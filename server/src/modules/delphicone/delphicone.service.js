const { z } = require('zod');
const prisma = require('../../config/db');
const followups = require('../billing/invoiceFollowups.service');

// Delphic One workspace (docs/features/DELPHIC-ONE-WORKSPACE.md): the company that sells the product. Customers, leads (with notes and a
// conversion to a customer), invoices with part payments, and a dashboard. Overdue invoices are chased with the shared follow-up log.

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31');
const nullableDay = z.preprocess((v) => (v === '' ? null : v), day.nullable().optional());
const text = (max) => z.string().trim().max(max);
const optText = (max) => z.preprocess((v) => (v === '' ? null : v), text(max).nullable().optional());
const money = z.coerce.number().min(0).max(1e10);

const CUSTOMER_STATUS = ['trial', 'active', 'read_only', 'churned'];
const LEAD_STAGES = ['new', 'contacted', 'demo', 'trial', 'won', 'lost'];
const LEAD_SOURCES = ['website', 'referral', 'outbound', 'event', 'partner', 'other'];
const PAY_MODES = ['neft', 'upi', 'cheque', 'cash', 'card', 'other'];

const customerSchema = z.object({
  name: text(150).min(1, 'Give the customer a name'), contact_name: optText(120), contact_email: optText(150), contact_phone: optText(40), gstin: optText(20), address: optText(500),
  status: z.enum(CUSTOMER_STATUS).default('trial'), plan_name: optText(80), users_count: z.coerce.number().int().min(0).max(100000).default(0), monthly_value: money.default(0),
  trial_ends_on: nullableDay, started_on: nullableDay, owner_user_id: z.string().uuid().nullable().optional(), notes: optText(3000),
});
const customerUpdateSchema = customerSchema.partial();

const leadSchema = z.object({
  company_name: text(150).min(1, 'Give the lead a company name'), contact_name: optText(120), contact_email: optText(150), contact_phone: optText(40),
  source: z.enum(LEAD_SOURCES).default('website'), stage: z.enum(LEAD_STAGES).default('new'), expected_value: money.default(0), users_expected: z.coerce.number().int().min(0).max(100000).nullable().optional(),
  owner_user_id: z.string().uuid().nullable().optional(), next_followup_date: nullableDay, notes: optText(3000), lost_reason: optText(300),
});
const leadUpdateSchema = leadSchema.partial();
const leadNoteSchema = z.object({ note: text(2000).min(1, 'Write the note'), stage: z.enum(LEAD_STAGES).optional(), next_followup_date: nullableDay });
const convertSchema = z.object({ trial_days: z.coerce.number().int().min(0).max(90).default(15), plan_name: optText(80), users_count: z.coerce.number().int().min(0).max(100000).optional() });

const invoiceSchema = z.object({
  customer_id: z.string().uuid(), number: optText(40), invoice_date: day.optional(), due_date: nullableDay, description: optText(500),
  amount: z.coerce.number().positive().max(1e10), gst_rate: z.coerce.number().min(0).max(40).default(18), status: z.enum(['draft', 'sent']).default('sent'), notes: optText(1000),
});
const invoiceUpdateSchema = z.object({ number: optText(40), invoice_date: day.optional(), due_date: nullableDay, description: optText(500), notes: optText(1000), status: z.enum(['draft', 'sent']).optional() });
const paymentSchema = z.object({ amount: z.coerce.number().positive().max(1e10), date: day.optional(), mode: z.enum(PAY_MODES).default('neft'), reference: optText(120), notes: optText(500) });

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => Number(v || 0);
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const toDate = (v) => new Date(`${v}T00:00:00.000Z`);
const todayStr = () => new Date().toISOString().slice(0, 10);
const addDays = (dateStr, n) => new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const FIELDS_DATES = ['trial_ends_on', 'started_on', 'next_followup_date'];
const withDates = (body) => Object.fromEntries(Object.entries(body).map(([k, v]) => [k, FIELDS_DATES.includes(k) ? (v ? toDate(v) : null) : v]));
const financialYear = (dateStr) => { const [y, m] = dateStr.split('-').map(Number); const start = m >= 4 ? y : y - 1; return `${start}-${String((start + 1) % 100).padStart(2, '0')}`; };

