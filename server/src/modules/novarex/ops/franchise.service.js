const { z, prisma, fail, num, round2, today, dayOf, toDate, addDays, text, optDate, uuid, optNum, lockGuard, lockTouch, audit, categoryId, gstSplit, priceLines, outletAllowed } = require('./common');
const billing = require('./billing.service');
const core = require('../core.service');
const stock = require('./stock.service');

// Franchise and third-party partners. Novarex books only what it is owed or sells to the partner: goods invoiced to it (sales invoices
// to the outlet's customer), franchise fees, royalties and revenue shares (franchise invoices -> income entries on that outlet). The
// partner's own retail sales, salaries and expenses are NEVER Novarex income or cost; the reported sales figure on a settlement is only
// the basis for the royalty and is not posted as revenue.
const fields = {
  outlet_id: uuid, partner_name: z.string().trim().min(1).max(250), start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end_date: optDate, initial_fee: optNum(0), royalty_pct: optNum(0, 100), revenue_share_pct: optNum(0, 100),
  purchase_discount_pct: optNum(0, 100), security_deposit: optNum(0), payment_terms: text(300), status: z.enum(['draft', 'active', 'expired', 'terminated']).optional(), renewal_date: optDate, terms: text(4000), notes: text(2000),
};
const createSchema = z.object(fields);
const updateSchema = z.object(fields).partial().extend({ reason: text(300) });
const DATE = ['start_date', 'end_date', 'renewal_date'];
const toData = (i) => { const d = { ...i }; for (const k of DATE) if (k in d) d[k] = toDate(d[k]); return d; };

async function outletKind(tx, orgId, outletId) {
  const o = await tx.nxOutlet.findFirst({ where: { id: outletId, org_id: orgId }, include: { ownership_type: { select: { kind: true, name: true } } } });
  if (!o) fail('invalid_ref', 'outlet');
  return o;
}

const out = (a, extra = {}) => ({ id: a.id, outlet_id: a.outlet_id, partner_name: a.partner_name, start_date: dayOf(a.start_date), end_date: dayOf(a.end_date), initial_fee: num(a.initial_fee), royalty_pct: num(a.royalty_pct), revenue_share_pct: num(a.revenue_share_pct), purchase_discount_pct: num(a.purchase_discount_pct), security_deposit: num(a.security_deposit), payment_terms: a.payment_terms, status: a.status, renewal_date: dayOf(a.renewal_date), terms: a.terms, notes: a.notes, ...extra });

async function list(orgId, f = {}, scope, warnDays = 60) {
  const where = { org_id: orgId, deleted_at: null, ...(f.status ? { status: f.status } : {}) };
  if (scope) where.outlet_id = f.outlet_id && scope.includes(f.outlet_id) ? f.outlet_id : { in: scope };
  else if (f.outlet_id) where.outlet_id = f.outlet_id;
  const rows = await prisma.nxFranchiseAgreement.findMany({ where, orderBy: { created_at: 'desc' }, take: 500 });
  const O = stock.mapBy(await prisma.nxOutlet.findMany({ where: { org_id: orgId }, select: { id: true, name: true, code: true } }));
  const t = today(); const warn = addDays(t, warnDays);
  const invs = await prisma.nxInvoice.findMany({ where: { org_id: orgId, deleted_at: null, status: { not: 'cancelled' }, outlet_id: { in: rows.map((r) => r.outlet_id) }, type: { in: ['sales', 'franchise'] } } });
  return rows.map((a) => {
    const mine = invs.filter((i) => i.outlet_id === a.outlet_id);
    const end = dayOf(a.renewal_date) || dayOf(a.end_date);
    return out(a, { outlet: O.get(a.outlet_id)?.name, outlet_code: O.get(a.outlet_id)?.code, receivable: round2(mine.reduce((s, i) => s + billing.outstandingOf(i), 0)), fees_invoiced: round2(mine.filter((i) => i.type === 'franchise').reduce((s, i) => s + num(i.total), 0)), expired: a.status === 'active' && Boolean(dayOf(a.end_date)) && dayOf(a.end_date) < t, renewal_due: a.status === 'active' && Boolean(end) && end <= warn });
  });
}

async function get(orgId, id, scope) {
  const a = await prisma.nxFranchiseAgreement.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!a) fail('not_found');
  if (!outletAllowed(scope, a.outlet_id)) fail('forbidden_outlet');
  return out(a);
}

