const prisma = require('../../config/db');
const calc = require('./cash.calc');

const { D, money } = calc;

// Group cash (Group Dashboard > Cash Position). Legal entities own bank accounts, companies own wallets inside them.
// Every function takes the caller's holding group ids and only ever touches records of those groups. Writes are for the
// group superadmin; the company side (mine*) only reads wallets owned by the caller's own workspace.
// Nothing stores a balance: it is always derived from the opening balances and the live (not deleted) transactions.

const toDate = (s) => new Date(`${s}T00:00:00.000Z`);
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const plain = (o) => JSON.parse(JSON.stringify(o));

// Every cash record carries its holding group, so nothing needs a legal entity or a bank account to be found.
const grp = (groupIds) => ({ org_group_id: { in: groupIds } });
const walletInclude = {
  bank_account: { include: { legal_entity: true } },
  owner_org: { select: { id: true, name: true } },
  owner_legal_entity: true,
};

async function audit(client, groupId, entityType, entityId, action, before, after, actorId) {
  await client.walletAudit.create({ data: { org_group_id: groupId, entity_type: entityType, entity_id: entityId, action, before: before ? plain(before) : undefined, after: after ? plain(after) : undefined, actor_id: actorId || null } });
}

/** in - out of the live transactions of each wallet (optionally up to a date), as Decimals by wallet id. */
async function netByWallet(client, walletIds, { from, to } = {}) {
  if (!walletIds.length) return new Map();
  const date = {};
  if (from) date.gte = toDate(from);
  if (to) date.lte = toDate(to);
  const rows = await client.walletTransaction.groupBy({
    by: ['wallet_id', 'direction'],
    where: { wallet_id: { in: walletIds }, deleted_at: null, ...(from || to ? { date } : {}) },
    _sum: { amount: true },
  });
  const out = new Map(walletIds.map((id) => [id, calc.ZERO]));
  for (const r of rows) {
    const v = D(r._sum.amount);
    out.set(r.wallet_id, r.direction === 'in' ? out.get(r.wallet_id).plus(v) : out.get(r.wallet_id).minus(v));
  }
  return out;
}

async function loadWallet(client, groupIds, id) {
  return client.wallet.findFirst({ where: { id, ...grp(groupIds) }, include: walletInclude });
}

const ownerLabel = (w) => (w.owner_org ? w.owner_org.name : w.owner_legal_entity ? `${w.owner_legal_entity.name} (entity)` : 'No owner');

function walletView(w, net) {
  const balance = D(w.opening_balance).plus(net || calc.ZERO);
  return {
    id: w.id,
    name: w.name,
    purpose: w.purpose,
    active: w.active,
    bank_account_id: w.bank_account_id,
    currency: w.currency,
    bank_account_name: w.bank_account?.name || null,
    owner_org_id: w.owner_org_id,
    owner_legal_entity_id: w.owner_legal_entity_id,
    owner_name: ownerLabel(w),
    opening_balance: money(w.opening_balance),
    balance: money(balance),
    negative: balance.lt(0),
  };
}

// ---------------------------------------------------------------------------------------------------------------- entities

async function listEntities(groupIds) {
  const rows = await prisma.legalEntity.findMany({ where: { org_group_id: { in: groupIds } }, include: { workspace: { select: { id: true, name: true } }, _count: { select: { bank_accounts: true } } }, orderBy: { name: 'asc' } });
  return rows.map((e) => ({ ...e, workspace_name: e.workspace?.name || null, bank_accounts: e._count.bank_accounts, workspace: undefined, _count: undefined }));
}

async function orgInGroup(client, groupIds, orgId) {
  return client.org.findFirst({ where: { id: orgId, org_group_id: { in: groupIds } }, select: { id: true, name: true, org_group_id: true } });
}

const isDuplicate = (err) => err?.code === 'P2002';

async function createEntity(groupIds, userId, body) {
  if (body.workspace_id && !(await orgInGroup(prisma, groupIds, body.workspace_id))) return { error: 'workspace_not_found' };
  try {
    const row = await prisma.$transaction(async (tx) => {
      const e = await tx.legalEntity.create({ data: { org_group_id: groupIds[0], ...body, created_by: userId } });
      await audit(tx, e.org_group_id, 'legal_entity', e.id, 'create', null, e, userId);
      return e;
    });
    return { entity: row };
  } catch (err) {
    if (isDuplicate(err)) return { error: 'duplicate_entity' };
    throw err;
  }
}

async function updateEntity(groupIds, userId, id, body) {
  const before = await prisma.legalEntity.findFirst({ where: { id, org_group_id: { in: groupIds } } });
  if (!before) return { error: 'not_found' };
  if (body.workspace_id && !(await orgInGroup(prisma, groupIds, body.workspace_id))) return { error: 'workspace_not_found' };
  if (body.active === false && before.active && (await prisma.bankAccount.count({ where: { legal_entity_id: id, active: true } }))) return { error: 'entity_has_accounts' };
  try {
    const row = await prisma.$transaction(async (tx) => {
      const e = await tx.legalEntity.update({ where: { id }, data: body });
      await audit(tx, e.org_group_id, 'legal_entity', id, 'update', before, e, userId);
      return e;
    });
    return { entity: row };
  } catch (err) {
    if (isDuplicate(err)) return { error: 'duplicate_entity' };
    throw err;
  }
}

/** Delphic Global and Gulati Industries are both a workspace and a legal entity: create their entity records once, linked to the workspace. */
async function seedDefaultEntities(groupIds, userId) {
  const orgs = await prisma.org.findMany({ where: { org_group_id: { in: groupIds }, slug: { in: ['delphic', 'gulati'] } }, select: { id: true, name: true, org_group_id: true } });
  const made = [];
  for (const org of orgs) {
    const exists = await prisma.legalEntity.findFirst({ where: { org_group_id: org.org_group_id, OR: [{ workspace_id: org.id }, { name: org.name }] } });
    if (exists) continue;
    const r = await createEntity([org.org_group_id], userId, { name: org.name, workspace_id: org.id });
    if (r.entity) made.push(r.entity);
  }
  return { created: made };
}

