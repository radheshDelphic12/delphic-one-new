// Phase 3: the group-wide change log, the Logs API, project history, and restorable (soft) deletes.
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed, unique } = require('./helpers');
const orgContext = require('../src/lib/orgContext');

let orgA; let orgB; let superToken; let adminAToken; let adminA; let superUser;

beforeEach(async () => {
  await cleanDatabase();
  orgA = await createOrg({ name: 'Delphic Global', slug: 'delphic' });
  orgB = await createOrg({ name: 'Gulati Industries', slug: 'gulati', org_group_id: orgA.org_group_id });
  superUser = await createUser({ role: 'admin', name: 'Paras Super', withOrg: false });
  await prisma.user.update({ where: { id: superUser.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: superUser.id, org_group_id: orgA.org_group_id } });
  await createOrgMembership(superUser.id, orgA.id, { role: 'admin' });
  ({ access_token: superToken } = await loginAs(superUser));
  adminA = await createUser({ role: 'admin', name: 'Admin A', withOrg: false });
  await createOrgMembership(adminA.id, orgA.id, { role: 'admin' });
  ({ access_token: adminAToken } = await loginAs(adminA));
});

afterAll(async () => {
  await prisma.$disconnect();
});

// run a write as a signed-in person, the way a request would
// (async + await: a Prisma call is lazy and must actually run inside the context)
const asUser = (user, org, fn) => orgContext.run({ org_id: org.id, user_id: user.id, user_name: user.name }, async () => await fn());
const logs = (where = {}) => prisma.changeLog.findMany({ where, orderBy: { created_at: 'asc' } });
const mkAccount = (data = {}) => prisma.account.create({ data: { type: 'client', name: unique('Client '), stage: 'active', owner_id: adminA.id, org_id: orgA.id, ...data } });

describe('what is recorded', () => {
  test('a create, an update (old -> new, only what changed), a soft delete and a restore, each with who and when', async () => {
    const acc = await asUser(adminA, orgA, () => mkAccount({ name: 'Alpha Corp' }));
    await asUser(adminA, orgA, () => prisma.account.update({ where: { id: acc.id }, data: { name: 'Alpha Corporation', industry: 'IT' } }));
    await asUser(adminA, orgA, () => prisma.account.update({ where: { id: acc.id }, data: { deleted_at: new Date(), deleted_by: adminA.id, delete_reason: 'dup' } }));
    await asUser(superUser, orgA, () => prisma.account.update({ where: { id: acc.id }, data: { deleted_at: null, deleted_by: null, delete_reason: null } }));

    const rows = await logs({ entity_id: acc.id });
    expect(rows.map((r) => r.action)).toEqual(['create', 'update', 'soft_delete', 'restore']);
    expect(rows[0]).toMatchObject({ entity_type: 'account', entity_label: 'Alpha Corp', actor_id: adminA.id, actor_name: 'Admin A', org_id: orgA.id });
    expect(rows[1].changed_fields.sort()).toEqual(['industry', 'name']);
    expect(rows[1].old_values).toMatchObject({ name: 'Alpha Corp', industry: null });
    expect(rows[1].new_values).toMatchObject({ name: 'Alpha Corporation', industry: 'IT' });
    expect(rows[3].actor_name).toBe('Paras Super');
  });

  test('a real delete keeps the deleted values; a bulk delete lists what it removed; secrets are hidden', async () => {
    const a = await asUser(adminA, orgA, () => mkAccount({ name: 'Doomed One' }));
    await asUser(adminA, orgA, () => prisma.account.delete({ where: { id: a.id } }));
    const del = (await logs({ entity_id: a.id })).find((r) => r.action === 'delete');
    expect(del.old_values).toMatchObject({ name: 'Doomed One' });

    await asUser(adminA, orgA, () => mkAccount({ name: 'Bulk 1' }));
    await asUser(adminA, orgA, () => mkAccount({ name: 'Bulk 2' }));
    await asUser(adminA, orgA, () => prisma.account.deleteMany({ where: { name: { startsWith: 'Bulk' } } }));
    const bulk = (await logs({ action: 'bulk_delete' }))[0];
    expect(bulk.new_values.count).toBe(2);
    expect(bulk.old_values.rows.map((r) => r.label).sort()).toEqual(['Bulk 1', 'Bulk 2']);

    const emp = await createUser({ role: 'employee' });
    await asUser(adminA, orgA, () => prisma.orgMembership.create({ data: { person_id: emp.id, org_id: orgA.id, role: 'employee', bank_account_number: '1234567890', bank_name: 'HDFC' } }));
    const secret = (await logs({ entity_type: 'employee' })).find((r) => r.action === 'create');
    expect(JSON.stringify(secret.new_values)).not.toContain('1234567890');
    expect(secret.new_values.bank_account_number).toBe('[hidden]');
  });

  test('nothing is logged outside a request or a named job (seeds, scripts), and a no-op update leaves no row', async () => {
    const acc = await mkAccount({ name: 'Quiet' });
    await prisma.account.update({ where: { id: acc.id }, data: { industry: 'x' } });
    expect(await prisma.changeLog.count()).toBe(0);
    await asUser(adminA, orgA, () => prisma.account.update({ where: { id: acc.id }, data: { industry: 'x' } })); // same value
    expect(await prisma.changeLog.count()).toBe(0);
    await orgContext.runAs('Nightly job', async () => await prisma.account.update({ where: { id: acc.id }, data: { industry: 'y' } }));
    expect((await logs())[0]).toMatchObject({ actor_name: 'Nightly job', actor_id: null });
  });

  test('a request through the API is logged with the signed-in person', async () => {
    const acc = await mkAccount({ name: 'Via API' });
    const res = await authed(request(app).patch(`/api/v1/accounts/${acc.id}`), adminAToken).send({ industry: 'Fintech' });
    expect(res.status).toBe(200);
    const row = (await logs({ entity_id: acc.id })).find((r) => r.action === 'update');
    expect(row).toMatchObject({ actor_id: adminA.id, actor_name: 'Admin A' });
    expect(row.new_values).toMatchObject({ industry: 'Fintech' });
  });
});