// ---- customers ---------------------------------------------------------------------------------------------------------------

const viewCustomer = (c, balance = 0) => ({
  id: c.id, name: c.name, contact_name: c.contact_name, contact_email: c.contact_email, contact_phone: c.contact_phone, gstin: c.gstin, address: c.address, status: c.status, plan_name: c.plan_name,
  users_count: c.users_count, monthly_value: num(c.monthly_value), trial_ends_on: ymd(c.trial_ends_on), started_on: ymd(c.started_on), owner_user_id: c.owner_user_id, notes: c.notes, lead_id: c.lead_id,
  outstanding: round2(balance), created_at: c.created_at,
  ...(c.deleted_at ? { deleted_at: c.deleted_at, deleted_reason: c.deleted_reason || null } : {}),
});

// A soft-deleted customer is gone everywhere: its invoices stay in the database but are left out of every list, total and follow-up.
async function deletedCustomerIds(orgId) {
  return (await prisma.doxCustomer.findMany({ where: { org_id: orgId, deleted_at: { not: null } }, select: { id: true } })).map((r) => r.id);
}
const findLiveInvoice = async (orgId, id) => prisma.doxInvoice.findFirst({ where: { id, org_id: orgId, customer_id: { notIn: await deletedCustomerIds(orgId) } } });

async function balancesByCustomer(orgId) {
  const rows = await prisma.doxInvoice.findMany({ where: { org_id: orgId, status: 'sent', customer_id: { notIn: await deletedCustomerIds(orgId) } }, select: { id: true, customer_id: true, total: true } });
  const paid = await prisma.doxInvoicePayment.groupBy({ by: ['invoice_id'], where: { org_id: orgId, deleted_at: null }, _sum: { amount: true } });
  const paidBy = new Map(paid.map((p) => [p.invoice_id, num(p._sum.amount)]));
  const by = new Map();
  for (const r of rows) by.set(r.customer_id, round2((by.get(r.customer_id) || 0) + Math.max(0, num(r.total) - (paidBy.get(r.id) || 0))));
  return by;
}

async function listCustomers(orgId, { status, q, deleted } = {}) {
  const rows = await prisma.doxCustomer.findMany({
    where: { org_id: orgId, deleted_at: deleted ? { not: null } : null, ...(status && !deleted ? { status } : {}), ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { contact_name: { contains: q, mode: 'insensitive' } }, { contact_email: { contains: q, mode: 'insensitive' } }] } : {}) },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
  });
  const bal = await balancesByCustomer(orgId);
  const withWorkspace = new Set((rows.length ? await prisma.saasCustomer.findMany({ where: { dox_customer_id: { in: rows.map((r) => r.id) } }, select: { dox_customer_id: true } }) : []).map((r) => r.dox_customer_id));
  return rows.map((c) => ({ ...viewCustomer(c, bal.get(c.id) || 0), has_workspace: withWorkspace.has(c.id) }));
}

async function createCustomer(orgId, user, body) {
  const row = await prisma.doxCustomer.create({ data: { ...withDates(body), org_id: orgId, created_by: user.id } });
  return { customer: viewCustomer(row) };
}

async function updateCustomer(orgId, id, body) {
  const existing = await prisma.doxCustomer.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!existing) return { error: 'not_found' };
  const row = await prisma.doxCustomer.update({ where: { id }, data: withDates(body) });
  return { customer: viewCustomer(row, (await balancesByCustomer(orgId)).get(id) || 0) };
}

async function removeCustomer(orgId, id) {
  const existing = await prisma.doxCustomer.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!existing) return { error: 'not_found' };
  if (await prisma.doxInvoice.count({ where: { org_id: orgId, customer_id: id, status: { not: 'cancelled' } } })) return { error: 'has_invoices' };
  await prisma.doxCustomer.update({ where: { id }, data: { deleted_at: new Date() } });
  return { deleted: true };
}

// ---- leads -------------------------------------------------------------------------------------------------------------------

const viewLead = (l) => ({
  id: l.id, company_name: l.company_name, contact_name: l.contact_name, contact_email: l.contact_email, contact_phone: l.contact_phone, source: l.source, stage: l.stage, expected_value: num(l.expected_value),
  users_expected: l.users_expected, owner_user_id: l.owner_user_id, next_followup_date: ymd(l.next_followup_date), followup_due: Boolean(l.next_followup_date && ymd(l.next_followup_date) <= todayStr() && !['won', 'lost'].includes(l.stage)),
  notes: l.notes, customer_id: l.customer_id, lost_reason: l.lost_reason, created_at: l.created_at,
});

