const prisma = require('../../config/db');

// Group Dashboard > GST & TDS (docs/features/GROUP-TAX-TRACKING.md). Reads the invoices that already exist (Delphic's client invoices with their
// contract charge lines, and the Book Keeping invoice generator) and tells, per invoice and per period: base amount, GST, TDS, what is payable and
// what is paid. On top of that three small registers: TDS refunds received, GST paid to the government, TDS deposited for vendors.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** A contract charge line is GST when its label says so (IGST / CGST / SGST included), TDS when it says TDS; anything else is "other". */
function chargeKind(line) {
  if (line.tax_kind === 'gst' || line.tax_kind === 'tds') return line.tax_kind;
  const label = String(line.label || '');
  if (/gst/i.test(label)) return 'gst';
  if (/tds/i.test(label)) return 'tds';
  return 'other';
}

/** Financial year (April-March) of a date: { label: 'FY 2026-27', start: 2026 }. */
function fyOf(date) {
  const d = new Date(date);
  const m = d.getUTCMonth() + 1;
  const y = d.getUTCFullYear();
  const start = m >= 4 ? y : y - 1;
  return { label: `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`, start };
}

/** Indian GST quarter of a month: Apr-Jun = Q1 ... Jan-Mar = Q4 of the financial year. */
function quarterOf(year, month) {
  const fyStart = month >= 4 ? year : year - 1;
  const q = Math.floor(((month + 8) % 12) / 3) + 1;
  const first = [4, 7, 10, 1][q - 1];
  const last = [6, 9, 12, 3][q - 1];
  return { key: `${fyStart}-Q${q}`, label: `Q${q} FY ${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')} (${MONTH_NAMES[first - 1]}-${MONTH_NAMES[last - 1]})`, order: fyStart * 10 + q, lastMonth: last, fyStart };
}

function monthRange(from, to) {
  const parse = (s) => (/^\d{4}-\d{2}$/.test(s || '') ? { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)) } : null);
  const a = parse(from);
  const b = parse(to);
  return {
    start: a ? new Date(Date.UTC(a.y, a.m - 1, 1)) : null,
    end: b ? new Date(Date.UTC(b.y, b.m, 0, 23, 59, 59, 999)) : null,
  };
}

