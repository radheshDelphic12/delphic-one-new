// Recycle bin: a delete a person makes in the app is archived and a superadmin can restore it (config/recycleBin.js).
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed, unique } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
  await prisma.deletedRecord.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: unique('delphic-') });
  const admin = await createUser({ role: 'admin', is_superadmin: true });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const token = (await loginAs(admin)).access_token;
  const plain = await createUser({ role: 'admin' });
  await createOrgMembership(plain.id, org.id, { role: 'admin' });
  const plainToken = (await loginAs(plain)).access_token;
  await prisma.calendar.create({ data: { org_id: org.id, name: 'Ahmedabad Calendar', is_default: true } });
  const user = await createUser({ role: 'employee', name: 'Vipul' });
  const membership = await createOrgMembership(user.id, org.id, { role: 'employee', joined_at: new Date('2026-01-01') });
  const project = await prisma.account.create({
    data: { org_id: org.id, name: 'COA automation', type: 'client', stage: 'active', is_project: true, service_category: 'managed_services', owner_id: admin.id, agreement_start_date: new Date('2026-01-01') },
  });
  return { org, token, plainToken, membership, project };
}

describe('Recycle bin', () => {
  test('a deleted timesheet entry is kept with who / why, listed for the superadmin, and restored with its old id', async () => {
    const ctx = await seed();
    const entry = await prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: ctx.membership.id, account_id: ctx.project.id, date: new Date('2026-10-19'), hours: 8, billable: true, status: 'approved' } });

    const del = await authed(request(app).delete(`/api/v1/timesheets/entries/${entry.id}`), ctx.token).send({ reason: 'Logged on the wrong day' });
    expect(del.status).toBe(200);
    expect(await prisma.timesheetEntry.count({ where: { id: entry.id } })).toBe(0);

    const kept = await prisma.deletedRecord.findMany({ where: { model: 'TimesheetEntry', row_id: entry.id } });
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ reason: 'Logged on the wrong day', org_id: ctx.org.id });
    expect(kept[0].deleted_by).toBeTruthy();

    // only a superadmin sees and restores it
    expect((await authed(request(app).get('/api/v1/admin/recycle-bin'), ctx.plainToken)).status).toBe(403);
    const list = await authed(request(app).get('/api/v1/admin/recycle-bin'), ctx.token);
    expect(list.status).toBe(200);
    expect(list.body.data.rows).toHaveLength(1);
    expect(list.body.data.rows[0]).toMatchObject({ model: 'TimesheetEntry', type_label: 'Timesheet entry' });

    const restored = await authed(request(app).post(`/api/v1/admin/recycle-bin/${kept[0].id}/restore`), ctx.token);
    expect(restored.status).toBe(200);
    const back = await prisma.timesheetEntry.findUnique({ where: { id: entry.id } });
    expect(back).toMatchObject({ account_id: ctx.project.id, status: 'approved' });
    expect(Number(back.hours)).toBe(8);
    expect(back.date.toISOString().slice(0, 10)).toBe('2026-10-19');

    // not restorable twice, and gone from the open list
    expect((await authed(request(app).post(`/api/v1/admin/recycle-bin/${kept[0].id}/restore`), ctx.token)).status).toBe(409);
    expect((await authed(request(app).get('/api/v1/admin/recycle-bin'), ctx.token)).body.data.rows).toHaveLength(0);
  });

  test('a restore that would clash with a live record is refused with a clear message', async () => {
    const ctx = await seed();
    const entry = await prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: ctx.membership.id, account_id: ctx.project.id, date: new Date('2026-10-19'), hours: 8, billable: true, status: 'approved' } });
    await authed(request(app).delete(`/api/v1/timesheets/entries/${entry.id}`), ctx.token).send({ reason: 'Wrong day' });
    const kept = await prisma.deletedRecord.findFirst({ where: { row_id: entry.id } });
    // the same row exists again (for example it was re-created): restoring it would duplicate it
    await prisma.timesheetEntry.create({ data: { id: entry.id, org_id: ctx.org.id, org_membership_id: ctx.membership.id, account_id: ctx.project.id, date: new Date('2026-10-19'), hours: 8, billable: true, status: 'approved' } });
    const res = await authed(request(app).post(`/api/v1/admin/recycle-bin/${kept.id}/restore`), ctx.token);
    expect(res.status).toBe(409);
    expect((await prisma.deletedRecord.findUnique({ where: { id: kept.id } })).restored_at).toBeNull();
  });
});