async function listLeads(orgId, { stage, q, followup } = {}) {
  const rows = await prisma.doxLead.findMany({
    where: { org_id: orgId, deleted_at: null, ...(stage ? { stage } : {}), ...(q ? { OR: [{ company_name: { contains: q, mode: 'insensitive' } }, { contact_name: { contains: q, mode: 'insensitive' } }] } : {}), ...(followup === 'due' ? { next_followup_date: { lte: toDate(todayStr()) }, stage: { notIn: ['won', 'lost'] } } : {}) },
    orderBy: [{ next_followup_date: 'asc' }, { created_at: 'desc' }],
  });
  const lastNotes = rows.length ? await prisma.doxLeadNote.findMany({ where: { org_id: orgId, lead_id: { in: rows.map((r) => r.id) } }, orderBy: { created_at: 'desc' }, select: { lead_id: true, note: true } }) : [];
  const last = new Map();
  for (const n of lastNotes) if (!last.has(n.lead_id)) last.set(n.lead_id, n.note);
  const gone = new Set(await deletedCustomerIds(orgId));
  return rows.map((l) => ({ ...viewLead(l), ...(l.customer_id && gone.has(l.customer_id) ? { customer_id: null, customer_deleted: true } : {}), last_note: last.get(l.id) || null }));
}

async function createLead(orgId, user, body) {
  const row = await prisma.doxLead.create({ data: { ...withDates(body), org_id: orgId, created_by: user.id, owner_user_id: body.owner_user_id || user.id } });
  return { lead: viewLead(row) };
}

async function updateLead(orgId, user, id, body) {
  const existing = await prisma.doxLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!existing) return { error: 'not_found' };
  if (existing.stage === 'won' && body.stage && body.stage !== 'won') return { error: 'already_won' };
  if (body.stage === 'won') return { error: 'use_convert' };
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.doxLead.update({ where: { id }, data: withDates(body) });
    if (body.stage && body.stage !== existing.stage) await tx.doxLeadNote.create({ data: { org_id: orgId, lead_id: id, note: `Moved to ${body.stage}${body.stage === 'lost' && body.lost_reason ? ` (${body.lost_reason})` : ''}`, stage_to: body.stage, created_by: user.id } });
    return r;
  });
  return { lead: viewLead(row) };
}

async function addLeadNote(orgId, user, id, body) {
  const existing = await prisma.doxLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!existing) return { error: 'not_found' };
  if (body.stage === 'won') return { error: 'use_convert' };
  const data = {};
  if (body.stage && body.stage !== existing.stage) data.stage = body.stage;
  if (body.next_followup_date !== undefined) data.next_followup_date = body.next_followup_date ? toDate(body.next_followup_date) : null;
  const [note, lead] = await prisma.$transaction([
    prisma.doxLeadNote.create({ data: { org_id: orgId, lead_id: id, note: body.note, stage_to: data.stage || null, created_by: user.id } }),
    prisma.doxLead.update({ where: { id }, data }),
  ]);
  return { note: { id: note.id, note: note.note, stage_to: note.stage_to, created_at: note.created_at }, lead: viewLead(lead) };
}

async function listLeadNotes(orgId, id) {
  const lead = await prisma.doxLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!lead) return { error: 'not_found' };
  const rows = await prisma.doxLeadNote.findMany({ where: { org_id: orgId, lead_id: id }, orderBy: { created_at: 'desc' } });
  const ids = [...new Set(rows.map((r) => r.created_by).filter(Boolean))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return { notes: rows.map((r) => ({ id: r.id, note: r.note, stage_to: r.stage_to, by: names.get(r.created_by) || null, created_at: r.created_at })) };
}

