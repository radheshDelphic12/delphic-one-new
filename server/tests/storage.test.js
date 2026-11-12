/** Group Dashboard > Settings > Storage: disk, uploaded files by kind and database size; group superadmin only. */
const fs = require('fs');
const path = require('path');
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');
const env = require('../src/config/env');
const storage = require('../src/modules/storage/storage.service');

let superToken; let adminToken;
const made = [];

beforeEach(async () => {
  await cleanDatabase();
  const org = await createOrg({ name: 'Delphic Global', slug: 'delphic' });
  const su = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: su.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: org.org_group_id } });
  await createOrgMembership(su.id, org.id, { role: 'admin' });
  ({ access_token: superToken } = await loginAs(su));
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  ({ access_token: adminToken } = await loginAs(admin));
});
afterAll(async () => {
  for (const f of made) { try { fs.rmSync(f, { recursive: true, force: true }); } catch { /* ignore */ } }
  await prisma.$disconnect();
});

describe('storage', () => {
  test('names a stored file by what it belongs to', () => {
    const s = path.sep;
    expect(storage.categoryOf('wallet-1.pdf')).toBe('Wallet attachments');
    expect(storage.categoryOf('deployment-9.png')).toBe('Deployment bills');
    expect(storage.categoryOf('1791-22.docx')).toBe('Documents (CVs, agreements, invoices)');
    expect(storage.categoryOf(`ai-interviews${s}abc.webm`)).toBe('AI interview recordings');
    expect(storage.categoryOf('x.bin')).toBe('Other files');
  });

  test('the group superadmin sees disk, uploads by kind and the database; an admin does not', async () => {
    fs.mkdirSync(env.uploadDir, { recursive: true });
    const probe = path.join(env.uploadDir, `wallet-storage-test-${Date.now()}.pdf`);
    fs.writeFileSync(probe, Buffer.alloc(2048));
    made.push(probe);
    const res = await authed(request(app).get('/api/v1/storage'), superToken).query({ fresh: 1 });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.disk.available).toBe(true);
    expect(d.disk.free_bytes).toBeGreaterThan(0);
    expect(['ok', 'warning', 'critical']).toContain(d.disk.level);
    expect(d.uploads.by_category.find((c) => c.category === 'Wallet attachments').bytes).toBeGreaterThanOrEqual(2048);
    expect(d.database.total_bytes).toBeGreaterThan(0);
    expect(d.database.largest_tables.length).toBeGreaterThan(0);
    expect((await authed(request(app).get('/api/v1/storage'), adminToken)).status).toBe(403);
  });
});