async function create(orgId, actorId, body) {
  const input = createSchema.parse(body);
  return prisma.$transaction(async (tx) => {
    const o = await outletKind(tx, orgId, input.outlet_id);
    if (!['franchise', 'third_party'].includes(o.ownership_type?.kind)) fail('not_franchise_outlet');
    if ((input.status || 'draft') === 'active' && (await tx.nxFranchiseAgreement.findFirst({ where: { org_id: orgId, outlet_id: input.outlet_id, status: 'active', deleted_at: null } }))) fail('agreement_overlap');
    const a = await tx.nxFranchiseAgreement.create({ data: { ...toData(input), org_id: orgId, created_by: actorId } });
    await audit(tx, orgId, actorId, 'franchise_agreement', a.id, 'create', null, { partner: a.partner_name, royalty_pct: num(a.royalty_pct) });
    return out(a);
  });
}

async function update(orgId, actorId, id, body) {
  const input = updateSchema.parse(body || {});
  const { reason, ...rest } = input;
  return prisma.$transaction(async (tx) => {
    const before = await tx.nxFranchiseAgreement.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
    if (!before) fail('not_found');
    const outlet_id = rest.outlet_id || before.outlet_id;
    if (rest.outlet_id) { const o = await outletKind(tx, orgId, outlet_id); if (!['franchise', 'third_party'].includes(o.ownership_type?.kind)) fail('not_franchise_outlet'); }
    if ((rest.status || before.status) === 'active' && (await tx.nxFranchiseAgreement.findFirst({ where: { org_id: orgId, outlet_id, status: 'active', deleted_at: null, NOT: { id } } }))) fail('agreement_overlap');
    const row = await tx.nxFranchiseAgreement.update({ where: { id }, data: { ...toData(rest), updated_by: actorId } });
    await audit(tx, orgId, actorId, 'franchise_agreement', id, 'update', { royalty_pct: num(before.royalty_pct), status: before.status, purchase_discount_pct: num(before.purchase_discount_pct) }, { royalty_pct: num(row.royalty_pct), status: row.status, purchase_discount_pct: num(row.purchase_discount_pct) }, reason);
    return out(row);
  });
}

async function archive(orgId, actorId, id, reason) {
  const a = await prisma.nxFranchiseAgreement.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!a) fail('not_found');
  await prisma.nxFranchiseAgreement.update({ where: { id }, data: { deleted_at: new Date(), status: a.status === 'active' ? 'terminated' : a.status } });
  await audit(prisma, orgId, actorId, 'franchise_agreement', id, 'archive', { partner: a.partner_name }, null, reason);
  return { id };
}

// ---------------- settlements ----------------
const sFields = { agreement_id: uuid, month: z.string().regex(/^\d{4}-\d{2}$/), kind: z.enum(['royalty', 'fee', 'initial_fee']).optional(), reported_sales: optNum(0), basis_visible: z.boolean().optional(), fee_due: optNum(0), notes: text(1000) };
const sCreate = z.object(sFields);
const sUpdate = z.object(sFields).partial().extend({ reason: text(300) });
const compute = (a, s) => {
  const base = s.basis_visible === false ? 0 : num(s.reported_sales);
  const royalty = round2((base * num(a.royalty_pct)) / 100); const share = round2((base * num(a.revenue_share_pct)) / 100);
  const fee = s.kind === 'initial_fee' && s.fee_due === undefined ? num(a.initial_fee) : num(s.fee_due);
  return { royalty_due: royalty, share_due: share, fee_due: fee, total_due: round2(royalty + share + fee) };
};
const sOut = (s, names = {}) => ({ id: s.id, agreement_id: s.agreement_id, outlet_id: s.outlet_id, outlet: names.outlet, partner: names.partner, month: s.month, kind: s.kind, reported_sales: num(s.reported_sales), basis_visible: s.basis_visible, royalty_due: num(s.royalty_due), share_due: num(s.share_due), fee_due: num(s.fee_due), total_due: num(s.total_due), status: s.status, invoice_id: s.invoice_id, notes: s.notes });

