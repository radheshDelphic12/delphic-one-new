// Resignation requests. The employee submits (Settings > Account), the reporting manager records the retention call,
// HR approves with the last working day (or rejects), and starting the F&F is a separate HR action.
//
// The employee never changes employment_status. Approving runs the same membership update as the HR edit drawer
// (orgs.updateMembership), so the notice rules, payroll, attendance and the nightly exit (jobs/lwdExit) are untouched.
const prisma = require('../../config/db');
const { todayIst } = require('../../lib/istDate');
const { ensureFnf } = require('../../lib/fnf');
const { adminPower } = require('../../lib/access/guard');
const { levelOf, effectivePermissions } = require('../../lib/access/effective');
const orgsService = require('../orgs/orgs.service');

const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const OUTCOME_LABELS = { retained: 'retained, resignation closed', not_retained: 'approved and sent to HR' };
// still in progress: with the manager (submitted) or with HR (manager_approved)
const OPEN_STATUSES = ['submitted', 'manager_approved'];

// closing line of the e-mail copy of a resignation notification
const REVIEW_FOOTER = 'Open Delphic One > Settings > Resignations to review it.';
const OWN_FOOTER = 'Open Delphic One > Settings > Account to see the details.';

const ORG_SETTINGS_SELECT = { resignation_enabled: true, resignation_notice_days: true, resignation_manager_required: true };
const INCLUDE = {
  org_membership: { select: { id: true, employee_code: true, employment_status: true, joined_at: true, manager_id: true, hr_poc_id: true, notice_start_date: true, notice_end_date: true, person: { select: { id: true, name: true } } } },
};

