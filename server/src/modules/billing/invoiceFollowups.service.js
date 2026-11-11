const { z } = require('zod');
const prisma = require('../../config/db');

// Payment collection for unpaid invoices: a due date, the next follow-up date and a log of every chase with its note.
// Works for client invoices (Finance > Invoicing, scoped by workspace) and group invoices (Book Keeping, scoped by holding group).

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31');
const nullableDate = z.preprocess((v) => (v === '' ? null : v), dateStr.nullable().optional());

const termsSchema = z.object({ due_date: nullableDate, next_followup_date: nullableDate });
const followupSchema = z.object({
  note: z.string().trim().min(1, 'Write what was said or agreed').max(2000),
  followed_on: dateStr.optional(),
  next_followup_date: nullableDate,
});

const toDate = (v) => new Date(`${v}T00:00:00.000Z`);
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const todayStr = () => new Date().toISOString().slice(0, 10);

/** Which invoice table and which scope a kind belongs to. */
function target(kind, scope) {
  if (kind === 'client_invoice') return { model: prisma.clientInvoice, where: { org_id: scope.orgId }, owner: { org_id: scope.orgId } };
  return { model: prisma.groupInvoice, where: { org_group_id: { in: scope.groupIds } }, owner: {} };
}

async function loadInvoice(kind, scope, id) {
  const t = target(kind, scope);
  const inv = await t.model.findFirst({ where: { id, ...t.where } });
  return inv ? { inv, t } : null;
}

/** Due date and next follow-up date of one invoice (either can be cleared with null). */
async function setTerms(kind, scope, id, body) {
  const found = await loadInvoice(kind, scope, id);
  if (!found) return { error: 'not_found' };
  const data = {};
  if (body.due_date !== undefined) {
    if (kind === 'group_invoice' && found.inv.status === 'cancelled') return { error: 'cancelled' };
    data.due_date = body.due_date ? toDate(body.due_date) : null;
  }
  if (body.next_followup_date !== undefined) data.next_followup_date = body.next_followup_date ? toDate(body.next_followup_date) : null;
  if (!Object.keys(data).length) return { error: 'nothing_to_change' };
  await found.t.model.update({ where: { id }, data });
  return { terms: { due_date: ymd(data.due_date ?? found.inv.due_date), next_followup_date: ymd(data.next_followup_date ?? found.inv.next_followup_date) } };
}

function viewFollowup(f, names) {
  return { id: f.id, followed_on: ymd(f.followed_on), note: f.note, next_followup_date: ymd(f.next_followup_date), by: names.get(f.created_by) || null, created_at: f.created_at };
}

async function namesOf(rows) {
  const ids = [...new Set(rows.map((r) => r.created_by).filter(Boolean))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  return new Map(users.map((u) => [u.id, u.name]));
}

async function list(kind, scope, id) {
  const found = await loadInvoice(kind, scope, id);
  if (!found) return { error: 'not_found' };
  const rows = await prisma.invoiceFollowup.findMany({ where: { invoice_kind: kind, invoice_id: id }, orderBy: [{ followed_on: 'desc' }, { created_at: 'desc' }] });
  const names = await namesOf(rows);
  return { followups: rows.map((r) => viewFollowup(r, names)), terms: { due_date: ymd(found.inv.due_date), next_followup_date: ymd(found.inv.next_followup_date) } };
}

/** Log a chase and (when given) move the invoice's next follow-up date; an empty next date clears it. */
async function add(kind, scope, user, id, body) {
  const found = await loadInvoice(kind, scope, id);
  if (!found) return { error: 'not_found' };
  const next = body.next_followup_date ?? null;
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.invoiceFollowup.create({
      data: {
        invoice_kind: kind, invoice_id: id, ...found.t.owner, ...(kind === 'group_invoice' ? { org_group_id: found.inv.org_group_id } : {}),
        followed_on: toDate(body.followed_on || todayStr()), note: body.note, next_followup_date: next ? toDate(next) : null, created_by: user.id,
      },
    });
    await found.t.model.update({ where: { id }, data: { next_followup_date: next ? toDate(next) : null } });
    return r;
  });
  const names = await namesOf([row]);
  return { followup: viewFollowup(row, names) };
}

/** For a list of invoices: how many chases each has had and the last note. */
async function summaries(kind, ids) {
  if (!ids.length) return new Map();
  const rows = await prisma.invoiceFollowup.findMany({ where: { invoice_kind: kind, invoice_id: { in: ids } }, orderBy: [{ followed_on: 'desc' }, { created_at: 'desc' }], select: { invoice_id: true, note: true, followed_on: true } });
  const by = new Map();
  for (const r of rows) {
    const s = by.get(r.invoice_id) || { followup_count: 0, last_followup_note: r.note, last_followup_on: ymd(r.followed_on) };
    s.followup_count += 1;
    by.set(r.invoice_id, s);
  }
  return by;
}

/** Overdue: still unpaid after its due date. followup_due: the next follow-up date has come. */
function collectionState({ due_date, next_followup_date, open }) {
  const today = todayStr();
  const due = ymd(due_date);
  const next = ymd(next_followup_date);
  const overdue = Boolean(open && due && due < today);
  const days_overdue = overdue ? Math.round((new Date(today) - new Date(due)) / 86400000) : 0;
  return { due_date: due, next_followup_date: next, overdue, days_overdue, followup_due: Boolean(open && next && next <= today) };
}

module.exports = { termsSchema, followupSchema, setTerms, list, add, summaries, collectionState };
