const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const prisma = require('../../config/db');
const env = require('../../config/env');
const { adminPower } = require('../../lib/access/guard');
const { WORKING_STATUSES } = require('../../lib/employmentStatus');
const { DEFAULT_CATEGORIES, STATUSES, STATUS_LABEL } = require('./whistleblower.constants');

// Speak Up - Confidential Reporting: any employee raises a complaint; it reaches the handlers an admin set for its category.
//  - Confidential (default): the handlers see who raised it. Anonymous: no person is stored at all; the reporter follows the case with a
//    tracking code, of which only a hash is kept.
//  - Nothing here is written to the change log, and notifications never carry the subject, the text or the reporter.
//  - A restricted category (POSH, retaliation) is seen only by its own handlers and the group admin. Anyone picked as "involved" never
//    sees the case, even if they are a handler of its category.

const DAY_MS = 86400000;
const OPEN_STATUSES = STATUSES.filter((s) => s !== 'closed');
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const idsOf = (json) => (Array.isArray(json) ? json : []);

// ---------- who is looking ----------

async function viewer(user) {
  const person = await prisma.user.findUnique({ where: { id: user.id }, select: { is_group_superadmin: true } });
  const groupAdmin = Boolean(person?.is_group_superadmin);
  return {
    membershipId: user.org_membership_id,
    userId: user.id,
    groupAdmin,
    admin: groupAdmin || adminPower(user),
    canViewAll: adminPower(user, 'whistleblower.view'),
    canUpdateAll: adminPower(user, 'whistleblower.update'),
    canManage: groupAdmin || adminPower(user, 'whistleblower.manage'),
  };
}

/** Can this person see the case? */
function sees(v, c, cat) {
  if (v.groupAdmin) return true;
  if (idsOf(c.involved_membership_ids).includes(v.membershipId)) return false;
  if (c.assigned_membership_id === v.membershipId) return true;
  const handlers = idsOf(cat.handler_membership_ids);
  if (handlers.includes(v.membershipId)) return true;
  if (handlers.length === 0) return v.admin || v.canViewAll; // nobody named: the company admins
  if (cat.restricted) return false; // named handlers only
  return v.admin || v.canViewAll;
}

/** Can this person answer, change the status or assign it? Holding only "view" is read-only. */
function canAct(v, c, cat) {
  if (!sees(v, c, cat)) return false;
  if (v.groupAdmin || v.admin || v.canUpdateAll) return true;
  return idsOf(cat.handler_membership_ids).includes(v.membershipId) || c.assigned_membership_id === v.membershipId;
}

// ---------- settings and categories ----------

async function getSettings(orgId) {
  const row = await prisma.whistleSettings.findUnique({ where: { org_id: orgId } });
  return { enabled: row?.enabled ?? false, allow_anonymous: row?.allow_anonymous ?? true, sla_days: row?.sla_days ?? 7 };
}

async function updateSettings(user, patch) {
  const v = await viewer(user);
  if (!v.canManage) return { error: 'forbidden' };
  const row = await prisma.whistleSettings.upsert({
    where: { org_id: user.org_id },
    create: { org_id: user.org_id, ...patch },
    update: patch,
  });
  return { settings: { enabled: row.enabled, allow_anonymous: row.allow_anonymous, sla_days: row.sla_days } };
}

/** A company starts with the 20 default categories the first time the module is opened. */
async function ensureCategories(orgId) {
  if (await prisma.whistleCategory.count({ where: { org_id: orgId } })) return;
  await prisma.whistleCategory.createMany({
    data: DEFAULT_CATEGORIES.map(([number, name, examples, restricted]) => ({ org_id: orgId, number, name, examples, restricted })),
    skipDuplicates: true,
  });
}

async function memberNames(orgId, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const rows = await prisma.orgMembership.findMany({ where: { org_id: orgId, id: { in: list } }, select: { id: true, person: { select: { name: true } } } });
  return new Map(rows.map((m) => [m.id, m.person?.name || '']));
}

