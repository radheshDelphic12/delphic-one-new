const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const prisma = require('../../config/db');
const env = require('../../config/env');
const { projectListWhere } = require('../../lib/projectScope');
const { contractState } = require('../../lib/contractState');

// Project Management (Delphic Global): projects with their own tickets. Projects and tickets work on their own; a project can be
// linked to real contracts later (and unlinked) without touching its tickets. See docs/features/PROJECT-MANAGEMENT.md.

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const toDate = (v) => (v ? new Date(`${v}T00:00:00.000Z`) : null);
const dayOf = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const uuid = z.string().uuid();

const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];
const TICKET_TYPES = ['task', 'bug', 'change', 'support'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const CATEGORIES = ['todo', 'in_progress', 'blocked', 'done'];

// The starting set of ticket statuses; admins add, rename, reorder or switch them off (pm_statuses).
const DEFAULT_STATUSES = [
  { key: 'open', label: 'Open', category: 'todo' },
  { key: 'in_progress', label: 'In progress', category: 'in_progress' },
  { key: 'blocked', label: 'Blocked', category: 'blocked' },
  { key: 'resolved', label: 'Resolved', category: 'done' },
  { key: 'closed', label: 'Closed', category: 'done' },
];

const projectCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9-]+$/, 'Letters, digits and dashes only').optional(),
  description: z.string().trim().max(5000).nullish(),
  status: z.enum(PROJECT_STATUSES).optional(),
  owner_membership_id: uuid.nullish(),
  start_date: day.nullish(),
  end_date: day.nullish(),
  member_ids: z.array(uuid).max(200).optional(),
});
const projectUpdateSchema = projectCreateSchema.omit({ member_ids: true }).partial();

const customValues = z.record(z.string().max(60), z.union([z.string().max(2000), z.number(), z.null()]));
const FIELD_TYPES = ['text', 'number', 'date', 'select'];
const fieldCreateSchema = z.object({
  label: z.string().trim().min(1).max(60),
  key: z.string().trim().min(2).max(40).regex(/^[a-z0-9_]+$/, 'Lowercase letters, digits and underscores only').optional(),
  type: z.enum(FIELD_TYPES),
  options: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
  required: z.boolean().optional(),
  position: z.number().int().min(0).max(999).optional(),
});
const fieldUpdateSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
  required: z.boolean().optional(),
  position: z.number().int().min(0).max(999).optional(),
  is_active: z.boolean().optional(),
});
const shareSchema = z.object({
  email: z.string().trim().email(),
  label: z.string().trim().min(1).max(80),
  expires_at: z.coerce.date(),
  can_comment: z.boolean().optional(),
});

const ticketCreateSchema = z.object({
  title: z.string().trim().min(2).max(240),
  description: z.string().trim().max(10000).nullish(),
  type: z.enum(TICKET_TYPES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  status_key: z.string().trim().max(60).optional(),
  assignee_membership_id: uuid.nullish(),
  contract_id: uuid.nullish(),
  due_date: day.nullish(),
  custom_values: customValues.optional(),
  internal_only: z.boolean().optional(),
});
const ticketUpdateSchema = ticketCreateSchema.partial().extend({ resolution: z.string().trim().max(5000).nullish() });
const ticketListQuerySchema = z.object({
  status_key: z.string().optional(),
  category: z.enum(CATEGORIES).optional(),
  assignee_membership_id: uuid.optional(),
  priority: z.enum(PRIORITIES).optional(),
  type: z.enum(TICKET_TYPES).optional(),
  contract_id: uuid.optional(),
  overdue: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(120).optional(),
});
const statusSchema = z.object({
  key: z.string().trim().min(2).max(40).regex(/^[a-z0-9_]+$/, 'Lowercase letters, digits and underscores only'),
  label: z.string().trim().min(1).max(60),
  category: z.enum(CATEGORIES),
  position: z.number().int().min(0).max(999).optional(),
  is_active: z.boolean().optional(),
});
const statusUpdateSchema = statusSchema.omit({ key: true }).partial();

const num = (v) => Number(v || 0);

// ---- statuses (admin-editable data)

async function ensureStatuses(orgId) {
  const count = await prisma.pmStatus.count({ where: { org_id: orgId } });
  if (count > 0) return;
  await prisma.pmStatus.createMany({ data: DEFAULT_STATUSES.map((s, i) => ({ org_id: orgId, ...s, position: i })), skipDuplicates: true });
}

async function listStatuses(orgId, { includeInactive = false } = {}) {
  await ensureStatuses(orgId);
  return prisma.pmStatus.findMany({ where: { org_id: orgId, ...(includeInactive ? {} : { is_active: true }) }, orderBy: [{ position: 'asc' }, { created_at: 'asc' }] });
}

async function createStatus(orgId, input) {
  await ensureStatuses(orgId);
  if (await prisma.pmStatus.findUnique({ where: { org_id_key: { org_id: orgId, key: input.key } } })) return { error: 'duplicate_status' };
  const last = await prisma.pmStatus.aggregate({ where: { org_id: orgId }, _max: { position: true } });
  return { status: await prisma.pmStatus.create({ data: { org_id: orgId, ...input, position: input.position ?? (last._max.position ?? 0) + 1 } }) };
}

async function updateStatus(orgId, id, input) {
  const before = await prisma.pmStatus.findFirst({ where: { id, org_id: orgId } });
  if (!before) return { error: 'not_found' };
  // The category is what progress counts: keep at least one active status of every category the open tickets rely on.
  if ((input.is_active === false && before.is_active) || (input.category && input.category !== before.category)) {
    const stillThere = await prisma.pmStatus.count({ where: { org_id: orgId, category: before.category, is_active: true, id: { not: id } } });
    const used = await prisma.pmTicket.count({ where: { org_id: orgId, status_key: before.key } });
    if (used > 0 && !stillThere && before.category === 'done') return { error: 'last_done_status' };
  }
  return { status: await prisma.pmStatus.update({ where: { id }, data: input }) };
}

// ---- custom fields (per project)

async function listFields(projectId, { includeInactive = false } = {}) {
  return prisma.pmCustomField.findMany({ where: { project_id: projectId, ...(includeInactive ? {} : { is_active: true }) }, orderBy: [{ position: 'asc' }, { created_at: 'asc' }] });
}

// Turns what the form sent into the stored values, or says what is wrong. Blank / null clears a value.
function checkCustom(fields, incoming, { creating = false, existing = {} } = {}) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out = { ...existing };
  for (const [key, raw] of Object.entries(incoming || {})) {
    const f = byKey.get(key);
    if (!f || !f.is_active) return { error: 'unknown_field' };
    if (raw === null || raw === '') { delete out[key]; continue; }
    if (f.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) return { error: 'bad_field_value' };
      out[key] = n;
    } else if (f.type === 'date') {
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: 'bad_field_value' };
      out[key] = raw;
    } else if (f.type === 'select') {
      if (!(f.options || []).includes(String(raw))) return { error: 'bad_field_value' };
      out[key] = String(raw);
    } else {
      out[key] = String(raw).trim().slice(0, 2000);
    }
  }
  for (const f of fields) {
    if (!f.required || !f.is_active) continue;
    const touched = creating || Object.prototype.hasOwnProperty.call(incoming || {}, f.key);
    if (touched && (out[f.key] === undefined || out[f.key] === '')) return { error: 'field_required', label: f.label };
  }
  return { values: out };
}

