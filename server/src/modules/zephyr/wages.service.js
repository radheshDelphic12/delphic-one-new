const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const { markStale } = require('./periods');

// Daily-wage earners: site labour marked present / half / absent per project per day, paid out in batches.
// amount of a day = rate x day_fraction + ot_hours x rate / 8. Cost lands on the project the day was worked on.
const STATUSES = ['present', 'half', 'absent'];
const FRACTION = { present: 1, half: 0.5, absent: 0 };
const PAY_MODES = ['cash', 'upi', 'bank_transfer', 'cheque', 'other'];

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const money = z.coerce.number().min(0).max(1e9);
const uuid = z.string().uuid();

const workerFields = {
  name: z.string().trim().min(1).max(120),
  phone: text(30),
  trade: text(80),
  daily_rate: z.coerce.number().positive().max(1e7),
  joined_on: z.preprocess((v) => (v === '' ? null : v), dateStr.nullable().optional()),
  active: z.boolean(),
  notes: text(1000),
};
const createWorkerSchema = z.object({ ...workerFields, active: workerFields.active.default(true) });
const updateWorkerSchema = z.object(workerFields).partial();
const workerListSchema = z.object({ q: z.string().trim().max(100).optional(), active: z.enum(['true', 'false']).optional() });

const markSchema = z.object({
  worker_id: uuid,
  status: z.enum([...STATUSES, 'clear']),
  ot_hours: z.coerce.number().min(0).max(12).optional(),
  rate: z.coerce.number().positive().max(1e7).optional(),
  notes: text(300),
});
const bulkSchema = z.object({ project_id: uuid, work_date: dateStr, marks: z.array(markSchema).min(1).max(500) });
const sheetQuerySchema = z.object({ date: dateStr, project_id: uuid.optional() });
const attendanceQuerySchema = z.object({ from: dateStr, to: dateStr, worker_id: uuid.optional(), project_id: uuid.optional(), unpaid: z.enum(['true']).optional() });
const rangeSchema = z.object({ from: dateStr, to: dateStr, project_id: uuid.optional() });

const advanceSchema = z.object({ worker_id: uuid, given_on: dateStr, amount: z.coerce.number().positive().max(1e9), payment_mode: z.enum(PAY_MODES).nullable().optional(), notes: text(300) });
const advanceUpdateSchema = advanceSchema.omit({ worker_id: true }).partial();
const advanceQuerySchema = z.object({ worker_id: uuid.optional() });

const payableQuerySchema = z.object({ worker_id: uuid, to_date: dateStr, from_date: dateStr.optional(), project_id: uuid.optional() });
const payoutSchema = z.object({
  worker_id: uuid,
  to_date: dateStr,
  from_date: dateStr.optional(),
  project_id: uuid.optional(),
  paid_on: dateStr,
  advance_recovered: money.default(0),
  other_deductions: money.default(0),
  payment_mode: z.enum(PAY_MODES).default('cash'),
  reference: text(120),
  notes: text(500),
});
const payoutQuerySchema = z.object({ from: dateStr.optional(), to: dateStr.optional(), worker_id: uuid.optional(), status: z.enum(['paid', 'voided']).optional() });
const voidSchema = z.object({ reason: z.string().trim().min(1).max(500) });

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const dayOf = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const dayAmount = (rate, fraction, ot) => round2(rate * fraction + (ot * rate) / 8);

const workerOut = (w) => ({ id: w.id, name: w.name, phone: w.phone, trade: w.trade, daily_rate: num(w.daily_rate), joined_on: dayOf(w.joined_on), active: w.active, notes: w.notes });
const attendanceOut = (a) => ({
  id: a.id,
  worker_id: a.worker_id,
  project_id: a.project_id,
  work_date: dayOf(a.work_date),
  status: a.status,
  day_fraction: num(a.day_fraction),
  ot_hours: num(a.ot_hours),
  rate: num(a.rate),
  amount: num(a.amount),
  notes: a.notes,
  paid: Boolean(a.payout_id),
  payout_id: a.payout_id,
});
const payoutOut = (p) => ({
  id: p.id,
  worker_id: p.worker_id,
  project_id: p.project_id,
  from_date: dayOf(p.from_date),
  to_date: dayOf(p.to_date),
  days: num(p.days),
  ot_hours: num(p.ot_hours),
  gross: num(p.gross),
  advance_recovered: num(p.advance_recovered),
  other_deductions: num(p.other_deductions),
  net: num(p.net),
  paid_on: dayOf(p.paid_on),
  payment_mode: p.payment_mode,
  reference: p.reference,
  status: p.status,
  notes: p.notes,
  voided_reason: p.voided_reason,
});