describe('Group Dashboard > Logs', () => {
  test('only the group super admin; filters by company, entity type, person, action and date', async () => {
    const accA = await asUser(adminA, orgA, () => mkAccount({ name: 'In A' }));
    const adminB = await createUser({ role: 'admin', name: 'Admin B', withOrg: false });
    await createOrgMembership(adminB.id, orgB.id, { role: 'admin' });
    await asUser(adminB, orgB, () => prisma.account.create({ data: { type: 'client', name: 'In B', stage: 'active', owner_id: adminB.id, org_id: orgB.id } }));
    await asUser(adminA, orgA, () => prisma.account.update({ where: { id: accA.id }, data: { industry: 'IT' } }));

    expect((await authed(request(app).get('/api/v1/change-log'), adminAToken)).status).toBe(403);
    const all = await authed(request(app).get('/api/v1/change-log'), superToken);
    expect(all.status).toBe(200);
    expect(all.body.data.length).toBeGreaterThanOrEqual(3);
    expect(all.body.facets.companies.map((c) => c.name).sort()).toEqual(['Delphic Global', 'Gulati Industries']);

    const q = (query) => authed(request(app).get('/api/v1/change-log').query(query), superToken).then((r) => r.body.data);
    expect((await q({ org_id: orgB.id })).map((r) => r.entity_label)).toEqual(['In B']);
    expect((await q({ actor_id: adminA.id, action: 'update' })).map((r) => r.entity_label)).toEqual(['In A']);
    expect((await q({ entity_type: 'account' })).length).toBe(3);
    expect((await q({ entity_type: 'employee' })).length).toBe(0);
    const today = new Date().toISOString().slice(0, 10);
    expect((await q({ from: today, to: today })).length).toBe(3);
    expect((await q({ from: '2020-01-01', to: '2020-01-02' })).length).toBe(0);
    expect((await q({ org_id: orgB.id, actor_id: adminA.id })).length).toBe(0);
  });
});