async function createField(orgId, projectId, actor, input) {
  const p = await loadProject(orgId, projectId, actor);
  if (!p) return { error: 'not_found' };
  if (!(await canManageProject(actor, p))) return { error: 'forbidden' };
  if (input.type === 'select' && !(input.options || []).length) return { error: 'options_required' };
  const key = input.key || input.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  if (key.length < 2) return { error: 'bad_field_key' };
  if (await prisma.pmCustomField.findUnique({ where: { project_id_key: { project_id: projectId, key } } })) return { error: 'duplicate_field' };
  const last = await prisma.pmCustomField.aggregate({ where: { project_id: projectId }, _max: { position: true } });
  const field = await prisma.pmCustomField.create({ data: { org_id: orgId, project_id: projectId, key, label: input.label, type: input.type, options: input.type === 'select' ? input.options : [], required: Boolean(input.required), position: input.position ?? (last._max.position ?? -1) + 1 } });
  await logActivity(prisma, orgId, projectId, null, actor.userId, 'field_added', null, field.label);
  return { field };
}

async function updateField(orgId, projectId, fieldId, actor, input) {
  const p = await loadProject(orgId, projectId, actor);
  if (!p) return { error: 'not_found' };
  if (!(await canManageProject(actor, p))) return { error: 'forbidden' };
  const before = await prisma.pmCustomField.findFirst({ where: { id: fieldId, project_id: projectId } });
  if (!before) return { error: 'not_found' };
  if (input.options && before.type !== 'select') return { error: 'options_not_allowed' };
  const field = await prisma.pmCustomField.update({ where: { id: fieldId }, data: input });
  await logActivity(prisma, orgId, projectId, null, actor.userId, input.is_active === false ? 'field_switched_off' : 'field_changed', before.label, field.label);
  return { field };
}

// ---- access helpers (the route passes `actor`: { userId, membershipId, isManager })

