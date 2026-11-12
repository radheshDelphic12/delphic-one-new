/**
 * Group Dashboard > Companies & Stakes: the register of the group's businesses (current and planned) and who holds how much of each.
 */
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');

let group;
let alpha;
let beta;
let outsider; // a company of ANOTHER holding group
let superToken;
let adminToken;
const base = '/api/v1/group-companies';

beforeEach(async () => {
  await cleanDatabase();
  alpha = await createOrg({ name: 'Alpha Global' });
  group = { id: alpha.org_group_id };
  await prisma.orgGroup.update({ where: { id: group.id }, data: { name: 'Gulati Industries' } });
  beta = await createOrg({ name: 'Beta Trading', org_group_id: group.id });
  outsider = await createOrg({ name: 'Other Group Co' });

  const superUser = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: superUser.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: superUser.id, org_group_id: group.id } });
  await createOrgMembership(superUser.id, alpha.id, { role: 'admin' });
  ({ access_token: superToken } = await loginAs(superUser));

  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, alpha.id, { role: 'admin' });
  ({ access_token: adminToken } = await loginAs(admin));
});

afterAll(async () => {
  await prisma.$disconnect();
});

const get = (token = superToken) => authed(request(app).get(base), token);
const post = (body, token = superToken) => authed(request(app).post(base), token).send(body);
const patch = (id, body) => authed(request(app).patch(`${base}/${id}`), superToken).send(body);
const stakes = (id, list) => authed(request(app).put(`${base}/${id}/stakes`), superToken).send({ stakes: list });
const byName = (res, name) => res.body.data.companies.find((c) => c.name === name);