describe('project history (Finance > Projects)', () => {
  test('a project\'s own changes and its allocations / finance entries show together; another company cannot read it', async () => {
    const client = await mkAccount({ name: 'Client X' });
    const project = await asUser(adminA, orgA, () => mkAccount({ name: 'Project X', is_project: true, client_account_id: client.id, project_name: 'Project X' }));
    await asUser(adminA, orgA, () => prisma.account.update({ where: { id: project.id }, data: { project_name: 'Project X v2' } }));
    const emp = await createUser({ role: 'employee' });
    const m = await createOrgMembership(emp.id, orgA.id, { role: 'employee' });
    await asUser(adminA, orgA, () => prisma.projectMemberAssignment.create({ data: { org_id: orgA.id, account_id: project.id, org_membership_id: m.id, resource_type: 'company_employee', created_by: adminA.id } }));

    const res = await authed(request(app).get('/api/v1/change-log/entity').query({ entity_type: 'account', entity_id: project.id }), adminAToken);
    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => `${r.entity_type}:${r.action}`).sort()).toEqual(['account:create', 'account:update', 'project_allocation:create']);

    const adminB = await createUser({ role: 'admin', withOrg: false });
    await createOrgMembership(adminB.id, orgB.id, { role: 'admin' });
    const other = (await loginAs(adminB)).access_token;
    expect((await authed(request(app).get('/api/v1/change-log/entity').query({ entity_type: 'account', entity_id: project.id }), other)).body.data).toHaveLength(0);
    expect((await authed(request(app).get('/api/v1/change-log/entity').query({ entity_type: 'account', entity_id: project.id }), (await loginAs(await createUser({ role: 'employee' }))).access_token)).status).toBe(403);
  });
});

