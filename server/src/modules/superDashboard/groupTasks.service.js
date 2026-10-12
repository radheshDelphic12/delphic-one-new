const { z } = require('zod');
const prisma = require('../../config/db');
const calc = require('./groupTasks.calc');

// Group task management for the Super Admin: one-time and recurring tasks across the companies of the group, plus the
// weekly table that links every company to the day of the week it is reviewed on. All of it is scoped to the caller's
// holding group(s) and written to the audit trail.

const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
const dateOrNull = z.preprocess((v) => (v === '' ? null : v), dateStr.nullable().optional());

const taskFields = {
  title: z.string().trim().min(1).max(200),
  notes: text(4000),
  org_id: uuidOrNull, // null = every company
  priority: z.enum(['low', 'medium', 'high']),
  kind: z.enum(['one_time', 'recurring']),
  due_date: dateOrNull,
  frequency: z.enum(calc.FREQUENCIES).nullable().optional(),
  interval: z.coerce.number().int().min(1).max(52),
  weekdays: z.array(z.coerce.number().int().min(1).max(7)).max(7),
  day_of_month: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().int().min(1).max(31).nullable().optional()),
  start_date: dateOrNull,
  end_date: dateOrNull,
  status: z.enum(['active', 'paused', 'cancelled']),
  assignee_id: uuidOrNull,
};
const createSchema = z.object({ ...taskFields, priority: taskFields.priority.default('medium'), kind: taskFields.kind.default('one_time'), interval: taskFields.interval.default(1), weekdays: taskFields.weekdays.default([]), status: taskFields.status.default('active') });
const updateSchema = z.object(taskFields).partial();
const listQuerySchema = z.object({ month: monthStr.optional(), org_id: z.string().uuid().optional(), status: z.enum(['open', 'done', 'all']).default('all') });
const weekQuerySchema = z.object({ date: dateStr.optional(), org_id: z.string().uuid().optional() });
const planSchema = z.object({
  assignments: z.array(z.object({ org_id: z.string().uuid(), weekdays: z.array(z.coerce.number().int().min(1).max(7)).max(7), note: text(300) })).max(100),
});
const doneSchema = z.object({ done: z.boolean(), note: text(500) });

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).format(new Date());

function validateRule(t) {
  if (t.kind === 'one_time') return t.due_date ? null : 'due_date_required';
  if (!t.frequency) return 'frequency_required';
  if (!t.start_date) return 'start_date_required';
  if (t.end_date && t.end_date < t.start_date) return 'bad_dates';
  if (t.frequency === 'weekly' && !t.weekdays?.length) return 'weekdays_required';
  return null;
}

async function companies(groupIds, orgId) {
  return prisma.org.findMany({
    where: { org_group_id: { in: groupIds }, status: 'active', ...(orgId ? { id: orgId } : {}) },
    select: { id: true, name: true, slug: true, logo_url: true, enabled_modules: true },
    orderBy: { name: 'asc' },
  });
}
const isSoon = (o) => Boolean(o.enabled_modules?.includes('coming_soon'));

async function audit(userId, action, taskId, reason, snapshot) {
  await prisma.auditLog.create({ data: { actor_id: userId, action, entity_type: 'group_task', entity_id: taskId, reason, snapshot: snapshot || {} } });
}

const taskOut = (t, orgs, names) => ({
  id: t.id, title: t.title, notes: t.notes, priority: t.priority, kind: t.kind, status: t.status,
  org_id: t.org_id, company: t.org_id ? orgs.get(t.org_id) || null : null,
  due_date: calc.dayOf(t.due_date), frequency: t.frequency, interval: t.interval, weekdays: t.weekdays, day_of_month: t.day_of_month,
  start_date: calc.dayOf(t.start_date), end_date: calc.dayOf(t.end_date),
  assignee: t.assignee_id ? { id: t.assignee_id, name: names.get(t.assignee_id) || null } : null,
  created_at: t.created_at, updated_at: t.updated_at,
});