async function listSettlements(orgId, f = {}, scope) {
  const where = { org_id: orgId, deleted_at: null, ...(f.status ? { status: f.status } : {}), ...(f.agreement_id ? { agreement_id: f.agreement_id } : {}), ...(f.month ? { month: f.month } : {}) };
  if (scope) where.outlet_id = f.outlet_id && scope.includes(f.outlet_id) ? f.outlet_id : { in: scope };
  else if (f.outlet_id) where.outlet_id = f.outlet_id;
  if (f.from || f.to) where.month = { ...(f.from ? { gte: f.from.slice(0, 7) } : {}), ...(f.to ? { lte: f.to.slice(0, 7) } : {}) };
  const rows = await prisma.nxFranchiseSettlement.findMany({ where, orderBy: [{ month: 'desc' }], take: 500 });
  const [O, A] = await Promise.all([prisma.nxOutlet.findMany({ where: { org_id: orgId }, select: { id: true, name: true } }), prisma.nxFranchiseAgreement.findMany({ where: { org_id: orgId } })]);
  const o = stock.mapBy(O); const a = stock.mapBy(A);
  return rows.map((s) => sOut(s, { outlet: o.get(s.outlet_id)?.name, partner: a.get(s.agreement_id)?.partner_name }));
}

async function createSettlement(orgId, actorId, body, scope) {
  const input = sCreate.parse(body);
  const a = await prisma.nxFranchiseAgreement.findFirst({ where: { id: input.agreement_id, org_id: orgId, deleted_at: null } });
  if (!a) fail('invalid_ref', 'agreement');
  if (!outletAllowed(scope, a.outlet_id)) fail('forbidden_outlet');
  const c = compute(a, input);
  const row = await prisma.nxFranchiseSettlement.create({ data: { org_id: orgId, created_by: actorId, agreement_id: a.id, outlet_id: a.outlet_id, month: input.month, kind: input.kind || 'royalty', reported_sales: input.reported_sales ?? 0, basis_visible: input.basis_visible ?? true, notes: input.notes, ...c } });
  await audit(prisma, orgId, actorId, 'franchise_settlement', row.id, 'create', null, { month: row.month, total_due: c.total_due });
  return sOut(row);
}

async function updateSettlement(orgId, actorId, id, body) {
  const input = sUpdate.parse(body || {});
  const { reason, ...rest } = input;
  const s = await prisma.nxFranchiseSettlement.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!s) fail('not_found');
  if (s.status !== 'draft') fail('already_posted');
  const a = await prisma.nxFranchiseAgreement.findFirst({ where: { id: s.agreement_id, org_id: orgId } });
  const merged = { kind: s.kind, reported_sales: num(s.reported_sales), basis_visible: s.basis_visible, fee_due: num(s.fee_due), ...rest };
  const row = await prisma.nxFranchiseSettlement.update({ where: { id }, data: { ...rest, agreement_id: undefined, ...compute(a, merged), updated_by: actorId } });
  await audit(prisma, orgId, actorId, 'franchise_settlement', id, 'update', { total_due: num(s.total_due) }, { total_due: num(row.total_due) }, reason);
  return sOut(row);
}