async function myProjectIds(orgId, membershipId) {
  const rows = await prisma.pmProject.findMany({
    where: { org_id: orgId, OR: [{ owner_membership_id: membershipId }, { members: { some: { membership_id: membershipId } } }] },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function canSeeProject(orgId, actor, project) {
  if (actor.isManager) return true;
  if (project.owner_membership_id === actor.membershipId) return true;
  return Boolean(await prisma.pmProjectMember.findFirst({ where: { project_id: project.id, membership_id: actor.membershipId }, select: { id: true } }));
}

async function canManageProject(actor, project) {
  if (actor.isManager) return true;
  if (project.owner_membership_id === actor.membershipId) return true;
  return Boolean(await prisma.pmProjectMember.findFirst({ where: { project_id: project.id, membership_id: actor.membershipId, role: 'lead' }, select: { id: true } }));
}

async function loadProject(orgId, id, actor) {
  const project = await prisma.pmProject.findFirst({ where: { id, org_id: orgId } });
  if (!project || !(await canSeeProject(orgId, actor, project))) return null;
  return project;
}

async function membershipOk(orgId, membershipId) {
  const m = await prisma.orgMembership.findFirst({ where: { id: membershipId, org_id: orgId, left_at: null, employment_status: { not: 'terminated' } }, select: { id: true } });
  return Boolean(m);
}

async function logActivity(db, orgId, projectId, ticketId, actorUserId, action, from, to, note) {
  await db.pmActivity.create({ data: { org_id: orgId, project_id: projectId, ticket_id: ticketId || null, actor_user_id: actorUserId, action, from_value: from ?? null, to_value: to ?? null, note: note ?? null } });
}

// ---- notifications (never block the change they report on: notify() swallows its own errors)

async function userIdsOf(membershipIds) {
  const ids = [...new Set(membershipIds.filter(Boolean))];
  if (!ids.length) return [];
  const rows = await prisma.orgMembership.findMany({ where: { id: { in: ids } }, select: { person_id: true } });
  return rows.map((r) => r.person_id);
}

async function tell(type, ticket, project, actor, membershipIds, extra = {}) {
  const { notify } = require('../../lib/notifications');
  const recipientIds = await userIdsOf(membershipIds);
  if (!recipientIds.length) return;
  await notify(prisma, {
    type, actorId: actor?.userId || null, recipientIds,
    context: { skipAdmins: true, actorName: actor?.name, orgId: ticket.org_id, ticketNumber: ticket.number, ticketTitle: ticket.title, projectCode: project.code, projectName: project.name, metadata: { project_id: project.id }, ticketId: ticket.id, ...extra },
  });
}

// ---- names

async function nameMap(orgId, membershipIds) {
  const ids = [...new Set(membershipIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await prisma.orgMembership.findMany({ where: { id: { in: ids }, org_id: orgId }, select: { id: true, person: { select: { name: true } } } });
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.person?.name || 'Unknown' }]));
}

// ---- progress

function summarize(tickets, categoryOf, today = new Date()) {
  const t0 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  let done = 0; let blocked = 0; let overdue = 0; let inProgress = 0;
  for (const t of tickets) {
    const c = categoryOf(t.status_key);
    if (c === 'done') done += 1;
    else {
      if (c === 'blocked') blocked += 1;
      if (c === 'in_progress') inProgress += 1;
      if (t.due_date && new Date(t.due_date) < t0) overdue += 1;
    }
  }
  const total = tickets.length;
  return { total, done, open: total - done, in_progress: inProgress, blocked, overdue, percent: total ? Math.round((done / total) * 100) : 0 };
}

async function categoryResolver(orgId) {
  const statuses = await listStatuses(orgId, { includeInactive: true });
  const map = new Map(statuses.map((s) => [s.key, s.category]));
  return (key) => map.get(key) || 'todo';
}

async function listPeople(orgId) {
  const rows = await prisma.orgMembership.findMany({
    where: { org_id: orgId, left_at: null, employment_status: { not: 'terminated' } },
    select: { id: true, person: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, name: r.person?.name || 'Unknown' })).sort((a, b) => a.name.localeCompare(b.name));
}

// ---- projects

async function nextCode(orgId) {
  const n = await prisma.pmProject.count({ where: { org_id: orgId } });
  for (let i = n + 1; i < n + 50; i += 1) {
    const code = `PRJ-${String(i).padStart(3, '0')}`;
    if (!(await prisma.pmProject.findUnique({ where: { org_id_code: { org_id: orgId, code } }, select: { id: true } }))) return code;
  }
  return `PRJ-${Date.now()}`;
}

async function createProject(orgId, actor, input) {
  if (input.owner_membership_id && !(await membershipOk(orgId, input.owner_membership_id))) return { error: 'person_not_found' };
  const memberIds = [...new Set([...(input.member_ids || []), ...(input.owner_membership_id ? [input.owner_membership_id] : [])])];
  for (const id of memberIds) if (!(await membershipOk(orgId, id))) return { error: 'person_not_found' };
  const code = (input.code || '').toUpperCase() || (await nextCode(orgId));
  if (await prisma.pmProject.findUnique({ where: { org_id_code: { org_id: orgId, code } }, select: { id: true } })) return { error: 'duplicate_code' };
  const project = await prisma.$transaction(async (tx) => {
    const p = await tx.pmProject.create({
      data: {
        org_id: orgId, code, name: input.name, description: input.description || null, status: input.status || 'planning',
        owner_membership_id: input.owner_membership_id || null, start_date: toDate(input.start_date), end_date: toDate(input.end_date), created_by: actor.userId,
      },
    });
    if (memberIds.length) {
      await tx.pmProjectMember.createMany({ data: memberIds.map((m) => ({ org_id: orgId, project_id: p.id, membership_id: m, role: m === input.owner_membership_id ? 'lead' : 'member' })) });
    }
    await logActivity(tx, orgId, p.id, null, actor.userId, 'project_created', null, p.name);
    return p;
  });
  return { project: await getProject(orgId, project.id, actor) };
}

async function updateProject(orgId, id, actor, input) {
  const before = await loadProject(orgId, id, actor);
  if (!before) return { error: 'not_found' };
  if (!(await canManageProject(actor, before))) return { error: 'forbidden' };
  if (input.owner_membership_id && !(await membershipOk(orgId, input.owner_membership_id))) return { error: 'person_not_found' };
  if (input.code && input.code.toUpperCase() !== before.code) {
    const dup = await prisma.pmProject.findUnique({ where: { org_id_code: { org_id: orgId, code: input.code.toUpperCase() } }, select: { id: true } });
    if (dup) return { error: 'duplicate_code' };
  }
  const { start_date: sd, end_date: ed, code, ...rest } = input;
  const data = { ...rest, ...(code ? { code: code.toUpperCase() } : {}), ...(sd !== undefined ? { start_date: toDate(sd) } : {}), ...(ed !== undefined ? { end_date: toDate(ed) } : {}) };
  await prisma.$transaction(async (tx) => {
    await tx.pmProject.update({ where: { id }, data });
    if (input.owner_membership_id && input.owner_membership_id !== before.owner_membership_id) {
      await tx.pmProjectMember.upsert({
        where: { project_id_membership_id: { project_id: id, membership_id: input.owner_membership_id } },
        create: { org_id: orgId, project_id: id, membership_id: input.owner_membership_id, role: 'lead' }, update: { role: 'lead' },
      });
    }
    for (const k of ['name', 'status', 'owner_membership_id', 'description']) {
      if (input[k] !== undefined && String(input[k] ?? '') !== String(before[k] ?? '')) await logActivity(tx, orgId, id, null, actor.userId, `project_${k}_changed`, before[k], input[k]);
    }
  });
  return { project: await getProject(orgId, id, actor) };
}

async function projectRow(orgId, p, summaryByProject, names, contractCounts) {
  return {
    id: p.id, code: p.code, name: p.name, description: p.description, status: p.status,
    owner: names.get(p.owner_membership_id) || null,
    start_date: dayOf(p.start_date), end_date: dayOf(p.end_date),
    progress: summaryByProject.get(p.id) || summarize([], () => 'todo'),
    contracts_linked: contractCounts.get(p.id) || 0,
    created_at: p.created_at,
  };
}

async function listProjects(orgId, actor, { status, q, linked, mine } = {}) {
  const where = { org_id: orgId, ...(status ? { status } : {}), ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] } : {}) };
  if (!actor.isManager || mine === 'true') where.id = { in: await myProjectIds(orgId, actor.membershipId) };
  if (linked === 'true') where.contracts = { some: {} };
  if (linked === 'false') where.contracts = { none: {} };
  const projects = await prisma.pmProject.findMany({ where, orderBy: [{ status: 'asc' }, { created_at: 'desc' }] });
  const ids = projects.map((p) => p.id);
  const [tickets, links, names, cat] = await Promise.all([
    prisma.pmTicket.findMany({ where: { project_id: { in: ids } }, select: { project_id: true, status_key: true, due_date: true } }),
    prisma.pmProjectContract.groupBy({ by: ['project_id'], where: { project_id: { in: ids } }, _count: { _all: true } }),
    nameMap(orgId, projects.map((p) => p.owner_membership_id)),
    categoryResolver(orgId),
  ]);
  const byProject = new Map();
  for (const t of tickets) byProject.set(t.project_id, [...(byProject.get(t.project_id) || []), t]);
  const summaries = new Map([...byProject].map(([k, v]) => [k, summarize(v, cat)]));
  const counts = new Map(links.map((l) => [l.project_id, l._count._all]));
  return Promise.all(projects.map((p) => projectRow(orgId, p, summaries, names, counts)));
}

async function getProject(orgId, id, actor) {
  const p = await loadProject(orgId, id, actor);
  if (!p) return null;
  const [tickets, members, links, cat, activity, fields] = await Promise.all([
    prisma.pmTicket.findMany({ where: { project_id: id }, select: { id: true, status_key: true, due_date: true, contract_id: true } }),
    prisma.pmProjectMember.findMany({ where: { project_id: id }, orderBy: { created_at: 'asc' } }),
    prisma.pmProjectContract.findMany({ where: { project_id: id }, orderBy: { linked_at: 'asc' } }),
    categoryResolver(orgId),
    prisma.pmActivity.findMany({ where: { project_id: id, ticket_id: null }, orderBy: { created_at: 'desc' }, take: 30 }),
    listFields(id, { includeInactive: true }),
  ]);
  const names = await nameMap(orgId, [p.owner_membership_id, ...members.map((m) => m.membership_id)]);
  const contracts = await contractProgress(orgId, p, links, tickets, cat);
  return {
    id: p.id, code: p.code, name: p.name, description: p.description, status: p.status, owner: names.get(p.owner_membership_id) || null,
    start_date: dayOf(p.start_date), end_date: dayOf(p.end_date), created_at: p.created_at,
    can_manage: await canManageProject(actor, p),
    me: actor.membershipId,
    progress: summarize(tickets, cat),
    members: members.map((m) => ({ id: m.id, membership_id: m.membership_id, role: m.role, name: names.get(m.membership_id)?.name || 'Unknown' })),
    contracts,
    activity,
    fields,
  };
}