// ---------------------------------------------------------------------------------------------------------------- accounts

/** What the setup still lacks: declared opening balance minus the wallets' opening balances. */
async function openingStatus(client, accountId) {
  const acc = await client.bankAccount.findUnique({ where: { id: accountId }, include: { wallets: { where: { active: true }, select: { opening_balance: true } } } });
  const gap = calc.openingGap(acc.declared_opening_balance, acc.wallets);
  return { declared: money(acc.declared_opening_balance), wallets_total: money(calc.sum(acc.wallets.map((w) => w.opening_balance))), difference: money(gap), balanced: gap.eq(0) };
}

const openingWarning = (status) => (status.balanced ? [] : [`The wallets' opening balances add up to ${status.wallets_total}, but the account declares ${status.declared} (difference ${status.difference}).`]);

async function createAccount(groupIds, userId, body) {
  // a legal entity is optional: an account can stand on its own
  const entity = body.legal_entity_id ? await prisma.legalEntity.findFirst({ where: { id: body.legal_entity_id, org_group_id: { in: groupIds } } }) : null;
  if (body.legal_entity_id && !entity) return { error: 'entity_not_found' };
  const isCash = body.type === 'cash';
  const data = { ...body, legal_entity_id: entity?.id ?? null, org_group_id: entity?.org_group_id || groupIds[0], bank_name: isCash ? null : body.bank_name ?? null, account_last4: isCash ? null : body.account_last4 ?? null, opening_date: toDate(body.opening_date), created_by: userId };
  // wallets are mapped to the account by hand later (Setup > Wallets); nothing is created or linked automatically
  return prisma.$transaction(async (tx) => {
    const account = await tx.bankAccount.create({ data });
    await audit(tx, account.org_group_id, 'bank_account', account.id, 'create', null, account, userId);
    return { account };
  });
}

async function updateAccount(groupIds, userId, id, body) {
  const before = await prisma.bankAccount.findFirst({ where: { id, ...grp(groupIds) }, include: { legal_entity: true } });
  if (!before) return { error: 'not_found' };
  if (body.legal_entity_id && !(await prisma.legalEntity.findFirst({ where: { id: body.legal_entity_id, org_group_id: before.org_group_id } }))) return { error: 'entity_not_found' };
  if (body.active === false) {
    const live = await prisma.wallet.findMany({ where: { bank_account_id: id, active: true }, select: { id: true, opening_balance: true } });
    const net = await netByWallet(prisma, live.map((w) => w.id));
    if (live.some((w) => !D(w.opening_balance).plus(net.get(w.id)).eq(0))) return { error: 'balance_not_zero' };
  }
  const data = { ...body, ...(body.opening_date ? { opening_date: toDate(body.opening_date) } : {}) };
  if (before.type === 'cash') { delete data.bank_name; delete data.account_last4; }
  const account = await prisma.$transaction(async (tx) => {
    const a = await tx.bankAccount.update({ where: { id }, data });
    await audit(tx, before.org_group_id, 'bank_account', id, 'update', before, a, userId);
    return a;
  });
  return { account, warnings: openingWarning(await openingStatus(prisma, id)) };
}

// ---------------------------------------------------------------------------------------------------------------- wallets

async function createWallet(groupIds, userId, body) {
  // the bank account is optional (map it later); a mapped wallet has the account's currency
  const account = body.bank_account_id ? await prisma.bankAccount.findFirst({ where: { id: body.bank_account_id, ...grp(groupIds) } }) : null;
  if (body.bank_account_id && !account) return { error: 'account_not_found' };
  if (account && !account.active) return { error: 'account_inactive' };
  if (account && body.currency && body.currency !== account.currency) return { error: 'currency_mismatch' };
  // at most one owner: a workspace or a legal entity (or none)
  if (body.owner_org_id && body.owner_legal_entity_id) return { error: 'one_owner' };
  if (body.owner_org_id && !(await orgInGroup(prisma, groupIds, body.owner_org_id))) return { error: 'owner_not_found' };
  if (body.owner_legal_entity_id && !(await prisma.legalEntity.findFirst({ where: { id: body.owner_legal_entity_id, org_group_id: { in: groupIds } } }))) return { error: 'owner_not_found' };
  const wallet = await prisma.$transaction(async (tx) => {
    const w = await tx.wallet.create({ data: { ...body, bank_account_id: account?.id ?? null, currency: account?.currency || body.currency || 'INR', org_group_id: account?.org_group_id || groupIds[0], created_by: userId }, include: walletInclude });
    await audit(tx, w.org_group_id, 'wallet', w.id, 'create', null, w, userId);
    return w;
  });
  return { wallet: walletView(wallet, calc.ZERO), warnings: account ? openingWarning(await openingStatus(prisma, account.id)) : [] };
}

async function updateWallet(groupIds, userId, id, body) {
  const before = await loadWallet(prisma, groupIds, id);
  if (!before) return { error: 'not_found' };
  if (before.purpose === 'unallocated' && (body.purpose || body.active === false)) return { error: 'unallocated_locked' };
  // moving a wallet to another owner: still exactly one owner (a company or a legal entity)
  const ownerChange = body.owner_org_id !== undefined || body.owner_legal_entity_id !== undefined;
  if (ownerChange) {
    const orgId = body.owner_org_id ?? null;
    const entityId = body.owner_legal_entity_id ?? null;
    if (orgId && entityId) return { error: 'one_owner' };
    if (orgId && !(await orgInGroup(prisma, groupIds, orgId))) return { error: 'owner_not_found' };
    if (entityId && !(await prisma.legalEntity.findFirst({ where: { id: entityId, org_group_id: { in: groupIds } } }))) return { error: 'owner_not_found' };
    body = { ...body, owner_org_id: orgId, owner_legal_entity_id: entityId };
  }
  if (body.active === false) {
    const net = (await netByWallet(prisma, [id])).get(id);
    if (!D(before.opening_balance).plus(net).eq(0)) return { error: 'balance_not_zero' };
  }
  // Mapping: which bank account this wallet's money sits in (null = none). Entries never change; only where the wallet is counted.
  if (body.bank_account_id !== undefined) {
    if (body.bank_account_id) {
      const account = await prisma.bankAccount.findFirst({ where: { id: body.bank_account_id, ...grp(groupIds) } });
      if (!account) return { error: 'account_not_found' };
      if (!account.active) return { error: 'account_inactive' };
      if (account.currency !== (body.currency || before.currency)) return { error: 'currency_mismatch' };
      body = { ...body, currency: account.currency };
    }
  } else if (body.currency && body.currency !== before.currency && before.bank_account_id) return { error: 'currency_mismatch' };
  const wallet = await prisma.$transaction(async (tx) => {
    const w = await tx.wallet.update({ where: { id }, data: body, include: walletInclude });
    await audit(tx, before.org_group_id, 'wallet', id, 'update', before, w, userId);
    return w;
  });
  const net = (await netByWallet(prisma, [id])).get(id);
  return { wallet: walletView(wallet, net), warnings: wallet.bank_account_id ? openingWarning(await openingStatus(prisma, wallet.bank_account_id)) : [] };
}