describe('group companies register', () => {
  test('every workspace of the group is in the register (not another group), a coming-soon one is Planning', async () => {
    await prisma.org.update({ where: { id: beta.id }, data: { enabled_modules: ['coming_soon'] } });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.data.companies.map((c) => c.name).sort()).toEqual(['Alpha Global', 'Beta Trading']);
    expect(byName(res, 'Alpha Global')).toMatchObject({ is_current: true, status: 'operational', org_id: alpha.id, holders: [], total_pct: 0 });
    expect(byName(res, 'Beta Trading')).toMatchObject({ status: 'planning', coming_soon: true });
    expect(res.body.data.summary).toMatchObject({ total: 2, current: 2, off_platform: 0, stakes_missing: 2 });
    // opening it again does not duplicate; a new workspace shows up with no code change
    await createOrg({ name: 'Gamma Infra', org_group_id: group.id });
    const again = await get();
    expect(again.body.data.companies.map((c) => c.name)).toContain('Gamma Infra');
    expect(await prisma.groupCompany.count({ where: { org_group_id: group.id } })).toBe(3);
  });

  test('a hand-made business with the same name as a workspace (case, spacing, "Pvt Ltd", "&") is folded into it and keeps its holders', async () => {
    await get(); // workspace rows exist now
    const hand = await post({ name: 'beta  trading  Pvt. Ltd.', tagline: 'Hand made' });
    expect(hand.status).toBe(201);
    expect((await stakes(hand.body.data.id, [{ holder_kind: 'group', pct: 100 }])).status).toBe(200);
    const res = await get();
    const rows = res.body.data.companies.filter((c) => /beta/i.test(c.name));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Beta Trading', org_id: beta.id, tagline: 'Hand made', total_pct: 100 });
    expect(rows[0].holders).toHaveLength(1);
    expect(await prisma.groupCompany.count({ where: { org_group_id: group.id } })).toBe(2);
  });

  test('another holding group of the register can be the holder of a business (e.g. the main group holding a separate-group workspace)', async () => {
    const superUser = await prisma.user.findFirst({ where: { is_group_superadmin: true } });
    await prisma.orgGroupMembership.create({ data: { user_id: superUser.id, org_group_id: outsider.org_group_id } });
    await prisma.orgGroup.update({ where: { id: outsider.org_group_id }, data: { name: 'Separate Group' } });
    const res = await get();
    const row = byName(res, 'Other Group Co');
    // held by the main group although the workspace sits in its own group
    expect((await stakes(row.id, [{ holder_kind: 'group', holder_group_id: group.id, pct: 60 }, { holder_kind: 'group', pct: 40 }])).status).toBe(200);
    const after = byName(await get(), 'Other Group Co');
    expect(after.holders.map((h) => [h.holder_label, h.pct]).sort()).toEqual([['Gulati Industries', 60], ['Separate Group', 40]]);
    // the same group twice is refused; a group outside the caller's scope is refused
    expect((await stakes(row.id, [{ holder_kind: 'group', pct: 10 }, { holder_kind: 'group', holder_group_id: outsider.org_group_id, pct: 10 }])).status).toBe(400);
    expect((await stakes(row.id, [{ holder_kind: 'group', holder_group_id: '00000000-0000-4000-8000-000000000000', pct: 10 }])).status).toBe(400);
  });

  test('add a planned / off-platform business, edit its details, sector roll-up; a workspace keeps its name', async () => {
    await get();
    const add = await post({ name: 'Vidhyasri Mapsystems Ed Tech', short_code: 'VMET', sector: 'Education & Knowledge Services', tagline: 'Maps for schools', foundation_date: '2024-03-01', status: 'operational' });
    expect(add.status).toBe(201);
    expect(add.body.data).toMatchObject({ name: 'Vidhyasri Mapsystems Ed Tech', status: 'operational', org_id: null });
    const planned = await post({ name: 'Future Foods' });
    expect(planned.body.data.status).toBe('planning'); // planned by default

    // duplicates and workspace names are refused
    expect((await post({ name: 'future foods' })).status).toBe(409);
    expect((await post({ name: 'Beta Trading' })).status).toBe(409);

    const edit = await patch(planned.body.data.id, { sector: 'Food & Agri', status: 'future', tagline: 'Fresh, local', foundation_date: '2027-01-01', short_code: 'FF' });
    expect(edit.status).toBe(200);
    const res = await get();
    expect(byName(res, 'Future Foods')).toMatchObject({ sector: 'Food & Agri', status: 'future', foundation_date: '2027-01-01', short_code: 'FF', is_current: false });
    expect(res.body.data.summary.by_status).toMatchObject({ operational: 3, planning: 0, future: 1 });
    expect(res.body.data.sectors.find((s) => s.sector === 'Food & Agri').count).toBe(1);
    expect(res.body.data.sector_options).toEqual(['Education & Knowledge Services', 'Food & Agri']);

    // a workspace's other fields are editable, its name is not (that lives in Settings)
    const alphaRow = byName(res, 'Alpha Global');
    expect((await patch(alphaRow.id, { sector: 'Technology & Digital', status: 'operational' })).status).toBe(200);
    expect((await patch(alphaRow.id, { name: 'Renamed' })).status).toBe(409);
    expect((await authed(request(app).delete(`${base}/${alphaRow.id}`), superToken)).status).toBe(409);
    // a planned business can be removed
    expect((await authed(request(app).delete(`${base}/${planned.body.data.id}`), superToken)).status).toBe(200);
    expect(byName(await get(), 'Future Foods')).toBeUndefined();
  });

  test('a sector can be renamed or cleared for every business using it; only a group super admin, only its own group', async () => {
    const sectorPatch = (body, token = superToken) => authed(request(app).patch(`${base}/sectors`), token).send(body);
    const a = await post({ name: 'Sector Rename A', sector: 'Old Sector' });
    const b = await post({ name: 'Sector Rename B', sector: 'Old Sector' });
    expect((await sectorPatch({ from: 'Old Sector', to: 'New Sector' })).body.data.updated).toBe(2);
    let res = await get();
    expect(byName(res, 'Sector Rename A').sector).toBe('New Sector');
    expect(byName(res, 'Sector Rename B').sector).toBe('New Sector');
    expect((await sectorPatch({ from: 'New Sector', to: null })).body.data.updated).toBe(2);
    res = await get();
    expect(byName(res, 'Sector Rename A').sector).toBeNull();
    expect((await sectorPatch({ from: 'x', to: 'y' }, adminToken)).status).toBe(403);
    await prisma.groupCompany.deleteMany({ where: { id: { in: [a.body.data.id, b.body.data.id] } } });
  });

  test('stakes: several holders, at most 100%, holders from the group, no self-holding or loops; holdings show on the holder', async () => {
    const list = await get();
    const a = byName(list, 'Alpha Global');
    const b = byName(list, 'Beta Trading');
    const vmet = (await post({ name: 'Vidhyasri', status: 'operational' })).body.data;

    // Alpha is wholly owned by the group; Vidhyasri is 40% Beta + 30% a named outsider
    expect((await stakes(a.id, [{ holder_kind: 'group', pct: 100 }])).status).toBe(200);
    expect((await stakes(vmet.id, [{ holder_kind: 'company', holder_company_id: b.id, pct: 40 }, { holder_kind: 'external', holder_name: 'Founder family', pct: 30 }])).status).toBe(200);
    const res = await get();
    expect(byName(res, 'Alpha Global')).toMatchObject({ total_pct: 100 });
    expect(byName(res, 'Alpha Global').holders[0]).toMatchObject({ holder_kind: 'group', holder_label: 'Gulati Industries', pct: 100 });
    const v = byName(res, 'Vidhyasri');
    expect(v.total_pct).toBe(70);
    expect(v.holders.map((h) => `${h.holder_label} ${h.pct}`)).toEqual(['Beta Trading 40', 'Founder family 30']);
    expect(byName(res, 'Beta Trading').holdings).toEqual([{ company_id: vmet.id, company: 'Vidhyasri', pct: 40 }]);
    expect(res.body.data.summary).toMatchObject({ stakes_missing: 1, stakes_over: 0 }); // Beta has no holder yet

    // validation
    const over = await stakes(vmet.id, [{ holder_kind: 'group', pct: 60 }, { holder_kind: 'external', holder_name: 'X', pct: 50 }]);
    expect(over.status).toBe(400);
    expect(over.body.message).toMatch(/110%/);
    expect((await stakes(vmet.id, [{ holder_kind: 'company', holder_company_id: vmet.id, pct: 10 }])).status).toBe(400); // itself
    expect((await stakes(vmet.id, [{ holder_kind: 'group', pct: 10 }, { holder_kind: 'group', pct: 20 }])).status).toBe(400); // twice
    expect((await stakes(vmet.id, [{ holder_kind: 'external', holder_name: '  ', pct: 10 }])).status).toBe(400); // unnamed
    expect((await stakes(vmet.id, [{ holder_kind: 'company', pct: 10 }])).status).toBe(400);
    expect((await stakes(vmet.id, [{ holder_kind: 'group', pct: 0 }])).status).toBe(422); // zero is not a stake (rejected by validation)
    const foreign = await prisma.groupCompany.create({ data: { org_group_id: outsider.org_group_id, name: 'Foreign', status: 'operational' } });
    expect((await stakes(vmet.id, [{ holder_kind: 'company', holder_company_id: foreign.id, pct: 10 }])).status).toBe(400); // other group's business
    // ownership loop: Vidhyasri holds Beta, then Beta cannot be held by Vidhyasri's holder chain back
    expect((await stakes(b.id, [{ holder_kind: 'company', holder_company_id: vmet.id, pct: 20 }])).status).toBe(400);
    expect(byName(await get(), 'Vidhyasri').total_pct).toBe(70); // refused writes changed nothing

    // replacing with an empty list clears the holders
    expect((await stakes(vmet.id, [])).status).toBe(200);
    expect(byName(await get(), 'Vidhyasri').holders).toEqual([]);

    // deleting a held business removes the stakes it holds in others
    expect((await stakes(vmet.id, [{ holder_kind: 'group', pct: 100 }])).status).toBe(200);
    expect((await stakes(a.id, [{ holder_kind: 'company', holder_company_id: vmet.id, pct: 10 }, { holder_kind: 'group', pct: 90 }])).status).toBe(200);
    expect((await authed(request(app).delete(`${base}/${vmet.id}`), superToken)).body.data.stakes_removed).toBe(1);
    expect(byName(await get(), 'Alpha Global').total_pct).toBe(90);
  });

  test('"wholly owned by the group" quick start fills only the workspaces that have no holder', async () => {
    const list = await get();
    await stakes(byName(list, 'Alpha Global').id, [{ holder_kind: 'group', pct: 60 }, { holder_kind: 'external', holder_name: 'Partner', pct: 40 }]);
    const res = await authed(request(app).post(`${base}/stakes/group-default`), superToken);
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(1); // Beta only
    const after = await get();
    expect(byName(after, 'Alpha Global').total_pct).toBe(100);
    expect(byName(after, 'Alpha Global').holders).toHaveLength(2); // untouched
    expect(byName(after, 'Beta Trading').holders[0]).toMatchObject({ holder_kind: 'group', pct: 100 });
  });

  test('group superadmin only, and only for the caller\'s group', async () => {
    const list = await get();
    expect((await get(adminToken)).status).toBe(403);
    expect((await post({ name: 'Nope' }, adminToken)).status).toBe(403);
    expect((await request(app).get(base)).status).toBe(401);
    // another group's business is not reachable by id
    const foreign = await prisma.groupCompany.create({ data: { org_group_id: outsider.org_group_id, name: 'Foreign', status: 'operational' } });
    expect((await patch(foreign.id, { sector: 'x' })).status).toBe(404);
    expect((await stakes(foreign.id, [])).status).toBe(404);
    expect((await authed(request(app).delete(`${base}/${foreign.id}`), superToken)).status).toBe(404);
    expect(byName(list, 'Foreign')).toBeUndefined();
  });
});