async function deleteProject(orgId, id, actor) {
  const p = await loadProject(orgId, id, actor);
  if (!p) return { error: 'not_found' };
  if (!actor.isManager) return { error: 'forbidden' };
  await prisma.pmProject.delete({ where: { id } }); // tickets, comments, members, contract links and activity go with it (cascade)
  return { ok: true };
}

// ---- members

async function setMembers(orgId, id, actor, { add = [], remove = [], leads = [] }) {
  const p = await loadProject(orgId, id, actor);
  if (!p) return { error: 'not_found' };
  if (!(await canManageProject(actor, p))) return { error: 'forbidden' };
  for (const m of add) if (!(await membershipOk(orgId, m))) return { error: 'person_not_found' };
  await prisma.$transaction(async (tx) => {
    for (const m of add) {
      await tx.pmProjectMember.upsert({ where: { project_id_membership_id: { project_id: id, membership_id: m } }, create: { org_id: orgId, project_id: id, membership_id: m, role: leads.includes(m) ? 'lead' : 'member' }, update: { role: leads.includes(m) ? 'lead' : undefined } });
      await logActivity(tx, orgId, id, null, actor.userId, 'member_added', null, m);
    }
    const removable = remove.filter((m) => m !== p.owner_membership_id);
    if (removable.length) {
      await tx.pmProjectMember.deleteMany({ where: { project_id: id, membership_id: { in: removable } } });
      for (const m of removable) await logActivity(tx, orgId, id, null, actor.userId, 'member_removed', m, null);
    }
  });
  return { project: await getProject(orgId, id, actor) };
}

// ---- tickets

async function assigneeOk(orgId, project, membershipId) {
  if (!membershipId) return true;
  if (!(await membershipOk(orgId, membershipId))) return false;
  if (membershipId === project.owner_membership_id) return true;
  return Boolean(await prisma.pmProjectMember.findFirst({ where: { project_id: project.id, membership_id: membershipId }, select: { id: true } }));
}

async function contractOk(orgId, projectId, contractId) {
  if (!contractId) return true;
  return Boolean(await prisma.pmProjectContract.findFirst({ where: { org_id: orgId, project_id: projectId, contract_id: contractId }, select: { id: true } }));
}

async function statusRow(orgId, key) {
  const statuses = await listStatuses(orgId, { includeInactive: true });
  return statuses.find((s) => s.key === key) || null;
}

async function shapeTickets(orgId, rows, cat) {
  const names = await nameMap(orgId, rows.flatMap((t) => [t.assignee_membership_id, t.reporter_membership_id]));
  const statuses = await listStatuses(orgId, { includeInactive: true });
  const label = new Map(statuses.map((s) => [s.key, s.label]));
  const t0 = new Date(); t0.setUTCHours(0, 0, 0, 0);
  return rows.map((t) => {
    const category = cat(t.status_key);
    return {
      id: t.id, project_id: t.project_id, number: t.number, title: t.title, description: t.description, type: t.type, priority: t.priority,
      status_key: t.status_key, status_label: label.get(t.status_key) || t.status_key, category,
      assignee: names.get(t.assignee_membership_id) || null, reporter: names.get(t.reporter_membership_id) || null,
      contract_id: t.contract_id, due_date: dayOf(t.due_date), overdue: category !== 'done' && Boolean(t.due_date) && new Date(t.due_date) < t0,
      resolution: t.resolution, resolved_at: t.resolved_at, created_at: t.created_at, updated_at: t.updated_at,
      custom_values: t.custom_values || {}, internal_only: t.internal_only,
    };
  });
}

async function listTickets(orgId, projectId, actor, query = {}) {
  const p = await loadProject(orgId, projectId, actor);
  if (!p) return { error: 'not_found' };
  const cat = await categoryResolver(orgId);
  const where = { org_id: orgId, project_id: projectId };
  if (query.status_key) where.status_key = query.status_key;
  if (query.category) {
    const keys = (await listStatuses(orgId, { includeInactive: true })).filter((s) => s.category === query.category).map((s) => s.key);
    where.status_key = { in: keys };
  }
  if (query.assignee_membership_id) where.assignee_membership_id = query.assignee_membership_id;
  if (query.priority) where.priority = query.priority;
  if (query.type) where.type = query.type;
  if (query.contract_id) where.contract_id = query.contract_id;
  if (query.q) where.OR = [{ title: { contains: query.q, mode: 'insensitive' } }, { description: { contains: query.q, mode: 'insensitive' } }];
  let rows = await prisma.pmTicket.findMany({ where, orderBy: [{ number: 'desc' }] });
  let tickets = await shapeTickets(orgId, rows, cat);
  if (query.overdue === 'true') tickets = tickets.filter((t) => t.overdue);
  return { tickets };
}

async function createTicket(orgId, projectId, actor, input) {
  const p = await loadProject(orgId, projectId, actor);
  if (!p) return { error: 'not_found' };
  if (!(await assigneeOk(orgId, p, input.assignee_membership_id))) return { error: 'assignee_not_in_project' };
  if (!(await contractOk(orgId, projectId, input.contract_id))) return { error: 'contract_not_linked' };
  const statusKey = input.status_key || 'open';
  const status = await statusRow(orgId, statusKey);
  if (!status || !status.is_active) return { error: 'status_not_found' };
  if (status.category === 'done') return { error: 'resolution_required' };
  const custom = checkCustom(await listFields(projectId, { includeInactive: true }), input.custom_values, { creating: true });
  if (custom.error) return custom;
  const ticket = await prisma.$transaction(async (tx) => {
    const bumped = await tx.pmProject.update({ where: { id: projectId }, data: { ticket_seq: { increment: 1 } }, select: { ticket_seq: true } });
    const t = await tx.pmTicket.create({
      data: {
        org_id: orgId, project_id: projectId, number: bumped.ticket_seq, title: input.title, description: input.description || null, type: input.type || 'task',
        priority: input.priority || 'medium', status_key: statusKey, assignee_membership_id: input.assignee_membership_id || null, reporter_membership_id: actor.membershipId || null,
        contract_id: input.contract_id || null, due_date: toDate(input.due_date), created_by: actor.userId,
        custom_values: custom.values, internal_only: Boolean(input.internal_only),
      },
    });
    await logActivity(tx, orgId, projectId, t.id, actor.userId, 'ticket_created', null, t.title);
    return t;
  });
  const cat = await categoryResolver(orgId);
  if (ticket.assignee_membership_id) await tell('pm_ticket_assigned', ticket, p, actor, [ticket.assignee_membership_id]);
  return { ticket: (await shapeTickets(orgId, [ticket], cat))[0] };
}