describe('soft delete and restore', () => {
  test('an employee is deleted by an admin with a reason, disappears and cannot sign in, and the group super admin restores them', async () => {
    const empUser = await createUser({ role: 'employee', name: 'Gone Soon' });
    const m = await createOrgMembership(empUser.id, orgA.id, { role: 'employee' });
    const empToken = (await loginAs(empUser)).access_token;
    const del = (body) => authed(request(app).delete(`/api/v1/orgs/memberships/${m.id}`), adminAToken).send(body);

    expect((await del({})).status).toBe(422); // a reason is required
    expect((await del({ reason: 'created by mistake' })).status).toBe(200);
    expect(await prisma.orgMembership.findFirst({ where: { id: m.id } })).toBeNull(); // hidden from every ordinary read
    expect(await prisma.orgMembership.findFirst({ where: { id: m.id, deleted_at: { not: null } } })).toMatchObject({ delete_reason: 'created by mistake', deleted_by: adminA.id });
    expect((await authed(request(app).get('/api/v1/attendance/me'), empToken)).status).toBe(403); // no longer an active member
    expect((await authed(request(app).get('/api/v1/orgs/memberships'), adminAToken)).body.data.map((r) => r.id)).not.toContain(m.id);

    const deleted = (await authed(request(app).get('/api/v1/change-log/deleted'), superToken)).body.data;
    expect(deleted.find((d) => d.entity_id === m.id)).toMatchObject({ entity_type: 'employee', company: 'Delphic Global' });
    const back = await authed(request(app).post('/api/v1/change-log/restore'), superToken).send({ entity_type: 'employee', entity_id: m.id, reason: 'it was a mistake after all' });
    expect(back.status).toBe(200);
    expect(await prisma.orgMembership.findFirst({ where: { id: m.id } })).toBeTruthy();
    const trail = (await logs({ entity_id: m.id })).map((r) => r.action);
    expect(trail).toEqual(expect.arrayContaining(['soft_delete', 'restore']));
  });

  test('locked attendance or a processed payroll blocks deleting an employee: reopen first', async () => {
    const empUser = await createUser({ role: 'employee' });
    const m = await createOrgMembership(empUser.id, orgA.id, { role: 'employee' });
    await prisma.timesheetMonthLock.create({ data: { org_id: orgA.id, org_membership_id: m.id, period_month: 9, period_year: 2026, locked_by: adminA.id } });
    const res = await authed(request(app).delete(`/api/v1/orgs/memberships/${m.id}`), adminAToken).send({ reason: 'cleanup' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/locked attendance/i);
    expect(await prisma.orgMembership.findFirst({ where: { id: m.id } })).toBeTruthy();

    await prisma.timesheetMonthLock.deleteMany({});
    const run = await prisma.payrollRun.create({ data: { org_id: orgA.id, period_month: 9, period_year: 2026, status: 'processed' } });
    await prisma.payslip.create({ data: { org_id: orgA.id, payroll_run_id: run.id, org_membership_id: m.id, gross: 100, deductions: 0, net: 100, breakdown: {} } });
    const again = await authed(request(app).delete(`/api/v1/orgs/memberships/${m.id}`), adminAToken).send({ reason: 'cleanup' });
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/payroll/i);
  });

  test('a project deleted as a project is restorable; a catalogue account cannot be deleted as a project', async () => {
    const client = await mkAccount({ name: 'Client Y' });
    const project = await mkAccount({ name: 'Project Y', is_project: true, client_account_id: client.id });
    const admin = require('../src/modules/admin/admin.service');
    expect(await admin.softDeleteRecord('project', client.id, 'x', adminA)).toEqual({ error: 'not_a_project' });
    expect(await admin.softDeleteRecord('account', project.id, 'x', adminA)).toEqual({ error: 'is_project' });
    const done = await admin.softDeleteRecord('project', project.id, 'duplicate of another project', adminA);
    expect(done.result.dependency).toMatchObject({ allocations: 0, invoices: 0 });
    expect(await prisma.account.findFirst({ where: { id: project.id } })).toBeNull();
    expect((await admin.restore('project', project.id, 'restore it', adminA)).result.entity_id).toBe(project.id);
    expect(await prisma.account.findFirst({ where: { id: project.id } })).toBeTruthy();
  });

  test('a deleted expense claim and a deleted invoice are kept and can come back; a paid invoice cannot be deleted', async () => {
    const empUser = await createUser({ role: 'employee' });
    const m = await createOrgMembership(empUser.id, orgA.id, { role: 'employee' });
    const claim = await prisma.expenseClaim.create({ data: { org_id: orgA.id, org_membership_id: m.id, amount: 100, category: 'travel', description: 'cab', status: 'pending', expense_date: new Date('2026-10-01') } }).catch(() => null);
    const admin = require('../src/modules/admin/admin.service');
    if (claim) {
      expect((await admin.softDeleteRecord('expense_claim', claim.id, 'wrong claim', adminA)).result).toBeTruthy();
      expect(await prisma.expenseClaim.findFirst({ where: { id: claim.id } })).toBeNull();
      expect((await admin.restore('expense_claim', claim.id, 'back', adminA)).result).toBeTruthy();
    }
    const client = await mkAccount({ name: 'Client Z' });
    const base = { org_id: orgA.id, client_account_id: client.id, period_month: 9, period_year: 2026, amount: 500, line_items: [], created_by: adminA.id };
    const draft = await prisma.clientInvoice.create({ data: { ...base, invoice_number: 'INV-1', status: 'draft' } });
    const paid = await prisma.clientInvoice.create({ data: { ...base, period_month: 8, invoice_number: 'INV-2', status: 'paid' } });
    expect(await admin.softDeleteRecord('invoice', paid.id, 'oops', adminA)).toEqual({ error: 'locked_invoice_paid' });
    expect((await admin.softDeleteRecord('invoice', draft.id, 'duplicate', adminA)).result).toBeTruthy();
    const gone = await prisma.clientInvoice.findFirst({ where: { id: draft.id, deleted_at: { not: null } } });
    expect(gone.invoice_number).toContain('~deleted~'); // the number is free again
    await prisma.clientInvoice.create({ data: { ...base, period_month: 7, invoice_number: 'INV-1', status: 'draft' } }); // reused
    expect(await admin.restore('invoice', draft.id, 'back', adminA)).toEqual({ error: 'invoice_number_taken' });
  });
});