function categoryView(c, names = new Map()) {
  const ids = idsOf(c.handler_membership_ids);
  return {
    id: c.id, number: c.number, name: c.name, examples: c.examples, restricted: c.restricted, active: c.active,
    handler_membership_ids: ids, handlers: ids.map((id) => ({ id, name: names.get(id) || '' })),
  };
}

async function listCategories(user) {
  const v = await viewer(user);
  if (!v.canManage) return { error: 'forbidden' };
  await ensureCategories(user.org_id);
  const rows = await prisma.whistleCategory.findMany({ where: { org_id: user.org_id }, orderBy: { number: 'asc' } });
  const names = await memberNames(user.org_id, rows.flatMap((r) => idsOf(r.handler_membership_ids)));
  return { categories: rows.map((r) => categoryView(r, names)) };
}

async function validHandlers(orgId, ids) {
  if (!ids.length) return true;
  const n = await prisma.orgMembership.count({ where: { org_id: orgId, id: { in: ids } } });
  return n === new Set(ids).size;
}

/** Two categories with the same name would confuse the people choosing one. */
const nameTaken = (orgId, name, exceptId = null) => prisma.whistleCategory.findFirst({ where: { org_id: orgId, name: { equals: name.trim(), mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });

async function updateCategory(user, id, patch) {
  const v = await viewer(user);
  if (!v.canManage) return { error: 'forbidden' };
  const cat = await prisma.whistleCategory.findFirst({ where: { id, org_id: user.org_id } });
  if (!cat) return { error: 'not_found' };
  if (patch.name && (await nameTaken(user.org_id, patch.name, id))) return { error: 'duplicate_name' };
  if (patch.handler_membership_ids && !(await validHandlers(user.org_id, patch.handler_membership_ids))) return { error: 'bad_handlers' };
  const row = await prisma.whistleCategory.update({ where: { id }, data: patch });
  const names = await memberNames(user.org_id, idsOf(row.handler_membership_ids));
  return { category: categoryView(row, names) };
}

async function createCategory(user, body) {
  const v = await viewer(user);
  if (!v.canManage) return { error: 'forbidden' };
  await ensureCategories(user.org_id);
  if (await nameTaken(user.org_id, body.name)) return { error: 'duplicate_name' };
  if (!(await validHandlers(user.org_id, body.handler_membership_ids))) return { error: 'bad_handlers' };
  const last = await prisma.whistleCategory.aggregate({ where: { org_id: user.org_id }, _max: { number: true } });
  const row = await prisma.whistleCategory.create({ data: { org_id: user.org_id, number: (last._max.number || 0) + 1, ...body } });
  const names = await memberNames(user.org_id, idsOf(row.handler_membership_ids));
  return { category: categoryView(row, names) };
}

// ---------- notifications (in-app only; no subject, no text, no reporter) ----------

async function userIdsOf(orgId, membershipIds) {
  if (!membershipIds.length) return [];
  const rows = await prisma.orgMembership.findMany({ where: { org_id: orgId, id: { in: membershipIds } }, select: { person_id: true } });
  return rows.map((r) => r.person_id);
}

/** The company admins' memberships (the fallback when a category has no handler). */
async function adminMembershipIds(orgId) {
  const rows = await prisma.orgMembership.findMany({
    where: { org_id: orgId, OR: [{ role: 'admin' }, { person: { is_superadmin: true } }], employment_status: { in: WORKING_STATUSES } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function notifyUsers(orgId, userIds, { type, title, body, caseId, audience = 'handler' }) {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  await prisma.notification.createMany({ data: unique.map((user_id) => ({ user_id, type, title, body, entity_type: 'whistle_case', entity_id: caseId, org_id: orgId, metadata: { audience } })) });
}

/** Who should hear about a case: its category's handlers (or the admins), minus anyone involved and minus the person acting. */
async function handlerUserIds(c, cat, exceptMembershipId = null) {
  const named = idsOf(cat.handler_membership_ids);
  let members = named.length ? named : await adminMembershipIds(c.org_id);
  if (c.assigned_membership_id) members = [...new Set([...members, c.assigned_membership_id])];
  const involved = idsOf(c.involved_membership_ids);
  members = members.filter((m) => !involved.includes(m) && m !== exceptMembershipId);
  return userIdsOf(c.org_id, members);
}

// ---------- raising and following a concern (the reporter) ----------

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newAccessCode() {
  const bytes = crypto.randomBytes(12);
  const raw = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return { code: `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`, hash: hashCode(raw) };
}
const hashCode = (code) => crypto.createHash('sha256').update(String(code).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
const sameHash = (a, b) => a && b && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function meta(user) {
  const [settings, v] = await Promise.all([getSettings(user.org_id), viewer(user)]);
  await ensureCategories(user.org_id);
  const [categories, offices, departments, listed, assigned] = await Promise.all([
    prisma.whistleCategory.findMany({ where: { org_id: user.org_id, active: true }, orderBy: { number: 'asc' }, select: { id: true, number: true, name: true, examples: true } }),
    prisma.location.findMany({ where: { org_id: user.org_id }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.department.findMany({ where: { org_id: user.org_id }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.whistleCategory.findMany({ where: { org_id: user.org_id }, select: { handler_membership_ids: true } }),
    prisma.whistleCase.count({ where: { org_id: user.org_id, assigned_membership_id: user.org_membership_id } }),
  ]);
  const isHandler = v.admin || v.canViewAll || assigned > 0 || listed.some((c) => idsOf(c.handler_membership_ids).includes(v.membershipId));
  return { ...settings, categories, offices, departments, is_handler: isHandler, can_manage: v.canManage };
}

async function saveFiles(caseId, messageId, files = []) {
  for (const f of files) {
    await prisma.whistleAttachment.create({
      data: { case_id: caseId, message_id: messageId || null, file_name: f.originalname.slice(0, 200), stored_name: f.filename, mime_type: f.mimetype, size_bytes: f.size },
    });
  }
}

async function createCase(user, body, files = []) {
  const settings = await getSettings(user.org_id);
  if (!settings.enabled) return { error: 'disabled' };
  await ensureCategories(user.org_id);
  const category = await prisma.whistleCategory.findFirst({ where: { id: body.category_id, org_id: user.org_id, active: true } });
  if (!category) return { error: 'category_not_found' };
  if (body.location_id && !(await prisma.location.findFirst({ where: { id: body.location_id, org_id: user.org_id }, select: { id: true } }))) return { error: 'office_not_found' };
  if (body.department_id && !(await prisma.department.findFirst({ where: { id: body.department_id, org_id: user.org_id }, select: { id: true } }))) return { error: 'department_not_found' };
  const anonymous = body.mode === 'anonymous';
  if (anonymous && !settings.allow_anonymous) return { error: 'anonymous_off' };
  const involved = [...new Set(body.involved_membership_ids)].filter((id) => id !== user.org_membership_id);
  if (involved.length && (await prisma.orgMembership.count({ where: { org_id: user.org_id, id: { in: involved } } })) !== involved.length) return { error: 'bad_people' };
  const access = anonymous ? newAccessCode() : null;

  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wb:${user.org_id}`}))`;
    const last = await tx.whistleCase.aggregate({ where: { org_id: user.org_id }, _max: { seq: true } });
    const seq = (last._max.seq || 0) + 1;
    const row = await tx.whistleCase.create({
      data: {
        org_id: user.org_id, seq, case_no: `SU-${new Date().getUTCFullYear()}-${String(seq).padStart(4, '0')}`,
        category_id: category.id, subject: body.subject, description: body.description,
        incident_date: toDate(body.incident_date), location_id: body.location_id || null, department_id: body.department_id || null, people_involved: body.people_involved || null,
        involved_membership_ids: involved,
        reporter_membership_id: anonymous ? null : user.org_membership_id, is_anonymous: anonymous, access_code_hash: access?.hash || null,
      },
    });
    await tx.whistleEvent.create({ data: { case_id: row.id, action: 'created', detail: {}, actor_membership_id: anonymous ? null : user.org_membership_id } });
    return row;
  });
  await saveFiles(created.id, null, files);

  const recipients = await handlerUserIds(created, category, anonymous ? null : user.org_membership_id);
  await notifyUsers(user.org_id, recipients, { type: 'whistleblower_new', title: 'New complaint received', body: `${created.case_no} - ${category.name}`, caseId: created.id });
  return { case: { id: created.id, case_no: created.case_no, is_anonymous: anonymous }, access_code: access?.code || null };
}

/** What the reporter may see: no handler names, no internal notes. */
async function reporterView(c) {
  const [messages, events, attachments, category, office, department] = await Promise.all([
    prisma.whistleMessage.findMany({ where: { case_id: c.id, internal: false }, orderBy: { created_at: 'asc' } }),
    prisma.whistleEvent.findMany({ where: { case_id: c.id, action: { in: ['created', 'status', 'resolved', 'reopened'] } }, orderBy: { created_at: 'asc' } }),
    prisma.whistleAttachment.findMany({ where: { case_id: c.id }, orderBy: { created_at: 'asc' } }),
    prisma.whistleCategory.findUnique({ where: { id: c.category_id }, select: { name: true } }),
    c.location_id ? prisma.location.findUnique({ where: { id: c.location_id }, select: { name: true } }) : null,
    c.department_id ? prisma.department.findUnique({ where: { id: c.department_id }, select: { name: true } }) : null,
  ]);
  return {
    id: c.id, case_no: c.case_no, subject: c.subject, description: c.description, category: category?.name || '', incident_date: ymd(c.incident_date), office: office?.name || null, department: department?.name || null, people_involved: c.people_involved, status: c.status, status_label: STATUS_LABEL[c.status],
    is_anonymous: c.is_anonymous, created_at: c.created_at, last_activity_at: c.last_activity_at, resolution: c.status === 'closed' || c.status === 'action_taken' ? c.resolution : null,
    messages: messages.map((m) => ({ id: m.id, from: m.author_kind === 'reporter' ? 'you' : 'team', body: m.body, created_at: m.created_at })),
    timeline: events.map((e) => ({ id: e.id, action: e.action, to: e.detail?.to ? STATUS_LABEL[e.detail.to] : null, created_at: e.created_at })),
    attachments: attachments.map((a) => ({ id: a.id, file_name: a.file_name, mime_type: a.mime_type, size_bytes: a.size_bytes })),
  };
}

async function myCases(user) {
  const rows = await prisma.whistleCase.findMany({ where: { org_id: user.org_id, reporter_membership_id: user.org_membership_id }, orderBy: { created_at: 'desc' }, include: { category: { select: { name: true } } } });
  return rows.map((c) => ({ id: c.id, case_no: c.case_no, subject: c.subject, category: c.category.name, status: c.status, status_label: STATUS_LABEL[c.status], created_at: c.created_at, last_activity_at: c.last_activity_at }));
}

async function myCase(user, id) {
  const c = await prisma.whistleCase.findFirst({ where: { id, org_id: user.org_id, reporter_membership_id: user.org_membership_id } });
  return c ? { case: await reporterView(c) } : { error: 'not_found' };
}

async function addMessage(c, { kind, membershipId, body, internal = false }, files = []) {
  const message = await prisma.whistleMessage.create({ data: { case_id: c.id, author_kind: kind, author_membership_id: membershipId || null, body, internal } });
  await saveFiles(c.id, message.id, files);
  const data = { last_activity_at: new Date() };
  if (kind === 'reporter' && c.status === 'closed') {
    Object.assign(data, { status: 'in_review', closed_at: null });
    await prisma.whistleEvent.create({ data: { case_id: c.id, action: 'reopened', detail: { to: 'in_review' }, actor_membership_id: membershipId || null } });
  }
  await prisma.whistleCase.update({ where: { id: c.id }, data });
  return message;
}

async function replyMine(user, id, body, files = []) {
  const c = await prisma.whistleCase.findFirst({ where: { id, org_id: user.org_id, reporter_membership_id: user.org_membership_id }, include: { category: true } });
  if (!c) return { error: 'not_found' };
  await addMessage(c, { kind: 'reporter', membershipId: user.org_membership_id, body }, files);
  await notifyUsers(user.org_id, await handlerUserIds(c, c.category, user.org_membership_id), { type: 'whistleblower_update', title: 'New reply on a complaint', body: `${c.case_no} has a new message`, caseId: c.id });
  return myCase(user, id);
}

// ---------- the anonymous reporter (no login, a tracking code) ----------

async function findAnonymous(caseNo, code) {
  const candidates = await prisma.whistleCase.findMany({ where: { case_no: caseNo, is_anonymous: true }, include: { category: true } });
  const hash = hashCode(code);
  return candidates.find((c) => sameHash(c.access_code_hash, hash)) || null;
}

async function trackAnonymous({ case_no, code }) {
  const c = await findAnonymous(case_no, code);
  return c ? { case: await reporterView(c) } : { error: 'not_found' };
}

async function replyAnonymous({ case_no, code, body }, files = []) {
  const c = await findAnonymous(case_no, code);
  if (!c) return { error: 'not_found' };
  await addMessage(c, { kind: 'reporter', membershipId: null, body }, files);
  await notifyUsers(c.org_id, await handlerUserIds(c, c.category), { type: 'whistleblower_update', title: 'New reply on a complaint', body: `${c.case_no} has a new message`, caseId: c.id });
  return { case: await reporterView(await prisma.whistleCase.findUnique({ where: { id: c.id } })) };
}

// ---------- handling (the handlers and admins) ----------

const isOverdue = (c, slaDays, now = new Date()) => c.status !== 'closed' && now - new Date(c.last_activity_at) > slaDays * DAY_MS;

async function listCases(user, q = {}) {
  const [v, settings] = await Promise.all([viewer(user), getSettings(user.org_id)]);
  const rows = await prisma.whistleCase.findMany({
    where: {
      org_id: user.org_id,
      ...(q.category_id ? { category_id: q.category_id } : {}),
      ...(q.status === 'open' ? { status: { in: OPEN_STATUSES } } : q.status ? { status: q.status } : {}),
      ...(q.assigned_to_me ? { assigned_membership_id: user.org_membership_id } : {}),
      ...(q.q ? { OR: [{ case_no: { contains: q.q, mode: 'insensitive' } }, { subject: { contains: q.q, mode: 'insensitive' } }] } : {}),
    },
    orderBy: { last_activity_at: 'desc' },
    include: { category: true },
  });
  const visible = rows.filter((c) => sees(v, c, c.category));
  const names = await memberNames(user.org_id, visible.flatMap((c) => [c.assigned_membership_id, c.reporter_membership_id]));
  const now = new Date();
  const out = visible
    .map((c) => ({
      id: c.id, case_no: c.case_no, subject: c.subject, category: c.category.name, restricted: c.category.restricted, status: c.status, status_label: STATUS_LABEL[c.status],
      is_anonymous: c.is_anonymous, reporter: c.is_anonymous ? null : names.get(c.reporter_membership_id) || '', assigned_to: names.get(c.assigned_membership_id) || null,
      created_at: c.created_at, last_activity_at: c.last_activity_at, overdue: isOverdue(c, settings.sla_days, now),
    }))
    .filter((c) => (q.overdue ? c.overdue : true));
  return { cases: out, sla_days: settings.sla_days };
}

async function loadVisible(user, id) {
  const c = await prisma.whistleCase.findFirst({ where: { id, org_id: user.org_id }, include: { category: true } });
  if (!c) return { error: 'not_found' };
  const v = await viewer(user);
  if (!sees(v, c, c.category)) return { error: 'not_found' }; // a case you may not see does not exist for you
  return { c, v };
}

async function getCase(user, id) {
  const found = await loadVisible(user, id);
  if (found.error) return found;
  const { c, v } = found;
  const [messages, events, attachments, settings, office, department] = await Promise.all([
    prisma.whistleMessage.findMany({ where: { case_id: c.id }, orderBy: { created_at: 'asc' } }),
    prisma.whistleEvent.findMany({ where: { case_id: c.id }, orderBy: { created_at: 'asc' } }),
    prisma.whistleAttachment.findMany({ where: { case_id: c.id }, orderBy: { created_at: 'asc' } }),
    getSettings(user.org_id),
    c.location_id ? prisma.location.findUnique({ where: { id: c.location_id }, select: { name: true } }) : null,
    c.department_id ? prisma.department.findUnique({ where: { id: c.department_id }, select: { name: true } }) : null,
  ]);
  const names = await memberNames(user.org_id, [c.reporter_membership_id, c.assigned_membership_id, ...idsOf(c.involved_membership_ids), ...messages.map((m) => m.author_membership_id), ...events.map((e) => e.actor_membership_id)]);
  return {
    case: {
      id: c.id, case_no: c.case_no, subject: c.subject, description: c.description, category: c.category.name, category_id: c.category_id, restricted: c.category.restricted,
      status: c.status, status_label: STATUS_LABEL[c.status], is_anonymous: c.is_anonymous, reporter: c.is_anonymous ? null : { id: c.reporter_membership_id, name: names.get(c.reporter_membership_id) || '' },
      incident_date: ymd(c.incident_date), office: office?.name || null, department: department?.name || null, people_involved: c.people_involved,
      involved: idsOf(c.involved_membership_ids).map((mid) => ({ id: mid, name: names.get(mid) || '' })),
      assigned: c.assigned_membership_id ? { id: c.assigned_membership_id, name: names.get(c.assigned_membership_id) || '' } : null,
      resolution: c.resolution, created_at: c.created_at, last_activity_at: c.last_activity_at, closed_at: c.closed_at, overdue: isOverdue(c, settings.sla_days),
      can_act: canAct(v, c, c.category),
      messages: messages.map((m) => ({ id: m.id, from: m.author_kind, internal: m.internal, author: m.author_kind === 'reporter' ? (c.is_anonymous ? 'Anonymous reporter' : names.get(m.author_membership_id) || 'Reporter') : names.get(m.author_membership_id) || 'Handler', body: m.body, created_at: m.created_at })),
      events: events.map((e) => ({ id: e.id, action: e.action, detail: e.detail, actor: e.actor_membership_id ? names.get(e.actor_membership_id) || '' : null, created_at: e.created_at })),
      attachments: attachments.map((a) => ({ id: a.id, file_name: a.file_name, mime_type: a.mime_type, size_bytes: a.size_bytes })),
    },
  };
}

async function handlerMessage(user, id, { body, internal }, files = []) {
  const found = await loadVisible(user, id);
  if (found.error) return found;
  const { c, v } = found;
  if (!canAct(v, c, c.category)) return { error: 'forbidden' };
  await addMessage(c, { kind: 'handler', membershipId: user.org_membership_id, body, internal: Boolean(internal) }, files);
  if (!internal && c.reporter_membership_id) {
    await notifyUsers(user.org_id, await userIdsOf(user.org_id, [c.reporter_membership_id]), { type: 'whistleblower_update', title: 'Update on your complaint', body: `${c.case_no} has a new message from the team`, caseId: c.id, audience: 'reporter' });
  }
  return getCase(user, id);
}

async function updateCase(user, id, patch) {
  const found = await loadVisible(user, id);
  if (found.error) return found;
  const { c, v } = found;
  if (!canAct(v, c, c.category)) return { error: 'forbidden' };
  const data = { last_activity_at: new Date() };
  const events = [];
  if (patch.assigned_membership_id !== undefined) {
    if (patch.assigned_membership_id && !(await prisma.orgMembership.count({ where: { org_id: user.org_id, id: patch.assigned_membership_id } }))) return { error: 'bad_handlers' };
    if (patch.assigned_membership_id && idsOf(c.involved_membership_ids).includes(patch.assigned_membership_id)) return { error: 'involved_handler' };
    data.assigned_membership_id = patch.assigned_membership_id;
    events.push({ action: 'assigned', detail: { to: patch.assigned_membership_id } });
  }
  if (patch.resolution !== undefined) data.resolution = patch.resolution || null;
  if (patch.status !== undefined && patch.status !== c.status) {
    const resolution = patch.resolution !== undefined ? patch.resolution : c.resolution;
    if (patch.status === 'closed' && !String(resolution || '').trim()) return { error: 'resolution_required' };
    data.status = patch.status;
    data.closed_at = patch.status === 'closed' ? new Date() : null;
    events.push({ action: patch.status === 'closed' ? 'resolved' : c.status === 'closed' ? 'reopened' : 'status', detail: { from: c.status, to: patch.status } });
  }
  await prisma.$transaction(async (tx) => {
    await tx.whistleCase.update({ where: { id: c.id }, data });
    for (const e of events) await tx.whistleEvent.create({ data: { case_id: c.id, ...e, actor_membership_id: user.org_membership_id } });
  });
  if (data.status && c.reporter_membership_id) {
    await notifyUsers(user.org_id, await userIdsOf(user.org_id, [c.reporter_membership_id]), { type: 'whistleblower_update', title: 'Update on your complaint', body: `${c.case_no} is now ${STATUS_LABEL[data.status]}`, caseId: c.id, audience: 'reporter' });
  }
  if (data.assigned_membership_id) {
    await notifyUsers(user.org_id, await userIdsOf(user.org_id, [data.assigned_membership_id]), { type: 'whistleblower_new', title: 'A complaint was assigned to you', body: `${c.case_no} - ${c.category.name}`, caseId: c.id });
  }
  return getCase(user, id);
}

/** Counts for the dashboard cards: the person's own open complaints, and (for handlers) what is waiting on them. */
async function summary(user) {
  const [settings, v] = await Promise.all([getSettings(user.org_id), viewer(user)]);
  const mine = await prisma.whistleCase.count({ where: { org_id: user.org_id, reporter_membership_id: user.org_membership_id, status: { not: 'closed' } } });
  const m = await meta(user);
  let handling = null;
  if (m.is_handler) {
    const { cases } = await listCases(user, { status: 'open' });
    handling = { new: cases.filter((c) => c.status === 'new').length, open: cases.length, overdue: cases.filter((c) => c.overdue).length };
  }
  return { enabled: settings.enabled, my_open: mine, handling, can_manage: v.canManage };
}

// ---------- attachments ----------

async function attachmentFile(user, id) {
  const a = await prisma.whistleAttachment.findUnique({ where: { id }, include: { whistle_case: { include: { category: true } } } });
  if (!a || a.whistle_case.org_id !== user.org_id) return { error: 'not_found' };
  const c = a.whistle_case;
  const v = await viewer(user);
  const own = c.reporter_membership_id && c.reporter_membership_id === user.org_membership_id;
  if (!own && !sees(v, c, c.category)) return { error: 'not_found' };
  const file = path.join(path.resolve(env.uploadDir), path.basename(a.stored_name));
  if (!fs.existsSync(file)) return { error: 'not_found' };
  return { file, name: a.file_name, mime: a.mime_type };
}

module.exports = {
  getSettings, updateSettings, listCategories, updateCategory, createCategory, ensureCategories,
  meta, createCase, myCases, myCase, replyMine, trackAnonymous, replyAnonymous,
  listCases, getCase, handlerMessage, updateCase, summary, attachmentFile,
  // exported for the tests
  sees, canAct, hashCode,
};