// ---- workers
async function listWorkers(orgId, query) {
  const where = { org_id: orgId, deleted_at: null, ...(query.active ? { active: query.active === 'true' } : {}), ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}) };
  const workers = await prisma.zxWageWorker.findMany({ where, orderBy: { name: 'asc' } });
  const ids = workers.map((w) => w.id);
  const [unpaid, advances, recovered] = await Promise.all([
    prisma.zxWageAttendance.groupBy({ by: ['worker_id'], where: { org_id: orgId, worker_id: { in: ids }, payout_id: null }, _sum: { amount: true } }),
    prisma.zxWageAdvance.groupBy({ by: ['worker_id'], where: { org_id: orgId, worker_id: { in: ids } }, _sum: { amount: true } }),
    prisma.zxWagePayout.groupBy({ by: ['worker_id'], where: { org_id: orgId, worker_id: { in: ids }, status: 'paid' }, _sum: { advance_recovered: true } }),
  ]);
  const un = new Map(unpaid.map((r) => [r.worker_id, num(r._sum.amount)]));
  const adv = new Map(advances.map((r) => [r.worker_id, num(r._sum.amount)]));
  const rec = new Map(recovered.map((r) => [r.worker_id, num(r._sum.advance_recovered)]));
  return { workers: workers.map((w) => ({ ...workerOut(w), unpaid: round2(un.get(w.id) || 0), advance_outstanding: round2((adv.get(w.id) || 0) - (rec.get(w.id) || 0)) })) };
}

async function createWorker(orgId, actorId, input) {
  const row = await prisma.zxWageWorker.create({ data: { org_id: orgId, name: input.name, phone: input.phone ?? null, trade: input.trade ?? null, daily_rate: input.daily_rate, joined_on: toDate(input.joined_on), active: input.active, notes: input.notes ?? null, created_by: actorId } });
  await writeAudit(null, { orgId, actorId, entity: 'wage_worker', entityId: row.id, action: 'create', after: workerOut(row) });
  return { worker: workerOut(row) };
}

async function updateWorker(orgId, actorId, id, input) {
  const before = await prisma.zxWageWorker.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  const data = {};
  for (const k of ['name', 'phone', 'trade', 'daily_rate', 'active', 'notes']) if (input[k] !== undefined) data[k] = input[k];
  if (input.joined_on !== undefined) data.joined_on = toDate(input.joined_on);
  const row = await prisma.zxWageWorker.update({ where: { id }, data });
  await writeAudit(null, { orgId, actorId, entity: 'wage_worker', entityId: id, action: 'update', before: workerOut(before), after: workerOut(row) });
  return { worker: workerOut(row) };
}

async function removeWorker(orgId, actorId, id) {
  const before = await prisma.zxWageWorker.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if ((await prisma.zxWageAttendance.count({ where: { worker_id: id } })) > 0) return { error: 'worker_has_history' };
  await prisma.zxWageWorker.update({ where: { id }, data: { deleted_at: new Date(), active: false } });
  await writeAudit(null, { orgId, actorId, entity: 'wage_worker', entityId: id, action: 'delete', before: workerOut(before) });
  return { deleted: true };
}

// ---- attendance
// The day sheet: every active worker with their marks for the day across all projects (a worker may be split over projects).
async function daySheet(orgId, query) {
  const date = toDate(query.date);
  const [workers, rows] = await Promise.all([
    prisma.zxWageWorker.findMany({ where: { org_id: orgId, deleted_at: null, active: true }, orderBy: { name: 'asc' } }),
    prisma.zxWageAttendance.findMany({ where: { org_id: orgId, work_date: date } }),
  ]);
  const by = new Map();
  for (const r of rows) by.set(r.worker_id, [...(by.get(r.worker_id) || []), r]);
  return {
    date: query.date,
    workers: workers.map((w) => {
      const marks = (by.get(w.id) || []).map(attendanceOut);
      const here = query.project_id ? marks.find((m) => m.project_id === query.project_id) || null : null;
      return { ...workerOut(w), marks, mark: here, other_fraction: round2(marks.filter((m) => m.project_id !== query.project_id).reduce((a, m) => a + m.day_fraction, 0)) };
    }),
  };
}

