const { z } = require('zod');
const prisma = require('../../config/db');
const { userNames } = require('../../lib/vertical');
const { writeAudit } = require('./audit');
const { ownerOk } = require('./leads.service');

const KINDS = ['self', 'client'];
const STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];
const WO_STATUSES = ['draft', 'issued', 'in_progress', 'completed', 'cancelled'];

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateOnly = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable());
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
const money = z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(1e13).nullable().optional());

const projectFields = {
  name: z.string().trim().min(1).max(200),
  kind: z.enum(KINDS),
  party_id: uuidOrNull,
  location: text(200),
  status: z.enum(STATUSES),
  start_date: dateOnly.optional(),
  end_date: dateOnly.optional(),
  contract_value: money,
  budget: money,
  progress_pct: z.coerce.number().int().min(0).max(100),
  manager_id: uuidOrNull,
  notes: text(2000),
};
const createProjectSchema = z.object({ ...projectFields, kind: projectFields.kind.default('client'), status: projectFields.status.default('planning'), progress_pct: projectFields.progress_pct.default(0) });
const updateProjectSchema = z.object(projectFields).partial();
const fromLeadSchema = z.object({ start_date: dateOnly.optional(), end_date: dateOnly.optional(), manager_id: uuidOrNull });
const milestoneFields = {
  name: z.string().trim().min(1).max(200),
  due_date: dateOnly.optional(),
  weight: z.coerce.number().int().min(1).max(100),
  percent_done: z.coerce.number().int().min(0).max(100),
  billing_amount: money,
  billed: z.boolean(),
};
const milestoneCreateSchema = z.object({ ...milestoneFields, weight: milestoneFields.weight.default(1), percent_done: milestoneFields.percent_done.default(0), billed: milestoneFields.billed.default(false) });
const milestoneUpdateSchema = z.object(milestoneFields).partial();
const workOrderFields = {
  vendor_id: z.string().uuid(),
  wo_number: text(60),
  scope: z.string().trim().min(1).max(1000),
  value: z.coerce.number().positive().max(1e13),
  billed_to_date: z.coerce.number().min(0).max(1e13),
  status: z.enum(WO_STATUSES),
  issued_on: dateOnly.optional(),
  notes: text(1000),
};
const workOrderCreateSchema = z.object({ ...workOrderFields, billed_to_date: workOrderFields.billed_to_date.default(0), status: workOrderFields.status.default('draft') });
const workOrderUpdateSchema = z.object(workOrderFields).partial();
const listQuerySchema = z.object({
  status: z.enum([...STATUSES, 'open']).optional(),
  kind: z.enum(KINDS).optional(),
  party_id: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(300).default(200),
});

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const dayOf = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const todayStr = () => new Date().toISOString().slice(0, 10);
const num = (v) => (v === null || v === undefined ? null : Number(v));
const sum = (rows, f) => rows.reduce((a, r) => a + (num(f(r)) || 0), 0);
const isClosed = (p) => p.status === 'completed' || p.status === 'cancelled';
const milestoneStatus = (pct) => (pct >= 100 ? 'done' : pct > 0 ? 'in_progress' : 'pending');
const snapshot = (p) => ({ code: p.code, name: p.name, kind: p.kind, status: p.status, contract_value: num(p.contract_value), budget: num(p.budget), manager_id: p.manager_id });

// Weighted milestone progress; the manual figure applies only while there are no milestones.
function progressOf(milestones, manual) {
  if (milestones.length === 0) return manual;
  const weight = milestones.reduce((a, m) => a + m.weight, 0);
  return Math.round(milestones.reduce((a, m) => a + m.weight * m.percent_done, 0) / weight);
}

async function nextCode(tx, orgId) {
  await tx.zxSetting.upsert({ where: { org_id: orgId }, update: {}, create: { org_id: orgId } });
  const s = await tx.zxSetting.update({ where: { org_id: orgId }, data: { project_seq: { increment: 1 } } });
  return `${s.project_prefix}-${String(s.project_seq).padStart(3, '0')}`;
}

async function checkRefs(orgId, kind, input) {
  if (input.party_id) {
    const party = await prisma.zxParty.findFirst({ where: { id: input.party_id, org_id: orgId, deleted_at: null }, select: { kind: true } });
    if (!party) return 'party_not_found';
    if (kind === 'client' && party.kind === 'vendor') return 'party_not_client';
  }
  if (input.manager_id && !(await ownerOk(orgId, input.manager_id))) return 'manager_invalid';
  if (input.start_date && input.end_date && input.end_date < input.start_date) return 'bad_dates';
  return null;
}

