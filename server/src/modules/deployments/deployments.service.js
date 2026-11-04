const { z } = require('zod');
const prisma = require('../../config/db');
const calc = require('./deployments.calc');
const { canTrack } = require('../payments/payments.access');

// Group Dashboard > Travel > Deployments: client onsite visits, assignments and long-term resource deployments of any company of the group.
// A deployment is a record of its own (not a trip): its people, estimated budget, travel arrangements, an approval chain, actual expenses with
// bills, onsite logs, reviews and a full history. Group admins manage everything; deployed people log their work and expenses; managers and
// Finance act on the approval steps that name them.

const KINDS = ['visit', 'assignment', 'deployment'];
const ARRANGEMENTS = ['client_office', 'remote', 'hybrid'];
const ROLES = ['reporting_manager', 'delivery_manager', 'finance', 'admin'];
const TRAVEL_MODES = ['flight', 'train', 'bus', 'local_transport', 'accommodation', 'other'];
const OPEN = ['draft', 'pending_approval', 'approved', 'active'];

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const dateOrNull = z.preprocess((v) => (v === '' ? null : v), dateStr.nullable().optional());
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
const money = z.coerce.number().positive().max(1e10);
const pctOrNull = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().min(0).max(100).nullable());

const personSchema = z.object({
  user_id: uuidOrNull, name: z.string().trim().min(1).max(120), org_id: uuidOrNull, role: text(120),
  arrangement: z.enum(['inherit', ...ARRANGEMENTS]).default('inherit'), start_date: dateOrNull, end_date: dateOrNull,
});
const lineSchema = z.object({
  category: z.enum(calc.CATEGORIES), description: text(300), amount: money, frequency: z.enum(['one_time', 'monthly']).default('one_time'),
  funding: z.enum(calc.FUNDINGS).default('company'), client_share_pct: pctOrNull.optional(), billable: z.boolean().default(false),
}).refine((l) => l.funding !== 'shared' || (l.client_share_pct !== null && l.client_share_pct !== undefined), { message: 'Give the client\'s share (%) of a shared line', path: ['client_share_pct'] });
const travelSchema = z.object({
  person_id: uuidOrNull, mode: z.enum(TRAVEL_MODES), from_place: text(120), to_place: text(120), start_date: dateOrNull, end_date: dateOrNull,
  vendor: text(120), booking_ref: text(80), estimated_cost: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(1e10).nullable().optional()),
  status: z.enum(['planned', 'booked', 'completed', 'cancelled']).default('planned'), notes: text(1000),
});
const fields = {
  title: z.string().trim().min(1).max(200), kind: z.enum(KINDS), org_id: uuidOrNull,
  client_name: z.string().trim().min(1).max(200), client_account_id: uuidOrNull, client_location: text(300),
  client_supervisor_name: text(120), client_supervisor_phone: text(40), client_supervisor_email: text(160),
  pm_project_id: uuidOrNull, purpose: text(2000), start_date: dateStr, expected_end_date: dateStr,
  working_arrangement: z.enum(ARRANGEMENTS), reporting_manager_user_id: uuidOrNull, reporting_manager_name: text(120),
  delivery_manager_user_id: uuidOrNull, delivery_manager_name: text(120), currency: z.string().trim().min(3).max(3).default('INR'), notes: text(4000),
};
const createSchema = z.object({
  ...fields, kind: fields.kind.default('deployment'), working_arrangement: fields.working_arrangement.default('client_office'),
  people: z.array(personSchema).max(50).default([]), budget_lines: z.array(lineSchema).max(60).default([]), travel: z.array(travelSchema).max(60).default([]),
});
const updateSchema = z.object(fields).partial();
const submitSchema = z.object({ emergency: z.boolean().default(false), emergency_reason: text(1000) });
const extendSchema = z.object({ new_end_date: dateStr, reason: z.string().trim().min(3).max(500) });
const closeSchema = z.object({ actual_end_date: dateOrNull, reason: text(500) });
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const allocationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), person: personSchema, reason: text(500) }),
  z.object({ action: z.literal('replace'), person_id: z.string().uuid(), person: personSchema, reason: z.string().trim().min(3).max(500), on: dateOrNull }),
  z.object({ action: z.literal('release'), person_id: z.string().uuid(), reason: z.string().trim().min(3).max(500), on: dateOrNull }),
]);
const expenseSchema = z.object({
  expense_date: dateStr, category: z.enum(calc.CATEGORIES), description: text(500), amount: money, funding: z.enum(calc.FUNDINGS).default('company'),
  client_share_pct: pctOrNull.optional(), billable: z.preprocess((v) => v === true || v === 'true', z.boolean()).default(false),
  person_id: uuidOrNull,
}).refine((e) => e.funding !== 'shared' || (e.client_share_pct !== null && e.client_share_pct !== undefined), { message: 'Give the client\'s share (%) of a shared expense', path: ['client_share_pct'] });
const verifySchema = z.object({ decision: z.enum(['verify', 'reject']), note: text(500) });
const settleSchema = z.object({ settled_on: dateOrNull, settlement_ref: text(120) });
const recoverSchema = z.object({ amount: money, recovered_on: dateOrNull });
const logSchema = z.object({
  log_date: dateStr, location_mode: z.enum(['client_office', 'remote']).default('client_office'), hours: z.coerce.number().min(0).max(24),
  activities: z.string().trim().min(2).max(4000), deliverables: text(4000), pending_tasks: text(4000),
});
const reviewSchema = z.object({
  kind: z.enum(['weekly', 'client_feedback']), period_start: dateStr, person_id: uuidOrNull, rating: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().int().min(1).max(5).nullable().optional()),
  summary: z.string().trim().min(2).max(4000), client_contact: text(160),
});
const settingsSchema = z.object({
  approval_steps: z.array(z.enum(ROLES)).max(4).refine((a) => new Set(a).size === a.length, { message: 'Each step can appear once' }),
  emergency_allowed: z.boolean(), extension_needs_approval: z.boolean(), allocation_needs_approval: z.boolean(),
  overrun_tolerance_pct: z.coerce.number().min(0).max(100), ending_soon_days: z.coerce.number().int().min(1).max(180),
}).partial();
const listQuerySchema = z.object({
  status: z.enum(['open', 'draft', 'pending_approval', 'approved', 'active', 'closed', 'cancelled', 'all']).default('open'),
  org_id: z.string().uuid().optional(), kind: z.enum(KINDS).optional(), q: z.string().trim().max(100).optional(),
});

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const ymd = calc.ymd;
const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).format(new Date());
const num = calc.n;

// ---------------------------------------------------------------------------------------------------------------- helpers
/** Who is asking: the group of their company, whether they are a group admin, and whether Finance work is theirs. */
async function ctxOf(user) {
  const org = user.org_id ? await prisma.org.findUnique({ where: { id: user.org_id }, select: { org_group_id: true } }) : null;
  const u = await prisma.user.findUnique({ where: { id: user.id }, select: { is_group_superadmin: true, active: true } });
  const isGroupAdmin = Boolean(u?.active && u.is_group_superadmin);
  return { groupIds: org ? [org.org_group_id] : [], isGroupAdmin, canFinance: isGroupAdmin || (await canTrack(user)) };
}

async function settingsOf(groupId) {
  const row = await prisma.groupDeploymentSetting.findUnique({ where: { org_group_id: groupId } });
  return {
    approval_steps: row ? row.approval_steps : ['reporting_manager', 'delivery_manager', 'finance', 'admin'],
    emergency_allowed: row ? row.emergency_allowed : true,
    extension_needs_approval: row ? row.extension_needs_approval : true,
    allocation_needs_approval: row ? row.allocation_needs_approval : true,
    overrun_tolerance_pct: row ? num(row.overrun_tolerance_pct) : 0,
    ending_soon_days: row ? row.ending_soon_days : 14,
  };
}