/** A won lead becomes a customer on a trial (days editable); the lead keeps the link. */
async function convertLead(orgId, user, id, body) {
  const lead = await prisma.doxLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!lead) return { error: 'not_found' };
  if (lead.customer_id) return { error: 'already_converted' };
  const today = todayStr();
  const result = await prisma.$transaction(async (tx) => {
    const customer = await tx.doxCustomer.create({
      data: {
        org_id: orgId, name: lead.company_name, contact_name: lead.contact_name, contact_email: lead.contact_email, contact_phone: lead.contact_phone, status: 'trial', plan_name: body.plan_name || null,
        users_count: body.users_count ?? lead.users_expected ?? 0, monthly_value: lead.expected_value, started_on: toDate(today), trial_ends_on: body.trial_days ? toDate(addDays(today, body.trial_days)) : null,
        owner_user_id: lead.owner_user_id, lead_id: lead.id, created_by: user.id,
      },
    });
    const updated = await tx.doxLead.update({ where: { id }, data: { stage: 'won', customer_id: customer.id, next_followup_date: null } });
    await tx.doxLeadNote.create({ data: { org_id: orgId, lead_id: id, note: `Won: customer created${body.trial_days ? ` with a ${body.trial_days}-day trial` : ''}`, stage_to: 'won', created_by: user.id } });
    return { customer, lead: updated };
  });
  return { customer: viewCustomer(result.customer), lead: viewLead(result.lead) };
}

async function removeLead(orgId, id) {
  const existing = await prisma.doxLead.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!existing) return { error: 'not_found' };
  await prisma.doxLead.update({ where: { id }, data: { deleted_at: new Date() } });
  return { deleted: true };
}

// ---- invoices ----------------------------------------------------------------------------------------------------------------

function viewInvoice(inv, paidAmount, customerName, chase) {
  const total = num(inv.total);
  const paid = round2(paidAmount || 0);
  const balance = round2(Math.max(0, total - paid));
  let payment_status = 'unpaid';
  if (inv.status === 'cancelled') payment_status = 'cancelled';
  else if (inv.status === 'draft') payment_status = 'draft';
  else if (balance <= 0) payment_status = 'paid';
  else if (paid > 0) payment_status = 'part_paid';
  const open = inv.status === 'sent' && balance > 0;
  return {
    id: inv.id, number: inv.number, customer_id: inv.customer_id, customer_name: customerName, invoice_date: ymd(inv.invoice_date), description: inv.description, amount: num(inv.amount), gst_amount: num(inv.gst_amount),
    total, paid, balance, status: inv.status, payment_status, cancelled_reason: inv.cancelled_reason, notes: inv.notes,
    ...followups.collectionState({ due_date: inv.due_date, next_followup_date: inv.next_followup_date, open }),
    followup_count: chase?.followup_count || 0, last_followup_note: chase?.last_followup_note || null, last_followup_on: chase?.last_followup_on || null,
  };
}

async function paidMap(orgId, ids) {
  if (!ids.length) return new Map();
  const g = await prisma.doxInvoicePayment.groupBy({ by: ['invoice_id'], where: { org_id: orgId, invoice_id: { in: ids }, deleted_at: null }, _sum: { amount: true } });
  return new Map(g.map((x) => [x.invoice_id, num(x._sum.amount)]));
}