async function listAttendance(orgId, q) {
  const rows = await prisma.zxWageAttendance.findMany({
    where: { org_id: orgId, work_date: { gte: toDate(q.from), lte: toDate(q.to) }, ...(q.worker_id ? { worker_id: q.worker_id } : {}), ...(q.project_id ? { project_id: q.project_id } : {}), ...(q.unpaid ? { payout_id: null } : {}) },
    orderBy: [{ work_date: 'asc' }],
  });
  return { attendance: rows.map(attendanceOut) };
}

async function markDay(orgId, actorId, input) {
  const project = await prisma.zxProject.findFirst({ where: { id: input.project_id, org_id: orgId, deleted_at: null }, select: { id: true } });
  if (!project) return { error: 'project_not_found' };
  const date = toDate(input.work_date);
  const ids = [...new Set(input.marks.map((m) => m.worker_id))];
  if (ids.length !== input.marks.length) return { error: 'duplicate_worker' };
  const workers = new Map((await prisma.zxWageWorker.findMany({ where: { id: { in: ids }, org_id: orgId, deleted_at: null } })).map((w) => [w.id, w]));
  if (workers.size !== ids.length) return { error: 'worker_not_found' };
  const existing = await prisma.zxWageAttendance.findMany({ where: { org_id: orgId, worker_id: { in: ids }, work_date: date } });
  const result = { saved: 0, cleared: 0, locked: [] };
  const ops = [];
  for (const m of input.marks) {
    const worker = workers.get(m.worker_id);
    const mine = existing.find((e) => e.worker_id === m.worker_id && e.project_id === input.project_id);
    if (mine?.payout_id) {
      result.locked.push(worker.name);
      continue;
    }
    if (m.status === 'clear') {
      if (mine) {
        ops.push(prisma.zxWageAttendance.delete({ where: { id: mine.id } }));
        result.cleared += 1;
      }
      continue;
    }
    const fraction = FRACTION[m.status];
    const ot = m.status === 'absent' ? 0 : m.ot_hours ?? 0;
    const elsewhere = existing.filter((e) => e.worker_id === m.worker_id && e.project_id !== input.project_id).reduce((a, e) => a + num(e.day_fraction), 0);
    if (elsewhere + fraction > 1) return { error: 'over_one_day', worker: worker.name };
    const rate = m.rate ?? (mine ? num(mine.rate) : num(worker.daily_rate));
    const data = { status: m.status, day_fraction: fraction, ot_hours: ot, rate, amount: dayAmount(rate, fraction, ot), notes: m.notes ?? null, marked_by: actorId };
    ops.push(
      mine
        ? prisma.zxWageAttendance.update({ where: { id: mine.id }, data })
        : prisma.zxWageAttendance.create({ data: { org_id: orgId, worker_id: m.worker_id, project_id: input.project_id, work_date: date, ...data } })
    );
    result.saved += 1;
  }
  if (ops.length) {
    await prisma.$transaction(ops);
    await markStale(orgId, input.work_date);
    await writeAudit(null, { orgId, actorId, entity: 'wage_attendance', entityId: input.project_id, action: 'mark', after: { date: input.work_date, saved: result.saved, cleared: result.cleared } });
  }
  return result;
}

async function removeAttendance(orgId, actorId, id) {
  const row = await prisma.zxWageAttendance.findFirst({ where: { id, org_id: orgId } });
  if (!row) return { error: 'not_found' };
  if (row.payout_id) return { error: 'paid_locked' };
  await prisma.zxWageAttendance.delete({ where: { id } });
  await markStale(orgId, row.work_date);
  await writeAudit(null, { orgId, actorId, entity: 'wage_attendance', entityId: id, action: 'delete', before: attendanceOut(row) });
  return { deleted: true };
}

// ---- advances
async function outstandingAdvance(orgId, workerId, excludeAdvanceId) {
  const [adv, rec] = await Promise.all([
    prisma.zxWageAdvance.aggregate({ where: { org_id: orgId, worker_id: workerId, ...(excludeAdvanceId ? { id: { not: excludeAdvanceId } } : {}) }, _sum: { amount: true } }),
    prisma.zxWagePayout.aggregate({ where: { org_id: orgId, worker_id: workerId, status: 'paid' }, _sum: { advance_recovered: true } }),
  ]);
  return round2(num(adv._sum.amount) - num(rec._sum.advance_recovered));
}

const advanceOut = (a) => ({ id: a.id, worker_id: a.worker_id, given_on: dayOf(a.given_on), amount: num(a.amount), payment_mode: a.payment_mode, notes: a.notes });