async function loadTicket(orgId, ticketId, actor) {
  const t = await prisma.pmTicket.findFirst({ where: { id: ticketId, org_id: orgId } });
  if (!t) return {};
  const project = await loadProject(orgId, t.project_id, actor);
  return project ? { ticket: t, project } : {};
}

async function getTicket(orgId, ticketId, actor) {
  const { ticket, project } = await loadTicket(orgId, ticketId, actor);
  if (!ticket) return null;
  const cat = await categoryResolver(orgId);
  const [comments, activity, attachments] = await Promise.all([
    prisma.pmTicketComment.findMany({ where: { ticket_id: ticketId }, orderBy: { created_at: 'asc' } }),
    prisma.pmActivity.findMany({ where: { ticket_id: ticketId }, orderBy: { created_at: 'desc' }, take: 100 }),
    prisma.pmTicketAttachment.findMany({ where: { ticket_id: ticketId }, orderBy: { created_at: 'asc' } }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set([...comments.map((c) => c.author_user_id).filter(Boolean), ...activity.map((a) => a.actor_user_id), ...attachments.map((a) => a.uploaded_by)])] } }, select: { id: true, name: true } });
  const who = new Map(users.map((u) => [u.id, u.name]));
  return {
    ...(await shapeTickets(orgId, [ticket], cat))[0],
    project: { id: project.id, code: project.code, name: project.name },
    attachments: attachments.map((a) => ({ id: a.id, filename: a.filename, mime_type: a.mime_type, size_bytes: a.size_bytes, uploaded_by: who.get(a.uploaded_by) || 'Unknown', can_delete: actor.isManager || a.uploaded_by === actor.userId, created_at: a.created_at })),
    comments: comments.map((c) => ({ id: c.id, body: c.body, author: c.external_label ? `${c.external_label} (shared access)` : who.get(c.author_user_id) || 'Unknown', is_public: c.is_public, external: Boolean(c.external_label), created_at: c.created_at })),
    activity: activity.map((a) => ({ id: a.id, action: a.action, from_value: a.from_value, to_value: a.to_value, note: a.note, actor: who.get(a.actor_user_id) || 'Unknown', created_at: a.created_at })),
  };
}

// A manager or project lead edits everything; a plain member edits tickets assigned to or reported by them.
async function updateTicket(orgId, ticketId, actor, input) {
  const { ticket: before, project } = await loadTicket(orgId, ticketId, actor);
  if (!before) return { error: 'not_found' };
  const manager = await canManageProject(actor, project);
  if (!manager && before.assignee_membership_id !== actor.membershipId && before.reporter_membership_id !== actor.membershipId) return { error: 'forbidden' };
  if (input.assignee_membership_id !== undefined && !(await assigneeOk(orgId, project, input.assignee_membership_id))) return { error: 'assignee_not_in_project' };
  if (input.contract_id !== undefined && !(await contractOk(orgId, project.id, input.contract_id))) return { error: 'contract_not_linked' };

  const data = {};
  const changes = [];
  for (const k of ['title', 'description', 'type', 'priority', 'assignee_membership_id', 'contract_id']) {
    if (input[k] !== undefined && String(input[k] ?? '') !== String(before[k] ?? '')) { data[k] = input[k] === '' ? null : input[k]; changes.push([k, before[k], input[k]]); }
  }
  if (input.due_date !== undefined && (input.due_date || null) !== dayOf(before.due_date)) { data.due_date = toDate(input.due_date); changes.push(['due_date', dayOf(before.due_date), input.due_date]); }

  if (input.internal_only !== undefined && input.internal_only !== before.internal_only) { data.internal_only = input.internal_only; changes.push(['internal_only', String(before.internal_only), String(input.internal_only)]); }
  if (input.custom_values) {
    const custom = checkCustom(await listFields(project.id, { includeInactive: true }), input.custom_values, { existing: before.custom_values || {} });
    if (custom.error) return custom;
    if (JSON.stringify(custom.values) !== JSON.stringify(before.custom_values || {})) {
      data.custom_values = custom.values;
      for (const k of Object.keys(input.custom_values)) changes.push([`field_${k}`, (before.custom_values || {})[k] ?? null, custom.values[k] ?? null]);
    }
  }

  const cat = await categoryResolver(orgId);
  const newKey = input.status_key || before.status_key;
  if (input.status_key && input.status_key !== before.status_key) {
    const status = await statusRow(orgId, input.status_key);
    if (!status || (!status.is_active && !actor.isManager)) return { error: 'status_not_found' };
    data.status_key = input.status_key;
    changes.push(['status', before.status_key, input.status_key]);
  }
  const wasDone = cat(before.status_key) === 'done';
  const isDone = cat(newKey) === 'done';
  const resolution = input.resolution !== undefined ? (input.resolution || null) : before.resolution;
  if (input.resolution !== undefined && (input.resolution || null) !== (before.resolution || null)) { data.resolution = input.resolution || null; changes.push(['resolution', before.resolution, input.resolution]); }
  if (isDone && !wasDone) {
    if (!resolution) return { error: 'resolution_required' }; // a ticket is only done with a recorded resolution
    data.resolved_at = new Date();
  } else if (!isDone && wasDone) {
    data.resolved_at = null; // reopened
  }
  if (!changes.length && !('resolved_at' in data)) return { ticket: await getTicket(orgId, ticketId, actor) };

  await prisma.$transaction(async (tx) => {
    await tx.pmTicket.update({ where: { id: ticketId }, data });
    const who = await nameMap(orgId, changes.filter(([k]) => k === 'assignee_membership_id').flatMap(([, from, to]) => [from, to]));
    const show = (k, v) => (v == null || v === '' ? null : k === 'assignee_membership_id' ? who.get(v)?.name || String(v) : String(v));
    for (const [k, from, to] of changes) await logActivity(tx, orgId, project.id, ticketId, actor.userId, `${k}_changed`, show(k, from), show(k, to));
  });
  const after = { ...before, ...data };
  if (data.assignee_membership_id && data.assignee_membership_id !== before.assignee_membership_id) await tell('pm_ticket_assigned', after, project, actor, [data.assignee_membership_id]);
  if (data.status_key) {
    const label = (await statusRow(orgId, data.status_key))?.label || data.status_key;
    await tell('pm_ticket_status_changed', after, project, actor, [after.assignee_membership_id, after.reporter_membership_id], { statusLabel: label });
  }
  return { ticket: await getTicket(orgId, ticketId, actor) };
}