async function loadTasks(groupIds, orgId) {
  const rows = await prisma.groupTask.findMany({ where: { org_group_id: { in: groupIds }, deleted_at: null, ...(orgId ? { OR: [{ org_id: orgId }, { org_id: null }] } : {}) }, orderBy: [{ created_at: 'asc' }] });
  const orgs = new Map((await companies(groupIds)).map((o) => [o.id, { id: o.id, name: o.name, slug: o.slug, logo_url: o.logo_url }]));
  const userIds = [...new Set(rows.map((r) => r.assignee_id).filter(Boolean))];
  const names = new Map((userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
  return { rows, orgs, names };
}

/** Every occurrence of every task in [from, to], with done flags, ready for a list or a calendar. */
async function occurrences(groupIds, from, to, orgId) {
  const { rows, orgs, names } = await loadTasks(groupIds, orgId);
  const done = rows.length ? await prisma.groupTaskDone.findMany({ where: { task_id: { in: rows.map((r) => r.id) }, occurrence_date: { gte: toDate(from), lte: toDate(to) } } }) : [];
  const doneKey = new Map(done.map((d) => [`${d.task_id}|${calc.dayOf(d.occurrence_date)}`, d]));
  const doers = new Map((done.length ? await prisma.user.findMany({ where: { id: { in: [...new Set(done.map((d) => d.done_by).filter(Boolean))] } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
  const today = todayIst();
  const items = [];
  for (const t of rows) {
    for (const date of calc.occurrencesBetween(t, from, to)) {
      const d = doneKey.get(`${t.id}|${date}`);
      items.push({
        key: `${t.id}|${date}`, task_id: t.id, date, title: t.title, notes: t.notes, priority: t.priority, kind: t.kind,
        recurring: t.kind === 'recurring', frequency: t.frequency, company: t.org_id ? orgs.get(t.org_id) || null : null,
        assignee: t.assignee_id ? { id: t.assignee_id, name: names.get(t.assignee_id) || null } : null,
        done: Boolean(d), done_by: d ? doers.get(d.done_by) || null : null, done_at: d ? d.done_at : null,
        overdue: !d && date < today,
      });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || ['high', 'medium', 'low'].indexOf(a.priority) - ['high', 'medium', 'low'].indexOf(b.priority) || a.title.localeCompare(b.title));
  return { items, tasks: rows.map((t) => taskOut(t, orgs, names)), orgs };
}

async function listMonth(groupIds, rawQuery) {
  const q = listQuerySchema.parse(rawQuery);
  const today = todayIst();
  const month = q.month || today.slice(0, 7);
  const { from, to } = calc.monthRange(month);
  const { items, tasks } = await occurrences(groupIds, from, to, q.org_id);
  const shown = q.status === 'open' ? items.filter((i) => !i.done) : q.status === 'done' ? items.filter((i) => i.done) : items;
  return {
    month, from, to, today,
    items: shown,
    summary: { total: items.length, done: items.filter((i) => i.done).length, open: items.filter((i) => !i.done).length, overdue: items.filter((i) => i.overdue).length, recurring: items.filter((i) => i.recurring).length, one_time: items.filter((i) => !i.recurring).length },
    tasks,
  };
}

/** The next tasks from today across `days` days (default a month), for the "what is coming" list. */
async function upcoming(groupIds, rawQuery = {}) {
  const days = Math.min(Math.max(Number(rawQuery.days) || 31, 1), 120);
  const today = todayIst();
  const to = calc.addDays(today, days - 1);
  const orgId = rawQuery.org_id && z.string().uuid().safeParse(rawQuery.org_id).success ? rawQuery.org_id : undefined;
  const { items } = await occurrences(groupIds, today, to, orgId);
  // anything still open and overdue from the last 30 days rides along at the top
  const back = await occurrences(groupIds, calc.addDays(today, -30), calc.addDays(today, -1), orgId);
  return { from: today, to, days, overdue: back.items.filter((i) => !i.done), items: items.filter((i) => !i.done) };
}

async function create(groupIds, userId, rawBody) {
  const body = createSchema.parse(rawBody);
  const bad = validateRule(body);
  if (bad) return { error: bad };
  if (body.org_id && !(await companies(groupIds, body.org_id)).length) return { error: 'company_not_found' };
  const group = groupIds[0];
  const row = await prisma.groupTask.create({
    data: {
      org_group_id: group, org_id: body.org_id || null, title: body.title, notes: body.notes || null, priority: body.priority, kind: body.kind,
      due_date: body.kind === 'one_time' ? toDate(body.due_date) : null,
      frequency: body.kind === 'recurring' ? body.frequency : null, interval: body.interval, weekdays: body.kind === 'recurring' && body.frequency === 'weekly' ? body.weekdays : [],
      day_of_month: body.kind === 'recurring' ? body.day_of_month ?? null : null,
      start_date: body.kind === 'recurring' ? toDate(body.start_date) : null, end_date: body.kind === 'recurring' ? toDate(body.end_date) : null,
      status: body.status, assignee_id: body.assignee_id || null, created_by: userId,
    },
  });
  await audit(userId, 'create', row.id, `Added task "${row.title}"`, { kind: row.kind, org_id: row.org_id });
  return { task: row };
}

async function update(groupIds, userId, id, rawBody) {
  const before = await prisma.groupTask.findFirst({ where: { id, org_group_id: { in: groupIds }, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  const body = updateSchema.parse(rawBody);
  const merged = { ...before, ...body, due_date: body.due_date !== undefined ? body.due_date : calc.dayOf(before.due_date), start_date: body.start_date !== undefined ? body.start_date : calc.dayOf(before.start_date), end_date: body.end_date !== undefined ? body.end_date : calc.dayOf(before.end_date) };
  const bad = validateRule(merged);
  if (bad) return { error: bad };
  if (body.org_id && !(await companies(groupIds, body.org_id)).length) return { error: 'company_not_found' };
  const data = { ...body };
  for (const k of ['due_date', 'start_date', 'end_date']) if (k in data) data[k] = toDate(data[k]);
  if (merged.kind === 'one_time') Object.assign(data, { frequency: null, weekdays: [], day_of_month: null, start_date: null, end_date: null });
  else data.due_date = null;
  const row = await prisma.groupTask.update({ where: { id }, data });
  const changed = Object.keys(body).filter((k) => JSON.stringify(before[k] instanceof Date ? calc.dayOf(before[k]) : before[k]) !== JSON.stringify(row[k] instanceof Date ? calc.dayOf(row[k]) : row[k]));
  if (changed.length) await audit(userId, 'update', id, `Edited ${changed.map((c) => c.replace(/_/g, ' ')).join(', ')}`, { fields: changed });
  return { task: row };
}

async function remove(groupIds, userId, id) {
  const before = await prisma.groupTask.findFirst({ where: { id, org_group_id: { in: groupIds }, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.groupTask.update({ where: { id }, data: { deleted_at: new Date() } });
  await audit(userId, 'delete', id, `Deleted task "${before.title}"`, { kind: before.kind });
  return { ok: true };
}

/** Tick one date of a task done / not done. For a recurring task only that date changes. */
async function setDone(groupIds, userId, id, date, rawBody) {
  const { done, note } = doneSchema.parse(rawBody || {});
  if (!dateStr.safeParse(date).success) return { error: 'bad_date' };
  const task = await prisma.groupTask.findFirst({ where: { id, org_group_id: { in: groupIds }, deleted_at: null } });
  if (!task) return { error: 'not_found' };
  if (!calc.occurrencesBetween({ ...task, status: 'active' }, date, date).length) return { error: 'not_an_occurrence' };
  const key = { task_id_occurrence_date: { task_id: id, occurrence_date: toDate(date) } };
  if (done) await prisma.groupTaskDone.upsert({ where: key, update: { done_by: userId, done_at: new Date(), note: note || null }, create: { task_id: id, occurrence_date: toDate(date), done_by: userId, note: note || null } });
  else await prisma.groupTaskDone.deleteMany({ where: { task_id: id, occurrence_date: toDate(date) } });
  await audit(userId, done ? 'done' : 'reopen', id, `${done ? 'Completed' : 'Reopened'} "${task.title}" for ${date}`, { date });
  return { ok: true, done };
}

// ---------------- the weekly table ----------------
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Seven days of one week: the companies linked to each weekday, that day's tasks, today highlighted. */
async function weeklyPlan(groupIds, rawQuery = {}) {
  const q = weekQuerySchema.parse(rawQuery);
  const today = todayIst();
  const weekStart = calc.mondayOf(q.date || today);
  const weekEnd = calc.addDays(weekStart, 6);
  const [orgs, links, occ] = await Promise.all([
    companies(groupIds),
    prisma.groupCompanyDay.findMany({ where: { org_group_id: { in: groupIds } } }),
    occurrences(groupIds, weekStart, weekEnd, q.org_id),
  ]);
  const byOrg = new Map(orgs.map((o) => [o.id, { id: o.id, name: o.name, slug: o.slug, logo_url: o.logo_url, coming_soon: isSoon(o) }]));
  const notes = new Map(links.map((l) => [`${l.org_id}|${l.weekday}`, l.note]));
  const days = DAY_NAMES.map((name, i) => {
    const weekday = i + 1;
    const date = calc.addDays(weekStart, i);
    const linked = links.filter((l) => l.weekday === weekday && byOrg.has(l.org_id)).map((l) => ({ ...byOrg.get(l.org_id), note: notes.get(`${l.org_id}|${weekday}`) || null })).sort((a, b) => a.name.localeCompare(b.name));
    const tasks = occ.items.filter((t) => t.date === date);
    return { weekday, name, date, is_today: date === today, is_past: date < today, companies: linked, tasks, task_count: tasks.length, open_tasks: tasks.filter((t) => !t.done).length };
  });
  const linkedIds = new Set(links.map((l) => l.org_id));
  return {
    week_start: weekStart, week_end: weekEnd, today, prev_week: calc.addDays(weekStart, -7), next_week: calc.addDays(weekStart, 7),
    days,
    unassigned: [...byOrg.values()].filter((o) => !linkedIds.has(o.id)),
    assignments: [...byOrg.values()].map((o) => ({ org: o, weekdays: links.filter((l) => l.org_id === o.id).map((l) => l.weekday).sort((a, b) => a - b) })),
  };
}

/** Replaces the weekday links of the given companies (an empty list clears a company). */
async function setWeeklyPlan(groupIds, userId, rawBody) {
  const { assignments } = planSchema.parse(rawBody);
  const valid = new Set((await companies(groupIds)).map((o) => o.id));
  if (assignments.some((a) => !valid.has(a.org_id))) return { error: 'company_not_found' };
  const group = groupIds[0];
  const before = await prisma.groupCompanyDay.findMany({ where: { org_group_id: { in: groupIds }, org_id: { in: assignments.map((a) => a.org_id) } } });
  await prisma.$transaction(async (tx) => {
    for (const a of assignments) {
      const days = [...new Set(a.weekdays)];
      await tx.groupCompanyDay.deleteMany({ where: { org_id: a.org_id, ...(days.length ? { weekday: { notIn: days } } : {}) } });
      for (const weekday of days) {
        await tx.groupCompanyDay.upsert({ where: { org_id_weekday: { org_id: a.org_id, weekday } }, update: { note: a.note || null, updated_by: userId }, create: { org_group_id: group, org_id: a.org_id, weekday, note: a.note || null, updated_by: userId } });
      }
    }
    await tx.auditLog.create({ data: { actor_id: userId, action: 'weekly_plan', entity_type: 'group_task', entity_id: group, reason: 'Changed the weekly company days', snapshot: { before: before.map((b) => ({ org_id: b.org_id, weekday: b.weekday })), after: assignments.map((a) => ({ org_id: a.org_id, weekdays: a.weekdays })) } } });
  });
  return weeklyPlan(groupIds, {});
}

module.exports = { createSchema, updateSchema, listMonth, upcoming, create, update, remove, setDone, weeklyPlan, setWeeklyPlan, validateRule, DAY_NAMES };