async function nameMap(orgId, membershipIds) {
  const ids = [...new Set(membershipIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await prisma.orgMembership.findMany({ where: { id: { in: ids }, org_id: orgId }, select: { id: true, person: { select: { id: true, name: true } } } });
  return new Map(rows.map((r) => [r.id, { name: r.person?.name || null, user_id: r.person?.id || null }]));
}

function serialize(row, names = new Map()) {
  const m = row.org_membership;
  return {
    id: row.id,
    org_membership_id: row.org_membership_id,
    employee: m?.person?.name || null,
    employee_code: m?.employee_code || null,
    employment_status: m?.employment_status || null,
    manager_membership_id: row.manager_membership_id,
    manager: names.get(row.manager_membership_id)?.name || null,
    reason: row.reason,
    reason_category: row.reason_category,
    proposed_lwd: ymd(row.proposed_lwd),
    status: row.status,
    meeting_done: row.meeting_done,
    meeting_date: ymd(row.meeting_date),
    manager_notes: row.manager_notes,
    manager_outcome: row.manager_outcome,
    manager_updated_at: row.manager_updated_at,
    approved_lwd: ymd(row.approved_lwd),
    decided_at: row.decided_at,
    decision_remarks: row.decision_remarks,
    fnf_started_at: row.fnf_started_at,
    created_at: row.created_at,
  };
}

async function serializeRows(orgId, rows) {
  const names = await nameMap(orgId, rows.map((r) => r.manager_membership_id));
  return rows.map((r) => serialize(r, names));
}

async function loadOne(orgId, id) {
  return prisma.resignationRequest.findFirst({ where: { id, org_id: orgId }, include: INCLUDE });
}

async function present(orgId, id) {
  const row = await loadOne(orgId, id);
  return (await serializeRows(orgId, [row]))[0];
}

// ---- notifications (never block the change they report on: notify() swallows its own errors)
async function tell(type, actor, recipientUserIds, context) {
  const { notify } = require('../../lib/notifications');
  await notify(prisma, { type, actorId: actor?.id || null, recipientIds: recipientUserIds.filter(Boolean), context });
}

/**
 * Who counts as HR for a resignation: the company Admin and anyone holding People > Edit (through a permission set or an
 * own grant). They are told the moment a resignation is submitted, not only once the manager has passed it on.
 */
async function hrUserIds(orgId) {
  const rows = await prisma.orgMembership.findMany({
    where: {
      org_id: orgId,
      employment_status: { in: ['active', 'on_leave', 'notice_period'] },
      OR: [{ role: 'admin' }, { custom_role_id: { not: null } }, { permission_grants: { some: { key: 'people.update' } } }],
    },
    select: {
      role: true, is_leave_manager: true, person_id: true,
      person: { select: { is_superadmin: true, is_group_superadmin: true } },
      custom_role: { select: { permissions: true } },
      permission_grants: { select: { key: true, scope: true, effect: true } },
    },
  });
  return rows
    .filter((m) => {
      const level = levelOf(m.person, m.role);
      if (level !== 'employee') return true;
      const { permissions } = effectivePermissions({ level, setPermissions: m.custom_role?.permissions, grants: m.permission_grants, isLeaveManager: m.is_leave_manager });
      return Boolean(permissions['people.update']);
    })
    .map((m) => m.person_id);
}

// ---- settings (admin editable)

async function getSettings(orgId) {
  return prisma.org.findUnique({ where: { id: orgId }, select: ORG_SETTINGS_SELECT });
}

async function updateSettings(orgId, patch) {
  const data = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  return prisma.org.update({ where: { id: orgId }, data, select: ORG_SETTINGS_SELECT });
}

// ---- employee

async function create(orgId, user, body) {
  const settings = await getSettings(orgId);
  if (!settings?.resignation_enabled) return { error: 'disabled' };
  const member = await prisma.orgMembership.findFirst({
    where: { id: user.org_membership_id, org_id: orgId },
    select: { id: true, employment_status: true, joined_at: true, manager_id: true, hr_poc_id: true, person: { select: { id: true, name: true } } },
  });
  if (!member) return { error: 'membership_not_found' };
  if (member.employment_status === 'notice_period') return { error: 'already_on_notice' };
  if (!['active', 'on_leave'].includes(member.employment_status)) return { error: 'not_working' };
  if (body.proposed_lwd) {
    if (body.proposed_lwd < todayIst()) return { error: 'lwd_in_past' };
    if (member.joined_at && body.proposed_lwd < member.joined_at) return { error: 'lwd_before_joining' };
  }
  const open = await prisma.resignationRequest.findFirst({ where: { org_membership_id: member.id, status: { in: OPEN_STATUSES } }, select: { id: true } });
  if (open) return { error: 'duplicate_open' };

  const row = await prisma.resignationRequest.create({
    data: {
      org_id: orgId,
      org_membership_id: member.id,
      manager_membership_id: member.manager_id || null,
      reason: body.reason,
      reason_category: body.reason_category || null,
      proposed_lwd: body.proposed_lwd || null,
    },
  });
  const names = await nameMap(orgId, [member.manager_id]);
  const managerUser = names.get(member.manager_id)?.user_id;
  await tell('resignation_submitted', user, [managerUser, member.hr_poc_id, ...(await hrUserIds(orgId))], {
    orgId, resignationId: row.id, employeeName: member.person?.name, lwd: ymd(body.proposed_lwd), emailFooter: REVIEW_FOOTER,
  });
  return { request: await present(orgId, row.id) };
}

async function listMine(orgId, orgMembershipId) {
  const rows = await prisma.resignationRequest.findMany({ where: { org_id: orgId, org_membership_id: orgMembershipId }, orderBy: { created_at: 'desc' }, include: INCLUDE, take: 20 });
  return serializeRows(orgId, rows);
}

async function withdraw(orgId, id, user) {
  const row = await loadOne(orgId, id);
  if (!row || row.org_membership_id !== user.org_membership_id) return { error: 'not_found' };
  if (!OPEN_STATUSES.includes(row.status)) return { error: 'not_open' };
  await prisma.resignationRequest.update({ where: { id }, data: { status: 'withdrawn' } });
  const names = await nameMap(orgId, [row.manager_membership_id]);
  await tell('resignation_decided', user, [names.get(row.manager_membership_id)?.user_id], {
    orgId, resignationId: id, message: `${row.org_membership.person.name} withdrew the resignation.`, emailFooter: REVIEW_FOOTER,
  });
  return { request: await present(orgId, id) };
}

// ---- reporting manager

/** The manager's view: requests from their direct reports (newest first). */
async function listTeam(orgId, user) {
  if (!user.org_membership_id) return [];
  const rows = await prisma.resignationRequest.findMany({ where: { org_id: orgId, manager_membership_id: user.org_membership_id }, orderBy: { created_at: 'desc' }, include: INCLUDE, take: 100 });
  return serializeRows(orgId, rows);
}

async function managerReview(orgId, id, user, body) {
  const row = await loadOne(orgId, id);
  if (!row) return { error: 'not_found' };
  const isManager = Boolean(user.org_membership_id) && row.manager_membership_id === user.org_membership_id;
  // HR can fill it in for a manager who is away, or when the person has no reporting manager.
  if (!isManager && !adminPower(user, 'people.update')) return { error: 'not_manager' };
  if (row.status !== 'submitted') return { error: 'not_open' };
  const outcome = body.manager_outcome || null;
  if (outcome && !body.meeting_done) return { error: 'outcome_needs_meeting' };
  if (body.meeting_done && !body.meeting_date && !row.meeting_date) body = { ...body, meeting_date: todayIst() };

  const retained = outcome === 'retained';
  // the manager approving the resignation (after the meeting) sends it on to HR
  const toHr = outcome === 'not_retained';
  await prisma.resignationRequest.update({
    where: { id },
    data: {
      meeting_done: body.meeting_done,
      meeting_date: body.meeting_done ? (body.meeting_date || row.meeting_date) : null,
      manager_notes: body.manager_notes ?? row.manager_notes,
      manager_outcome: outcome,
      manager_updated_by: user.id,
      manager_updated_at: new Date(),
      ...(retained ? { status: 'retained', decided_by: user.id, decided_at: new Date() } : {}),
      ...(toHr ? { status: 'manager_approved' } : {}),
    },
  });
  const name = row.org_membership.person.name;
  const managerNames = await nameMap(orgId, [user.org_membership_id]);
  // HR (the person's HR POC) and the admins hear about the manager's decision, not about every saved note
  if (outcome) {
    await tell('resignation_manager_updated', user, [row.org_membership.hr_poc_id, ...(await hrUserIds(orgId))], {
      orgId, resignationId: id, employeeName: name, managerName: managerNames.get(user.org_membership_id)?.name,
      outcomeLabel: OUTCOME_LABELS[outcome], emailFooter: REVIEW_FOOTER,
    });
  }
  if (retained) {
    await tell('resignation_decided', user, [row.org_membership.person.id], {
      orgId, resignationId: id, message: 'Your manager has recorded that you are staying. The resignation is closed.', emailFooter: OWN_FOOTER,
    });
  }
  return { request: await present(orgId, id) };
}

// ---- HR

async function listAll(orgId, { status } = {}) {
  const rows = await prisma.resignationRequest.findMany({ where: { org_id: orgId, ...(status ? { status } : {}) }, orderBy: { created_at: 'desc' }, include: INCLUDE, take: 500 });
  // waiting for HR: forwarded by the manager, or never had a manager to go through
  const pending = await prisma.resignationRequest.count({ where: { org_id: orgId, OR: [{ status: 'manager_approved' }, { status: 'submitted', manager_membership_id: null }] } });
  return { items: await serializeRows(orgId, rows), pending };
}

async function approve(orgId, id, admin, body) {
  const row = await loadOne(orgId, id);
  if (!row) return { error: 'not_found' };
  if (!OPEN_STATUSES.includes(row.status)) return { error: 'not_open' };
  const settings = await getSettings(orgId);
  const withManager = row.status === 'submitted' && settings.resignation_manager_required && row.manager_membership_id;
  if (withManager && !body.skip_manager_step) return { error: 'manager_pending' };
  if (body.approved_lwd < todayIst()) return { error: 'lwd_in_past' };
  const membership = row.org_membership;
  if (membership.employment_status === 'notice_period' || membership.employment_status === 'terminated') return { error: 'already_on_notice' };

  const result = await orgsService.updateMembership(orgId, row.org_membership_id, {
    employment_status: 'notice_period',
    notice_start_date: todayIst(),
    notice_end_date: body.approved_lwd,
  }, admin.id);
  if (result.error) return { error: result.error };
  await prisma.resignationRequest.update({
    where: { id },
    data: { status: 'approved', approved_lwd: body.approved_lwd, decided_by: admin.id, decided_at: new Date(), decision_remarks: body.remarks || null },
  });
  await tell('resignation_decided', admin, [membership.person.id], {
    orgId, resignationId: id, message: `Your resignation is approved. Your last working day is ${ymd(body.approved_lwd)}.`, emailFooter: OWN_FOOTER,
  });
  return { request: await present(orgId, id) };
}

async function reject(orgId, id, admin, { remarks }) {
  const row = await loadOne(orgId, id);
  if (!row) return { error: 'not_found' };
  if (!OPEN_STATUSES.includes(row.status)) return { error: 'not_open' };
  await prisma.resignationRequest.update({ where: { id }, data: { status: 'rejected', decided_by: admin.id, decided_at: new Date(), decision_remarks: remarks } });
  await tell('resignation_decided', admin, [row.org_membership.person.id], {
    orgId, resignationId: id, message: `Your resignation was not accepted. ${remarks}`, emailFooter: OWN_FOOTER,
  });
  return { request: await present(orgId, id) };
}

/** Moves an approved resignation into the F&F process, with the approved last working day as its start. */
async function startFnf(orgId, id, admin) {
  const row = await loadOne(orgId, id);
  if (!row) return { error: 'not_found' };
  if (row.status !== 'approved') return { error: 'not_approved' };
  if (row.fnf_started_at) return { error: 'fnf_already_started' };
  await ensureFnf(prisma, orgId, row.org_membership_id, row.approved_lwd);
  await prisma.resignationRequest.update({ where: { id }, data: { fnf_started_at: new Date(), fnf_started_by: admin.id } });
  await tell('resignation_decided', admin, [row.org_membership.person.id], {
    orgId, resignationId: id, message: 'Your full and final settlement process has started.', emailFooter: OWN_FOOTER,
  });
  return { request: await present(orgId, id) };
}

module.exports = { getSettings, updateSettings, create, listMine, withdraw, listTeam, managerReview, listAll, approve, reject, startFnf };