function rollups(project, milestones, workOrders) {
  const wos = workOrders.filter((w) => w.status !== 'cancelled');
  return {
    progress: progressOf(milestones, project.progress_pct),
    milestones_total: milestones.length,
    milestones_done: milestones.filter((m) => m.percent_done >= 100).length,
    milestones_overdue: milestones.filter((m) => m.due_date && dayOf(m.due_date) < todayStr() && m.percent_done < 100).length,
    billing_planned: sum(milestones, (m) => m.billing_amount),
    billing_billed: sum(milestones.filter((m) => m.billed), (m) => m.billing_amount),
    wo_count: wos.length,
    wo_value: sum(wos, (w) => w.value),
    wo_billed: sum(wos, (w) => w.billed_to_date),
  };
}

async function decorate(orgId, projects) {
  if (projects.length === 0) return [];
  const ids = projects.map((p) => p.id);
  const [milestones, workOrders, names, parties] = await Promise.all([
    prisma.zxMilestone.findMany({ where: { org_id: orgId, project_id: { in: ids }, deleted_at: null } }),
    prisma.zxWorkOrder.findMany({ where: { org_id: orgId, project_id: { in: ids }, deleted_at: null } }),
    userNames(projects.map((p) => p.manager_id)),
    prisma.zxParty.findMany({ where: { org_id: orgId, id: { in: [...new Set(projects.map((p) => p.party_id).filter(Boolean))] } }, select: { id: true, name: true } }),
  ]);
  const partyMap = new Map(parties.map((p) => [p.id, p]));
  return projects.map((p) => ({
    ...p,
    contract_value: num(p.contract_value),
    budget: num(p.budget),
    manager: names.get(p.manager_id) || null,
    party: partyMap.get(p.party_id) || null,
    ...rollups(p, milestones.filter((m) => m.project_id === p.id), workOrders.filter((w) => w.project_id === p.id)),
  }));
}

async function list(orgId, query) {
  const where = {
    org_id: orgId,
    deleted_at: null,
    ...(query.status === 'open' ? { status: { in: ['planning', 'active', 'on_hold'] } } : query.status ? { status: query.status } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.party_id ? { party_id: query.party_id } : {}),
    ...(query.q ? { OR: ['name', 'code', 'location'].map((f) => ({ [f]: { contains: query.q, mode: 'insensitive' } })) } : {}),
  };
  return decorate(orgId, await prisma.zxProject.findMany({ where, orderBy: [{ created_at: 'desc' }], take: query.limit }));
}

async function summary(orgId) {
  const projects = await decorate(orgId, await prisma.zxProject.findMany({ where: { org_id: orgId, deleted_at: null } }));
  const by_status = Object.fromEntries(STATUSES.map((s) => [s, projects.filter((p) => p.status === s).length]));
  const live = projects.filter((p) => p.status === 'active' || p.status === 'planning' || p.status === 'on_hold');
  return {
    total: projects.length,
    by_status,
    live_count: live.length,
    live_contract_value: sum(live.filter((p) => p.kind === 'client'), (p) => p.contract_value),
    live_budget: sum(live.filter((p) => p.kind === 'self'), (p) => p.budget),
    committed_cost: sum(live, (p) => p.wo_value),
    milestones_overdue: sum(live, (p) => p.milestones_overdue),
  };
}

async function get(orgId, id) {
  const project = await prisma.zxProject.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!project) return { error: 'not_found' };
  const [milestones, workOrders, team] = await Promise.all([
    prisma.zxMilestone.findMany({ where: { project_id: id, org_id: orgId, deleted_at: null }, orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }] }),
    prisma.zxWorkOrder.findMany({ where: { project_id: id, org_id: orgId, deleted_at: null }, orderBy: { created_at: 'asc' }, include: { vendor: { select: { id: true, name: true } } } }),
    prisma.zxAssignment.findMany({ where: { project_id: id, org_id: orgId, deleted_at: null }, orderBy: { created_at: 'asc' }, include: { person: { select: { id: true, name: true, kind: true, designation: true } } } }),
  ]);
  const [decorated] = await decorate(orgId, [project]);
  return {
    project: {
      ...decorated,
      milestones: milestones.map((m) => ({ ...m, billing_amount: num(m.billing_amount) })),
      work_orders: workOrders.map((w) => ({ ...w, value: num(w.value), billed_to_date: num(w.billed_to_date) })),
      team,
    },
  };
}

async function create(orgId, actorId, input) {
  const bad = await checkRefs(orgId, input.kind, input);
  if (bad) return { error: bad };
  const { start_date, end_date, ...rest } = input;
  const project = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, orgId);
    return tx.zxProject.create({ data: { org_id: orgId, created_by: actorId, code, ...rest, start_date: toDate(start_date), end_date: toDate(end_date) } });
  });
  await writeAudit(null, { orgId, actorId, entity: 'project', entityId: project.id, action: 'create', after: snapshot(project) });
  return get(orgId, project.id);
}

