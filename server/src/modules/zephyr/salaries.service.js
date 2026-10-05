const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const { salaryOut, overlaps, dayOf, toDate, num } = require('./people.service');
const { markStale } = require('./periods');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthSchema = z.string().regex(MONTH_RE, 'Use YYYY-MM');
const listQuerySchema = z.object({ month: monthSchema });
const generateSchema = z.object({ month: monthSchema });
const splitItem = z.object({ project_id: z.string().uuid(), pct: z.coerce.number().min(0).max(100) });
const updateSchema = z.object({
  days: z.coerce.number().min(0).max(31).optional(),
  deductions: z.coerce.number().min(0).max(1e10).optional(),
  notes: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(500).nullable().optional()),
  project_split: z.array(splitItem).max(50).nullable().optional(),
});
const unapproveSchema = z.object({ reason: z.string().trim().min(1).max(500) });
const paySchema = z.object({ paid_on: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()) });

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const monthBounds = (month) => {
  const [y, m] = month.split('-').map(Number);
  return [new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10), new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)];
};

// Cost allocation across projects: the person's assignments active in the month, weighted by allocation.
async function defaultSplit(orgId, personId, month) {
  const [start, end] = monthBounds(month);
  const rows = (await prisma.zxAssignment.findMany({ where: { org_id: orgId, person_id: personId, deleted_at: null } })).filter((a) => overlaps(dayOf(a.from_date), dayOf(a.to_date), start, end));
  const total = rows.reduce((a, r) => a + r.allocation_pct, 0);
  if (total === 0) return null;
  return rows.map((r) => ({ project_id: r.project_id, pct: round2((r.allocation_pct / total) * 100) }));
}

function withAmounts(split, net) {
  if (!split) return null;
  return split.map((s) => ({ project_id: s.project_id, pct: s.pct, amount: round2((net * s.pct) / 100) }));
}

function compute(basis, rate, days, deductions) {
  const gross = basis === 'daily' ? round2(rate * (days || 0)) : round2(rate);
  return { gross, net: round2(gross - deductions) };
}

async function list(orgId, month) {
  const rows = await prisma.zxSalaryRecord.findMany({
    where: { org_id: orgId, month },
    include: { person: { select: { id: true, name: true, kind: true, designation: true } } },
    orderBy: { person: { name: 'asc' } },
  });
  const out = rows.map((r) => ({ ...salaryOut(r), person: r.person }));
  const totals = { gross: 0, deductions: 0, net: 0, draft: 0, approved: 0, paid: 0 };
  for (const r of out) {
    totals.gross += r.gross;
    totals.deductions += r.deductions;
    totals.net += r.net;
    totals[r.status] += 1;
  }
  return { records: out, totals: { ...totals, gross: round2(totals.gross), deductions: round2(totals.deductions), net: round2(totals.net) } };
}

// Draft slips for everyone on a fixed rate who was employed at some point in the month.
async function generate(orgId, actorId, month) {
  const [start, end] = monthBounds(month);
  const people = (await prisma.zxPerson.findMany({ where: { org_id: orgId, deleted_at: null, pay_basis: { not: null }, rate: { not: null } } })).filter(
    (p) => (!p.joining_date || dayOf(p.joining_date) <= end) && (!p.leaving_date || dayOf(p.leaving_date) >= start) && (p.active || p.leaving_date)
  );
  const existing = new Set((await prisma.zxSalaryRecord.findMany({ where: { org_id: orgId, month }, select: { person_id: true } })).map((r) => r.person_id));
  let created = 0;
  for (const p of people) {
    if (existing.has(p.id)) continue;
    const rate = num(p.rate);
    const { gross, net } = compute(p.pay_basis, rate, 0, 0);
    const split = withAmounts(await defaultSplit(orgId, p.id, month), net);
    await prisma.zxSalaryRecord.create({
      data: { org_id: orgId, person_id: p.id, month, pay_basis: p.pay_basis, rate, days: p.pay_basis === 'daily' ? 0 : null, gross, deductions: 0, net, project_split: split ?? undefined },
    });
    created += 1;
  }
  if (created > 0) await writeAudit(null, { orgId, actorId, entity: 'salary', action: 'generate', after: { month, created } });
  return { created, skipped: people.length - created };
}

async function findRecord(orgId, id) {
  return prisma.zxSalaryRecord.findFirst({ where: { id, org_id: orgId } });
}

async function update(orgId, actorId, id, input) {
  const rec = await findRecord(orgId, id);
  if (!rec) return { error: 'not_found' };
  if (rec.status !== 'draft') return { error: 'not_draft' };
  if (input.days !== undefined && rec.pay_basis !== 'daily') return { error: 'days_not_applicable' };
  const days = input.days ?? num(rec.days);
  const deductions = input.deductions ?? num(rec.deductions);
  const { gross, net } = compute(rec.pay_basis, num(rec.rate), days, deductions);
  if (deductions > gross) return { error: 'deductions_exceed' };
  let split = rec.project_split;
  if (input.project_split !== undefined) {
    if (input.project_split === null) split = null;
    else {
      const total = input.project_split.reduce((a, s) => a + s.pct, 0);
      if (input.project_split.length > 0 && Math.abs(total - 100) > 0.01) return { error: 'split_total' };
      const ids = [...new Set(input.project_split.map((s) => s.project_id))];
      if (ids.length !== input.project_split.length) return { error: 'split_duplicate' };
      if ((await prisma.zxProject.count({ where: { id: { in: ids }, org_id: orgId, deleted_at: null } })) !== ids.length) return { error: 'project_not_found' };
      split = input.project_split.length ? input.project_split : null;
    }
  }
  const row = await prisma.zxSalaryRecord.update({
    where: { id },
    data: {
      days: rec.pay_basis === 'daily' ? days : null,
      gross,
      deductions,
      net,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      project_split: split ? withAmounts(split, net) : Prisma.DbNull,
    },
  });
  await writeAudit(null, { orgId, actorId, entity: 'salary', entityId: id, action: 'update', before: { days: num(rec.days), deductions: num(rec.deductions), net: num(rec.net) }, after: { days, deductions, net } });
  return { record: salaryOut(await prisma.zxSalaryRecord.findUnique({ where: { id: row.id } })) };
}