async function orgIdsOf(groupIds, orgId) {
  const orgs = await prisma.org.findMany({ where: { org_group_id: { in: groupIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const wanted = orgId ? orgs.filter((o) => o.id === orgId) : orgs;
  return { all: orgs, ids: wanted.map((o) => o.id) };
}

// ---- invoices ---------------------------------------------------------------------------------------------------------

function splitCharges(lines) {
  const out = { gst: 0, tds: 0, other: 0, lines: [] };
  for (const l of lines || []) {
    const kind = chargeKind(l);
    const amount = num(l.amount); // signed: negative = deducted
    if (kind === 'tds') out.tds += Math.abs(amount);
    else out[kind] += amount;
    out.lines.push({ label: l.label, kind, amount: round2(amount) });
  }
  out.gst = round2(out.gst);
  out.tds = round2(out.tds);
  out.other = round2(out.other);
  return out;
}

/**
 * The figures of one invoice. A single-project invoice keeps its charges in `details`; a combined (consolidated) invoice keeps
 * them in each contract of `items`, and its own `details` carries only the net total - so the contracts are added up here.
 * Order of the money: base amount - adjustment = base after adjustment; GST and TDS are worked out on that; payable = base + GST - TDS.
 */
function invoiceFigures(items, fallbackAmount) {
  const parts = Array.isArray(items.items) && items.items.length ? items.items : [items];
  let gross = 0; let adjustment = 0; let base = 0; let total = 0; let gst = 0; let tds = 0; let other = 0;
  const lines = [];
  for (const part of parts) {
    const d = part.details || {};
    const split = splitCharges(d.charges);
    const partBase = num(d.subtotal ?? d.amount ?? (parts.length === 1 ? fallbackAmount : 0));
    const adj = num(d.adjustment_amount);
    base += partBase;
    adjustment += adj;
    gross += d.base_amount != null ? num(d.base_amount) : partBase - adj;
    total += num(d.total_amount ?? (partBase + split.gst + split.other - split.tds));
    gst += split.gst; tds += split.tds; other += split.other;
    for (const l of split.lines) lines.push(parts.length > 1 && part.project?.name ? { ...l, label: `${l.label} (${part.project.name})` } : l);
  }
  return { gross: round2(gross), adjustment: round2(adjustment), base: round2(base), total: round2(total), gst: round2(gst), tds: round2(tds), other: round2(other), lines, contracts: parts.length > 1 ? parts.length : 0 };
}

function taxMode(gst, tds) {
  if (gst > 0 && tds > 0) return 'gst_tds';
  if (gst > 0) return 'gst';
  if (tds > 0) return 'tds';
  return 'none';
}

// The invoices whose BILLING month (the period the invoice is for) falls in the range, whatever day they were generated on. `start` / `end` are the month edges.
function billingMonthWhere(start, end) {
  if (!start && !end) return {};
  const firstYear = start ? start.getUTCFullYear() : end.getUTCFullYear() - 30;
  const lastYear = end ? end.getUTCFullYear() : start.getUTCFullYear() + 30;
  const parts = [];
  for (let y = firstYear; y <= lastYear; y += 1) {
    const lo = start && y === start.getUTCFullYear() ? start.getUTCMonth() + 1 : 1;
    const hi = end && y === end.getUTCFullYear() ? end.getUTCMonth() + 1 : 12;
    parts.push({ period_year: y, period_month: { gte: lo, lte: hi } });
  }
  return { OR: parts };
}

/** Every invoice of the chosen companies, with its tax split. `basis` 'billing' picks them by billing month instead of invoice date. */
async function loadInvoices(groupIds, { orgId, from, to, currency, allTimeUntilEnd = false, basis = 'invoice' } = {}) {
  const { ids: orgIds, all } = await orgIdsOf(groupIds, orgId);
  const orgName = new Map(all.map((o) => [o.id, o.name]));
  const { start, end } = monthRange(from, to);
  const range = () => ({ ...(start && !allTimeUntilEnd ? { gte: start } : {}), ...(end ? { lte: end } : {}) });
  const dated = (field, fallback) => (start || end ? { OR: [{ [field]: range() }, { [field]: null, [fallback]: range() }] } : {});

  const clientRows = await prisma.clientInvoice.findMany({
    where: { org_id: { in: orgIds }, deleted_at: null, status: { in: ['sent', 'paid'] }, ...(currency ? { currency } : {}), ...(basis === 'billing' ? billingMonthWhere(start && !allTimeUntilEnd ? start : null, end) : dated('invoice_date', 'created_at')) },
    include: { client_account: { select: { name: true, project_name: true, project_code: true } } },
    orderBy: [{ invoice_date: 'desc' }, { created_at: 'desc' }],
  });
  const payments = clientRows.length
    ? await prisma.paymentRecord.findMany({ where: { kind: 'client_invoice', reference_id: { in: clientRows.map((r) => r.id) }, deleted_at: null }, select: { reference_id: true, amount: true } })
    : [];
  const paidBy = new Map();
  for (const p of payments) paidBy.set(p.reference_id, round2((paidBy.get(p.reference_id) || 0) + num(p.amount)));

  const rows = clientRows.map((r) => {
    const items = r.line_items && !Array.isArray(r.line_items) ? r.line_items : {};
    const fig = invoiceFigures(items, num(r.amount));
    const split = { gst: fig.gst, tds: fig.tds, other: fig.other, lines: fig.lines };
    const base = fig.base;
    const total = fig.total;
    const date = r.invoice_date || r.created_at;
    const recorded = paidBy.get(r.id) || 0;
    const paid = round2(Math.min(total, r.status === 'paid' && recorded === 0 ? total : recorded));
    const project = items.project?.name || r.client_account?.project_name || r.client_account?.name || null;
    return {
      key: `client_invoice:${r.id}`,
      kind: 'client_invoice',
      id: r.id,
      org_id: r.org_id,
      company: orgName.get(r.org_id) || '',
      number: r.invoice_number || null,
      client: items.project?.client_name || r.client_account?.name || null,
      project,
      invoice_date: ymd(date),
      fy: fyOf(date).label,
      period_year: basis === 'billing' && r.period_year ? r.period_year : new Date(date).getUTCFullYear(),
      period_month: basis === 'billing' && r.period_month ? r.period_month : new Date(date).getUTCMonth() + 1,
      // The billing month of the invoice itself (what Finance > Invoices shows as its Period); it can differ from the invoice date.
      billing_month: r.period_month || null,
      billing_year: r.period_year || null,
      currency: r.currency,
      status: r.status,
      gross_base: fig.gross,
      adjustment: fig.adjustment,
      contracts: fig.contracts,
      base: round2(base),
      gst: split.gst,
      tds: split.tds,
      other: split.other,
      total: round2(total),
      paid,
      // an invoice marked paid is closed (older ones were settled on the amount before GST / TDS)
      pending: r.status === 'paid' ? 0 : round2(Math.max(total - paid, 0)),
      tax_mode: taxMode(split.gst, split.tds),
      lines: split.lines,
    };
  });

  // The Book Keeping invoice generator: GST lines and the TDS the buyer deducts.
  const gRange = (start || end) ? { invoice_date: { ...(start && !allTimeUntilEnd ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {};
  const groupRows = await prisma.groupInvoice.findMany({
    where: { org_group_id: { in: groupIds }, status: 'issued', ...(currency ? { currency } : {}), ...gRange, ...(orgId ? { legal_entity: { workspace_id: orgId } } : {}) },
    include: { payments: { where: { deleted_at: null }, select: { amount: true } }, legal_entity: { select: { name: true, workspace_id: true } } },
    orderBy: { invoice_date: 'desc' },
  });
  for (const g of groupRows) {
    const gst = round2(num(g.cgst) + num(g.sgst) + num(g.igst));
    const tds = round2(num(g.tds_amount));
    const total = round2(num(g.total) - tds); // payable: amount + GST - TDS
    const paid = round2(Math.min(total, g.payments.reduce((s, p) => s + num(p.amount), 0)));
    const d = new Date(g.invoice_date);
    rows.push({
      key: `group_invoice:${g.id}`,
      kind: 'group_invoice',
      id: g.id,
      org_id: g.legal_entity?.workspace_id || null,
      company: g.legal_entity?.name || '',
      number: g.number,
      client: g.buyer_name,
      project: null,
      invoice_date: ymd(g.invoice_date),
      fy: fyOf(d).label,
      period_year: d.getUTCFullYear(),
      period_month: d.getUTCMonth() + 1,
      currency: g.currency,
      status: paid >= total && total > 0 ? 'paid' : paid > 0 ? 'part_paid' : 'sent',
      base: round2(num(g.subtotal)),
      gst,
      tds,
      other: 0,
      total: round2(total),
      paid,
      pending: round2(Math.max(total - paid, 0)),
      tax_mode: taxMode(gst, tds),
      lines: [...(gst ? [{ label: g.type === 'gst' ? 'GST' : 'Tax', kind: 'gst', amount: gst }] : []), ...(tds ? [{ label: 'TDS', kind: 'tds', amount: -tds }] : [])],
    });
  }
  rows.sort((a, b) => String(b.invoice_date).localeCompare(String(a.invoice_date)));
  return rows;
}

function totalsByCurrency(rows) {
  const by = {};
  for (const r of rows) {
    const t = (by[r.currency] ||= { currency: r.currency, invoices: 0, base: 0, gst: 0, tds: 0, other: 0, total: 0, paid: 0, pending: 0, no_tax_invoices: 0 });
    t.invoices += 1;
    for (const k of ['base', 'gst', 'tds', 'other', 'total', 'paid', 'pending']) t[k] = round2(t[k] + r[k]);
    if (r.tax_mode === 'none') t.no_tax_invoices += 1;
  }
  return Object.values(by).sort((a, b) => (a.currency === 'INR' ? -1 : b.currency === 'INR' ? 1 : a.currency.localeCompare(b.currency)));
}

async function invoices(groupIds, q) {
  const rows = await loadInvoices(groupIds, q);
  return { rows, totals: totalsByCurrency(rows) };
}

async function options(groupIds) {
  const { all } = await orgIdsOf(groupIds);
  const used = await prisma.clientInvoice.findMany({ where: { org_id: { in: all.map((o) => o.id) }, deleted_at: null }, distinct: ['currency'], select: { currency: true } });
  return { companies: all.map((o) => ({ id: o.id, name: o.name })), currencies: [...new Set(['INR', ...used.map((u) => u.currency)])] };
}

// ---- TDS receivable ----------------------------------------------------------------------------------------------------

async function tdsReceivable(groupIds, q) {
  const [rows, receipts] = await Promise.all([
    loadInvoices(groupIds, q),
    prisma.tdsReceipt.findMany({ where: { org_group_id: { in: groupIds }, deleted_at: null }, orderBy: { received_on: 'asc' } }),
  ]);
  const receivedBy = new Map();
  const receiptsBy = new Map();
  for (const r of receipts) {
    const k = `${r.invoice_kind}:${r.invoice_id}`;
    receivedBy.set(k, round2((receivedBy.get(k) || 0) + num(r.amount)));
    if (!receiptsBy.has(k)) receiptsBy.set(k, []);
    receiptsBy.get(k).push({ id: r.id, amount: num(r.amount), received_on: ymd(r.received_on), reference: r.reference, note: r.note });
  }
  const items = rows.filter((r) => r.tds > 0).map((r) => {
    const fraction = r.total > 0 ? Math.min(1, r.paid / r.total) : 0;
    const deducted = round2(r.tds * fraction);
    const received = receivedBy.get(r.key) || 0;
    const outstanding = round2(Math.max(deducted - received, 0));
    const status = deducted === 0 ? 'not_deducted' : received >= deducted ? 'received' : received > 0 ? 'part_received' : 'receivable';
    return {
      key: r.key, kind: r.kind, id: r.id, company: r.company, number: r.number, client: r.client, project: r.project, invoice_date: r.invoice_date, fy: r.fy, currency: r.currency,
      base: r.base, total: r.total, paid: r.paid, tds_expected: r.tds, tds_deducted: deducted, tds_yet_to_deduct: round2(r.tds - deducted), received, outstanding, status,
      receipts: receiptsBy.get(r.key) || [],
    };
  });
  const by = {};
  for (const i of items) {
    const t = (by[i.currency] ||= { currency: i.currency, invoices: 0, expected: 0, deducted: 0, yet_to_deduct: 0, received: 0, outstanding: 0 });
    t.invoices += 1;
    t.expected = round2(t.expected + i.tds_expected);
    t.deducted = round2(t.deducted + i.tds_deducted);
    t.yet_to_deduct = round2(t.yet_to_deduct + i.tds_yet_to_deduct);
    t.received = round2(t.received + i.received);
    t.outstanding = round2(t.outstanding + i.outstanding);
  }
  const fy = {};
  for (const i of items) {
    const t = (fy[`${i.fy}|${i.currency}`] ||= { fy: i.fy, currency: i.currency, deducted: 0, received: 0, outstanding: 0 });
    t.deducted = round2(t.deducted + i.tds_deducted);
    t.received = round2(t.received + i.received);
    t.outstanding = round2(t.outstanding + i.outstanding);
  }
  return { items, totals: Object.values(by), by_fy: Object.values(fy).sort((a, b) => b.fy.localeCompare(a.fy)) };
}

async function addTdsReceipt(groupIds, user, body) {
  const rows = await loadInvoices(groupIds, { allTimeUntilEnd: true });
  const inv = rows.find((r) => r.key === `${body.invoice_kind}:${body.invoice_id}`);
  if (!inv) return { error: 'invoice_not_found' };
  if (!(inv.tds > 0)) return { error: 'no_tds' };
  const existing = await prisma.tdsReceipt.aggregate({ where: { invoice_kind: body.invoice_kind, invoice_id: body.invoice_id, deleted_at: null }, _sum: { amount: true } });
  const received = num(existing._sum.amount);
  if (received + body.amount > inv.tds + 0.005) return { error: 'over_tds', tds: inv.tds, received };
  const row = await prisma.tdsReceipt.create({
    data: { org_group_id: groupIds[0], org_id: inv.org_id, invoice_kind: body.invoice_kind, invoice_id: body.invoice_id, amount: body.amount, currency: inv.currency, received_on: new Date(body.received_on), reference: body.reference || null, note: body.note || null, created_by: user.id },
  });
  await audit(user, 'tds_receipt_add', row.id, `TDS refund ${body.amount} ${inv.currency} on ${inv.number || inv.id}`, { invoice: inv.key, amount: body.amount });
  return { receipt: row };
}

async function removeRecord(model, action, groupIds, user, id, reason) {
  const row = await prisma[model].findFirst({ where: { id, org_group_id: { in: groupIds }, deleted_at: null } });
  if (!row) return { error: 'not_found' };
  await prisma[model].update({ where: { id }, data: { deleted_at: new Date(), deleted_by: user.id, delete_reason: reason || null } });
  await audit(user, action, id, reason || 'Removed', { amount: num(row.amount) });
  return { deleted: true };
}
const removeTdsReceipt = (g, u, id, reason) => removeRecord('tdsReceipt', 'tds_receipt_remove', g, u, id, reason);

function audit(user, action, entityId, reason, snapshot) {
  return prisma.auditLog.create({ data: { actor_id: user.id, org_id: user.org_id || null, action, entity_type: 'group_tax', entity_id: entityId, reason, snapshot } });
}

// ---- challans ----------------------------------------------------------------------------------------------------------

const KIND_LABEL = {
  gst: 'GST payment',
  gst_credit: 'GST credit set off',
  tds_salary: 'TDS on salaries (employees)',
  tds_vendor: 'TDS on vendor / contractor payments',
  advance_tax: 'Advance tax / income tax',
  pf: 'PF',
  esi: 'ESI',
  pt: 'Professional tax',
  other: 'Other',
};

const serializeChallan = (c, orgName) => ({
  id: c.id,
  kind: c.kind,
  kind_label: KIND_LABEL[c.kind] || c.kind,
  org_id: c.org_id,
  company: c.org_id ? orgName.get(c.org_id) || '' : 'All companies',
  challan_number: c.challan_number,
  bsr_code: c.bsr_code,
  bank: c.bank,
  period_month: c.period_month,
  period_year: c.period_year,
  period: c.covers_months === 3 ? `Quarter ending ${MONTH_NAMES[c.period_month - 1]} ${c.period_year}` : `${MONTH_NAMES[c.period_month - 1]} ${c.period_year}`,
  covers_months: c.covers_months,
  amount: num(c.amount),
  paid_on: ymd(c.paid_on),
  parties: Array.isArray(c.parties) ? c.parties : [],
  note: c.note,
  has_file: Boolean(c.file_path),
  file_name: c.file_name,
  fy: fyOf(c.paid_on).label,
});

/** Who a challan can cover: the employees of the group's companies and the vendors. */
async function parties(groupIds, { orgId } = {}) {
  const { ids: orgIds, all } = await orgIdsOf(groupIds, orgId);
  const orgName = new Map(all.map((o) => [o.id, o.name]));
  const [members, vendors] = await Promise.all([
    prisma.orgMembership.findMany({ where: { org_id: { in: orgIds }, worker_type: { not: 'contractor' } }, select: { id: true, org_id: true, employee_code: true, person: { select: { name: true } } } }),
    prisma.account.findMany({ where: { org_id: { in: orgIds }, type: 'vendor', deleted_at: null }, select: { id: true, org_id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  members.sort((a, b) => String(a.person?.name || '').localeCompare(String(b.person?.name || '')));
  return {
    employees: members.map((m) => ({ id: m.id, label: m.person?.name || 'Unknown', hint: [m.employee_code, orgName.get(m.org_id)].filter(Boolean).join(' · ') })),
    vendors: vendors.map((v) => ({ id: v.id, label: v.name, hint: orgName.get(v.org_id) || '' })),
  };
}

async function challans(groupIds, { orgId, from, to, kind } = {}) {
  const { all } = await orgIdsOf(groupIds);
  const orgName = new Map(all.map((o) => [o.id, o.name]));
  const { start, end } = monthRange(from, to);
  const rows = await prisma.taxChallan.findMany({
    where: { org_group_id: { in: groupIds }, deleted_at: null, ...(kind ? { kind } : {}), ...(orgId ? { OR: [{ org_id: orgId }, { org_id: null }] } : {}), ...((start || end) ? { paid_on: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {}) },
    orderBy: [{ paid_on: 'desc' }, { created_at: 'desc' }],
  });
  const items = rows.map((c) => serializeChallan(c, orgName));
  const by = {};
  for (const c of items) {
    const t = (by[c.kind] ||= { kind: c.kind, label: c.kind_label, challans: 0, amount: 0 });
    t.challans += 1;
    t.amount = round2(t.amount + c.amount);
  }
  return { items, totals: Object.values(by), kinds: Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label })) };
}

/** `parties` must be employees / vendors of the group; labels are taken from the register, never trusted from the form. */
async function cleanParties(groupIds, list) {
  if (!list?.length) return { parties: [] };
  const p = await parties(groupIds);
  const emp = new Map(p.employees.map((e) => [e.id, e]));
  const ven = new Map(p.vendors.map((v) => [v.id, v]));
  const out = [];
  for (const x of list) {
    const found = x.kind === 'employee' ? emp.get(x.id) : ven.get(x.id);
    if (!found) return { error: 'party_not_found' };
    out.push({ kind: x.kind, id: x.id, label: found.label, ...(x.amount ? { amount: round2(x.amount) } : {}) });
  }
  return { parties: out };
}

async function createChallan(groupIds, user, body, file) {
  const checked = await cleanParties(groupIds, body.parties);
  if (checked.error) return checked;
  const row = await prisma.taxChallan.create({
    data: {
      org_group_id: groupIds[0], org_id: body.org_id || null, kind: body.kind, challan_number: body.challan_number || null, bsr_code: body.bsr_code || null, bank: body.bank || null,
      period_month: body.period_month, period_year: body.period_year, covers_months: body.covers_months, amount: body.amount, paid_on: new Date(body.paid_on), parties: checked.parties, note: body.note || null,
      ...(file ? { file_path: file.path, file_name: file.originalname.slice(0, 150), file_mime: file.mimetype } : {}), created_by: user.id,
    },
  });
  await audit(user, 'tax_challan_add', row.id, `${KIND_LABEL[body.kind]} ${body.amount}${body.challan_number ? ` · challan ${body.challan_number}` : ''}`, { kind: body.kind, amount: body.amount, challan_number: body.challan_number || null, parties: checked.parties.length });
  return { challan: row };
}

async function updateChallan(groupIds, user, id, body, file) {
  const existing = await prisma.taxChallan.findFirst({ where: { id, org_group_id: { in: groupIds }, deleted_at: null } });
  if (!existing) return { error: 'not_found' };
  const data = {};
  for (const k of ['kind', 'challan_number', 'bsr_code', 'bank', 'period_month', 'period_year', 'covers_months', 'amount', 'note', 'org_id']) if (body[k] !== undefined) data[k] = body[k] === '' ? null : body[k];
  if (body.paid_on) data.paid_on = new Date(body.paid_on);
  if (body.parties !== undefined) {
    const checked = await cleanParties(groupIds, body.parties);
    if (checked.error) return checked;
    data.parties = checked.parties;
  }
  if (file) Object.assign(data, { file_path: file.path, file_name: file.originalname.slice(0, 150), file_mime: file.mimetype });
  const row = await prisma.taxChallan.update({ where: { id }, data });
  await audit(user, 'tax_challan_edit', id, `Challan ${row.challan_number || id} edited`, { before: { amount: num(existing.amount), challan_number: existing.challan_number }, after: { amount: num(row.amount), challan_number: row.challan_number } });
  return { challan: row };
}

const removeChallan = (g, u, id, reason) => removeRecord('taxChallan', 'tax_challan_remove', g, u, id, reason);

async function challanFile(groupIds, id) {
  const c = await prisma.taxChallan.findFirst({ where: { id, org_group_id: { in: groupIds }, deleted_at: null }, select: { file_path: true, file_name: true } });
  return c?.file_path ? { path: c.file_path, name: c.file_name || 'challan' } : null;
}

// ---- GST payable -------------------------------------------------------------------------------------------------------

async function gst(groupIds, { orgId, from, to, by = 'month', basis = 'invoice' } = {}) {
  // INR invoices only; everything up to the end of the range, so the balance carries the earlier months.
  const rows = (await loadInvoices(groupIds, { orgId, to, currency: 'INR', allTimeUntilEnd: true, basis })).filter((r) => r.gst > 0);
  const payments = await prisma.taxChallan.findMany({ where: { org_group_id: { in: groupIds }, deleted_at: null, kind: { in: ['gst', 'gst_credit'] }, ...(orgId ? { OR: [{ org_id: orgId }, { org_id: null }] } : {}) }, orderBy: { paid_on: 'asc' } });
  const bucketOf = (year, month) => (by === 'quarter' ? quarterOf(year, month) : { key: `${year}-${String(month).padStart(2, '0')}`, label: `${MONTH_NAMES[month - 1]} ${year}`, order: year * 100 + month });
  const buckets = new Map();
  const ensure = (b) => { if (!buckets.has(b.key)) buckets.set(b.key, { key: b.key, label: b.label, order: b.order, collected: 0, paid: 0, credits: 0, invoices: [], payments: [] }); return buckets.get(b.key); };
  for (const r of rows) {
    const b = ensure(bucketOf(r.period_year, r.period_month));
    b.collected = round2(b.collected + r.gst);
    b.invoices.push({ key: r.key, company: r.company, number: r.number, client: r.client, invoice_date: r.invoice_date, base: r.base, gst: r.gst });
  }
  for (const p of payments) {
    const b = ensure(bucketOf(p.period_year, p.period_month));
    const amount = num(p.amount);
    if (p.kind === 'gst_credit') b.credits = round2(b.credits + amount); else b.paid = round2(b.paid + amount);
    b.payments.push({ id: p.id, kind: p.kind === 'gst_credit' ? 'credit' : 'payment', amount, paid_on: ymd(p.paid_on), challan_number: p.challan_number, has_file: Boolean(p.file_path), note: p.note, covers_months: p.covers_months, period_month: p.period_month, period_year: p.period_year });
  }
  const { start } = monthRange(from, null);
  const list = [...buckets.values()].sort((a, b) => a.order - b.order);
  let running = 0;
  for (const b of list) {
    b.payable = round2(b.collected - b.paid - b.credits);
    running = round2(running + b.payable);
    b.balance = running; // carried forward: what is still owed up to and including this period
  }
  const inRange = start ? list.filter((b) => b.order >= (by === 'quarter' ? quarterOf(start.getUTCFullYear(), start.getUTCMonth() + 1).order : start.getUTCFullYear() * 100 + start.getUTCMonth() + 1)) : list;
  const totals = inRange.reduce((t, b) => ({ collected: round2(t.collected + b.collected), paid: round2(t.paid + b.paid), credits: round2(t.credits + b.credits) }), { collected: 0, paid: 0, credits: 0 });
  return { by, periods: inRange.slice().reverse(), totals: { ...totals, payable_in_range: round2(totals.collected - totals.paid - totals.credits), balance: list.length ? list[list.length - 1].balance : 0 } };
}

// ---- TDS withheld (employees' salary TDS, vendors) and deposited ------------------------------------------------------

async function tdsPayable(groupIds, { orgId, from, to, currency } = {}) {
  const { ids: orgIds } = await orgIdsOf(groupIds, orgId);
  const { start, end } = monthRange(from, to);
  const orgs = new Map((await prisma.org.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]));
  const key = (y, m) => y * 100 + m;
  const inRange = (r) => (!start || key(r.period_year, r.period_month) >= key(start.getUTCFullYear(), start.getUTCMonth() + 1)) && (!end || key(r.period_year, r.period_month) <= key(end.getUTCFullYear(), end.getUTCMonth() + 1));

  // vendors: the TDS set on a vendor invoice
  const inv = await prisma.projectVendorInvoice.findMany({
    where: { org_id: { in: orgIds }, tds_amount: { gt: 0 }, ...(currency ? { currency } : {}) },
    include: { vendor_account: { select: { name: true } }, account: { select: { name: true, project_name: true, project_code: true } } },
    orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }],
  });
  const vendorRows = inv.filter(inRange).map((r) => ({
    id: r.id, company: orgs.get(r.org_id) || '', vendor: r.vendor_account?.name || '', project: r.account?.project_name || r.account?.name || null, number: r.invoice_number,
    period: `${MONTH_NAMES[r.period_month - 1]} ${r.period_year}`, period_month: r.period_month, period_year: r.period_year, currency: r.currency,
    base: num(r.amount), tds: num(r.tds_amount), adjustment: num(r.adjustment_amount), net_payable: round2(num(r.amount) + num(r.gst_amount) + num(r.other_amount) - num(r.tds_amount) + num(r.adjustment_amount)), invoice_date: ymd(r.invoice_date),
  }));

  // employees: the TDS adjustment on the month's salary
  const adj = await prisma.salaryAdjustment.findMany({
    where: { org_id: { in: orgIds }, kind: 'tds' },
    include: { org_membership: { select: { employee_code: true, person: { select: { name: true } } } } },
    orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }],
  });
  const employeeRows = adj.filter(inRange).map((a) => ({
    id: a.id, company: orgs.get(a.org_id) || '', employee: a.org_membership?.person?.name || '', employee_code: a.org_membership?.employee_code || null,
    period: `${MONTH_NAMES[a.period_month - 1]} ${a.period_year}`, period_month: a.period_month, period_year: a.period_year, tds: num(a.amount), note: a.note,
  }));

  const deposits = await prisma.taxChallan.findMany({ where: { org_group_id: { in: groupIds }, deleted_at: null, kind: { in: ['tds_salary', 'tds_vendor'] }, ...(orgId ? { OR: [{ org_id: orgId }, { org_id: null }] } : {}) }, orderBy: { paid_on: 'desc' } });
  const summary = (withheldAll, kind) => {
    const deposited = deposits.filter((d) => d.kind === kind).reduce((s, d) => s + num(d.amount), 0);
    return { withheld: round2(withheldAll), deposited: round2(deposited), to_deposit: round2(withheldAll - deposited) };
  };
  const by = {};
  for (const r of vendorRows) {
    const t = (by[r.currency] ||= { currency: r.currency, vendors_invoices: 0, withheld: 0 });
    t.vendors_invoices += 1;
    t.withheld = round2(t.withheld + r.tds);
  }
  return {
    rows: vendorRows,
    totals: Object.values(by),
    employee_rows: employeeRows,
    deposits: deposits.map((d) => serializeChallan(d, orgs)),
    // INR only (a deposit is made in rupees): everything withheld so far minus everything deposited
    inr: summary(inv.filter((r) => r.currency === 'INR').reduce((s, r) => s + num(r.tds_amount), 0), 'tds_vendor'),
    employees: summary(adj.reduce((s, a) => s + num(a.amount), 0), 'tds_salary'),
  };
}

// ---- Book Keeping > Receivables (per group, off until a group admin switches it on) -------------------------------------------------

const DEFAULT_SINCE = '2026-09';

/** Every holding group of the caller with its Receivables switch. */
async function receivableSetting(groupIds) {
  const [groups, rows] = await Promise.all([
    prisma.orgGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.groupReceivableSetting.findMany({ where: { org_group_id: { in: groupIds } } }),
  ]);
  const by = new Map(rows.map((r) => [r.org_group_id, r]));
  return { groups: groups.map((g) => ({ id: g.id, name: g.name, enabled: Boolean(by.get(g.id)?.enabled), since_month: by.get(g.id)?.since_month || DEFAULT_SINCE })) };
}

async function setReceivableSetting(groupIds, user, { org_group_id: groupId, enabled, since_month: since }) {
  if (!groupIds.includes(groupId)) return { error: 'not_found' };
  const data = { enabled, ...(since ? { since_month: since } : {}), updated_by: user.id };
  await prisma.groupReceivableSetting.upsert({ where: { org_group_id: groupId }, update: data, create: { org_group_id: groupId, ...data } });
  return receivableSetting(groupIds);
}

/**
 * Every client invoice of the switched-on groups from `since_month` (by BILLING month, not invoice date) with what is paid and pending, the
 * GST and TDS still to collect, and what the group is left with: money in hand (banks + cash) minus the GST and TDS still to deposit, and the same
 * if every pending invoice were collected. Money figures are INR; other currencies show only in the table totals.
 */
async function receivables(groupIds, { orgId, currency, from, to } = {}) {
  const { groups } = await receivableSetting(groupIds);
  const on = groups.filter((g) => g.enabled);
  if (!on.length) return { enabled: false, groups };
  const onIds = on.map((g) => g.id);
  const since = from || on.map((g) => g.since_month).sort()[0];
  const q = { orgId, currency, from: since, to: to || undefined, basis: 'billing' };
  const cash = require('../cashPosition/cash.service');
  const [rows, tdsRec, gstView, tdsPay, position] = await Promise.all([
    loadInvoices(onIds, q),
    tdsReceivable(onIds, q),
    gst(onIds, { orgId, to: to || undefined, basis: 'billing' }),
    tdsPayable(onIds, { orgId }),
    cash.position(onIds, {}),
  ]);
  const list = rows.map((r) => ({ ...r, billing_label: r.billing_month && r.billing_year ? `${MONTH_NAMES[r.billing_month - 1]} ${r.billing_year}` : `${MONTH_NAMES[r.period_month - 1]} ${r.period_year}` }))
    .sort((a, b) => (b.billing_year || b.period_year) * 100 + (b.billing_month || b.period_month) - ((a.billing_year || a.period_year) * 100 + (a.billing_month || a.period_month)) || String(b.invoice_date).localeCompare(String(a.invoice_date)));
  const inr = list.filter((r) => r.currency === 'INR');
  const pendingInr = round2(inr.reduce((s, r) => s + r.pending, 0));
  const gstPending = round2(inr.reduce((s, r) => s + (r.total > 0 && r.pending > 0 ? r.gst * (r.pending / r.total) : 0), 0));
  const tdsOutstanding = tdsRec.totals.find((t) => t.currency === 'INR')?.outstanding || 0;
  const inHand = Number(position.totals?.INR || 0);
  const gstToDeposit = Math.max(Number(gstView.totals?.balance || 0), 0);
  const tdsToDeposit = round2(Math.max(tdsPay.inr?.to_deposit || 0, 0) + Math.max(tdsPay.employees?.to_deposit || 0, 0));
  const freeNow = round2(inHand - gstToDeposit - tdsToDeposit);
  return {
    enabled: true,
    groups,
    since_month: since,
    rows: list,
    totals: totalsByCurrency(list),
    funds: {
      currency: 'INR',
      in_hand: round2(inHand),
      to_collect: pendingInr,
      gst_in_pending: gstPending,
      tds_to_receive: round2(tdsOutstanding),
      gst_to_deposit: round2(gstToDeposit),
      tds_to_deposit: tdsToDeposit,
      left_now: freeNow,
      left_after_collection: round2(freeNow + pendingInr),
    },
  };
}

module.exports = {
  receivableSetting, setReceivableSetting, receivables,
  options, invoices, tdsReceivable, addTdsReceipt, removeTdsReceipt, gst, tdsPayable,
  challans, parties, createChallan, updateChallan, removeChallan, challanFile, KIND_LABEL,
  chargeKind, fyOf, quarterOf,
};