// ---------------------------------------------------------------------------------------------------------------- transactions

const txView = (t) => ({ ...t, date: ymd(t.date), amount: money(t.amount) });

async function walletBalanceOf(client, walletId) {
  const w = await client.wallet.findUnique({ where: { id: walletId }, select: { opening_balance: true } });
  const net = (await netByWallet(client, [walletId])).get(walletId);
  return D(w.opening_balance).plus(net);
}
const negativeWarning = (wallet, balance) => (balance.lt(0) ? [`${wallet.name} is now negative (${money(balance)}).`] : []);

async function createTransaction(groupIds, userId, walletId, body, attachment) {
  const wallet = await loadWallet(prisma, groupIds, walletId);
  if (!wallet) return { error: 'not_found' };
  if (!wallet.active) return { error: 'wallet_inactive' };
  const tx = await prisma.$transaction(async (client) => {
    const row = await client.walletTransaction.create({
      data: {
        wallet_id: walletId, date: toDate(body.date), direction: body.direction, amount: body.amount, mode: body.mode, category: body.category ?? null, party: body.party ?? null, notes: body.notes ?? null,
        reference_type: 'manual', attachment_url: attachment?.url || null, attachment_name: attachment?.name || null, created_by: userId,
      },
    });
    await audit(client, wallet.org_group_id, 'transaction', row.id, 'create', null, row, userId);
    return row;
  });
  return { transaction: txView(tx), warnings: negativeWarning(wallet, await walletBalanceOf(prisma, walletId)) };
}

async function loadTransaction(groupIds, id) {
  return prisma.walletTransaction.findFirst({ where: { id, deleted_at: null, wallet: grp(groupIds) }, include: { wallet: { include: walletInclude } } });
}

async function updateTransaction(groupIds, userId, id, body) {
  const before = await loadTransaction(groupIds, id);
  if (!before) return { error: 'not_found' };
  // a leg of a transfer is edited through its transfer, so both sides always agree
  if (before.transfer_id) return updateTransfer(groupIds, userId, before.transfer_id, { date: body.date, amount: body.amount, notes: body.notes });
  const data = { ...body, ...(body.date ? { date: toDate(body.date) } : {}) };
  const tx = await prisma.$transaction(async (client) => {
    const row = await client.walletTransaction.update({ where: { id }, data });
    await audit(client, before.wallet.org_group_id, 'transaction', id, 'update', before, row, userId);
    return row;
  });
  return { transaction: txView(tx), warnings: negativeWarning(before.wallet, await walletBalanceOf(prisma, before.wallet_id)) };
}

async function removeTransaction(groupIds, userId, id) {
  const before = await loadTransaction(groupIds, id);
  if (!before) return { error: 'not_found' };
  // deleting one side of a transfer deletes the whole transfer
  if (before.transfer_id) return removeTransfer(groupIds, userId, before.transfer_id);
  await prisma.$transaction(async (client) => {
    await client.walletTransaction.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: userId } });
    await audit(client, before.wallet.org_group_id, 'transaction', id, 'delete', before, null, userId);
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------- transfers

const transferView = (t, legs) => ({ ...t, date: ymd(t.date), amount: money(t.amount), ...(legs ? { transactions: legs.map(txView) } : {}) });

async function createTransfer(groupIds, userId, body) {
  if (body.from_wallet_id === body.to_wallet_id) return { error: 'same_wallet' };
  const [from, to] = await Promise.all([loadWallet(prisma, groupIds, body.from_wallet_id), loadWallet(prisma, groupIds, body.to_wallet_id)]);
  if (!from || !to) return { error: 'not_found' };
  if (!from.active || !to.active) return { error: 'wallet_inactive' };
  if (from.currency !== to.currency) return { error: 'currency_mismatch' };
  const kind = calc.transferKind(from, to);
  const intercompany = calc.isIntercompany(from, to);
  const result = await prisma.$transaction(async (client) => {
    const transfer = await client.walletTransfer.create({ data: { from_wallet_id: from.id, to_wallet_id: to.id, date: toDate(body.date), amount: body.amount, kind, is_intercompany: intercompany, notes: body.notes ?? null, created_by: userId } });
    const base = { date: transfer.date, amount: transfer.amount, mode: 'other', category: 'transfer', reference_type: 'transfer', transfer_id: transfer.id, notes: body.notes ?? null, created_by: userId };
    // exactly two entries, written together with the transfer or not at all
    const out = await client.walletTransaction.create({ data: { ...base, wallet_id: from.id, direction: 'out', party: to.name } });
    const inn = await client.walletTransaction.create({ data: { ...base, wallet_id: to.id, direction: 'in', party: from.name } });
    await audit(client, from.org_group_id, 'transfer', transfer.id, 'create', null, { ...transfer, legs: [out.id, inn.id] }, userId);
    return { transfer, legs: [out, inn] };
  });
  return { transfer: transferView(result.transfer, result.legs), warnings: negativeWarning(from, await walletBalanceOf(prisma, from.id)) };
}

async function loadTransfer(groupIds, id) {
  return prisma.walletTransfer.findFirst({ where: { id, deleted_at: null, from_wallet: grp(groupIds) }, include: { from_wallet: { include: walletInclude }, transactions: { where: { deleted_at: null } } } });
}