async function deleteTicket(orgId, ticketId, actor) {
  const { ticket, project } = await loadTicket(orgId, ticketId, actor);
  if (!ticket) return { error: 'not_found' };
  if (!(await canManageProject(actor, project))) return { error: 'forbidden' };
  await prisma.$transaction(async (tx) => {
    await tx.pmTicket.delete({ where: { id: ticketId } });
    await logActivity(tx, orgId, project.id, null, actor.userId, 'ticket_deleted', `#${ticket.number} ${ticket.title}`, null);
  });
  return { ok: true };
}

async function addComment(orgId, ticketId, actor, body, isPublic = false) {
  const { ticket, project } = await loadTicket(orgId, ticketId, actor);
  if (!ticket) return { error: 'not_found' };
  const c = await prisma.pmTicketComment.create({ data: { org_id: orgId, ticket_id: ticketId, author_user_id: actor.userId, body, is_public: Boolean(isPublic) } });
  await tell('pm_ticket_commented', ticket, project, actor, [ticket.assignee_membership_id, ticket.reporter_membership_id], { comment: body });
  return { comment: c };
}

// ---- attachments (files live in the upload folder; they are read only through the authenticated download route)

const ALLOWED_ATTACHMENT_EXT = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.png', '.jpg', '.jpeg'];
const dropFile = (name) => fs.unlink(path.join(env.uploadDir, path.basename(name)), () => {});

async function addAttachment(orgId, ticketId, actor, file) {
  const { ticket, project } = await loadTicket(orgId, ticketId, actor);
  if (!ticket) { dropFile(file.filename); return { error: 'not_found' }; }
  const a = await prisma.$transaction(async (tx) => {
    const row = await tx.pmTicketAttachment.create({ data: { org_id: orgId, ticket_id: ticketId, filename: file.originalname.slice(0, 200), stored_name: file.filename, mime_type: file.mimetype || null, size_bytes: file.size, uploaded_by: actor.userId } });
    await logActivity(tx, orgId, project.id, ticketId, actor.userId, 'attachment_added', null, row.filename);
    return row;
  });
  return { attachment: { id: a.id, filename: a.filename, size_bytes: a.size_bytes } };
}

async function loadAttachment(orgId, id, actor) {
  const a = await prisma.pmTicketAttachment.findFirst({ where: { id, org_id: orgId } });
  if (!a) return {};
  const { ticket, project } = await loadTicket(orgId, a.ticket_id, actor);
  return ticket ? { attachment: a, ticket, project } : {};
}

async function attachmentFile(orgId, id, actor) {
  const { attachment } = await loadAttachment(orgId, id, actor);
  if (!attachment) return { error: 'not_found' };
  const full = path.join(env.uploadDir, path.basename(attachment.stored_name));
  if (!fs.existsSync(full)) return { error: 'not_found' };
  return { path: path.resolve(full), filename: attachment.filename };
}

async function deleteAttachment(orgId, id, actor) {
  const { attachment, project } = await loadAttachment(orgId, id, actor);
  if (!attachment) return { error: 'not_found' };
  if (!actor.isManager && attachment.uploaded_by !== actor.userId && !(await canManageProject(actor, project))) return { error: 'forbidden' };
  await prisma.$transaction(async (tx) => {
    await tx.pmTicketAttachment.delete({ where: { id } });
    await logActivity(tx, orgId, project.id, attachment.ticket_id, actor.userId, 'attachment_removed', attachment.filename, null);
  });
  dropFile(attachment.stored_name);
  return { ok: true };
}

// Nightly: tell the assignee of every open ticket due today or tomorrow, once per ticket per day.
async function notifyDueSoon({ now = new Date() } = {}) {
  const { notify } = require('../../lib/notifications');
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const today = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  const tomorrow = new Date(today.getTime() + 86400000);
  const startOfDay = new Date(today.getTime() - 5.5 * 3600 * 1000);
  const tickets = await prisma.pmTicket.findMany({ where: { assignee_membership_id: { not: null }, due_date: { gte: today, lte: tomorrow } }, include: { project: true } });
  let sent = 0;
  const catByOrg = new Map();
  for (const t of tickets) {
    if (!catByOrg.has(t.org_id)) catByOrg.set(t.org_id, await categoryResolver(t.org_id));
    if (catByOrg.get(t.org_id)(t.status_key) === 'done') continue;
    const [userId] = await userIdsOf([t.assignee_membership_id]);
    if (!userId) continue;
    const already = await prisma.notification.findFirst({ where: { user_id: userId, type: 'pm_ticket_due_soon', entity_id: t.id, created_at: { gte: startOfDay } }, select: { id: true } });
    if (already) continue;
    await notify(prisma, { type: 'pm_ticket_due_soon', recipientIds: [userId], context: { skipAdmins: true, notifySelf: true, orgId: t.org_id, ticketId: t.id, ticketNumber: t.number, ticketTitle: t.title, projectCode: t.project.code, projectName: t.project.name, dueLabel: dayOf(t.due_date) === dayOf(today) ? 'today' : 'tomorrow', metadata: { project_id: t.project_id } } });
    sent += 1;
  }
  return { sent };
}

// ---- sharing with a client or vendor (read-only link built on the existing external-access tokens)

const SHARE_RESOURCE = 'project_management';
const newToken = () => `ext_${crypto.randomBytes(32).toString('hex')}`;
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const shareRow = (g) => ({
  id: g.id, email: g.email, label: g.scope?.label || g.email, can_comment: Boolean(g.scope?.can_comment),
  expires_at: g.expires_at, revoked_at: g.revoked_at, last_used_at: g.last_used_at, use_count: g.use_count, created_at: g.created_at,
  active: !g.revoked_at && g.expires_at > new Date(),
});

async function listShares(orgId, projectId, actor) {
  const p = await loadProject(orgId, projectId, actor);
  if (!p) return { error: 'not_found' };
  if (!(await canManageProject(actor, p))) return { error: 'forbidden' };
  const rows = await prisma.externalAccess.findMany({ where: { org_id: orgId, scope: { path: ['pm_project_id'], equals: projectId } }, orderBy: { created_at: 'desc' } });
  return { shares: rows.map(shareRow) };
}

