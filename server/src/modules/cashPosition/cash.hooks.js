const { z } = require('zod');
const prisma = require('../../config/db');
const calc = require('./cash.calc');

// Phase 2: when a client invoice, vendor payment, expense or salary is marked paid, the money goes through a wallet.
// Only records created on or after the group's go-live date are affected; older ones are left exactly as they were
// (their payments are entered by hand in Book Keeping). Un-marking a payment (or deleting the record) removes the entry.

const KINDS = {
  invoice: { direction: 'in', label: 'Client invoice' },
  vendor_payment: { direction: 'out', label: 'Vendor payment' },
  expense: { direction: 'out', label: 'Expense reimbursement' },
  salary_run: { direction: 'out', label: 'Salary' },
};

const walletPaymentSchema = z.object({
  wallet_id: z.string().uuid(),
  mode: z.enum(calc.MODES),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Error codes added to the finance routes' own tables. */
const HOOK_ERRORS = {
  wallet_required: [422, 'Choose the wallet this payment went through (and how it was paid)'],
  wallet_not_allowed: [403, 'That wallet does not belong to this company'],
  wallet_currency: [422, "The wallet's currency is not the currency of this payment"],
  wallet_inactive: [409, 'That wallet is not active'],
};

const toDate = (s) => new Date(`${s}T00:00:00.000Z`);
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const plain = (o) => JSON.parse(JSON.stringify(o));

async function groupOf(client, orgId) {
  const org = await client.org.findUnique({ where: { id: orgId }, select: { org_group_id: true, default_currency: true } });
  return org;
}

async function getSetting(groupId) {
  const row = await prisma.groupCashSetting.findUnique({ where: { org_group_id: groupId } });
  return { go_live_date: row?.go_live_date ? ymd(row.go_live_date) : null };
}

async function setGoLive(groupIds, userId, date) {
  const groupId = groupIds[0];
  const row = await prisma.groupCashSetting.upsert({
    where: { org_group_id: groupId },
    create: { org_group_id: groupId, go_live_date: date ? toDate(date) : null, updated_by: userId },
    update: { go_live_date: date ? toDate(date) : null, updated_by: userId },
  });
  await prisma.walletAudit.create({ data: { org_group_id: groupId, entity_type: 'setting', entity_id: groupId, action: 'update', after: plain(row), actor_id: userId } });
  return { go_live_date: row.go_live_date ? ymd(row.go_live_date) : null };
}

/** Can this person put this wallet on a payment of this company? Its own wallets, or anything in the group for the group superadmin. */
async function walletAllowed(client, user, orgId, groupId, wallet) {
  if (wallet.org_group_id !== groupId) return false;
  if (wallet.owner_org_id === orgId || (wallet.owner_legal_entity && wallet.owner_legal_entity.workspace_id === orgId)) return true;
  const u = await client.user.findUnique({ where: { id: user.id }, select: { is_group_superadmin: true, active: true } });
  return Boolean(u?.is_group_superadmin && u.active);
}

/**
 * Called before a record is marked paid. Returns { error } to stop, or { post(client) } to run in the same transaction
 * as the record's own update. `record` = { id, created_at, currency, amount, date, party, category }.
 */
async function prepare({ orgId, user, kind, record, walletPayment }) {
  const org = await groupOf(prisma, orgId);
  if (!org) return { post: async () => null };
  const setting = await getSetting(org.org_group_id);
  const affected = setting.go_live_date && ymd(record.created_at) >= setting.go_live_date;
  if (!affected) return { post: async () => null };
  if (!walletPayment) return { error: 'wallet_required' };
  const wallet = await prisma.wallet.findUnique({ where: { id: walletPayment.wallet_id }, include: { owner_legal_entity: true } });
  if (!wallet || !(await walletAllowed(prisma, user, orgId, org.org_group_id, wallet))) return { error: 'wallet_not_allowed' };
  if (!wallet.active) return { error: 'wallet_inactive' };
  if (wallet.currency !== (record.currency || org.default_currency)) return { error: 'wallet_currency' };
  const cfg = KINDS[kind];
  return {
    post: async (client, over = {}) => {
      const referenceId = over.id || record.id;
      const data = {
        wallet_id: wallet.id, date: toDate(walletPayment.date || record.date), direction: cfg.direction, amount: record.amount, mode: walletPayment.mode,
        category: record.category || cfg.label, party: record.party || null, reference_type: kind, reference_id: referenceId, created_by: user.id,
      };
      const existing = await client.walletTransaction.findFirst({ where: { reference_type: kind, reference_id: referenceId, deleted_at: null } });
      const row = existing ? await client.walletTransaction.update({ where: { id: existing.id }, data }) : await client.walletTransaction.create({ data });
      await client.walletAudit.create({ data: { org_group_id: org.org_group_id, entity_type: 'transaction', entity_id: row.id, action: existing ? 'update' : 'create', before: existing ? plain(existing) : undefined, after: plain(row), actor_id: user.id } });
      return row;
    },
  };
}

/** The payment was un-marked, or its record deleted: the linked wallet entry goes (soft), with an audit record. */
async function unlink(client, userId, kind, referenceId) {
  const rows = await client.walletTransaction.findMany({ where: { reference_type: kind, reference_id: referenceId, deleted_at: null }, include: { wallet: true } });
  for (const row of rows) {
    await client.walletTransaction.update({ where: { id: row.id }, data: { deleted_at: new Date(), deleted_by: userId } });
    await client.walletAudit.create({ data: { org_group_id: row.wallet.org_group_id, entity_type: 'transaction', entity_id: row.id, action: 'delete', before: plain({ ...row, wallet: undefined }), actor_id: userId } });
  }
  return rows.length;
}

module.exports = { KINDS, HOOK_ERRORS, walletPaymentSchema, getSetting, setGoLive, prepare, unlink };