async function listAdvances(orgId, q) {
  const rows = await prisma.zxWageAdvance.findMany({ where: { org_id: orgId, ...(q.worker_id ? { worker_id: q.worker_id } : {}) }, orderBy: [{ given_on: 'desc' }, { created_at: 'desc' }] });
  return { advances: rows.map(advanceOut) };
}

async function createAdvance(orgId, actorId, input) {
  if (!(await prisma.zxWageWorker.findFirst({ where: { id: input.worker_id, org_id: orgId, deleted_at: null }, select: { id: true } }))) return { error: 'worker_not_found' };
  const row = await prisma.zxWageAdvance.create({ data: { org_id: orgId, worker_id: input.worker_id, given_on: toDate(input.given_on), amount: input.amount, payment_mode: input.payment_mode ?? null, notes: input.notes ?? null, created_by: actorId } });
  await writeAudit(null, { orgId, actorId, entity: 'wage_advance', entityId: row.id, action: 'create', after: advanceOut(row) });
  return { advance: advanceOut(row) };
}

async function updateAdvance(orgId, actorId, id, input) {
  const before = await prisma.zxWageAdvance.findFirst({ where: { id, org_id: orgId } });
  if (!before) return { error: 'not_found' };
  if (input.amount !== undefined) {
    const others = await outstandingAdvance(orgId, before.worker_id, id);
    if (others + input.amount < 0) return { error: 'advance_already_recovered' };
  }
  const data = {};
  if (input.given_on !== undefined) data.given_on = toDate(input.given_on);
  for (const k of ['amount', 'payment_mode', 'notes']) if (input[k] !== undefined) data[k] = input[k];
  const row = await prisma.zxWageAdvance.update({ where: { id }, data });
  await writeAudit(null, { orgId, actorId, entity: 'wage_advance', entityId: id, action: 'update', before: advanceOut(before), after: advanceOut(row) });
  return { advance: advanceOut(row) };
}

async function removeAdvance(orgId, actorId, id) {
  const before = await prisma.zxWageAdvance.findFirst({ where: { id, org_id: orgId } });
  if (!before) return { error: 'not_found' };
  if ((await outstandingAdvance(orgId, before.worker_id, id)) < 0) return { error: 'advance_already_recovered' };
  await prisma.zxWageAdvance.delete({ where: { id } });
  await writeAudit(null, { orgId, actorId, entity: 'wage_advance', entityId: id, action: 'delete', before: advanceOut(before) });
  return { deleted: true };
}

// ---- payouts
function payableWhere(orgId, q) {
  return { org_id: orgId, worker_id: q.worker_id, payout_id: null, work_date: { ...(q.from_date ? { gte: toDate(q.from_date) } : {}), lte: toDate(q.to_date) }, ...(q.project_id ? { project_id: q.project_id } : {}) };
}

// What a payout would settle: the worker's unpaid days up to a date, by project, plus the advance still to recover.
async function payable(orgId, q) {
  const worker = await prisma.zxWageWorker.findFirst({ where: { id: q.worker_id, org_id: orgId, deleted_at: null } });
  if (!worker) return { error: 'worker_not_found' };
  const rows = await prisma.zxWageAttendance.findMany({ where: payableWhere(orgId, q), orderBy: { work_date: 'asc' } });
  const byProject = new Map();
  for (const r of rows) {
    const p = byProject.get(r.project_id) || { project_id: r.project_id, days: 0, ot_hours: 0, amount: 0 };
    p.days += num(r.day_fraction);
    p.ot_hours += num(r.ot_hours);
    p.amount += num(r.amount);
    byProject.set(r.project_id, p);
  }
  const projects = await prisma.zxProject.findMany({ where: { id: { in: [...byProject.keys()] } }, select: { id: true, code: true, name: true } });
  const meta = new Map(projects.map((p) => [p.id, p]));
  return {
    worker: workerOut(worker),
    rows: rows.length,
    from_date: rows.length ? dayOf(rows[0].work_date) : null,
    days: round2(rows.reduce((a, r) => a + num(r.day_fraction), 0)),
    ot_hours: round2(rows.reduce((a, r) => a + num(r.ot_hours), 0)),
    gross: round2(rows.reduce((a, r) => a + num(r.amount), 0)),
    advance_outstanding: await outstandingAdvance(orgId, q.worker_id),
    projects: [...byProject.values()].map((p) => ({ ...p, days: round2(p.days), ot_hours: round2(p.ot_hours), amount: round2(p.amount), code: meta.get(p.project_id)?.code || null, name: meta.get(p.project_id)?.name || 'Project' })),
  };
}