async function createShare(orgId, projectId, actor, input) {
  const p = await loadProject(orgId, projectId, actor);
  if (!p) return { error: 'not_found' };
  if (!(await canManageProject(actor, p))) return { error: 'forbidden' };
  const now = Date.now();
  if (input.expires_at.getTime() <= now) return { error: 'expiry_in_past' };
  if (input.expires_at.getTime() > now + 365 * 86400000) return { error: 'expiry_too_far' };
  const token = newToken();
  const grant = await prisma.externalAccess.create({
    data: { org_id: orgId, email: input.email, scope: { resources: [SHARE_RESOURCE], pm_project_id: projectId, can_comment: Boolean(input.can_comment), label: input.label }, token_hash: hashToken(token), granted_by: actor.userId, expires_at: input.expires_at },
  });
  await logActivity(prisma, orgId, projectId, null, actor.userId, 'share_created', null, `${input.label} (${input.email})`);
  return { share: shareRow(grant), token }; // the plain token is returned this once only
}

async function revokeShare(orgId, projectId, shareId, actor) {
  const p = await loadProject(orgId, projectId, actor);
  if (!p) return { error: 'not_found' };
  if (!(await canManageProject(actor, p))) return { error: 'forbidden' };
  const g = await prisma.externalAccess.findFirst({ where: { id: shareId, org_id: orgId, scope: { path: ['pm_project_id'], equals: projectId } } });
  if (!g) return { error: 'not_found' };
  if (g.revoked_at) return { error: 'already_revoked' };
  const updated = await prisma.externalAccess.update({ where: { id: shareId }, data: { revoked_at: new Date() } });
  await logActivity(prisma, orgId, projectId, null, actor.userId, 'share_revoked', g.scope?.label || g.email, null);
  return { share: shareRow(updated) };
}

// What the shared link shows: the project, its non-internal tickets (no assignees, no internal comments, nothing about contracts or money).
async function guestView(grant) {
  const projectId = grant.scope?.pm_project_id;
  const project = await prisma.pmProject.findFirst({ where: { id: projectId, org_id: grant.org_id } });
  if (!project) return { error: 'not_found' };
  const [rows, fields, cat, statuses] = await Promise.all([
    prisma.pmTicket.findMany({ where: { project_id: projectId, internal_only: false }, orderBy: { number: 'desc' }, include: { comments: { where: { is_public: true }, orderBy: { created_at: 'asc' } } } }),
    listFields(projectId),
    categoryResolver(grant.org_id),
    listStatuses(grant.org_id, { includeInactive: true }),
  ]);
  const label = new Map(statuses.map((st) => [st.key, st.label]));
  const t0 = new Date(); t0.setUTCHours(0, 0, 0, 0);
  return {
    project: { code: project.code, name: project.name, description: project.description, status: project.status, start_date: dayOf(project.start_date), end_date: dayOf(project.end_date) },
    share: { label: grant.scope?.label || grant.email, can_comment: Boolean(grant.scope?.can_comment), expires_at: grant.expires_at },
    progress: summarize(rows, cat),
    fields: fields.map((f) => ({ key: f.key, label: f.label, type: f.type })),
    tickets: rows.map((t) => {
      const category = cat(t.status_key);
      return {
        id: t.id, number: t.number, title: t.title, description: t.description, type: t.type, priority: t.priority, status_label: label.get(t.status_key) || t.status_key, category,
        due_date: dayOf(t.due_date), overdue: category !== 'done' && Boolean(t.due_date) && new Date(t.due_date) < t0, resolution: t.resolution, custom_values: t.custom_values || {},
        comments: t.comments.map((c) => ({ id: c.id, body: c.body, author: c.external_label ? c.external_label : 'Delphic team', mine: Boolean(c.external_label), created_at: c.created_at })),
      };
    }),
  };
}

async function guestComment(grant, ticketId, body) {
  if (!grant.scope?.can_comment) return { error: 'comment_not_allowed' };
  const ticket = await prisma.pmTicket.findFirst({ where: { id: ticketId, project_id: grant.scope.pm_project_id, org_id: grant.org_id, internal_only: false } });
  if (!ticket) return { error: 'not_found' };
  const label = grant.scope.label || grant.email;
  const c = await prisma.pmTicketComment.create({ data: { org_id: grant.org_id, ticket_id: ticketId, author_user_id: null, body, is_public: true, external_label: label } });
  const project = await prisma.pmProject.findUnique({ where: { id: ticket.project_id } });
  await tell('pm_ticket_commented', ticket, project, null, [ticket.assignee_membership_id, ticket.reporter_membership_id], { comment: body, actorName: `${label} (shared access)` });
  return { comment: { id: c.id } };
}

// ---- contracts (linked later, independent of tickets)