async function updateSettings(groupIds, userId, body) {
  const data = settingsSchema.parse(body);
  const groupId = groupIds[0];
  await prisma.groupDeploymentSetting.upsert({ where: { org_group_id: groupId }, create: { org_group_id: groupId, ...data, updated_by: userId }, update: { ...data, updated_by: userId } });
  return { settings: await settingsOf(groupId) };
}

async function groupOrgs(groupIds) {
  return prisma.org.findMany({ where: { org_group_id: { in: groupIds }, status: 'active' }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
}

async function namesOf(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  return new Map((await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
}

async function event(client, deploymentId, kind, user, reason, detail) {
  await client.groupDeploymentEvent.create({ data: { deployment_id: deploymentId, kind, reason: reason || null, detail: detail || undefined, by_user: user?.id || null, by_name: user?.name || null } });
}

async function nextCode(groupId) {
  const last = await prisma.groupDeployment.findFirst({ where: { org_group_id: groupId }, orderBy: { code: 'desc' }, select: { code: true } });
  const n = last ? Number(String(last.code).replace(/\D/g, '')) + 1 : 1;
  return `DEP-${String(n).padStart(4, '0')}`;
}

const INCLUDE = {
  people: { orderBy: { created_at: 'asc' } }, budget_lines: { orderBy: { created_at: 'asc' } }, travel: { orderBy: [{ start_date: 'asc' }, { created_at: 'asc' }] },
  expenses: { where: { deleted_at: null }, orderBy: [{ expense_date: 'desc' }, { created_at: 'desc' }] },
  requests: { orderBy: { created_at: 'desc' }, include: { steps: { orderBy: { seq: 'asc' } } } },
};

async function load(groupIds, id, include = {}) {
  return prisma.groupDeployment.findFirst({ where: { id, org_group_id: { in: groupIds }, deleted_at: null }, include });
}

// ---------------------------------------------------------------------------------------------------------------- shaping
const shapePerson = (p) => ({
  id: p.id, user_id: p.user_id, name: p.name, org_id: p.org_id, role: p.role, arrangement: p.arrangement, start_date: ymd(p.start_date), end_date: ymd(p.end_date),
  status: p.status, released_on: ymd(p.released_on), release_reason: p.release_reason, replaces_id: p.replaces_id,
});
const shapeLine = (l) => ({ id: l.id, category: l.category, description: l.description, amount: num(l.amount), frequency: l.frequency, funding: l.funding, client_share_pct: l.client_share_pct == null ? null : num(l.client_share_pct), billable: l.billable });
const shapeTravel = (t) => ({
  id: t.id, person_id: t.person_id, mode: t.mode, from_place: t.from_place, to_place: t.to_place, start_date: ymd(t.start_date), end_date: ymd(t.end_date),
  vendor: t.vendor, booking_ref: t.booking_ref, estimated_cost: t.estimated_cost == null ? null : num(t.estimated_cost), status: t.status, notes: t.notes,
});
const shapeExpense = (e) => ({
  id: e.id, deployment_id: e.deployment_id, person_id: e.person_id, expense_date: ymd(e.expense_date), month: e.month, category: e.category, description: e.description,
  amount: num(e.amount), funding: e.funding, client_share_pct: e.client_share_pct == null ? null : num(e.client_share_pct), billable: e.billable, client_amount: num(e.client_amount),
  has_bill: Boolean(e.bill_url), bill_name: e.bill_name, bill_url: e.bill_url, status: e.status, submitted_by_name: e.submitted_by_name, verified_by_name: e.verified_by_name,
  verified_at: e.verified_at, verify_note: e.verify_note, settled_on: ymd(e.settled_on), settlement_ref: e.settlement_ref, recovery_status: e.recovery_status,
  recovered_amount: num(e.recovered_amount), recovered_on: ymd(e.recovered_on), over_budget: e.over_budget, overrun_request_id: e.overrun_request_id, created_at: e.created_at,
});
const shapeRequest = (r) => ({
  id: r.id, deployment_id: r.deployment_id, kind: r.kind, payload: r.payload, status: r.status, emergency: r.emergency, emergency_reason: r.emergency_reason,
  requested_by_name: r.requested_by_name, decision_note: r.decision_note, created_at: r.created_at, decided_at: r.decided_at,
  steps: (r.steps || []).map((s) => ({ seq: s.seq, role: s.role, status: s.status, decided_by_name: s.decided_by_name, decided_at: s.decided_at, comment: s.comment })),
  next_role: (r.steps || []).find((s) => s.status === 'pending')?.role || null,
});

function baseOf(d, settings, today) {
  const start = ymd(d.start_date);
  const end = ymd(d.expected_end_date);
  const daysLeft = d.status === 'active' ? Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000) : null;
  const state = d.status === 'active' ? (daysLeft < 0 ? 'overdue' : daysLeft <= settings.ending_soon_days ? 'ending_soon' : 'active') : d.status;
  return {
    id: d.id, code: d.code, title: d.title, kind: d.kind, org_id: d.org_id, client_name: d.client_name, client_account_id: d.client_account_id, client_location: d.client_location,
    client_supervisor_name: d.client_supervisor_name, client_supervisor_phone: d.client_supervisor_phone, client_supervisor_email: d.client_supervisor_email,
    pm_project_id: d.pm_project_id, purpose: d.purpose, start_date: start, expected_end_date: end, actual_end_date: ymd(d.actual_end_date),
    days: calc.daysBetween(start, end), months: calc.monthsOf(start, end), days_left: daysLeft, working_arrangement: d.working_arrangement,
    reporting_manager_user_id: d.reporting_manager_user_id, reporting_manager_name: d.reporting_manager_name, delivery_manager_user_id: d.delivery_manager_user_id, delivery_manager_name: d.delivery_manager_name,
    currency: d.currency, status: d.status, state, emergency: d.emergency, emergency_reason: d.emergency_reason, started_at: d.started_at, closed_at: d.closed_at, close_reason: d.close_reason, notes: d.notes,
    created_at: d.created_at,
  };
}

function figuresOf(d) {
  const lines = (d.budget_lines || []).map(shapeLine);
  const months = calc.monthsOf(ymd(d.start_date), ymd(d.expected_end_date));
  const est = calc.estimate(lines, months);
  const expenses = (d.expenses || []).map(shapeExpense);
  const act = calc.actuals(expenses, est, ymd(d.start_date), ymd(d.expected_end_date));
  return { lines, est, expenses, act };
}

async function listFor(groupIds, query) {
  const q = listQuerySchema.parse(query || {});
  const settings = await settingsOf(groupIds[0]);
  const today = todayIst();
  const where = { org_group_id: { in: groupIds }, deleted_at: null, ...(q.org_id ? { org_id: q.org_id } : {}), ...(q.kind ? { kind: q.kind } : {}) };
  if (q.status === 'open') where.status = { in: OPEN };
  else if (q.status !== 'all') where.status = q.status;
  if (q.q) where.OR = [{ title: { contains: q.q, mode: 'insensitive' } }, { client_name: { contains: q.q, mode: 'insensitive' } }, { code: { contains: q.q, mode: 'insensitive' } }];
  const rows = await prisma.groupDeployment.findMany({
    where, orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }],
    include: { people: true, budget_lines: true, expenses: { where: { deleted_at: null } }, requests: { where: { status: 'pending' }, select: { id: true, kind: true } } },
  });
  const orgs = await groupOrgs(groupIds);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  return rows.map((d) => {
    const f = figuresOf(d);
    const active = d.people.filter((p) => p.status === 'active');
    return {
      ...baseOf(d, settings, today), org_name: d.org_id ? orgName.get(d.org_id) || null : 'Whole group', people_count: active.length, people: active.map((p) => ({ id: p.id, name: p.name })),
      estimated: f.est.total, actual: f.act.total, variance: f.act.variance, over_budget: f.act.over_budget, pending_recovery: f.act.pending_recovery, pending_requests: d.requests.length,
    };
  });
}

async function get(groupIds, id) {
  const d = await load(groupIds, id, { ...INCLUDE, events: { orderBy: { created_at: 'desc' }, take: 200 }, reviews: { orderBy: [{ period_start: 'desc' }, { created_at: 'desc' }], take: 100 } });
  if (!d) return { error: 'not_found' };
  const settings = await settingsOf(d.org_group_id);
  const f = figuresOf(d);
  const today = todayIst();
  const todays = await prisma.groupDeploymentLog.findMany({ where: { deployment_id: id, log_date: toDate(today) }, select: { person_id: true, location_mode: true } });
  const activePeople = d.people.filter((p) => p.status === 'active');
  const where = (p) => { const l = todays.find((x) => x.person_id === p.id); return l ? l.location_mode : null; };
  const orgs = await groupOrgs(groupIds);
  const project = d.pm_project_id ? await prisma.pmProject.findUnique({ where: { id: d.pm_project_id }, select: { id: true, code: true, name: true } }) : null;
  return {
    deployment: {
      ...baseOf(d, settings, today), org_name: d.org_id ? orgs.find((o) => o.id === d.org_id)?.name || null : 'Whole group',
      project: project ? { id: project.id, code: project.code, name: project.name } : null,
      people: d.people.map((p) => ({ ...shapePerson(p), today: p.status === 'active' ? where(p) : null })),
      budget_lines: f.lines, estimate: f.est, actual: f.act, expenses: f.expenses, travel: d.travel.map(shapeTravel),
      requests: d.requests.map(shapeRequest), events: d.events.map((e) => ({ id: e.id, kind: e.kind, reason: e.reason, detail: e.detail, by_name: e.by_name, created_at: e.created_at })),
      reviews: d.reviews.map((r) => ({ id: r.id, kind: r.kind, period_start: ymd(r.period_start), rating: r.rating, summary: r.summary, client_contact: r.client_contact, person_id: r.person_id, created_by_name: r.created_by_name, created_at: r.created_at })),
      presence: { client_office: activePeople.filter((p) => where(p) === 'client_office').length, remote: activePeople.filter((p) => where(p) === 'remote').length, not_logged: activePeople.filter((p) => !where(p)).length },
      settings,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------- create / edit
async function checkRefs(groupIds, d) {
  const orgs = await groupOrgs(groupIds);
  const ids = new Set(orgs.map((o) => o.id));
  if (d.org_id && !ids.has(d.org_id)) return { error: 'company_not_found' };
  if (d.pm_project_id) {
    const p = await prisma.pmProject.findFirst({ where: { id: d.pm_project_id, org_id: { in: [...ids] } }, select: { id: true } });
    if (!p) return { error: 'project_not_found' };
  }
  if (d.client_account_id) {
    const a = await prisma.account.findFirst({ where: { id: d.client_account_id, org_id: { in: [...ids] }, deleted_at: null }, select: { id: true } });
    if (!a) return { error: 'client_not_found' };
  }
  return null;
}
const badDates = (s, e) => (s && e && e < s ? 'bad_dates' : null);

async function withManagerNames(d) {
  const names = await namesOf([d.reporting_manager_user_id, d.delivery_manager_user_id]);
  return {
    ...d,
    ...(d.reporting_manager_user_id && !d.reporting_manager_name ? { reporting_manager_name: names.get(d.reporting_manager_user_id) || null } : {}),
    ...(d.delivery_manager_user_id && !d.delivery_manager_name ? { delivery_manager_name: names.get(d.delivery_manager_user_id) || null } : {}),
  };
}

async function create(groupIds, user, body) {
  const parsed = createSchema.parse(body);
  if (badDates(parsed.start_date, parsed.expected_end_date)) return { error: 'bad_dates' };
  const refs = await checkRefs(groupIds, parsed);
  if (refs) return refs;
  const { people, budget_lines: lines, travel, ...rest } = await withManagerNames(parsed);
  const groupId = groupIds[0];
  let created = null;
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    const code = await nextCode(groupId);
    try {
      created = await prisma.$transaction(async (tx) => {
        const row = await tx.groupDeployment.create({
          data: {
            ...rest, code, org_group_id: groupId, created_by: user.id, start_date: toDate(rest.start_date), expected_end_date: toDate(rest.expected_end_date),
            people: { create: people.map((p) => ({ ...p, start_date: toDate(p.start_date), end_date: toDate(p.end_date) })) },
            budget_lines: { create: lines },
            travel: { create: travel.map((t) => ({ ...t, start_date: toDate(t.start_date), end_date: toDate(t.end_date) })) },
          },
        });
        await event(tx, row.id, 'created', user, `${rest.kind} for ${rest.client_name}`, { people: people.length });
        return row;
      });
    } catch (err) {
      if (err.code !== 'P2002') throw err; // a clash on the code: try the next number
    }
  }
  if (!created) return { error: 'code_clash' };
  return get(groupIds, created.id);
}

async function update(groupIds, user, id, body) {
  const d = updateSchema.parse(body);
  const row = await load(groupIds, id);
  if (!row) return { error: 'not_found' };
  if (!OPEN.includes(row.status)) return { error: 'closed' };
  const start = d.start_date || ymd(row.start_date);
  const end = d.expected_end_date || ymd(row.expected_end_date);
  if (badDates(start, end)) return { error: 'bad_dates' };
  // once submitted, the end date moves only through an extension, which is approved
  if (row.status !== 'draft' && d.expected_end_date && d.expected_end_date !== ymd(row.expected_end_date)) return { error: 'use_extension' };
  if (row.status !== 'draft' && d.start_date && d.start_date !== ymd(row.start_date) && row.status === 'active') return { error: 'started' };
  const refs = await checkRefs(groupIds, d);
  if (refs) return refs;
  const named = await withManagerNames({ ...row, ...d });
  const data = { ...d };
  if (d.reporting_manager_user_id !== undefined) data.reporting_manager_name = d.reporting_manager_name ?? named.reporting_manager_name ?? null;
  if (d.delivery_manager_user_id !== undefined) data.delivery_manager_name = d.delivery_manager_name ?? named.delivery_manager_name ?? null;
  if (d.start_date) data.start_date = toDate(d.start_date);
  if (d.expected_end_date) data.expected_end_date = toDate(d.expected_end_date);
  await prisma.$transaction(async (tx) => {
    await tx.groupDeployment.update({ where: { id }, data });
    await event(tx, id, 'edited', user, null, { fields: Object.keys(d) });
  });
  return get(groupIds, id);
}

async function remove(groupIds, user, id) {
  const row = await load(groupIds, id);
  if (!row) return { error: 'not_found' };
  if (row.status !== 'draft') return { error: 'only_draft' };
  await prisma.groupDeployment.update({ where: { id }, data: { deleted_at: new Date() } });
  return { id };
}

// ---------------------------------------------------------------------------------------------------------------- approvals
/** The ordered steps of a request. A manager step with nobody named on the deployment is skipped (approved, with a note). */
function stepsFor(settings, dep, only) {
  const roles = (only ? settings.approval_steps.filter((r) => only.includes(r)) : settings.approval_steps);
  return roles.map((role, i) => {
    const missing = (role === 'reporting_manager' && !dep.reporting_manager_user_id) || (role === 'delivery_manager' && !dep.delivery_manager_user_id);
    return missing ? { seq: i + 1, role, status: 'approved', decided_by_name: 'System', decided_at: new Date(), comment: 'Skipped: nobody is named for this step' } : { seq: i + 1, role, status: 'pending' };
  });
}

async function createRequest(tx, dep, user, kind, payload, steps, extra = {}) {
  const req = await tx.groupDeploymentRequest.create({
    data: { deployment_id: dep.id, kind, payload, requested_by: user?.id || null, requested_by_name: user?.name || null, ...extra, steps: { create: steps } },
    include: { steps: true },
  });
  return req;
}

/** Applies an approved request to its deployment. */
async function applyRequest(tx, dep, req, user) {
  const p = req.payload || {};
  if (req.kind === 'deployment') {
    if (dep.status === 'pending_approval') await tx.groupDeployment.update({ where: { id: dep.id }, data: { status: 'approved' } });
    await event(tx, dep.id, 'approved', user, 'Deployment approved', { request: req.id });
  } else if (req.kind === 'extension') {
    await tx.groupDeployment.update({ where: { id: dep.id }, data: { expected_end_date: toDate(p.new_end_date) } });
    await event(tx, dep.id, 'extended', user, p.reason, { from: ymd(dep.expected_end_date), to: p.new_end_date });
  } else if (req.kind === 'allocation') {
    await applyAllocation(tx, dep, p, user);
  } else if (req.kind === 'budget') {
    await tx.groupDeploymentBudgetLine.deleteMany({ where: { deployment_id: dep.id } });
    if ((p.lines || []).length) await tx.groupDeploymentBudgetLine.createMany({ data: p.lines.map((l) => ({ ...l, deployment_id: dep.id })) });
    await event(tx, dep.id, 'budget_revised', user, p.reason || null, { lines: (p.lines || []).length });
  } else if (req.kind === 'budget_overrun') {
    await event(tx, dep.id, 'overrun_approved', user, null, { expense: p.expense_id, over_by: p.over_by });
  }
}

/** Can this person decide the next step of a request? A group admin may always (override); otherwise the step\'s role must match. */
async function canDecide(user, ctx, dep, role) {
  if (ctx.isGroupAdmin) return true;
  if (role === 'reporting_manager') return dep.reporting_manager_user_id === user.id;
  if (role === 'delivery_manager') return dep.delivery_manager_user_id === user.id;
  if (role === 'finance') return ctx.canFinance;
  if (role === 'admin') return user.role === 'admin';
  return false;
}

async function decide(groupIds, user, ctx, requestId, body) {
  const input = z.object({ decision: z.enum(['approve', 'reject']), comment: text(500) }).parse(body);
  const req = await prisma.groupDeploymentRequest.findFirst({ where: { id: requestId, deployment: { org_group_id: { in: groupIds }, deleted_at: null } }, include: { steps: { orderBy: { seq: 'asc' } }, deployment: true } });
  if (!req) return { error: 'request_not_found' };
  if (req.status !== 'pending') return { error: 'request_done' };
  const step = req.steps.find((s) => s.status === 'pending');
  if (!step) return { error: 'request_done' };
  if (!(await canDecide(user, ctx, req.deployment, step.role))) return { error: 'not_your_step' };
  if (input.decision === 'reject' && !input.comment) return { error: 'comment_required' };
  await prisma.$transaction(async (tx) => {
    await tx.groupDeploymentRequestStep.update({ where: { id: step.id }, data: { status: input.decision === 'approve' ? 'approved' : 'rejected', decided_by: user.id, decided_by_name: user.name || null, decided_at: new Date(), comment: input.comment || null } });
    if (input.decision === 'reject') {
      await tx.groupDeploymentRequest.update({ where: { id: req.id }, data: { status: 'rejected', decided_at: new Date(), decision_note: input.comment } });
      if (req.kind === 'deployment' && req.deployment.status === 'pending_approval') await tx.groupDeployment.update({ where: { id: req.deployment_id }, data: { status: 'draft' } });
      await event(tx, req.deployment_id, 'rejected', user, input.comment, { kind: req.kind, step: step.role });
      return;
    }
    await event(tx, req.deployment_id, 'step_approved', user, input.comment, { kind: req.kind, step: step.role });
    const remaining = req.steps.filter((s) => s.status === 'pending' && s.id !== step.id);
    if (!remaining.length) {
      await tx.groupDeploymentRequest.update({ where: { id: req.id }, data: { status: 'approved', decided_at: new Date() } });
      await applyRequest(tx, req.deployment, req, user);
    }
  });
  return { request: shapeRequest(await prisma.groupDeploymentRequest.findUnique({ where: { id: req.id }, include: { steps: { orderBy: { seq: 'asc' } } } })), deployment_id: req.deployment_id };
}

/** Requests waiting for this person: the ones whose next step names their role (a group admin sees all pending ones). */
async function pendingFor(groupIds, user, ctx) {
  const rows = await prisma.groupDeploymentRequest.findMany({
    where: { status: 'pending', deployment: { org_group_id: { in: groupIds }, deleted_at: null } },
    include: { steps: { orderBy: { seq: 'asc' } }, deployment: { select: { id: true, code: true, title: true, client_name: true, reporting_manager_user_id: true, delivery_manager_user_id: true, status: true } } },
    orderBy: { created_at: 'asc' },
  });
  const out = [];
  for (const r of rows) {
    const step = r.steps.find((s) => s.status === 'pending');
    if (step && (await canDecide(user, ctx, r.deployment, step.role))) out.push({ ...shapeRequest(r), deployment: { id: r.deployment.id, code: r.deployment.code, title: r.deployment.title, client_name: r.deployment.client_name } });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- lifecycle
async function submit(groupIds, user, id, body) {
  const input = submitSchema.parse(body || {});
  const dep = await load(groupIds, id, { people: true, budget_lines: true });
  if (!dep) return { error: 'not_found' };
  if (dep.status !== 'draft') return { error: 'not_draft' };
  const settings = await settingsOf(dep.org_group_id);
  if (!dep.people.some((p) => p.status === 'active')) return { error: 'people_required' };
  if (input.emergency) {
    if (!settings.emergency_allowed) return { error: 'emergency_off' };
    if (!input.emergency_reason) return { error: 'emergency_reason' };
  } else {
    const est = calc.estimate(dep.budget_lines.map(shapeLine), calc.monthsOf(ymd(dep.start_date), ymd(dep.expected_end_date)));
    if (est.total <= 0) return { error: 'budget_required' };
  }
  const steps = stepsFor(settings, dep);
  await prisma.$transaction(async (tx) => {
    const allDone = steps.every((s) => s.status === 'approved');
    const req = await createRequest(tx, dep, user, 'deployment', { emergency: input.emergency }, steps, { emergency: input.emergency, emergency_reason: input.emergency_reason || null, ...(allDone ? { status: 'approved', decided_at: new Date() } : {}) });
    await tx.groupDeployment.update({ where: { id }, data: { status: allDone ? 'approved' : 'pending_approval', emergency: input.emergency, emergency_reason: input.emergency_reason || null } });
    await event(tx, id, allDone ? 'approved' : 'submitted', user, input.emergency ? `Emergency: ${input.emergency_reason}` : null, { request: req.id, steps: steps.map((s) => s.role) });
  });
  return get(groupIds, id);
}

async function start(groupIds, user, id) {
  const dep = await load(groupIds, id);
  if (!dep) return { error: 'not_found' };
  const emergencyStart = dep.status === 'pending_approval' && dep.emergency;
  if (dep.status !== 'approved' && !emergencyStart) return { error: 'not_approved' };
  await prisma.$transaction(async (tx) => {
    await tx.groupDeployment.update({ where: { id }, data: { status: 'active', started_at: new Date() } });
    await event(tx, id, 'started', user, emergencyStart ? 'Started before approval (emergency)' : null, {});
  });
  return get(groupIds, id);
}

async function close(groupIds, user, id, body) {
  const input = closeSchema.parse(body || {});
  const dep = await load(groupIds, id, { people: true });
  if (!dep) return { error: 'not_found' };
  if (dep.status !== 'active') return { error: 'not_active' };
  const end = input.actual_end_date || todayIst();
  await prisma.$transaction(async (tx) => {
    await tx.groupDeployment.update({ where: { id }, data: { status: 'closed', actual_end_date: toDate(end), closed_at: new Date(), close_reason: input.reason || null } });
    await tx.groupDeploymentPerson.updateMany({ where: { deployment_id: id, status: 'active' }, data: { status: 'released', released_on: toDate(end), release_reason: 'Deployment closed' } });
    await tx.groupDeploymentRequest.updateMany({ where: { deployment_id: id, status: 'pending' }, data: { status: 'cancelled', decided_at: new Date() } });
    await event(tx, id, 'closed', user, input.reason, { actual_end_date: end });
  });
  return get(groupIds, id);
}

async function cancel(groupIds, user, id, body) {
  const input = reasonSchema.parse(body || {});
  const dep = await load(groupIds, id);
  if (!dep) return { error: 'not_found' };
  if (!OPEN.includes(dep.status)) return { error: 'closed' };
  await prisma.$transaction(async (tx) => {
    await tx.groupDeployment.update({ where: { id }, data: { status: 'cancelled', closed_at: new Date(), close_reason: input.reason } });
    await tx.groupDeploymentRequest.updateMany({ where: { deployment_id: id, status: 'pending' }, data: { status: 'cancelled', decided_at: new Date() } });
    await event(tx, id, 'cancelled', user, input.reason, {});
  });
  return get(groupIds, id);
}

/** A change that needs approval once the deployment has been submitted: applied straight away in a draft, or when approvals are off. */
async function changeOrRequest(groupIds, user, dep, kind, payload, needsApproval, applyNow) {
  const settings = await settingsOf(dep.org_group_id);
  if (dep.status === 'draft' || !needsApproval(settings) || !settings.approval_steps.length) {
    await prisma.$transaction(async (tx) => { await applyNow(tx); });
    return { applied: true };
  }
  const steps = stepsFor(settings, dep);
  const allDone = steps.every((s) => s.status === 'approved');
  let created;
  await prisma.$transaction(async (tx) => {
    created = await createRequest(tx, dep, user, kind, payload, steps, allDone ? { status: 'approved', decided_at: new Date() } : {});
    if (allDone) await applyRequest(tx, dep, created, user);
    else await event(tx, dep.id, 'change_requested', user, payload.reason || null, { kind, request: created.id });
  });
  return { applied: allDone, requested: !allDone };
}

async function extend(groupIds, user, id, body) {
  const input = extendSchema.parse(body);
  const dep = await load(groupIds, id);
  if (!dep) return { error: 'not_found' };
  if (!OPEN.includes(dep.status)) return { error: 'closed' };
  if (input.new_end_date <= ymd(dep.expected_end_date)) return { error: 'extend_later' };
  const pending = await prisma.groupDeploymentRequest.count({ where: { deployment_id: id, kind: 'extension', status: 'pending' } });
  if (pending) return { error: 'extension_pending' };
  const out = await changeOrRequest(groupIds, user, dep, 'extension', { new_end_date: input.new_end_date, reason: input.reason }, (s) => s.extension_needs_approval, async (tx) => {
    await tx.groupDeployment.update({ where: { id }, data: { expected_end_date: toDate(input.new_end_date) } });
    await event(tx, id, 'extended', user, input.reason, { from: ymd(dep.expected_end_date), to: input.new_end_date });
  });
  return { ...(await get(groupIds, id)), ...out };
}

// ---------------------------------------------------------------------------------------------------------------- people / allocation
async function applyAllocation(tx, dep, p, user) {
  const today = todayIst();
  const personData = (x) => ({ user_id: x.user_id || null, name: x.name, org_id: x.org_id || null, role: x.role || null, arrangement: x.arrangement || 'inherit', start_date: toDate(x.start_date) || toDate(today), end_date: toDate(x.end_date) });
  if (p.action === 'add') {
    await tx.groupDeploymentPerson.create({ data: { deployment_id: dep.id, ...personData(p.person) } });
    await event(tx, dep.id, 'person_added', user, p.reason || null, { name: p.person.name });
  } else if (p.action === 'replace') {
    const old = await tx.groupDeploymentPerson.findFirst({ where: { id: p.person_id, deployment_id: dep.id } });
    if (!old) return;
    await tx.groupDeploymentPerson.update({ where: { id: old.id }, data: { status: 'replaced', released_on: toDate(p.on || today), release_reason: p.reason } });
    await tx.groupDeploymentPerson.create({ data: { deployment_id: dep.id, ...personData(p.person), replaces_id: old.id, start_date: toDate(p.on || today) } });
    await event(tx, dep.id, 'person_replaced', user, p.reason, { from: old.name, to: p.person.name });
  } else if (p.action === 'release') {
    const old = await tx.groupDeploymentPerson.findFirst({ where: { id: p.person_id, deployment_id: dep.id } });
    if (!old) return;
    await tx.groupDeploymentPerson.update({ where: { id: old.id }, data: { status: 'released', released_on: toDate(p.on || today), release_reason: p.reason } });
    await event(tx, dep.id, 'person_released', user, p.reason, { name: old.name });
  }
}

async function changeAllocation(groupIds, user, id, body) {
  const input = allocationSchema.parse(body);
  const dep = await load(groupIds, id, { people: true });
  if (!dep) return { error: 'not_found' };
  if (!OPEN.includes(dep.status)) return { error: 'closed' };
  if (input.action !== 'add') {
    const target = dep.people.find((p) => p.id === input.person_id && p.status === 'active');
    if (!target) return { error: 'person_not_found' };
  }
  const out = await changeOrRequest(groupIds, user, dep, 'allocation', input, (s) => s.allocation_needs_approval, async (tx) => applyAllocation(tx, dep, input, user));
  return { ...(await get(groupIds, id)), ...out };
}

async function updatePerson(groupIds, user, id, personId, body) {
  const input = z.object({ role: text(120), arrangement: z.enum(['inherit', ...ARRANGEMENTS]).optional(), start_date: dateOrNull, end_date: dateOrNull }).parse(body);
  const dep = await load(groupIds, id);
  if (!dep) return { error: 'not_found' };
  const p = await prisma.groupDeploymentPerson.findFirst({ where: { id: personId, deployment_id: id } });
  if (!p) return { error: 'person_not_found' };
  const data = { ...input };
  if (input.start_date !== undefined) data.start_date = toDate(input.start_date);
  if (input.end_date !== undefined) data.end_date = toDate(input.end_date);
  await prisma.$transaction(async (tx) => {
    await tx.groupDeploymentPerson.update({ where: { id: personId }, data });
    await event(tx, id, 'person_updated', user, null, { name: p.name, fields: Object.keys(input) });
  });
  return get(groupIds, id);
}

// ---------------------------------------------------------------------------------------------------------------- budget and travel arrangements
async function setBudget(groupIds, user, id, body) {
  const input = z.object({ lines: z.array(lineSchema).max(60), reason: text(500) }).parse(body);
  const dep = await load(groupIds, id);
  if (!dep) return { error: 'not_found' };
  if (!OPEN.includes(dep.status)) return { error: 'closed' };
  const out = await changeOrRequest(groupIds, user, dep, 'budget', { lines: input.lines, reason: input.reason || 'Budget revised' }, () => true, async (tx) => {
    await tx.groupDeploymentBudgetLine.deleteMany({ where: { deployment_id: id } });
    if (input.lines.length) await tx.groupDeploymentBudgetLine.createMany({ data: input.lines.map((l) => ({ ...l, deployment_id: id })) });
    await event(tx, id, 'budget_set', user, null, { lines: input.lines.length });
  });
  return { ...(await get(groupIds, id)), ...out };
}

async function addTravel(groupIds, user, id, body) {
  const t = travelSchema.parse(body);
  const dep = await load(groupIds, id);
  if (!dep) return { error: 'not_found' };
  if (!OPEN.includes(dep.status)) return { error: 'closed' };
  await prisma.$transaction(async (tx) => {
    await tx.groupDeploymentTravel.create({ data: { ...t, deployment_id: id, start_date: toDate(t.start_date), end_date: toDate(t.end_date) } });
    await event(tx, id, 'travel_added', user, null, { mode: t.mode, to: t.to_place });
  });
  return get(groupIds, id);
}
async function updateTravel(groupIds, user, id, travelId, body) {
  const t = travelSchema.partial().parse(body);
  const dep = await load(groupIds, id);
  if (!dep) return { error: 'not_found' };
  const row = await prisma.groupDeploymentTravel.findFirst({ where: { id: travelId, deployment_id: id } });
  if (!row) return { error: 'travel_not_found' };
  const data = { ...t };
  if (t.start_date !== undefined) data.start_date = toDate(t.start_date);
  if (t.end_date !== undefined) data.end_date = toDate(t.end_date);
  await prisma.groupDeploymentTravel.update({ where: { id: travelId }, data });
  return get(groupIds, id);
}
async function deleteTravel(groupIds, user, id, travelId) {
  const dep = await load(groupIds, id);
  if (!dep) return { error: 'not_found' };
  await prisma.groupDeploymentTravel.deleteMany({ where: { id: travelId, deployment_id: id } });
  return get(groupIds, id);
}

// ---------------------------------------------------------------------------------------------------------------- expenses
async function submitExpense(groupIds, user, id, body, file, ctx) {
  const input = expenseSchema.parse(body);
  const dep = await load(groupIds, id, { people: true, budget_lines: true, expenses: { where: { deleted_at: null } } });
  if (!dep) return { error: 'not_found' };
  if (!['approved', 'active'].includes(dep.status)) return { error: 'not_open_for_expenses' };
  const mine = dep.people.find((p) => p.user_id === user.id && p.status === 'active');
  const manager = dep.reporting_manager_user_id === user.id || dep.delivery_manager_user_id === user.id;
  if (!ctx.isGroupAdmin && !ctx.canFinance && !mine && !manager) return { error: 'forbidden' };
  const person = input.person_id ? dep.people.find((p) => p.id === input.person_id) : mine;
  if (input.person_id && !person) return { error: 'person_not_found' };
  const settings = await settingsOf(dep.org_group_id);
  const f = figuresOf(dep);
  const clientAmount = calc.clientPart(input.amount, input.funding, input.client_share_pct);
  const allowed = f.est.total * (1 + settings.overrun_tolerance_pct / 100);
  const overBudget = f.act.total + input.amount > allowed + 0.005;
  let expense;
  await prisma.$transaction(async (tx) => {
    expense = await tx.groupDeploymentExpense.create({
      data: {
        deployment_id: id, person_id: person?.id || null, expense_date: toDate(input.expense_date), month: input.expense_date.slice(0, 7), category: input.category, description: input.description || null,
        amount: input.amount, funding: input.funding, client_share_pct: input.client_share_pct ?? null, billable: input.billable, client_amount: clientAmount,
        bill_url: file?.url || null, bill_name: file?.name || null, submitted_by: user.id, submitted_by_name: user.name || null, over_budget: overBudget,
        recovery_status: 'none',
      },
    });
    await event(tx, id, 'expense_submitted', user, input.description || null, { amount: input.amount, category: input.category });
    if (overBudget) {
      const steps = stepsFor(settings, dep, ['finance', 'admin']);
      const useSteps = steps.length ? steps : [{ seq: 1, role: 'admin', status: 'pending' }];
      const req = await createRequest(tx, dep, user, 'budget_overrun', { expense_id: expense.id, amount: input.amount, over_by: calc.round2(f.act.total + input.amount - f.est.total) }, useSteps);
      await tx.groupDeploymentExpense.update({ where: { id: expense.id }, data: { overrun_request_id: req.id } });
      await event(tx, id, 'overrun_requested', user, null, { request: req.id, expense: expense.id });
    }
  });
  return get(groupIds, id);
}

async function loadExpense(groupIds, expenseId) {
  return prisma.groupDeploymentExpense.findFirst({ where: { id: expenseId, deleted_at: null, deployment: { org_group_id: { in: groupIds }, deleted_at: null } }, include: { deployment: { select: { id: true, org_id: true } } } });
}

async function verifyExpense(groupIds, user, expenseId, body) {
  const input = verifySchema.parse(body);
  const e = await loadExpense(groupIds, expenseId);
  if (!e) return { error: 'expense_not_found' };
  if (e.status !== 'submitted') return { error: 'expense_state' };
  if (input.decision === 'verify' && e.over_budget) {
    const req = e.overrun_request_id ? await prisma.groupDeploymentRequest.findUnique({ where: { id: e.overrun_request_id } }) : null;
    if (!req || req.status !== 'approved') return { error: 'overrun_pending' };
  }
  if (input.decision === 'reject' && !input.note) return { error: 'comment_required' };
  await prisma.$transaction(async (tx) => {
    await tx.groupDeploymentExpense.update({
      where: { id: expenseId },
      data: input.decision === 'verify'
        ? { status: 'verified', verified_by: user.id, verified_by_name: user.name || null, verified_at: new Date(), verify_note: input.note || null, recovery_status: num(e.client_amount) > 0 ? 'pending' : 'none' }
        : { status: 'rejected', verified_by: user.id, verified_by_name: user.name || null, verified_at: new Date(), verify_note: input.note, over_budget: false },
    });
    await event(tx, e.deployment_id, input.decision === 'verify' ? 'expense_verified' : 'expense_rejected', user, input.note, { expense: expenseId, amount: num(e.amount) });
  });
  return { deployment_id: e.deployment_id };
}

async function settleExpense(groupIds, user, expenseId, body) {
  const input = settleSchema.parse(body || {});
  const e = await loadExpense(groupIds, expenseId);
  if (!e) return { error: 'expense_not_found' };
  if (e.status !== 'verified') return { error: 'expense_state' };
  await prisma.$transaction(async (tx) => {
    await tx.groupDeploymentExpense.update({ where: { id: expenseId }, data: { status: 'settled', settled_on: toDate(input.settled_on || todayIst()), settlement_ref: input.settlement_ref || null } });
    await event(tx, e.deployment_id, 'expense_settled', user, input.settlement_ref, { expense: expenseId, amount: num(e.amount) });
  });
  return { deployment_id: e.deployment_id };
}

async function recoverExpense(groupIds, user, expenseId, body) {
  const input = recoverSchema.parse(body);
  const e = await loadExpense(groupIds, expenseId);
  if (!e) return { error: 'expense_not_found' };
  if (!['verified', 'settled'].includes(e.status) || num(e.client_amount) <= 0) return { error: 'expense_state' };
  const outstanding = calc.round2(num(e.client_amount) - num(e.recovered_amount));
  if (input.amount > outstanding + 0.005) return { error: 'recover_too_much' };
  const total = calc.round2(num(e.recovered_amount) + input.amount);
  await prisma.$transaction(async (tx) => {
    await tx.groupDeploymentExpense.update({ where: { id: expenseId }, data: { recovered_amount: total, recovered_on: toDate(input.recovered_on || todayIst()), recovery_status: calc.recoveryStatus(e.client_amount, total) } });
    await event(tx, e.deployment_id, 'recovery_recorded', user, null, { expense: expenseId, amount: input.amount });
  });
  return { deployment_id: e.deployment_id };
}

/** Who may download an expense bill: the group admin, Finance, the submitter, or the deployment\'s managers. */
async function canReadBill(user, fileUrl, ctx) {
  const e = await prisma.groupDeploymentExpense.findFirst({ where: { bill_url: fileUrl, deleted_at: null }, include: { deployment: { select: { org_group_id: true, org_id: true, reporting_manager_user_id: true, delivery_manager_user_id: true } } } });
  if (!e) return null;
  if (!ctx.groupIds.includes(e.deployment.org_group_id)) return false;
  const ok = ctx.isGroupAdmin || ctx.canFinance || e.submitted_by === user.id || e.deployment.reporting_manager_user_id === user.id || e.deployment.delivery_manager_user_id === user.id;
  return ok ? { label: e.bill_name } : false;
}

// ---------------------------------------------------------------------------------------------------------------- onsite logs and reviews
async function saveLog(groupIds, user, id, body) {
  const input = logSchema.parse(body);
  const dep = await load(groupIds, id, { people: true });
  if (!dep) return { error: 'not_found' };
  if (dep.status !== 'active') return { error: 'not_active' };
  const person = dep.people.find((p) => p.user_id === user.id && p.status === 'active');
  if (!person) return { error: 'not_on_deployment' };
  const today = todayIst();
  if (input.log_date > today) return { error: 'future_log' };
  const from = ymd(person.start_date) || ymd(dep.start_date);
  if (input.log_date < from) return { error: 'before_start' };
  const data = { location_mode: input.location_mode, hours: input.hours, activities: input.activities, deliverables: input.deliverables || null, pending_tasks: input.pending_tasks || null, user_id: user.id };
  const row = await prisma.groupDeploymentLog.upsert({
    where: { person_id_log_date: { person_id: person.id, log_date: toDate(input.log_date) } },
    create: { deployment_id: id, person_id: person.id, log_date: toDate(input.log_date), ...data }, update: data,
  });
  return { log: shapeLog(row) };
}
const shapeLog = (l) => ({ id: l.id, deployment_id: l.deployment_id, person_id: l.person_id, log_date: ymd(l.log_date), location_mode: l.location_mode, hours: num(l.hours), activities: l.activities, deliverables: l.deliverables, pending_tasks: l.pending_tasks });

async function logsOf(groupIds, id, query, user, ctx) {
  const dep = await load(groupIds, id, { people: true });
  if (!dep) return { error: 'not_found' };
  const month = /^\d{4}-\d{2}$/.test(String(query?.month || '')) ? query.month : todayIst().slice(0, 7);
  const first = toDate(`${month}-01`);
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const mine = dep.people.find((p) => p.user_id === user?.id);
  const manager = dep.reporting_manager_user_id === user?.id || dep.delivery_manager_user_id === user?.id;
  const onlyMine = !ctx.isGroupAdmin && !manager && !ctx.canFinance;
  if (onlyMine && !mine) return { error: 'forbidden' };
  const rows = await prisma.groupDeploymentLog.findMany({ where: { deployment_id: id, log_date: { gte: first, lte: last }, ...(onlyMine ? { person_id: mine.id } : {}) }, orderBy: [{ log_date: 'desc' }] });
  const people = new Map(dep.people.map((p) => [p.id, p.name]));
  const logs = rows.map((l) => ({ ...shapeLog(l), person_name: people.get(l.person_id) || null }));
  const hours = calc.round2(logs.reduce((a, l) => a + l.hours, 0));
  return { month, logs, summary: { days: logs.length, hours, client_office_days: logs.filter((l) => l.location_mode === 'client_office').length, remote_days: logs.filter((l) => l.location_mode === 'remote').length } };
}

const mondayOf = (s) => { const d = new Date(`${s}T00:00:00Z`); const back = (d.getUTCDay() + 6) % 7; return ymd(new Date(d.getTime() - back * 86400000)); };

async function addReview(groupIds, user, id, body, ctx) {
  const input = reviewSchema.parse(body);
  const dep = await load(groupIds, id, { people: true });
  if (!dep) return { error: 'not_found' };
  const manager = dep.reporting_manager_user_id === user.id || dep.delivery_manager_user_id === user.id;
  if (!ctx.isGroupAdmin && !manager) return { error: 'forbidden' };
  if (input.person_id && !dep.people.some((p) => p.id === input.person_id)) return { error: 'person_not_found' };
  const period = input.kind === 'weekly' ? mondayOf(input.period_start) : `${input.period_start.slice(0, 7)}-01`;
  await prisma.$transaction(async (tx) => {
    await tx.groupDeploymentReview.create({ data: { deployment_id: id, person_id: input.person_id || null, kind: input.kind, period_start: toDate(period), rating: input.rating ?? null, summary: input.summary, client_contact: input.client_contact || null, created_by: user.id, created_by_name: user.name || null } });
    await event(tx, id, input.kind === 'weekly' ? 'weekly_review' : 'client_feedback', user, null, { period });
  });
  return get(groupIds, id);
}

// ---------------------------------------------------------------------------------------------------------------- employee side
/** The deployments the person is on (approved or running), with their own recent logs and expenses. */
async function mine(groupIds, user) {
  const today = todayIst();
  const rows = await prisma.groupDeployment.findMany({
    where: { org_group_id: { in: groupIds }, deleted_at: null, status: { in: ['approved', 'active'] }, people: { some: { user_id: user.id, status: 'active' } } },
    include: { people: true, budget_lines: true, expenses: { where: { deleted_at: null } } },
    orderBy: { start_date: 'asc' },
  });
  const settings = groupIds.length ? await settingsOf(groupIds[0]) : null;
  const out = [];
  for (const d of rows) {
    const person = d.people.find((p) => p.user_id === user.id && p.status === 'active');
    const logs = await prisma.groupDeploymentLog.findMany({ where: { person_id: person.id }, orderBy: { log_date: 'desc' }, take: 14 });
    const arrangement = person.arrangement === 'inherit' ? d.working_arrangement : person.arrangement;
    out.push({
      ...baseOf(d, settings, today), person: { id: person.id, role: person.role, arrangement, start_date: ymd(person.start_date) },
      logs: logs.map(shapeLog), logged_today: logs.some((l) => ymd(l.log_date) === today),
      expenses: d.expenses.filter((e) => e.submitted_by === user.id).map(shapeExpense), can_submit_expense: ['approved', 'active'].includes(d.status),
    });
  }
  return out;
}

/** Deployments of which this person is a manager, so they can review and submit expenses on their behalf. */
async function managed(groupIds, user) {
  const settings = await settingsOf(groupIds[0]);
  const today = todayIst();
  const rows = await prisma.groupDeployment.findMany({
    where: { org_group_id: { in: groupIds }, deleted_at: null, status: { in: OPEN }, OR: [{ reporting_manager_user_id: user.id }, { delivery_manager_user_id: user.id }] },
    include: { people: true }, orderBy: { start_date: 'asc' },
  });
  return rows.map((d) => ({ ...baseOf(d, settings, today), people: d.people.filter((p) => p.status === 'active').map(shapePerson) }));
}

/** Expenses waiting for Finance: submitted, to verify, and verified-but-unsettled / client recoveries. */
async function financeQueue(groupIds) {
  const rows = await prisma.groupDeploymentExpense.findMany({
    where: { deleted_at: null, deployment: { org_group_id: { in: groupIds }, deleted_at: null }, OR: [{ status: 'submitted' }, { status: 'verified' }, { status: 'settled', recovery_status: { in: ['pending', 'partial'] } }] },
    include: { deployment: { select: { id: true, code: true, title: true, client_name: true } } }, orderBy: [{ expense_date: 'asc' }],
  });
  return rows.map((e) => ({ ...shapeExpense(e), deployment: e.deployment }));
}

// ---------------------------------------------------------------------------------------------------------------- dashboard
async function dashboard(groupIds) {
  const settings = await settingsOf(groupIds[0]);
  const today = todayIst();
  const rows = await prisma.groupDeployment.findMany({
    where: { org_group_id: { in: groupIds }, deleted_at: null },
    include: { people: true, budget_lines: true, expenses: { where: { deleted_at: null } }, requests: { where: { status: 'pending' }, select: { id: true } } },
  });
  const orgs = await groupOrgs(groupIds);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const projectIds = [...new Set(rows.map((r) => r.pm_project_id).filter(Boolean))];
  const projects = new Map((projectIds.length ? await prisma.pmProject.findMany({ where: { id: { in: projectIds } }, select: { id: true, code: true, name: true } }) : []).map((p) => [p.id, `${p.code} ${p.name}`]));
  const active = rows.filter((r) => r.status === 'active');
  const withFig = rows.map((r) => ({ r, f: figuresOf(r) }));
  const live = withFig.filter(({ r }) => OPEN.includes(r.status) || r.status === 'closed');
  const sum = (arr, f) => calc.round2(arr.reduce((a, x) => a + f(x), 0));
  const group = (keyOf, label) => {
    const m = new Map();
    for (const { r, f } of live) {
      const k = keyOf(r);
      const e = m.get(k) || { key: k, label: label(r), deployments: 0, active: 0, people: 0, estimated: 0, actual: 0 };
      e.deployments += 1;
      if (r.status === 'active') e.active += 1;
      e.people += r.people.filter((p) => p.status === 'active').length;
      e.estimated = calc.round2(e.estimated + f.est.total);
      e.actual = calc.round2(e.actual + f.act.total);
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.actual - a.actual || b.people - a.people);
  };
  const monthly = new Map();
  for (const { f } of live) for (const m of f.act.months) { const e = monthly.get(m.month) || { month: m.month, budget: 0, actual: 0 }; e.budget = calc.round2(e.budget + m.budget); e.actual = calc.round2(e.actual + m.actual); monthly.set(m.month, e); }
  const events = await prisma.groupDeploymentEvent.findMany({ where: { deployment: { org_group_id: { in: groupIds }, deleted_at: null } }, orderBy: { created_at: 'desc' }, take: 15, include: { deployment: { select: { id: true, code: true, title: true } } } });
  const pendingVerify = await prisma.groupDeploymentExpense.count({ where: { status: 'submitted', deleted_at: null, deployment: { org_group_id: { in: groupIds }, deleted_at: null } } });
  const recoveries = withFig.filter(({ f }) => f.act.pending_recovery > 0).map(({ r, f }) => ({ id: r.id, code: r.code, title: r.title, client_name: r.client_name, owed: f.act.pending_recovery })).sort((a, b) => b.owed - a.owed);
  const activeFig = withFig.filter(({ r }) => r.status === 'active');
  return {
    today, ending_soon_days: settings.ending_soon_days,
    summary: {
      active: active.length,
      draft_or_pending: rows.filter((r) => ['draft', 'pending_approval', 'approved'].includes(r.status)).length,
      deployed_people: active.reduce((a, r) => a + r.people.filter((p) => p.status === 'active').length, 0),
      ending_soon: active.filter((r) => Math.round((new Date(`${ymd(r.expected_end_date)}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000) <= settings.ending_soon_days).length,
      estimated_total: sum(live, ({ f }) => f.est.total), actual_total: sum(live, ({ f }) => f.act.total),
      active_estimated: sum(activeFig, ({ f }) => f.est.total), active_actual: sum(activeFig, ({ f }) => f.act.total),
      billable_actual: sum(live, ({ f }) => f.act.billable), non_billable_actual: sum(live, ({ f }) => f.act.non_billable),
      client_funded_actual: sum(live, ({ f }) => f.act.client_borne), company_funded_actual: sum(live, ({ f }) => f.act.company_borne),
      pending_recovery: sum(live, ({ f }) => f.act.pending_recovery), recovered: sum(live, ({ f }) => f.act.recovered),
      pending_approvals: rows.reduce((a, r) => a + r.requests.length, 0), expenses_to_verify: pendingVerify,
    },
    by_client: group((r) => (r.client_name || '').toLowerCase(), (r) => r.client_name),
    by_project: group((r) => r.pm_project_id || 'none', (r) => (r.pm_project_id ? projects.get(r.pm_project_id) || 'Project' : 'No project')),
    by_company: group((r) => r.org_id || 'group', (r) => (r.org_id ? orgName.get(r.org_id) || 'Company' : 'Whole group')),
    upcoming_ends: active.map((r) => ({ id: r.id, code: r.code, title: r.title, client_name: r.client_name, expected_end_date: ymd(r.expected_end_date), days_left: Math.round((new Date(`${ymd(r.expected_end_date)}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000), people: r.people.filter((p) => p.status === 'active').length }))
      .sort((a, b) => a.days_left - b.days_left).slice(0, 10),
    monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)),
    recoveries, history: events.map((e) => ({ id: e.id, kind: e.kind, reason: e.reason, by_name: e.by_name, created_at: e.created_at, deployment: e.deployment })),
  };
}

/** Pick-lists for the form: companies, people of every company, active clients, projects and the possible managers. */
async function options(groupIds) {
  const orgs = await groupOrgs(groupIds);
  const orgIds = orgs.map((o) => o.id);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const [members, accounts, projects] = await Promise.all([
    prisma.orgMembership.findMany({ where: { org_id: { in: orgIds }, left_at: null, employment_status: { not: 'terminated' } }, select: { org_id: true, person: { select: { id: true, name: true, active: true } } } }),
    prisma.account.findMany({ where: { org_id: { in: orgIds }, type: 'client', stage: 'active', is_project: false, deleted_at: null }, select: { id: true, name: true, org_id: true }, orderBy: { name: 'asc' } }),
    prisma.pmProject.findMany({ where: { org_id: { in: orgIds } }, select: { id: true, code: true, name: true, org_id: true }, orderBy: { name: 'asc' }, take: 500 }).catch(() => []),
  ]);
  const seen = new Set();
  const people = [];
  for (const m of members) {
    if (!m.person || m.person.active === false || seen.has(`${m.person.id}:${m.org_id}`)) continue;
    seen.add(`${m.person.id}:${m.org_id}`);
    people.push({ user_id: m.person.id, name: m.person.name, org_id: m.org_id, org_name: orgName.get(m.org_id) });
  }
  people.sort((a, b) => a.name.localeCompare(b.name));
  return {
    companies: orgs, people, clients: accounts.map((a) => ({ id: a.id, name: a.name, org_id: a.org_id, org_name: orgName.get(a.org_id) || null })),
    projects: projects.map((p) => ({ id: p.id, code: p.code, name: p.name, org_id: p.org_id, org_name: orgName.get(p.org_id) || null })),
    settings: await settingsOf(groupIds[0]),
  };
}

module.exports = {
  ctxOf, KINDS, ARRANGEMENTS, ROLES, settingsOf, updateSettings, options, listFor, get, create, update, remove, submit, start, close, cancel, extend, changeAllocation, updatePerson,
  setBudget, addTravel, updateTravel, deleteTravel, submitExpense, verifyExpense, settleExpense, recoverExpense, canReadBill, saveLog, logsOf, addReview,
  decide, pendingFor, mine, managed, financeQueue, dashboard,
};