async function listPayouts(orgId, q) {
  const rows = await prisma.zxWagePayout.findMany({
    where: { org_id: orgId, ...(q.worker_id ? { worker_id: q.worker_id } : {}), ...(q.status ? { status: q.status } : {}), ...(q.from || q.to ? { paid_on: { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) } } : {}) },
    include: { worker: { select: { id: true, name: true, trade: true } } },
    orderBy: [{ paid_on: 'desc' }, { created_at: 'desc' }],
  });
  const totals = rows.filter((r) => r.status === 'paid').reduce((a, r) => ({ gross: a.gross + num(r.gross), net: a.net + num(r.net), advance_recovered: a.advance_recovered + num(r.advance_recovered) }), { gross: 0, net: 0, advance_recovered: 0 });
  return { payouts: rows.map((r) => ({ ...payoutOut(r), worker: r.worker })), totals: { gross: round2(totals.gross), net: round2(totals.net), advance_recovered: round2(totals.advance_recovered) } };
}

async function pay(orgId, actorId, input) {
  const worker = await prisma.zxWageWorker.findFirst({ where: { id: input.worker_id, org_id: orgId, deleted_at: null }, select: { id: true } });
  if (!worker) return { error: 'worker_not_found' };
  const rows = await prisma.zxWageAttendance.findMany({ where: payableWhere(orgId, input) });
  if (rows.length === 0) return { error: 'nothing_to_pay' };
  const gross = round2(rows.reduce((a, r) => a + num(r.amount), 0));
  if (gross <= 0) return { error: 'nothing_to_pay' };
  if (input.advance_recovered > (await outstandingAdvance(orgId, input.worker_id))) return { error: 'advance_exceeds_outstanding' };
  if (input.advance_recovered + input.other_deductions > gross) return { error: 'deductions_exceed' };
  const net = round2(gross - input.advance_recovered - input.other_deductions);
  const dates = rows.map((r) => dayOf(r.work_date)).sort();
  const payout = await prisma.$transaction(async (tx) => {
    const created = await tx.zxWagePayout.create({
      data: {
        org_id: orgId,
        worker_id: input.worker_id,
        project_id: input.project_id ?? null,
        from_date: toDate(input.from_date || dates[0]),
        to_date: toDate(input.to_date),
        days: round2(rows.reduce((a, r) => a + num(r.day_fraction), 0)),
        ot_hours: round2(rows.reduce((a, r) => a + num(r.ot_hours), 0)),
        gross,
        advance_recovered: input.advance_recovered,
        other_deductions: input.other_deductions,
        net,
        paid_on: toDate(input.paid_on),
        payment_mode: input.payment_mode,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        paid_by: actorId,
      },
    });
    const claimed = await tx.zxWageAttendance.updateMany({ where: { id: { in: rows.map((r) => r.id) }, payout_id: null }, data: { payout_id: created.id } });
    if (claimed.count !== rows.length) throw Object.assign(new Error('changed'), { zxChanged: true });
    return created;
  }).catch((e) => (e.zxChanged ? null : Promise.reject(e)));
  if (!payout) return { error: 'changed_meanwhile' };
  await writeAudit(null, { orgId, actorId, entity: 'wage_payout', entityId: payout.id, action: 'pay', after: payoutOut(payout) });
  return { payout: payoutOut(payout) };
}

async function voidPayout(orgId, actorId, id, reason) {
  const before = await prisma.zxWagePayout.findFirst({ where: { id, org_id: orgId } });
  if (!before) return { error: 'not_found' };
  if (before.status !== 'paid') return { error: 'already_voided' };
  const row = await prisma.$transaction(async (tx) => {
    await tx.zxWageAttendance.updateMany({ where: { payout_id: id }, data: { payout_id: null } });
    return tx.zxWagePayout.update({ where: { id }, data: { status: 'voided', voided_reason: reason } });
  });
  await writeAudit(null, { orgId, actorId, entity: 'wage_payout', entityId: id, action: 'void', before: payoutOut(before), after: payoutOut(row), reason });
  return { payout: payoutOut(row) };
}