async function listInvoices(orgId, { customer_id: customerId, filter, q } = {}) {
  const rows = await prisma.doxInvoice.findMany({
    where: { org_id: orgId, customer_id: customerId ? { equals: customerId, notIn: await deletedCustomerIds(orgId) } : { notIn: await deletedCustomerIds(orgId) }, ...(q ? { OR: [{ number: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] } : {}) },
    orderBy: [{ invoice_date: 'desc' }, { created_at: 'desc' }], take: 1000,
  });
  const [paid, chases, customers] = await Promise.all([
    paidMap(orgId, rows.map((r) => r.id)),
    followups.summaries('dox_invoice', rows.map((r) => r.id)),
    prisma.doxCustomer.findMany({ where: { org_id: orgId, id: { in: [...new Set(rows.map((r) => r.customer_id))] } }, select: { id: true, name: true } }),
  ]);
  const names = new Map(customers.map((c) => [c.id, c.name]));
  let out = rows.map((r) => viewInvoice(r, paid.get(r.id), names.get(r.customer_id) || '', chases.get(r.id)));
  if (filter === 'overdue') out = out.filter((r) => r.overdue);
  else if (filter === 'followup_due') out = out.filter((r) => r.followup_due);
  else if (filter === 'open') out = out.filter((r) => r.status === 'sent' && r.balance > 0);
  else if (filter === 'no_due_date') out = out.filter((r) => r.status === 'sent' && r.balance > 0 && !r.due_date);
  else if (filter === 'paid') out = out.filter((r) => r.payment_status === 'paid');
  const live = out.filter((r) => r.status === 'sent');
  return { rows: out, totals: { billed: round2(live.reduce((s, r) => s + r.total, 0)), received: round2(live.reduce((s, r) => s + r.paid, 0)), outstanding: round2(live.reduce((s, r) => s + r.balance, 0)), overdue: round2(live.filter((r) => r.overdue).reduce((s, r) => s + r.balance, 0)), overdue_count: live.filter((r) => r.overdue).length } };
}

async function nextNumber(orgId, dateStr) {
  const prefix = `DO/${financialYear(dateStr)}/`;
  const last = await prisma.doxInvoice.findMany({ where: { org_id: orgId, number: { startsWith: prefix } }, select: { number: true } });
  const max = last.reduce((m, r) => Math.max(m, Number(r.number.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

async function createInvoice(orgId, user, body) {
  const customer = await prisma.doxCustomer.findFirst({ where: { id: body.customer_id, org_id: orgId, deleted_at: null } });
  if (!customer) return { error: 'customer_not_found' };
  const date = body.invoice_date || todayStr();
  const gst = round2((body.amount * body.gst_rate) / 100);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const number = body.number || (await nextNumber(orgId, date));
    try {
      const row = await prisma.doxInvoice.create({
        data: { org_id: orgId, customer_id: customer.id, number, invoice_date: toDate(date), due_date: body.due_date ? toDate(body.due_date) : null, description: body.description || null, amount: body.amount, gst_amount: gst, total: round2(body.amount + gst), status: body.status, notes: body.notes || null, created_by: user.id },
      });
      return { invoice: viewInvoice(row, 0, customer.name) };
    } catch (err) {
      if (err.code === 'P2002') { if (body.number) return { error: 'duplicate_number' }; continue; }
      throw err;
    }
  }
  return { error: 'duplicate_number' };
}

async function updateInvoice(orgId, id, body) {
  const inv = await findLiveInvoice(orgId, id);
  if (!inv) return { error: 'not_found' };
  if (inv.status === 'cancelled') return { error: 'cancelled' };
  const data = {};
  if (body.number) data.number = body.number;
  if (body.invoice_date) data.invoice_date = toDate(body.invoice_date);
  if (body.due_date !== undefined) data.due_date = body.due_date ? toDate(body.due_date) : null;
  if (body.description !== undefined) data.description = body.description;
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.status) data.status = body.status;
  try {
    const row = await prisma.doxInvoice.update({ where: { id }, data });
    return { invoice: viewInvoice(row, (await paidMap(orgId, [id])).get(id)) };
  } catch (err) {
    if (err.code === 'P2002') return { error: 'duplicate_number' };
    throw err;
  }
}

async function cancelInvoice(orgId, id, reason) {
  const inv = await findLiveInvoice(orgId, id);
  if (!inv) return { error: 'not_found' };
  if (inv.status === 'cancelled') return { error: 'cancelled' };
  if ((await paidMap(orgId, [id])).get(id)) return { error: 'has_payments' };
  const row = await prisma.doxInvoice.update({ where: { id }, data: { status: 'cancelled', cancelled_reason: reason, next_followup_date: null } });
  return { invoice: viewInvoice(row, 0) };
}

async function listPayments(orgId, id) {
  const inv = await findLiveInvoice(orgId, id);
  if (!inv) return { error: 'not_found' };
  const rows = await prisma.doxInvoicePayment.findMany({ where: { org_id: orgId, invoice_id: id, deleted_at: null }, orderBy: [{ date: 'desc' }, { created_at: 'desc' }] });
  return { payments: rows.map((p) => ({ id: p.id, date: ymd(p.date), amount: num(p.amount), mode: p.mode, reference: p.reference, notes: p.notes })) };
}

async function addPayment(orgId, user, id, body) {
  const inv = await findLiveInvoice(orgId, id);
  if (!inv) return { error: 'not_found' };
  if (inv.status !== 'sent') return { error: 'not_open' };
  const balance = round2(num(inv.total) - ((await paidMap(orgId, [id])).get(id) || 0));
  if (body.amount > balance + 0.005) return { error: 'over_balance', balance };
  await prisma.doxInvoicePayment.create({ data: { org_id: orgId, invoice_id: id, date: toDate(body.date || todayStr()), amount: body.amount, mode: body.mode, reference: body.reference || null, notes: body.notes || null, created_by: user.id } });
  if (round2(balance - body.amount) <= 0) await prisma.doxInvoice.update({ where: { id }, data: { next_followup_date: null } }); // paid: nothing left to chase
  return { invoice: viewInvoice(await prisma.doxInvoice.findUnique({ where: { id } }), (await paidMap(orgId, [id])).get(id)) };
}

async function removePayment(orgId, id, paymentId) {
  const p = await prisma.doxInvoicePayment.findFirst({ where: { id: paymentId, invoice_id: id, org_id: orgId, deleted_at: null } });
  if (!p) return { error: 'not_found' };
  await prisma.doxInvoicePayment.update({ where: { id: paymentId }, data: { deleted_at: new Date() } });
  return { invoice: viewInvoice(await prisma.doxInvoice.findUnique({ where: { id } }), (await paidMap(orgId, [id])).get(id)) };
}

// ---- dashboard ---------------------------------------------------------------------------------------------------------------

async function summary(orgId) {
  const today = todayStr();
  const [customers, leads, inv] = await Promise.all([
    prisma.doxCustomer.findMany({ where: { org_id: orgId, deleted_at: null }, select: { id: true, name: true, status: true, monthly_value: true, users_count: true, trial_ends_on: true } }),
    prisma.doxLead.findMany({ where: { org_id: orgId, deleted_at: null }, select: { stage: true, expected_value: true, next_followup_date: true } }),
    listInvoices(orgId, {}),
  ]);
  const byStatus = Object.fromEntries(CUSTOMER_STATUS.map((s) => [s, customers.filter((c) => c.status === s).length]));
  const mrr = round2(customers.filter((c) => c.status === 'active').reduce((s, c) => s + num(c.monthly_value), 0));
  const trialsEnding = customers.filter((c) => c.status === 'trial' && c.trial_ends_on && ymd(c.trial_ends_on) <= addDays(today, 7)).map((c) => ({ id: c.id, name: c.name, trial_ends_on: ymd(c.trial_ends_on) })).sort((a, b) => a.trial_ends_on.localeCompare(b.trial_ends_on));
  const stages = LEAD_STAGES.map((stage) => { const rows = leads.filter((l) => l.stage === stage); return { stage, count: rows.length, expected_value: round2(rows.reduce((s, l) => s + num(l.expected_value), 0)) }; });
  const leadFollowupsDue = leads.filter((l) => l.next_followup_date && ymd(l.next_followup_date) <= today && !['won', 'lost'].includes(l.stage)).length;
  const live = inv.rows.filter((r) => r.status === 'sent');
  return {
    customers: { total: customers.length, by_status: byStatus, users: customers.filter((c) => ['trial', 'active'].includes(c.status)).reduce((s, c) => s + c.users_count, 0), mrr, trials_ending: trialsEnding },
    leads: { total: leads.length, open: leads.filter((l) => !['won', 'lost'].includes(l.stage)).length, stages, followups_due: leadFollowupsDue },
    receivables: { outstanding: inv.totals.outstanding, overdue: inv.totals.overdue, overdue_count: inv.totals.overdue_count, followups_due: live.filter((r) => r.followup_due).length, no_due_date: live.filter((r) => r.balance > 0 && !r.due_date).length },
  };
}

module.exports = {
  CUSTOMER_STATUS, LEAD_STAGES, LEAD_SOURCES, PAY_MODES,
  customerSchema, customerUpdateSchema, leadSchema, leadUpdateSchema, leadNoteSchema, convertSchema, invoiceSchema, invoiceUpdateSchema, paymentSchema,
  listCustomers, createCustomer, updateCustomer, removeCustomer,
  listLeads, createLead, updateLead, addLeadNote, listLeadNotes, convertLead, removeLead,
  listInvoices, createInvoice, updateInvoice, cancelInvoice, listPayments, addPayment, removePayment, summary,
};