// A won lead becomes a project once; the lead keeps the link and can no longer be reopened.
async function createFromLead(orgId, actorId, leadId, input) {
  const lead = await prisma.zxLead.findFirst({ where: { id: leadId, org_id: orgId, deleted_at: null } });
  if (!lead) return { error: 'lead_not_found' };
  if (lead.stage !== 'won') return { error: 'lead_not_won' };
  if (lead.project_id) return { error: 'lead_converted' };
  const kind = lead.category === 'self_project' ? 'self' : 'client';
  const bad = await checkRefs(orgId, kind, { manager_id: input.manager_id, start_date: input.start_date, end_date: input.end_date });
  if (bad) return { error: bad };
  const project = await prisma.$transaction(async (tx) => {
    const claimed = await tx.zxLead.updateMany({ where: { id: leadId, org_id: orgId, project_id: null }, data: { updated_at: new Date() } });
    if (claimed.count !== 1) return null;
    const code = await nextCode(tx, orgId);
    const value = lead.estimated_value;
    const created = await tx.zxProject.create({
      data: {
        org_id: orgId,
        created_by: actorId,
        code,
        name: lead.name,
        kind,
        party_id: lead.party_id,
        lead_id: lead.id,
        location: lead.location,
        status: 'planning',
        start_date: toDate(input.start_date),
        end_date: toDate(input.end_date),
        contract_value: kind === 'client' ? value : null,
        budget: kind === 'self' ? value : null,
        manager_id: input.manager_id || lead.owner_id,
        notes: lead.notes,
      },
    });
    await tx.zxLead.update({ where: { id: leadId }, data: { project_id: created.id } });
    await tx.zxLeadActivity.create({ data: { org_id: orgId, lead_id: leadId, kind: 'note', created_by: actorId, summary: `Converted to project ${code}` } });
    return created;
  });
  if (!project) return { error: 'lead_converted' };
  await writeAudit(null, { orgId, actorId, entity: 'project', entityId: project.id, action: 'create_from_lead', after: { ...snapshot(project), lead_id: leadId } });
  return get(orgId, project.id);
}

async function update(orgId, actorId, id, input) {
  const before = await prisma.zxProject.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  const merged = { ...before, ...input };
  const dates = { start_date: input.start_date !== undefined ? input.start_date : dayOf(before.start_date), end_date: input.end_date !== undefined ? input.end_date : dayOf(before.end_date) };
  const bad = await checkRefs(orgId, merged.kind, { ...dates, party_id: input.party_id !== undefined || input.kind ? merged.party_id : null, manager_id: input.manager_id && input.manager_id !== before.manager_id ? input.manager_id : null });
  if (bad) return { error: bad };
  if (input.status === 'completed' && before.status !== 'completed') {
    const open = await prisma.zxMilestone.count({ where: { project_id: id, deleted_at: null, percent_done: { lt: 100 } } });
    if (open > 0) return { error: 'milestones_incomplete' };
  }
  const { start_date, end_date, ...rest } = input;
  await prisma.zxProject.update({
    where: { id },
    data: { ...rest, ...(start_date !== undefined ? { start_date: toDate(start_date) } : {}), ...(end_date !== undefined ? { end_date: toDate(end_date) } : {}) },
  });
  const after = await prisma.zxProject.findUnique({ where: { id } });
  await writeAudit(null, { orgId, actorId, entity: 'project', entityId: id, action: 'update', before: snapshot(before), after: snapshot(after) });
  return get(orgId, id);
}

async function remove(orgId, actorId, id) {
  const before = await prisma.zxProject.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.zxProject.update({ where: { id }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'project', entityId: id, action: 'delete', before: snapshot(before) });
  return { ok: true };
}

async function liveProject(orgId, id) {
  const project = await prisma.zxProject.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!project) return { error: 'not_found' };
  if (isClosed(project)) return { error: 'project_closed' };
  return { project };
}

async function addMilestone(orgId, actorId, projectId, input) {
  const found = await liveProject(orgId, projectId);
  if (found.error) return found;
  if (input.billed && input.percent_done < 100) return { error: 'not_done' };
  const last = await prisma.zxMilestone.aggregate({ where: { project_id: projectId }, _max: { sort_order: true } });
  const { due_date, ...rest } = input;
  const milestone = await prisma.zxMilestone.create({
    data: { org_id: orgId, project_id: projectId, ...rest, due_date: toDate(due_date), status: milestoneStatus(input.percent_done), sort_order: (last._max.sort_order ?? -1) + 1 },
  });
  await writeAudit(null, { orgId, actorId, entity: 'milestone', entityId: milestone.id, action: 'create', after: { project_id: projectId, name: milestone.name } });
  return get(orgId, projectId);
}