async function approve(orgId, actorId, id) {
  const rec = await findRecord(orgId, id);
  if (!rec) return { error: 'not_found' };
  if (rec.status !== 'draft') return { error: 'not_draft' };
  if (rec.pay_basis === 'daily' && !(num(rec.days) > 0)) return { error: 'days_required' };
  const row = await prisma.zxSalaryRecord.update({ where: { id }, data: { status: 'approved', approved_by: actorId, approved_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'salary', entityId: id, action: 'approve', after: { month: rec.month, net: num(rec.net) } });
  await markStale(orgId, rec.month);
  return { record: salaryOut(row) };
}

async function unapprove(orgId, actorId, id, reason) {
  const rec = await findRecord(orgId, id);
  if (!rec) return { error: 'not_found' };
  // Locks guard ordinary work, not admins: even a paid slip can be reopened, with a reason on the audit trail.
  if (rec.status !== 'approved' && rec.status !== 'paid') return { error: 'not_approved' };
  const row = await prisma.zxSalaryRecord.update({ where: { id }, data: { status: 'draft', approved_by: null, approved_at: null, paid_on: null } });
  await writeAudit(null, { orgId, actorId, entity: 'salary', entityId: id, action: 'unapprove', before: { status: rec.status, paid_on: rec.paid_on ? dayOf(rec.paid_on) : null }, reason });
  await markStale(orgId, rec.month);
  return { record: salaryOut(row) };
}

async function pay(orgId, actorId, id, paidOn) {
  const rec = await findRecord(orgId, id);
  if (!rec) return { error: 'not_found' };
  if (rec.status !== 'approved') return { error: 'not_approved' };
  const date = paidOn || new Date().toISOString().slice(0, 10);
  if (date > new Date().toISOString().slice(0, 10)) return { error: 'future_date' };
  const row = await prisma.zxSalaryRecord.update({ where: { id }, data: { status: 'paid', paid_on: toDate(date) } });
  await writeAudit(null, { orgId, actorId, entity: 'salary', entityId: id, action: 'pay', after: { month: rec.month, net: num(rec.net), paid_on: date } });
  return { record: salaryOut(row) };
}

async function remove(orgId, actorId, id) {
  const rec = await findRecord(orgId, id);
  if (!rec) return { error: 'not_found' };
  if (rec.status !== 'draft') return { error: 'not_draft' };
  await prisma.zxSalaryRecord.delete({ where: { id } });
  await writeAudit(null, { orgId, actorId, entity: 'salary', entityId: id, action: 'delete', before: { month: rec.month, person_id: rec.person_id } });
  return { ok: true };
}

// The signed-in staff member's own workspace: assigned projects (read-only) and approved / paid slips.
async function myWork(orgId, personId) {
  if (!personId) return { person: null, assignments: [], salaries: [] };
  const person = await prisma.zxPerson.findFirst({ where: { id: personId, org_id: orgId, deleted_at: null }, include: { vendor_party: { select: { id: true, name: true } } } });
  if (!person) return { person: null, assignments: [], salaries: [] };
  const assignments = await prisma.zxAssignment.findMany({
    where: { org_id: orgId, person_id: personId, deleted_at: null, project: { deleted_at: null } },
    orderBy: { created_at: 'desc' },
    include: { project: { select: { id: true, code: true, name: true, status: true, location: true, start_date: true, end_date: true, progress_pct: true } } },
  });
  const projectIds = assignments.map((a) => a.project_id);
  const milestones = projectIds.length
    ? await prisma.zxMilestone.findMany({ where: { org_id: orgId, project_id: { in: projectIds }, deleted_at: null }, orderBy: [{ sort_order: 'asc' }], select: { project_id: true, name: true, due_date: true, percent_done: true, weight: true } })
    : [];
  const salaries = (await prisma.zxSalaryRecord.findMany({ where: { org_id: orgId, person_id: personId, status: { in: ['approved', 'paid'] } }, orderBy: { month: 'desc' }, take: 24 })).map((s) => ({
    id: s.id, month: s.month, pay_basis: s.pay_basis, rate: num(s.rate), days: num(s.days), gross: num(s.gross), deductions: num(s.deductions), net: num(s.net), status: s.status, paid_on: s.paid_on,
  }));
  const done = (list) => (list.length ? Math.round(list.reduce((a, m) => a + m.weight * m.percent_done, 0) / list.reduce((a, m) => a + m.weight, 0)) : null);
  return {
    person: { id: person.id, name: person.name, kind: person.kind, designation: person.designation, phone: person.phone, email: person.email, joining_date: person.joining_date, vendor_party: person.vendor_party, pay_basis: person.pay_basis, rate: num(person.rate) },
    assignments: assignments.map((a) => {
      const ms = milestones.filter((m) => m.project_id === a.project_id);
      return { id: a.id, role: a.role, from_date: a.from_date, to_date: a.to_date, allocation_pct: a.allocation_pct, project: { ...a.project, progress: done(ms) ?? a.project.progress_pct }, milestones: ms };
    }),
    salaries,
  };
}

module.exports = { listQuerySchema, generateSchema, updateSchema, unapproveSchema, paySchema, list, generate, update, approve, unapprove, pay, remove, myWork };