// Receipt-style detail of one payout: its days by project.
async function payoutDetail(orgId, id) {
  const p = await prisma.zxWagePayout.findFirst({ where: { id, org_id: orgId }, include: { worker: { select: { id: true, name: true, trade: true, phone: true } }, attendance: { orderBy: { work_date: 'asc' } } } });
  if (!p) return { error: 'not_found' };
  const projects = await prisma.zxProject.findMany({ where: { id: { in: [...new Set(p.attendance.map((a) => a.project_id))] } }, select: { id: true, code: true, name: true } });
  const meta = new Map(projects.map((x) => [x.id, x]));
  return { payout: { ...payoutOut(p), worker: p.worker, attendance: p.attendance.map((a) => ({ ...attendanceOut(a), project: meta.get(a.project_id) || null })) } };
}

// ---- reports: days and wages per project and per worker for a date range
async function summary(orgId, q) {
  const rows = await prisma.zxWageAttendance.findMany({
    where: { org_id: orgId, work_date: { gte: toDate(q.from), lte: toDate(q.to) }, ...(q.project_id ? { project_id: q.project_id } : {}) },
    select: { worker_id: true, project_id: true, day_fraction: true, ot_hours: true, amount: true, payout_id: true, status: true },
  });
  const [projects, workers] = await Promise.all([
    prisma.zxProject.findMany({ where: { org_id: orgId }, select: { id: true, code: true, name: true } }),
    prisma.zxWageWorker.findMany({ where: { org_id: orgId }, select: { id: true, name: true, trade: true } }),
  ]);
  const group = (key) => {
    const m = new Map();
    for (const r of rows) {
      const k = r[key];
      const g = m.get(k) || { id: k, days: 0, ot_hours: 0, amount: 0, paid: 0, workers: new Set(), absent: 0 };
      g.days += num(r.day_fraction);
      g.ot_hours += num(r.ot_hours);
      g.amount += num(r.amount);
      if (r.payout_id) g.paid += num(r.amount);
      g.workers.add(r.worker_id);
      if (r.status === 'absent') g.absent += 1;
      m.set(k, g);
    }
    return m;
  };
  const fin = (g) => ({ id: g.id, days: round2(g.days), ot_hours: round2(g.ot_hours), amount: round2(g.amount), paid: round2(g.paid), unpaid: round2(g.amount - g.paid), workers: g.workers.size, absent_days: g.absent });
  const pm = new Map(projects.map((p) => [p.id, p]));
  const wm = new Map(workers.map((w) => [w.id, w]));
  const byProject = [...group('project_id').values()].map((g) => ({ ...fin(g), code: pm.get(g.id)?.code || null, name: pm.get(g.id)?.name || 'Project' })).sort((a, b) => b.amount - a.amount);
  const byWorker = [...group('worker_id').values()].map((g) => ({ ...fin(g), name: wm.get(g.id)?.name || 'Worker', trade: wm.get(g.id)?.trade || null })).sort((a, b) => b.amount - a.amount);
  const t = byProject.reduce((a, r) => ({ days: a.days + r.days, amount: a.amount + r.amount, paid: a.paid + r.paid }), { days: 0, amount: 0, paid: 0 });
  return { from: q.from, to: q.to, projects: byProject, workers: byWorker, totals: { days: round2(t.days), amount: round2(t.amount), paid: round2(t.paid), unpaid: round2(t.amount - t.paid) } };
}

// Wage cost by project and month (by the day worked), for the profit reports: [{ month, project_id, amount }].
async function costRows(orgId, from, to) {
  const rows = await prisma.zxWageAttendance.findMany({ where: { org_id: orgId, work_date: { gte: toDate(from), lte: toDate(to) }, amount: { gt: 0 } }, select: { work_date: true, project_id: true, amount: true } });
  return rows.map((r) => ({ month: dayOf(r.work_date).slice(0, 7), project_id: r.project_id, amount: num(r.amount) }));
}

module.exports = {
  STATUSES,
  createWorkerSchema,
  updateWorkerSchema,
  workerListSchema,
  bulkSchema,
  sheetQuerySchema,
  attendanceQuerySchema,
  rangeSchema,
  advanceSchema,
  advanceUpdateSchema,
  advanceQuerySchema,
  payableQuerySchema,
  payoutSchema,
  payoutQuerySchema,
  voidSchema,
  listWorkers,
  createWorker,
  updateWorker,
  removeWorker,
  daySheet,
  listAttendance,
  markDay,
  removeAttendance,
  listAdvances,
  createAdvance,
  updateAdvance,
  removeAdvance,
  payable,
  listPayouts,
  pay,
  voidPayout,
  payoutDetail,
  summary,
  costRows,
};
