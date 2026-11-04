// Leave mailing list: applying for leave emails the reporting manager and every address on the admin-edited list.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');
const leaveService = require('../src/modules/leave/leave.service');

beforeEach(async () => {
  await cleanDatabase();
  await prisma.emailOutbox.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

const d = (s) => new Date(`${s}T00:00:00.000Z`);
const api = (method, token, path) => authed(request(app)[method](`/api/v1${path}`), token);

async function person(org, { role = 'employee', managerId } = {}) {
  const user = await createUser({ role });
  const membership = await createOrgMembership(user.id, org.id, { role, joined_at: d('2026-01-01') });
  if (managerId) await prisma.orgMembership.update({ where: { id: membership.id }, data: { manager_id: managerId } });
  const { access_token } = await loginAs(user);
  return { user, membership, token: access_token };
}

async function seed({ withManager = true } = {}) {
  const org = await createOrg();
  const admin = await person(org, { role: 'admin' });
  const manager = await person(org);
  const emp = await person(org, { managerId: withManager ? manager.membership.id : undefined });
  await leaveService.listTypes(org.id);
  const CL = await prisma.leaveType.findFirst({ where: { org_id: org.id, name: 'Casual Leave' } });
  return { org, admin, manager, emp, CL };
}

const mails = () => prisma.emailOutbox.findMany({ where: { kind: 'leave_applied' }, orderBy: { to_email: 'asc' } });
const apply = (s, body = {}) => api('post', s.emp.token, '/leave/requests').send({ leave_type_id: s.CL.id, from_date: '2026-12-08', to_date: '2026-12-09', reason: 'Family function', ...body });

describe('leave mailing list', () => {
  test('only an admin can read or change the list; bad addresses are rejected, good ones are tidied', async () => {
    const s = await seed();
    expect((await api('get', s.emp.token, '/leave/mailing-list')).status).toBe(403);
    expect((await api('put', s.emp.token, '/leave/mailing-list').send({ emails: ['hr@example.com'] })).status).toBe(403);
    expect((await api('put', s.admin.token, '/leave/mailing-list').send({ emails: ['not-an-email'] })).status).toBe(422);

    const res = await api('put', s.admin.token, '/leave/mailing-list').send({ emails: [' HR@Example.com ', 'hr@example.com', 'inbox@example.com'] });
    expect(res.status).toBe(200);
    expect(res.body.data.emails).toEqual(['hr@example.com', 'inbox@example.com']);
    expect((await api('get', s.admin.token, '/leave/mailing-list')).body.data.emails).toEqual(['hr@example.com', 'inbox@example.com']);
    expect(await prisma.auditLog.count({ where: { org_id: s.org.id, action: 'leave_mailing_list_set' } })).toBe(1);
  });

  test('applying for leave emails the reporting manager and each address on the list, once each', async () => {
    const s = await seed();
    await api('put', s.admin.token, '/leave/mailing-list').send({ emails: ['hr@example.com', s.manager.user.email] });

    const res = await apply(s);
    expect(res.status).toBe(201);

    const sent = await mails();
    expect(sent.map((m) => m.to_email).sort()).toEqual([s.manager.user.email.toLowerCase(), 'hr@example.com'].sort());
    expect(sent[0].subject).toContain(s.emp.user.name);
    expect(sent[0].body_text).toContain('Casual Leave');
    expect(sent[0].body_text).toContain('Family function');
    expect(sent[0].org_id).toBe(s.org.id);
  });

  test('no reporting manager and an empty list: the request still goes through and nothing is queued', async () => {
    const s = await seed({ withManager: false });
    const res = await apply(s);
    expect(res.status).toBe(201);
    expect(await mails()).toHaveLength(0);
  });

  test('no reporting manager: the list alone is mailed; the applicant is never mailed about their own request', async () => {
    const s = await seed({ withManager: false });
    await api('put', s.admin.token, '/leave/mailing-list').send({ emails: ['hr@example.com', s.emp.user.email] });
    await apply(s);
    expect((await mails()).map((m) => m.to_email)).toEqual(['hr@example.com']);
  });

  test('a leave applied on the employee\'s behalf also mails; an auto-approved one does not', async () => {
    const s = await seed();
    await api('put', s.admin.token, '/leave/mailing-list').send({ emails: ['hr@example.com'] });
    const body = { org_membership_id: s.emp.membership.id, leave_type_id: s.CL.id, from_date: '2026-12-10', to_date: '2026-12-10', reason: 'Asked by phone' };

    expect((await api('post', s.admin.token, '/leave/requests/admin').send(body)).status).toBe(201);
    expect((await mails()).map((m) => m.to_email).sort()).toEqual([s.manager.user.email.toLowerCase(), 'hr@example.com'].sort());

    await prisma.emailOutbox.deleteMany({});
    expect((await api('post', s.admin.token, '/leave/requests/admin').send({ ...body, from_date: '2026-12-11', to_date: '2026-12-11', auto_approve: true })).status).toBe(201);
    expect(await mails()).toHaveLength(0);
  });

  test('a refused request (overlap) sends no mail', async () => {
    const s = await seed();
    expect((await apply(s)).status).toBe(201);
    await prisma.emailOutbox.deleteMany({});
    expect((await apply(s)).status).toBe(409);
    expect(await mails()).toHaveLength(0);
  });
});