/** Invoice a settlement (fee / royalty / revenue share) once: income entry on the franchise outlet, receivable until paid. */
async function invoiceSettlement(orgId, actorId, id, body = {}, ctx = {}) {
  const settings = await core.ensureSettings(orgId);
  const date = body.date || today();
  const gst = body.gst_rate === undefined ? 18 : num(body.gst_rate);
  await lockGuard(orgId, [date], ctx);
  return prisma.$transaction(async (tx) => {
    const claim = await tx.nxFranchiseSettlement.updateMany({ where: { id, org_id: orgId, status: 'draft', deleted_at: null }, data: { status: 'invoiced' } });
    if (claim.count !== 1) fail('invoice_exists');
    const s = await tx.nxFranchiseSettlement.findFirst({ where: { id, org_id: orgId } });
    if (num(s.total_due) <= 0) fail('nothing_to_invoice');
    const a = await tx.nxFranchiseAgreement.findFirst({ where: { id: s.agreement_id, org_id: orgId } });
    const o = await tx.nxOutlet.findFirst({ where: { id: s.outlet_id, org_id: orgId } });
    const raw = [];
    const label = (t) => `${t} - ${s.month}`;
    if (num(s.royalty_due) > 0) raw.push({ name: label('Royalty'), qty: 1, unit_price: num(s.royalty_due), discount_pct: 0, gst_rate: gst });
    if (num(s.share_due) > 0) raw.push({ name: label('Revenue share'), qty: 1, unit_price: num(s.share_due), discount_pct: 0, gst_rate: gst });
    if (num(s.fee_due) > 0) raw.push({ name: label(s.kind === 'initial_fee' ? 'Initial franchise fee' : 'Franchise fee'), qty: 1, unit_price: num(s.fee_due), discount_pct: 0, gst_rate: gst });
    const priced = priceLines(raw);
    const inv = await tx.nxInvoice.create({ data: { org_id: orgId, created_by: actorId, invoice_no: await billing.invoiceNo(tx, orgId, 'franchise', settings), type: 'franchise', source_type: 'franchise_settlement', source_id: s.id, outlet_id: s.outlet_id, party_name: a.partner_name, issue_date: toDate(date), due_date: toDate(addDays(date, 15)), subtotal: priced.subtotal, tax_total: priced.tax_total, total: priced.total, lines: priced.lines, tax_split: gstSplit(priced.tax_total, null, null), notes: a.payment_terms } });
    const cat = await categoryId(tx, orgId, 'income', 'Franchise fees and royalties');
    const e = await billing.makeEntry(tx, orgId, actorId, { kind: 'income', category_id: cat, outlet_id: s.outlet_id, date, due_date: addDays(date, 15), amount: priced.subtotal, party_name: a.partner_name, reference: inv.invoice_no, description: `Franchise ${s.kind} ${s.month}, ${o?.name || ''}`, source_type: 'franchise_invoice', source_id: inv.id });
    await tx.nxInvoice.update({ where: { id: inv.id }, data: { entry_id: e.id } });
    await tx.nxFranchiseSettlement.update({ where: { id }, data: { invoice_id: inv.id } });
    await audit(tx, orgId, actorId, 'franchise_settlement', id, 'invoice', { status: 'draft' }, { status: 'invoiced', invoice_no: inv.invoice_no, total: priced.total });
    await lockTouch(orgId, [date]);
    return { settlement_id: id, invoice_id: inv.id, invoice_no: inv.invoice_no, total: priced.total };
  });
}

/** One franchise partner's report: goods bought, fees due / received, outstanding, settlement history. Scoped for partner users. */
async function report(orgId, outletId, scope, f = {}) {
  if (!outletAllowed(scope, outletId)) fail('forbidden_outlet');
  const range = (d) => (!f.from || dayOf(d) >= f.from) && (!f.to || dayOf(d) <= f.to);
  const [invs, sets, agreement, orders, ships] = await Promise.all([
    prisma.nxInvoice.findMany({ where: { org_id: orgId, outlet_id: outletId, deleted_at: null, status: { not: 'cancelled' } } }),
    prisma.nxFranchiseSettlement.findMany({ where: { org_id: orgId, outlet_id: outletId, deleted_at: null }, orderBy: { month: 'desc' } }),
    prisma.nxFranchiseAgreement.findFirst({ where: { org_id: orgId, outlet_id: outletId, deleted_at: null }, orderBy: { created_at: 'desc' } }),
    prisma.nxSalesOrder.findMany({ where: { org_id: orgId, outlet_id: outletId, deleted_at: null } }),
    prisma.nxShipment.count({ where: { org_id: orgId, outlet_id: outletId, deleted_at: null } }),
  ]);
  const inR = invs.filter((i) => range(i.issue_date));
  const sum = (arr, k) => round2(arr.reduce((a, i) => a + num(i[k]), 0));
  const goods = inR.filter((i) => i.type === 'sales'); const fees = inR.filter((i) => i.type === 'franchise');
  return {
    agreement: agreement ? out(agreement) : null,
    orders: orders.length, shipments: ships,
    purchases_from_novarex: { invoiced: sum(goods, 'total'), paid: sum(goods, 'paid_amount'), outstanding: round2(goods.reduce((a, i) => a + billing.outstandingOf(i), 0)) },
    fees_and_royalties: { invoiced: sum(fees, 'total'), received: sum(fees, 'paid_amount'), outstanding: round2(fees.reduce((a, i) => a + billing.outstandingOf(i), 0)) },
    reported_sales: round2(sets.filter((s) => s.basis_visible && (!f.from || s.month >= f.from.slice(0, 7)) && (!f.to || s.month <= f.to.slice(0, 7))).reduce((a, s) => a + num(s.reported_sales), 0)),
    settlements: sets.map((s) => sOut(s)),
  };
}

module.exports = { list, get, create, update, archive, listSettlements, createSettlement, updateSettlement, invoiceSettlement, report };