async function updateMilestone(orgId, actorId, projectId, id, input) {
  const found = await liveProject(orgId, projectId);
  if (found.error) return found;
  const before = await prisma.zxMilestone.findFirst({ where: { id, project_id: projectId, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'milestone_not_found' };
  const pct = input.percent_done ?? before.percent_done;
  const billed = input.billed ?? before.billed;
  if (billed && pct < 100) return { error: 'not_done' };
  const { due_date, ...rest } = input;
  await prisma.zxMilestone.update({ where: { id }, data: { ...rest, ...(due_date !== undefined ? { due_date: toDate(due_date) } : {}), status: milestoneStatus(pct) } });
  await writeAudit(null, { orgId, actorId, entity: 'milestone', entityId: id, action: 'update', before: { percent_done: before.percent_done, billed: before.billed }, after: { percent_done: pct, billed } });
  return get(orgId, projectId);
}

async function removeMilestone(orgId, actorId, projectId, id) {
  const found = await liveProject(orgId, projectId);
  if (found.error) return found;
  const before = await prisma.zxMilestone.findFirst({ where: { id, project_id: projectId, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'milestone_not_found' };
  if (before.billed) return { error: 'milestone_billed' };
  await prisma.zxMilestone.update({ where: { id }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'milestone', entityId: id, action: 'delete', before: { name: before.name } });
  return get(orgId, projectId);
}

async function vendorOk(orgId, vendorId) {
  const v = await prisma.zxParty.findFirst({ where: { id: vendorId, org_id: orgId, deleted_at: null }, select: { kind: true, status: true } });
  return Boolean(v && v.kind !== 'client' && v.status === 'active');
}

async function addWorkOrder(orgId, actorId, projectId, input) {
  const found = await liveProject(orgId, projectId);
  if (found.error) return found;
  if (!(await vendorOk(orgId, input.vendor_id))) return { error: 'vendor_invalid' };
  if (input.billed_to_date > input.value) return { error: 'billed_exceeds' };
  const count = await prisma.zxWorkOrder.count({ where: { project_id: projectId } });
  const { issued_on, ...rest } = input;
  const wo = await prisma.zxWorkOrder.create({
    data: { org_id: orgId, project_id: projectId, created_by: actorId, ...rest, wo_number: input.wo_number || `${found.project.code}-WO${count + 1}`, issued_on: toDate(issued_on) },
  });
  await writeAudit(null, { orgId, actorId, entity: 'work_order', entityId: wo.id, action: 'create', after: { project_id: projectId, vendor_id: wo.vendor_id, value: num(wo.value) } });
  return get(orgId, projectId);
}

async function updateWorkOrder(orgId, actorId, projectId, id, input) {
  const found = await liveProject(orgId, projectId);
  if (found.error) return found;
  const before = await prisma.zxWorkOrder.findFirst({ where: { id, project_id: projectId, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'work_order_not_found' };
  if (input.vendor_id && input.vendor_id !== before.vendor_id && !(await vendorOk(orgId, input.vendor_id))) return { error: 'vendor_invalid' };
  const value = input.value ?? num(before.value);
  const billed = input.billed_to_date ?? num(before.billed_to_date);
  if (billed > value) return { error: 'billed_exceeds' };
  if ((input.status ?? before.status) === 'cancelled' && billed > 0) return { error: 'cancel_billed' };
  const { issued_on, ...rest } = input;
  await prisma.zxWorkOrder.update({ where: { id }, data: { ...rest, ...(issued_on !== undefined ? { issued_on: toDate(issued_on) } : {}) } });
  await writeAudit(null, { orgId, actorId, entity: 'work_order', entityId: id, action: 'update', before: { value: num(before.value), billed_to_date: num(before.billed_to_date), status: before.status }, after: { value, billed_to_date: billed, status: input.status ?? before.status } });
  return get(orgId, projectId);
}

async function removeWorkOrder(orgId, actorId, projectId, id) {
  const found = await liveProject(orgId, projectId);
  if (found.error) return found;
  const before = await prisma.zxWorkOrder.findFirst({ where: { id, project_id: projectId, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'work_order_not_found' };
  if (num(before.billed_to_date) > 0) return { error: 'cancel_billed' };
  await prisma.zxWorkOrder.update({ where: { id }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'work_order', entityId: id, action: 'delete', before: { value: num(before.value) } });
  return get(orgId, projectId);
}

module.exports = {
  createProjectSchema, updateProjectSchema, fromLeadSchema, milestoneCreateSchema, milestoneUpdateSchema,
  workOrderCreateSchema, workOrderUpdateSchema, listQuerySchema,
  list, summary, get, create, createFromLead, update, remove,
  addMilestone, updateMilestone, removeMilestone, addWorkOrder, updateWorkOrder, removeWorkOrder,
};