async function contractProgress(orgId, project, links, tickets, cat) {
  if (!links.length) return [];
  const ids = links.map((l) => l.contract_id);
  const [accounts, contracts] = await Promise.all([
    prisma.account.findMany({ where: { id: { in: ids }, org_id: orgId }, select: FINANCE_PROJECT_SELECT }),
    prisma.contract.findMany({ where: { id: { in: ids }, org_id: orgId } }),
  ]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const byId = new Map(contracts.map((c) => [c.id, c]));
  return links.map((l) => {
    const a = accountById.get(l.contract_id);
    if (a) {
      // a Finance project (the "contract" the business bills against): no manual progress or money figures of its own here
      const v = financeProjectView(a);
      const mine = tickets.filter((t) => t.contract_id === l.contract_id || (!t.contract_id && links.length === 1));
      return {
        link_id: l.id, contract_id: l.contract_id, is_primary: l.is_primary, kind: 'finance_project',
        title: v.title, project_code: v.project_code, counterparty_name: v.counterparty_name, status: v.status, service_category: v.service_category,
        agreement_start_date: v.agreement_start_date, agreement_end_date: v.agreement_end_date,
        value: null, currency: null, billed_to_date: null, manual_progress_percent: null,
        ticket_progress: summarize(mine, cat),
      };
    }
    const c = byId.get(l.contract_id);
    // tickets tagged to this contract; untagged tickets belong to it when it is the project's only contract
    const mine = tickets.filter((t) => t.contract_id === l.contract_id || (!t.contract_id && links.length === 1));
    return {
      link_id: l.id, contract_id: l.contract_id, is_primary: l.is_primary,
      title: c?.title || 'Contract removed', counterparty_name: c?.counterparty_name || null, status: c?.status || null,
      value: c ? num(c.value) : 0, currency: c?.currency || null, billed_to_date: c ? num(c.billed_to_date) : 0,
      // two numbers side by side: the contract's own (manual) progress and the one worked out from this project's tickets
      manual_progress_percent: c ? c.progress_percent : null,
      ticket_progress: summarize(mine, cat),
    };
  });
}

// The contracts a project is linked to are the company's Finance projects (Finance > Projects: P0045 ... with their client,
// agreement dates and contract status). Contract rows from the separate Contracts module are still read if one was linked before.
const FINANCE_PROJECT_SELECT = {
  id: true, name: true, project_name: true, project_code: true, client_name: true, client_account: { select: { name: true } },
  service_category: true, agreement_start_date: true, agreement_end_date: true, contract_status: true, contract_hold_periods: true,
};

function financeProjectView(a) {
  const name = a.project_name || a.name;
  return {
    id: a.id,
    project_code: a.project_code || null,
    title: a.project_code ? `${a.project_code} · ${name}` : name,
    counterparty_name: a.client_account?.name || a.client_name || null,
    status: contractState(a).state,
    service_category: a.service_category || null,
    agreement_start_date: dayOf(a.agreement_start_date),
    agreement_end_date: dayOf(a.agreement_end_date),
  };
}

async function listLinkableContracts(orgId) {
  const linked = await prisma.pmProjectContract.findMany({ where: { org_id: orgId }, select: { contract_id: true } });
  const rows = await prisma.account.findMany({
    where: { AND: [projectListWhere(orgId), { id: { notIn: linked.map((l) => l.contract_id) } }] },
    orderBy: [{ project_code: 'asc' }, { name: 'asc' }], select: FINANCE_PROJECT_SELECT,
  });
  return rows.map(financeProjectView);
}

async function linkContract(orgId, projectId, actor, { contract_id, is_primary }) {
  const p = await loadProject(orgId, projectId, actor);
  if (!p) return { error: 'not_found' };
  if (!(await canManageProject(actor, p))) return { error: 'forbidden' };
  const account = await prisma.account.findFirst({ where: { AND: [projectListWhere(orgId), { id: contract_id }] }, select: FINANCE_PROJECT_SELECT });
  const contract = account
    ? { id: account.id, title: financeProjectView(account).title }
    : await prisma.contract.findFirst({ where: { id: contract_id, org_id: orgId }, select: { id: true, title: true } });
  if (!contract) return { error: 'contract_not_found' };
  if (await prisma.pmProjectContract.findUnique({ where: { contract_id } })) return { error: 'contract_already_linked' };
  const first = (await prisma.pmProjectContract.count({ where: { project_id: projectId } })) === 0;
  await prisma.$transaction(async (tx) => {
    const primary = is_primary || first;
    if (primary) await tx.pmProjectContract.updateMany({ where: { project_id: projectId }, data: { is_primary: false } });
    await tx.pmProjectContract.create({ data: { org_id: orgId, project_id: projectId, contract_id, is_primary: primary, linked_by: actor.userId } });
    await logActivity(tx, orgId, projectId, null, actor.userId, 'contract_linked', null, contract.title);
  });
  return { project: await getProject(orgId, projectId, actor) };
}

async function unlinkContract(orgId, projectId, actor, contractId) {
  const p = await loadProject(orgId, projectId, actor);
  if (!p) return { error: 'not_found' };
  if (!(await canManageProject(actor, p))) return { error: 'forbidden' };
  const link = await prisma.pmProjectContract.findFirst({ where: { project_id: projectId, contract_id: contractId } });
  if (!link) return { error: 'not_found' };
  await prisma.$transaction(async (tx) => {
    await tx.pmProjectContract.delete({ where: { id: link.id } });
    await tx.pmTicket.updateMany({ where: { project_id: projectId, contract_id: contractId }, data: { contract_id: null } }); // tickets stay, just untagged
    if (link.is_primary) {
      const next = await tx.pmProjectContract.findFirst({ where: { project_id: projectId }, orderBy: { linked_at: 'asc' } });
      if (next) await tx.pmProjectContract.update({ where: { id: next.id }, data: { is_primary: true } });
    }
    await logActivity(tx, orgId, projectId, null, actor.userId, 'contract_unlinked', contractId, null);
  });
  return { project: await getProject(orgId, projectId, actor) };
}

async function makePrimary(orgId, projectId, actor, contractId) {
  const p = await loadProject(orgId, projectId, actor);
  if (!p) return { error: 'not_found' };
  if (!(await canManageProject(actor, p))) return { error: 'forbidden' };
  const link = await prisma.pmProjectContract.findFirst({ where: { project_id: projectId, contract_id: contractId } });
  if (!link) return { error: 'not_found' };
  await prisma.$transaction([
    prisma.pmProjectContract.updateMany({ where: { project_id: projectId }, data: { is_primary: false } }),
    prisma.pmProjectContract.update({ where: { id: link.id }, data: { is_primary: true } }),
  ]);
  return { project: await getProject(orgId, projectId, actor) };
}

// "Copy to contract": an admin takes the ticket-based percentage over as the contract's own progress (never done automatically).
async function copyProgressToContract(orgId, projectId, actor, contractId) {
  if (!actor.isManager) return { error: 'forbidden' };
  const project = await getProject(orgId, projectId, actor);
  const row = project?.contracts.find((c) => c.contract_id === contractId);
  if (!row) return { error: 'not_found' };
  if (row.kind === 'finance_project') return { error: 'no_manual_progress' };
  await prisma.contract.update({ where: { id: contractId }, data: { progress_percent: row.ticket_progress.percent } });
  await logActivity(prisma, orgId, projectId, null, actor.userId, 'contract_progress_copied', String(row.manual_progress_percent), String(row.ticket_progress.percent));
  return { project: await getProject(orgId, projectId, actor) };
}

// A person's own tickets across every project they can see.
async function myTickets(orgId, actor) {
  const rows = await prisma.pmTicket.findMany({ where: { org_id: orgId, assignee_membership_id: actor.membershipId }, orderBy: [{ due_date: 'asc' }, { number: 'desc' }], take: 200, include: { project: { select: { id: true, code: true, name: true } } } });
  const cat = await categoryResolver(orgId);
  const shaped = await shapeTickets(orgId, rows, cat);
  return shaped.map((t, i) => ({ ...t, project: rows[i].project })).filter((t) => t.category !== 'done');
}

module.exports = {
  PROJECT_STATUSES, TICKET_TYPES, PRIORITIES, CATEGORIES,
  projectCreateSchema, projectUpdateSchema, ticketCreateSchema, ticketUpdateSchema, ticketListQuerySchema, statusSchema, statusUpdateSchema,
  listStatuses, createStatus, updateStatus, listPeople,
  FIELD_TYPES, fieldCreateSchema, fieldUpdateSchema, shareSchema, listFields, createField, updateField,
  listShares, createShare, revokeShare, guestView, guestComment,
  ALLOWED_ATTACHMENT_EXT, addAttachment, attachmentFile, deleteAttachment, notifyDueSoon,
  listProjects, getProject, createProject, updateProject, deleteProject, setMembers,
  listTickets, createTicket, getTicket, updateTicket, deleteTicket, addComment,
  listLinkableContracts, linkContract, unlinkContract, makePrimary, copyProgressToContract, myTickets,
};