async function updateTransfer(groupIds, userId, id, body) {
  const before = await loadTransfer(groupIds, id);
  if (!before) return { error: 'not_found' };
  const data = {};
  if (body.date) data.date = toDate(body.date);
  if (body.amount) data.amount = body.amount;
  if (body.notes !== undefined) data.notes = body.notes;
  const result = await prisma.$transaction(async (client) => {
    const transfer = await client.walletTransfer.update({ where: { id }, data });
    await client.walletTransaction.updateMany({ where: { transfer_id: id, deleted_at: null }, data });
    const legs = await client.walletTransaction.findMany({ where: { transfer_id: id, deleted_at: null } });
    await audit(client, before.from_wallet.org_group_id, 'transfer', id, 'update', { ...before, from_wallet: undefined }, { ...transfer, legs }, userId);
    return { transfer, legs };
  });
  return { transfer: transferView(result.transfer, result.legs), warnings: negativeWarning(before.from_wallet, await walletBalanceOf(prisma, before.from_wallet_id)) };
}

async function removeTransfer(groupIds, userId, id) {
  const before = await loadTransfer(groupIds, id);
  if (!before) return { error: 'not_found' };
  const now = new Date();
  await prisma.$transaction(async (client) => {
    await client.walletTransaction.updateMany({ where: { transfer_id: id, deleted_at: null }, data: { deleted_at: now, deleted_by: userId } });
    await client.walletTransfer.update({ where: { id }, data: { deleted_at: now, deleted_by: userId } });
    await audit(client, before.from_wallet.org_group_id, 'transfer', id, 'delete', { ...before, from_wallet: undefined }, null, userId);
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------- the Cash Position view

/**
 * Legal entity > bank account > wallets, and the same wallets grouped by owner; INR and USD always totalled apart.
 * Nothing is mandatory: a bank account may have no legal entity (listed under "No legal entity"), and a wallet may be
 * mapped to no bank account (listed apart as "Not mapped"). A bank account's balance is the sum of the wallets mapped to it.
 */
async function position(groupIds, q = {}) {
  const walletInc = { where: { active: true }, include: { owner_org: { select: { id: true, name: true } }, owner_legal_entity: true }, orderBy: { name: 'asc' } };
  const [entities, accounts, loose] = await Promise.all([
    prisma.legalEntity.findMany({ where: { org_group_id: { in: groupIds }, active: true, ...(q.legal_entity_id ? { id: q.legal_entity_id } : {}) }, orderBy: { name: 'asc' } }),
    prisma.bankAccount.findMany({
      where: { ...grp(groupIds), active: true, ...(q.legal_entity_id ? { legal_entity_id: q.legal_entity_id } : {}), ...(q.type ? { type: q.type } : {}), ...(q.currency ? { currency: q.currency } : {}) },
      orderBy: { name: 'asc' },
      include: { legal_entity: true, wallets: walletInc },
    }),
    q.legal_entity_id || q.type ? [] : prisma.wallet.findMany({ where: { ...grp(groupIds), active: true, bank_account_id: null, ...(q.currency ? { currency: q.currency } : {}) }, include: { owner_org: { select: { id: true, name: true } }, owner_legal_entity: true }, orderBy: { name: 'asc' } }),
  ]);
  const walletIds = [...accounts.flatMap((a) => a.wallets.map((w) => w.id)), ...loose.map((w) => w.id)];
  const net = await netByWallet(prisma, walletIds);
  const accountsFlat = [];
  const accountView = (a) => {
    const all = a.wallets.map((w) => ({ ...walletView({ ...w, bank_account: a }, net.get(w.id)), legal_entity_id: a.legal_entity_id }));
    const balance = calc.sum(all.map((w) => w.balance));
    const wallets = q.workspace_id ? all.filter((w) => w.owner_org_id === q.workspace_id) : all;
    const view = {
      id: a.id, name: a.name, type: a.type, bank_name: a.bank_name, account_last4: a.account_last4, payment_instructions: a.payment_instructions, currency: a.currency, legal_entity_id: a.legal_entity_id, legal_entity_name: a.legal_entity?.name || null,
      balance: money(balance), shown_balance: money(calc.sum(wallets.map((w) => w.balance))), opening: { declared: money(a.declared_opening_balance), wallets_total: money(calc.sum(a.wallets.map((w) => w.opening_balance))) }, wallets,
    };
    view.opening.difference = money(D(view.opening.declared).minus(view.opening.wallets_total));
    // alert level: the whole account balance (not the filtered share) against the minimum the group set for it
    view.minimum_balance = a.minimum_balance == null ? null : money(a.minimum_balance);
    view.below_minimum = a.minimum_balance != null && D(balance).lt(D(a.minimum_balance));
    view.shortfall = view.below_minimum ? money(D(a.minimum_balance).minus(D(balance))) : null;
    view.warnings = [...(D(view.opening.difference).eq(0) ? [] : [`Opening balances differ by ${view.opening.difference}`]), ...wallets.filter((w) => w.negative).map((w) => `${w.name} is negative`)];
    accountsFlat.push(view);
    return view;
  };
  const byEntity = new Map();
  for (const a of accounts) {
    const key = a.legal_entity_id || 'none';
    if (!byEntity.has(key)) byEntity.set(key, []);
    byEntity.get(key).push(accountView(a));
  }
  const shape = (e, list) => {
    const rows = list.filter((a) => !q.workspace_id || a.wallets.length);
    return { id: e.id, name: e.name, workspace_id: e.workspace_id || null, accounts: rows, totals: calc.totalsByCurrency(rows, (a) => a.shown_balance) };
  };
  const tree = entities.map((e) => shape(e, byEntity.get(e.id) || [])).filter((e) => e.accounts.length || (!q.workspace_id && !q.type && !q.currency));
  if (byEntity.has('none')) tree.push(shape({ id: null, name: 'No legal entity' }, byEntity.get('none')));

  const unmapped = loose.map((w) => ({ ...walletView(w, net.get(w.id)), bank_account_name: null })).filter((w) => !q.workspace_id || w.owner_org_id === q.workspace_id);

  // fund view: workspace -> its wallets across every bank account; entity-owned wallets sit under "<entity> (entity)"; no owner under "No owner"
  const owners = new Map();
  const addToFund = (w, extra) => {
    const key = w.owner_org_id ? `org:${w.owner_org_id}` : w.owner_legal_entity_id ? `entity:${w.owner_legal_entity_id}` : 'none';
    if (!owners.has(key)) owners.set(key, { key, owner_org_id: w.owner_org_id, name: w.owner_name, wallets: [] });
    owners.get(key).wallets.push({ ...w, ...extra });
  };
  for (const a of accountsFlat) for (const w of a.wallets) addToFund(w, { bank_account_name: a.name, legal_entity_name: a.legal_entity_name, type: a.type, currency: a.currency });
  for (const w of unmapped) addToFund(w, { bank_account_name: 'Not mapped', legal_entity_name: null, type: null });
  const funds = [...owners.values()].map((o) => ({ ...o, totals: calc.totalsByCurrency(o.wallets, (w) => w.balance) })).sort((x, y) => x.name.localeCompare(y.name));
  const belowMinimum = accountsFlat.filter((a) => a.below_minimum).map((a) => ({ id: a.id, name: a.name, currency: a.currency, balance: a.balance, minimum_balance: a.minimum_balance, shortfall: a.shortfall, legal_entity_name: a.legal_entity_name }));
  return { entities: tree, below_minimum: belowMinimum, unmapped_wallets: unmapped, unmapped_totals: calc.totalsByCurrency(unmapped, (w) => w.balance), funds, totals: calc.totalsByCurrency(tree.flatMap((e) => e.accounts), (a) => a.shown_balance) };
}

/** Pick-lists for the forms: entities, workspaces, accounts and wallets. */
async function options(groupIds) {
  const [entities, workspaces, accounts, wallets] = await Promise.all([
    prisma.legalEntity.findMany({ where: { org_group_id: { in: groupIds } }, select: { id: true, name: true, workspace_id: true, active: true }, orderBy: { name: 'asc' } }),
    prisma.org.findMany({ where: { org_group_id: { in: groupIds }, status: 'active' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.bankAccount.findMany({ where: { active: true, ...grp(groupIds) }, select: { id: true, name: true, type: true, currency: true, legal_entity_id: true, declared_opening_balance: true, minimum_balance: true, opening_date: true }, orderBy: { name: 'asc' } }),
    prisma.wallet.findMany({ where: { active: true, ...grp(groupIds) }, include: walletInclude, orderBy: { name: 'asc' } }),
  ]);
  return {
    entities, workspaces, modes: calc.MODES, currencies: calc.CURRENCIES,
    accounts: accounts.map((a) => ({ ...a, declared_opening_balance: money(a.declared_opening_balance), minimum_balance: a.minimum_balance == null ? null : money(a.minimum_balance), opening_date: ymd(a.opening_date) })),
    wallets: wallets.map((w) => ({ id: w.id, name: w.name, purpose: w.purpose, bank_account_id: w.bank_account_id, bank_account_name: w.bank_account?.name || null, currency: w.currency, owner_name: ownerLabel(w), owner_org_id: w.owner_org_id })),
  };
}

// ---------------------------------------------------------------------------------------------------------------- wallet entries + receipts

/** All live entries of a wallet in a date range, with the running balance, a breakdown by mode and the totals. */
async function entriesFor(wallet, { from, to } = {}) {
  const openingBefore = from ? D(wallet.opening_balance).plus((await netByWallet(prisma, [wallet.id], { to: ymd(new Date(toDate(from).getTime() - 86400000)) })).get(wallet.id)) : D(wallet.opening_balance);
  const date = {};
  if (from) date.gte = toDate(from);
  if (to) date.lte = toDate(to);
  const rows = await prisma.walletTransaction.findMany({ where: { wallet_id: wallet.id, deleted_at: null, ...(from || to ? { date } : {}) }, orderBy: [{ date: 'asc' }, { created_at: 'asc' }] });
  const withBalance = calc.withRunningBalance(openingBefore, rows).map((r) => ({ ...txView(r), balance_after: r.balance_after }));
  const totalIn = calc.sum(rows.filter((r) => r.direction === 'in').map((r) => r.amount));
  const totalOut = calc.sum(rows.filter((r) => r.direction === 'out').map((r) => r.amount));
  return {
    wallet: { id: wallet.id, name: wallet.name, owner_name: ownerLabel(wallet), bank_account_name: wallet.bank_account?.name || 'Not mapped to a bank account', legal_entity_name: wallet.bank_account?.legal_entity?.name || '', currency: wallet.currency },
    from: from || null, to: to || null,
    opening_balance: money(openingBefore), total_in: money(totalIn), total_out: money(totalOut), closing_balance: money(openingBefore.plus(totalIn).minus(totalOut)),
    by_mode: calc.modeBreakdown(rows), rows: withBalance,
  };
}

async function walletEntries(groupIds, walletId, q) {
  const wallet = await loadWallet(prisma, groupIds, walletId);
  return wallet ? entriesFor(wallet, q) : null;
}

/** "Delphic Global received 4 payments: these amounts, by these modes". Transfers between wallets are not receipts. */
async function receipts(groupIds, q = {}) {
  const date = {};
  if (q.from) date.gte = toDate(q.from);
  if (q.to) date.lte = toDate(q.to);
  const rows = await prisma.walletTransaction.findMany({
    where: {
      direction: 'in', deleted_at: null, reference_type: { not: 'transfer' }, ...(q.from || q.to ? { date } : {}),
      wallet: { ...grp(groupIds), ...(q.wallet_id ? { id: q.wallet_id } : {}), ...(q.workspace_id ? { owner_org_id: q.workspace_id } : {}) },
    },
    include: { wallet: { include: walletInclude } },
    orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
  });
  const groups = new Map();
  for (const r of rows) {
    const key = r.wallet.owner_org_id || `entity:${r.wallet.owner_legal_entity_id}`;
    if (!groups.has(key)) groups.set(key, { owner_name: ownerLabel(r.wallet), items: [] });
    groups.get(key).items.push(r);
  }
  const summary = [...groups.values()].map((g) => {
    const byCurrency = {};
    for (const r of g.items) {
      const cur = r.wallet.currency;
      const c = (byCurrency[cur] ||= { total: calc.ZERO, by_mode: {} });
      c.total = c.total.plus(D(r.amount));
      c.by_mode[r.mode] = D(c.by_mode[r.mode] || 0).plus(D(r.amount));
    }
    return {
      owner_name: g.owner_name, count: g.items.length,
      by_currency: Object.fromEntries(Object.entries(byCurrency).map(([cur, v]) => [cur, { total: money(v.total), by_mode: Object.fromEntries(Object.entries(v.by_mode).map(([m, x]) => [m, money(x)])) }])),
    };
  }).sort((a, b) => a.owner_name.localeCompare(b.owner_name));
  return {
    from: q.from || null, to: q.to || null, summary, totals: calc.totalsByCurrency(rows.map((r) => ({ currency: r.wallet.currency, amount: r.amount })), (r) => r.amount),
    rows: rows.map((r) => ({ id: r.id, date: ymd(r.date), owner_name: ownerLabel(r.wallet), wallet: r.wallet.name, bank_account: r.wallet.bank_account?.name || '', currency: r.wallet.currency, amount: money(r.amount), mode: r.mode, party: r.party, category: r.category, notes: r.notes })),
  };
}

// ---------------------------------------------------------------------------------------------------------------- reconciliation

/** What the system says the account held at the end of a day: wallet openings (once the account is open) + entries up to that day. */
async function systemBalanceAt(client, account, date) {
  if (account.opening_date > toDate(date)) return calc.ZERO;
  const wallets = await client.wallet.findMany({ where: { bank_account_id: account.id }, select: { id: true, opening_balance: true } });
  const net = await netByWallet(client, wallets.map((w) => w.id), { to: date });
  return wallets.reduce((acc, w) => acc.plus(D(w.opening_balance)).plus(net.get(w.id)), calc.ZERO);
}

async function previewReconciliation(groupIds, { bank_account_id, statement_date, statement_balance }) {
  const account = await prisma.bankAccount.findFirst({ where: { id: bank_account_id, ...grp(groupIds) } });
  if (!account) return { error: 'not_found' };
  const system = await systemBalanceAt(prisma, account, statement_date);
  return { bank_account_id, statement_date, currency: account.currency, system_balance: money(system), statement_balance: money(statement_balance), difference: money(D(statement_balance).minus(system)) };
}

async function createReconciliation(groupIds, userId, body) {
  const account = await prisma.bankAccount.findFirst({ where: { id: body.bank_account_id, ...grp(groupIds) }, include: { legal_entity: true } });
  if (!account) return { error: 'not_found' };
  const row = await prisma.$transaction(async (client) => {
    const system = await systemBalanceAt(client, account, body.statement_date);
    const r = await client.bankReconciliation.create({
      data: { bank_account_id: account.id, statement_date: toDate(body.statement_date), statement_balance: body.statement_balance, system_balance: system, difference: D(body.statement_balance).minus(system), notes: body.notes ?? null, created_by: userId },
    });
    await audit(client, account.org_group_id, 'reconciliation', r.id, 'create', null, r, userId);
    return r;
  });
  return { reconciliation: reconView(row, account) };
}

const reconView = (r, account) => ({ id: r.id, bank_account_id: r.bank_account_id, bank_account_name: account?.name, currency: account?.currency, statement_date: ymd(r.statement_date), statement_balance: money(r.statement_balance), system_balance: money(r.system_balance), difference: money(r.difference), notes: r.notes, created_at: r.created_at });

async function listReconciliations(groupIds, { bank_account_id } = {}) {
  const rows = await prisma.bankReconciliation.findMany({ where: { deleted_at: null, ...(bank_account_id ? { bank_account_id } : {}), bank_account: grp(groupIds) }, include: { bank_account: true }, orderBy: [{ statement_date: 'desc' }, { created_at: 'desc' }], take: 200 });
  return rows.map((r) => reconView(r, r.bank_account));
}

/** Fixing a saved reconciliation: the system balance is worked out again for the (possibly new) date. */
async function updateReconciliation(groupIds, userId, id, body) {
  const before = await prisma.bankReconciliation.findFirst({ where: { id, deleted_at: null, bank_account: grp(groupIds) }, include: { bank_account: { include: { legal_entity: true } } } });
  if (!before) return { error: 'not_found' };
  const date = body.statement_date || ymd(before.statement_date);
  const statement = body.statement_balance ?? before.statement_balance;
  const row = await prisma.$transaction(async (client) => {
    const system = await systemBalanceAt(client, before.bank_account, date);
    const r = await client.bankReconciliation.update({ where: { id }, data: { statement_date: toDate(date), statement_balance: statement, system_balance: system, difference: D(statement).minus(system), ...(body.notes !== undefined ? { notes: body.notes } : {}) } });
    await audit(client, before.bank_account.org_group_id, 'reconciliation', id, 'update', before.bank_account && { ...before, bank_account: undefined }, r, userId);
    return r;
  });
  return { reconciliation: reconView(row, before.bank_account) };
}

async function removeReconciliation(groupIds, userId, id) {
  const before = await prisma.bankReconciliation.findFirst({ where: { id, deleted_at: null, bank_account: grp(groupIds) }, include: { bank_account: { include: { legal_entity: true } } } });
  if (!before) return { error: 'not_found' };
  await prisma.$transaction(async (client) => {
    await client.bankReconciliation.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: userId } });
    await audit(client, before.bank_account.org_group_id, 'reconciliation', id, 'delete', { ...before, bank_account: undefined }, null, userId);
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------- delete (Setup)

/** A legal entity can be deleted only while nothing hangs on it. Otherwise switch it off. */
async function removeEntity(groupIds, userId, id) {
  const before = await prisma.legalEntity.findFirst({ where: { id, org_group_id: { in: groupIds } } });
  if (!before) return { error: 'not_found' };
  const [accounts, wallets, invoices] = await Promise.all([
    prisma.bankAccount.count({ where: { legal_entity_id: id } }),
    prisma.wallet.count({ where: { owner_legal_entity_id: id } }),
    prisma.groupInvoice.count({ where: { legal_entity_id: id } }),
  ]);
  if (accounts || wallets || invoices) return { error: 'entity_in_use' };
  await prisma.$transaction(async (tx) => {
    await tx.invoiceCounter.deleteMany({ where: { legal_entity_id: id } });
    await tx.legalEntity.delete({ where: { id } });
    await audit(tx, before.org_group_id, 'legal_entity', id, 'delete', before, null, userId);
  });
  return { ok: true };
}

/** A bank account is deleted only once no wallet is mapped to it; its saved reconciliations go with it. */
async function removeAccount(groupIds, userId, id) {
  const before = await prisma.bankAccount.findFirst({ where: { id, ...grp(groupIds) } });
  if (!before) return { error: 'not_found' };
  if (await prisma.wallet.count({ where: { bank_account_id: id } })) return { error: 'account_has_wallets' };
  await prisma.$transaction(async (tx) => {
    await tx.bankReconciliation.deleteMany({ where: { bank_account_id: id } });
    await tx.bankAccount.delete({ where: { id } });
    await audit(tx, before.org_group_id, 'bank_account', id, 'delete', before, null, userId);
  });
  return { ok: true };
}

/** A wallet is deleted only while it has no entries at all (not even deleted ones); otherwise switch it off. */
async function removeWallet(groupIds, userId, id) {
  const before = await loadWallet(prisma, groupIds, id);
  if (!before) return { error: 'not_found' };
  const [entries, transfers, invoices] = await Promise.all([
    prisma.walletTransaction.count({ where: { wallet_id: id } }),
    prisma.walletTransfer.count({ where: { OR: [{ from_wallet_id: id }, { to_wallet_id: id }] } }),
    prisma.groupInvoice.count({ where: { receiving_wallet_id: id } }),
  ]);
  if (entries || transfers || invoices) return { error: 'wallet_in_use' };
  // With no entries the balance is just the opening balance: a wallet holding money is switched off, not deleted.
  if (Number(before.opening_balance) !== 0) return { error: 'wallet_has_balance' };
  await prisma.$transaction(async (tx) => {
    await tx.wallet.delete({ where: { id } });
    await audit(tx, before.org_group_id, 'wallet', id, 'delete', { ...before, bank_account: undefined, owner_org: undefined, owner_legal_entity: undefined }, null, userId);
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------- bank account statement

/** A bank account's statement: every live entry of the wallets mapped to it, date-wise, with the running balance of the account. */
async function accountEntries(groupIds, accountId, { from, to } = {}) {
  const account = await prisma.bankAccount.findFirst({ where: { id: accountId, ...grp(groupIds) }, include: { legal_entity: true, wallets: { select: { id: true, name: true, opening_balance: true } } } });
  if (!account) return null;
  const ids = account.wallets.map((w) => w.id);
  const names = new Map(account.wallets.map((w) => [w.id, w.name]));
  const openingTotal = calc.sum(account.wallets.map((w) => w.opening_balance));
  const before = from ? await netByWallet(prisma, ids, { to: ymd(new Date(toDate(from).getTime() - 86400000)) }) : null;
  const opening = before ? [...before.values()].reduce((acc, v) => acc.plus(v), openingTotal) : openingTotal;
  const date = {};
  if (from) date.gte = toDate(from);
  if (to) date.lte = toDate(to);
  const rows = ids.length ? await prisma.walletTransaction.findMany({ where: { wallet_id: { in: ids }, deleted_at: null, ...(from || to ? { date } : {}) }, orderBy: [{ date: 'asc' }, { created_at: 'asc' }] }) : [];
  const withBalance = calc.withRunningBalance(opening, rows).map((r) => ({ ...txView(r), wallet: names.get(r.wallet_id), balance_after: r.balance_after }));
  const totalIn = calc.sum(rows.filter((r) => r.direction === 'in').map((r) => r.amount));
  const totalOut = calc.sum(rows.filter((r) => r.direction === 'out').map((r) => r.amount));
  return {
    wallet: { id: account.id, name: account.name, owner_name: `${account.wallets.length} wallet${account.wallets.length === 1 ? '' : 's'} mapped`, bank_account_name: account.name, legal_entity_name: account.legal_entity?.name || '', currency: account.currency },
    from: from || null, to: to || null,
    opening_balance: money(opening), total_in: money(totalIn), total_out: money(totalOut), closing_balance: money(opening.plus(totalIn).minus(totalOut)),
    by_mode: calc.modeBreakdown(rows), rows: withBalance,
  };
}

/**
 * One statement for any scope the Statements screen can pick: a bank account, a wallet, a company (the wallets it owns) or a legal
 * entity (the wallets in its bank accounts, plus the ones it owns). A company / entity can hold INR and USD wallets, which are never
 * added together, so those need `currency` (error `currency_required` when it is missing and the wallets span both).
 */
async function statement(groupIds, { scope, id, currency, from, to }) {
  if (scope === 'account') return accountEntries(groupIds, id, { from, to }).then((d) => (d ? { data: d } : { error: 'not_found' }));
  if (scope === 'wallet') return walletEntries(groupIds, id, { from, to }).then((d) => (d ? { data: d } : { error: 'not_found' }));

  let label;
  let where;
  if (scope === 'company') {
    const org = await prisma.org.findFirst({ where: { id, org_group_id: { in: groupIds } }, select: { id: true, name: true } });
    if (!org) return { error: 'not_found' };
    label = { name: org.name, owner: 'Company statement', entity: '' };
    where = { owner_org_id: id };
  } else {
    const entity = await prisma.legalEntity.findFirst({ where: { id, org_group_id: { in: groupIds } }, select: { id: true, name: true } });
    if (!entity) return { error: 'not_found' };
    label = { name: entity.name, owner: 'Legal entity statement', entity: entity.name };
    where = { OR: [{ owner_legal_entity_id: id }, { bank_account: { legal_entity_id: id } }] };
  }
  const found = await prisma.wallet.findMany({ where: { ...grp(groupIds), ...where }, include: walletInclude, orderBy: { name: 'asc' } });
  const currencies = [...new Set(found.map((w) => w.currency))];
  if (!currency && currencies.length > 1) return { error: 'currency_required' };
  const cur = currency || currencies[0] || 'INR';
  const wallets = found.filter((w) => w.currency === cur);
  const ids = wallets.map((w) => w.id);
  const names = new Map(wallets.map((w) => [w.id, w.name]));
  const openingTotal = calc.sum(wallets.map((w) => w.opening_balance));
  const before = from && ids.length ? await netByWallet(prisma, ids, { to: ymd(new Date(toDate(from).getTime() - 86400000)) }) : null;
  const opening = before ? [...before.values()].reduce((acc, v) => acc.plus(v), openingTotal) : openingTotal;
  const date = {};
  if (from) date.gte = toDate(from);
  if (to) date.lte = toDate(to);
  const rows = ids.length ? await prisma.walletTransaction.findMany({ where: { wallet_id: { in: ids }, deleted_at: null, ...(from || to ? { date } : {}) }, orderBy: [{ date: 'asc' }, { created_at: 'asc' }] }) : [];
  const withBalance = calc.withRunningBalance(opening, rows).map((r) => ({ ...txView(r), wallet: names.get(r.wallet_id), balance_after: r.balance_after }));
  const totalIn = calc.sum(rows.filter((r) => r.direction === 'in').map((r) => r.amount));
  const totalOut = calc.sum(rows.filter((r) => r.direction === 'out').map((r) => r.amount));
  return {
    data: {
      wallet: { id, name: label.name, owner_name: `${label.owner}: ${wallets.length} wallet${wallets.length === 1 ? '' : 's'} in ${cur}`, bank_account_name: label.owner, legal_entity_name: label.entity, currency: cur },
      currencies, from: from || null, to: to || null,
      opening_balance: money(opening), total_in: money(totalIn), total_out: money(totalOut), closing_balance: money(opening.plus(totalIn).minus(totalOut)),
      by_mode: calc.modeBreakdown(rows), rows: withBalance,
    },
  };
}

/** Everything the Setup screen lists, switched-off accounts and wallets included, so nothing can get stuck switched off. */
async function setupLists(groupIds) {
  const [entities, accounts, wallets] = await Promise.all([
    listEntities(groupIds),
    prisma.bankAccount.findMany({ where: grp(groupIds), include: { legal_entity: { select: { id: true, name: true } } }, orderBy: [{ legal_entity_id: 'asc' }, { name: 'asc' }] }),
    prisma.wallet.findMany({ where: grp(groupIds), include: walletInclude, orderBy: { name: 'asc' } }),
  ]);
  const net = await netByWallet(prisma, wallets.map((w) => w.id));
  return {
    entities,
    accounts: accounts.map((a) => ({
      id: a.id, name: a.name, type: a.type, bank_name: a.bank_name, account_last4: a.account_last4, currency: a.currency, active: a.active, payment_instructions: a.payment_instructions,
      declared_opening_balance: money(a.declared_opening_balance), minimum_balance: a.minimum_balance == null ? null : money(a.minimum_balance), opening_date: ymd(a.opening_date), legal_entity_id: a.legal_entity_id, legal_entity_name: a.legal_entity?.name || null,
    })),
    wallets: wallets.map((w) => ({ ...walletView(w, net.get(w.id)), bank_account_name: w.bank_account?.name || null })),
  };
}

async function listAudit(groupIds, { entity_type, entity_id, limit = 50 } = {}) {
  return prisma.walletAudit.findMany({ where: { org_group_id: { in: groupIds }, ...(entity_type ? { entity_type } : {}), ...(entity_id ? { entity_id } : {}) }, orderBy: { created_at: 'desc' }, take: limit });
}

// ---------------------------------------------------------------------------------------------------------------- the company side (read only)

/** A workspace admin sees only the wallets their workspace owns: the parent account's name, never its total or other owners' wallets. */
async function myWallets(orgId) {
  const wallets = await prisma.wallet.findMany({ where: { owner_org_id: orgId, active: true }, include: walletInclude, orderBy: { name: 'asc' } });
  const net = await netByWallet(prisma, wallets.map((w) => w.id));
  return wallets.map((w) => ({ ...walletView(w, net.get(w.id)), bank_account_name: w.bank_account?.name || null, legal_entity_name: w.bank_account?.legal_entity?.name || null, bank_account_type: w.bank_account?.type || null }));
}

async function myWalletEntries(orgId, walletId, q) {
  const wallet = await prisma.wallet.findFirst({ where: { id: walletId, owner_org_id: orgId }, include: walletInclude });
  return wallet ? entriesFor(wallet, q) : null;
}

/** Who may download a wallet entry's attachment: the group superadmin of its group, or an admin of the owning workspace. */
async function canReadAttachment(user, fileUrl) {
  const tx = await prisma.walletTransaction.findFirst({ where: { attachment_url: fileUrl, deleted_at: null }, include: { wallet: { include: walletInclude } } });
  if (!tx) return null;
  const w = tx.wallet;
  if (user.role === 'admin' && w.owner_org_id && w.owner_org_id === user.org_id) return { label: tx.attachment_name };
  const u = await prisma.user.findUnique({ where: { id: user.id }, select: { is_group_superadmin: true, active: true, org_group_memberships: { select: { org_group_id: true } } } });
  if (!u?.active || !u.is_group_superadmin) return false;
  const groups = u.org_group_memberships.map((m) => m.org_group_id);
  const ok = groups.length ? groups.includes(w.org_group_id) : true;
  return ok ? { label: tx.attachment_name } : false;
}

module.exports = {
  listEntities, createEntity, updateEntity, seedDefaultEntities,
  createAccount, updateAccount, createWallet, updateWallet,
  createTransaction, updateTransaction, removeTransaction,
  createTransfer, updateTransfer, removeTransfer,
  updateReconciliation, removeReconciliation, setupLists, removeEntity, removeAccount, removeWallet, accountEntries,
  position, options, walletEntries, receipts, previewReconciliation, createReconciliation, listReconciliations, listAudit,
  myWallets, myWalletEntries, canReadAttachment, statement };
