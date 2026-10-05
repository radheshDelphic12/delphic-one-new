const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../src/config/db');
const app = require('../src/app');

const PASSWORD = 'Password123!';

async function cleanDatabase() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE audit_logs, notifications, notification_preferences, stage_history, documents, comments, interview_round_interviewers, interview_rounds, submissions, requirement_assignments, requirement_seats, requirements, profiles, account_meeting_attendees, accounts, org_memberships, orgs, org_groups, users RESTART IDENTITY CASCADE'
  );
}

let counter = 0;
function unique(prefix) {
  counter += 1;
  return `${prefix}${Date.now()}${counter}`;
}

// The one org `createUser({ withOrg: true })` puts users in. Created lazily
// because cleanDatabase() truncates orgs between tests.
async function getTestOrg() {
  const existing = await prisma.org.findUnique({ where: { slug: 'test-org' } });
  return existing || createOrg({ name: 'Test Org', slug: 'test-org' });
}

// Users created with an explicit `withOrg: false` — never auto-enrolled.
const noOrgUsers = new Set();

// withOrg: true — give the user an active membership in the test org (a
// master workspace) right away. Default (undefined) — do it lazily in
// loginAs() if the user still has no membership row by then, as every
// production user has after the Phase 0 backfill; recruitment routes
// (requireMasterWorkspace) 403 without one. Lazy, so suites that build their
// own orgs and memberships never see an extra org. withOrg: false — a
// membership-less user (e.g. an offboarded employee), never enrolled.
async function createUser({ role, active = true, name, is_superadmin = false, withOrg }) {
  const email = `${unique('user')}@test.local`;
  const password_hash = await bcrypt.hash(PASSWORD, 4);
  const user = await prisma.user.create({
    data: { name: name || `${role} tester`, email, password_hash, role, active, is_superadmin },
  });
  if (withOrg === true) await createOrgMembership(user.id, (await getTestOrg()).id, { role });
  if (withOrg === false) noOrgUsers.add(user.id);
  return user;
}

async function loginAs(user) {
  if (!noOrgUsers.has(user.id) && !(await prisma.orgMembership.count({ where: { person_id: user.id } }))) {
    const { role } = await prisma.user.findUnique({ where: { id: user.id }, select: { role: true } });
    await createOrgMembership(user.id, (await getTestOrg()).id, { role });
  }
  const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
  if (res.status !== 200) {
    throw new Error(`login failed for ${user.email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

async function createActiveClientAccount(ownerId) {
  return prisma.account.create({
    data: { type: 'client', name: unique('Client '), stage: 'active', owner_id: ownerId, origin_owner_id: ownerId },
  });
}

async function createRequirement(salesToken, accountId, overrides = {}) {
  const res = await authed(request(app).post('/api/v1/requirements'), salesToken).send({
    account_id: accountId,
    title: unique('Req '),
    req_type: 'recruitment',
    seats_total: 1,
    ...overrides,
  });
  if (res.status !== 201) {
    throw new Error(`create requirement failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

async function createProfile(recruiterToken, overrides = {}) {
  const res = await authed(request(app).post('/api/v1/profiles'), recruiterToken).send({
    name: unique('Candidate '),
    total_experience_years: 5,
    primary_skills: ['Node.js'],
    source: 'direct',
    ...overrides,
  });
  if (res.status !== 201) {
    throw new Error(`create profile failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

function authed(req, token) {
  return req.set('Authorization', `Bearer ${token}`);
}

async function createInterviewRound(submissionId, overrides = {}) {
  const { interviewer_ids, ...fields } = overrides;
  const last = await prisma.interviewRound.findFirst({
    where: { submission_id: submissionId },
    orderBy: { round_number: 'desc' },
  });
  const round = await prisma.interviewRound.create({
    data: {
      submission_id: submissionId,
      round_number: last ? last.round_number + 1 : 1,
      round_type: 'internal_r1',
      scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      duration_minutes: 45,
      ...fields,
    },
  });
  if (Array.isArray(interviewer_ids) && interviewer_ids.length) {
    await prisma.interviewRoundInterviewer.createMany({
      data: interviewer_ids.map((user_id) => ({ interview_round_id: round.id, user_id })),
    });
  }
  return round;
}

// Multi-company ERP (Phase 1) test scaffolding.
async function createOrg(overrides = {}) {
  const orgGroup = overrides.org_group_id
    ? { id: overrides.org_group_id }
    : await prisma.orgGroup.create({ data: { name: unique('Group ') } });
  return prisma.org.create({
    data: {
      org_group_id: orgGroup.id,
      name: overrides.name || unique('Org '),
      slug: overrides.slug || unique('org-'),
      timezone: overrides.timezone || 'Asia/Kolkata',
      default_currency: overrides.default_currency || 'INR',
      status: overrides.status || 'active',
      // Test-only convenience default: most existing tests (accounts/requirements/
      // profiles/submissions/pipeline/reports) assume full recruitment access and
      // predate is_master_workspace. Pass `is_master_workspace: false` explicitly
      // to exercise the new gating itself.
      is_master_workspace: overrides.is_master_workspace ?? true,
      // Production default is true (admin approval is mandatory); the older suites approve as a
      // manager and expect that to be final, so they run with it off. The approval-chain tests
      // pass `timesheet_admin_approval: true`.
      timesheet_admin_approval: overrides.timesheet_admin_approval ?? false,
      // Same for the lock order (timesheets -> calculations -> financials): off for the older suites.
      enforce_lock_order: overrides.enforce_lock_order ?? false,
      ...(overrides.timesheet_manager_approval === undefined ? {} : { timesheet_manager_approval: overrides.timesheet_manager_approval }),
    },
  });
}

async function createOrgMembership(userId, orgId, overrides = {}) {
  return prisma.orgMembership.create({
    data: {
      person_id: userId,
      org_id: orgId,
      role: overrides.role || 'admin',
      employment_status: overrides.employment_status || 'active',
      employee_code: overrides.employee_code,
      department_id: overrides.department_id,
      ...(overrides.joined_at ? { joined_at: overrides.joined_at } : {}),
    },
  });
}

module.exports = {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createActiveClientAccount,
  createRequirement,
  createProfile,
  createInterviewRound,
  createOrg,
  createOrgMembership,
  authed,
  PASSWORD,
  unique,
};
