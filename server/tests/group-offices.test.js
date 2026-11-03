/**
 * Group Dashboard > Offices: headcount per office location for every company of the group, the people behind a count, and
 * add / edit / delete of a company's locations by the group superadmin.
 */
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');

let group;
let alpha;
let beta;
let outsider; // a company of ANOTHER holding group
let superToken;
let adminToken; // plain company admin of `alpha`
const base = '/api/v1/group-offices';

beforeEach(async () => {
  await cleanDatabase();
  alpha = await createOrg({ name: 'Alpha Global' });
  group = { id: alpha.org_group_id };
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

const get = (path, token = superToken) => authed(request(app).get(`${base}${path}`), token);
const loc = (org, name, extra = {}) => prisma.location.create({ data: { org_id: org.id, name, ...extra } });
async function person(org, location, name, extra = {}) {
  const user = await createUser({ role: 'recruiter', withOrg: false });
  await prisma.user.update({ where: { id: user.id }, data: { name } });
  const m = await createOrgMembership(user.id, org.id, { role: 'recruiter', employment_status: extra.employment_status });
  await prisma.orgMembership.update({ where: { id: m.id }, data: { location_id: location ? location.id : null, ...(extra.work_mode ? { work_mode: extra.work_mode } : {}) } });
  return m;
}

describe('group offices', () => {
  test('counts per office for every company of the group, rolled up by office name, never another group', async () => {
    const aIndore = await loc(alpha, 'Indore', { city: 'Indore', country: 'India' });
    const aGurgaon = await loc(alpha, 'Gurgaon');
    const bIndore = await loc(beta, 'indore'); // same office name, other company, other spelling
    const outsiderOffice = await loc(outsider, 'Indore');
    await person(alpha, aIndore, 'Asha');
    await person(alpha, aIndore, 'Bela');
    await person(alpha, aGurgaon, 'Chirag');
    await person(alpha, null, 'No Office Person');
    await person(beta, bIndore, 'Dev');
    await person(alpha, aIndore, 'Left Company', { employment_status: 'terminated' });
    await person(outsider, outsiderOffice, 'Stranger');

    const res = await get('');
    expect(res.status).toBe(200);
    const { totals, companies, by_office } = res.body.data;
    expect(companies.map((c) => c.org.name).sort()).toEqual(['Alpha Global', 'Beta Trading']);
    const a = companies.find((c) => c.org.name === 'Alpha Global');
    expect(a.locations.find((l) => l.name === 'Indore').people_count).toBe(2); // the exited person is not counted
    expect(a.locations.find((l) => l.name === 'Gurgaon').people_count).toBe(1);
    // no office: the company admin and 'No Office Person'; the group superadmin is not part of a company's headcount
    expect(a.no_office_count).toBe(2);
    expect(a.total_people).toBe(2 + 1 + 2);
    expect(totals).toMatchObject({ companies: 2, offices: 3 });
    // one row per office name across the group: Indore = 2 (Alpha) + 1 (Beta)
    const indore = by_office.find((o) => o.name.toLowerCase() === 'indore');
    expect(indore.people_count).toBe(3);
    expect(indore.companies.map((c) => c.org).sort()).toEqual(['Alpha Global', 'Beta Trading']);

    const all = await get('?status=all');
    expect(all.body.data.companies.find((c) => c.org.name === 'Alpha Global').locations.find((l) => l.name === 'Indore').people_count).toBe(3);
    const hybrid = await get('?work_mode=onsite');
    expect(hybrid.body.data.totals.people).toBe(0);
  });

  test('group-wide counts count each person once: the group superadmin is left out and a person in several companies is one', async () => {
    const aGurugram = await loc(alpha, 'Gurugram');
    const bGurugram = await loc(beta, 'Gurugram');
    await person(alpha, aGurugram, 'Solo Asha');
    // one admin who is a member of BOTH companies, placed in Gurugram in each
    const shared = await createUser({ role: 'admin', withOrg: false });
    await prisma.user.update({ where: { id: shared.id }, data: { name: 'Shared Admin' } });
    for (const [org, office] of [[alpha, aGurugram], [beta, bGurugram]]) {
      const m = await createOrgMembership(shared.id, org.id, { role: 'admin' });
      await prisma.orgMembership.update({ where: { id: m.id }, data: { location_id: office.id } });
    }
    // the group superadmin also has a membership in each company, in Gurugram
    const su = await prisma.user.findFirst({ where: { is_group_superadmin: true } });
    for (const [org, office] of [[alpha, aGurugram], [beta, bGurugram]]) {
      const have = await prisma.orgMembership.findFirst({ where: { person_id: su.id, org_id: org.id } });
      const m = have || await createOrgMembership(su.id, org.id, { role: 'admin' });
      await prisma.orgMembership.update({ where: { id: m.id }, data: { location_id: office.id } });
    }

    const { totals, by_office, companies } = (await get('')).body.data;
    const row = by_office.find((o) => o.name === 'Gurugram');
    expect(row.people_count).toBe(2); // Solo Asha + Shared Admin, once each; not the group superadmin, not the admin twice
    // each company's own table still shows who sits in it
    expect(companies.find((c) => c.org.id === alpha.id).locations.find((l) => l.name === 'Gurugram').people_count).toBe(2);
    expect(companies.find((c) => c.org.id === beta.id).locations.find((l) => l.name === 'Gurugram').people_count).toBe(1);
    // headcount: Solo Asha, Shared Admin and the plain company admin of Alpha (no office) = 3 people, not 5
    expect(totals.people).toBe(3);
    expect(totals.no_office).toBe(1);

    const drawer = await get('/people?office_name=gurugram');
    expect(drawer.body.data.total).toBe(2);
    const names = drawer.body.data.items.map((i) => i.name).sort();
    expect(names).toEqual(['Shared Admin', 'Solo Asha']);
    expect(drawer.body.data.items.find((i) => i.name === 'Shared Admin').company).toMatch(/Alpha Global.*Beta Trading|Beta Trading.*Alpha Global/);
  });

  test('the people behind a count: one office, no office, or one office name across the group', async () => {
    const aIndore = await loc(alpha, 'Indore');
    const bIndore = await loc(beta, 'Indore');
    await person(alpha, aIndore, 'Asha');
    await person(alpha, aIndore, 'Bela');
    await person(beta, bIndore, 'Dev');
    await person(alpha, null, 'Nowhere');
    const names = (r) => r.body.data.items.map((i) => i.name).sort();

    expect(names(await get(`/people?org_id=${alpha.id}&location_id=${aIndore.id}`))).toEqual(['Asha', 'Bela']);
    expect(names(await get(`/people?org_id=${alpha.id}&location_id=none`))).toContain('Nowhere');
    expect(names(await get(`/people?org_id=${alpha.id}&location_id=none`))).not.toContain('Asha');
    const byName = await get('/people?office_name=indore');
    expect(names(byName)).toEqual(['Asha', 'Bela', 'Dev']);
    expect(byName.body.data.items.find((i) => i.name === 'Dev')).toMatchObject({ company: 'Beta Trading', office: 'Indore' });
    // a company of another group is refused, not silently empty
    expect((await get(`/people?org_id=${outsider.id}`)).status).toBe(403);
  });

  test('assigning an office to an employee: own-company office only, by id, counts follow, group scope and role enforced', async () => {
    const aIndore = await loc(alpha, 'Indore');
    const bIndore = await loc(beta, 'Indore'); // same name, other company: must be refused for an Alpha person
    const outsiderOffice = await loc(outsider, 'Indore');
    const nowhere = await person(alpha, null, 'Nowhere');
    const patch = (membershipId, body, token = superToken) => authed(request(app).patch(`${base}/memberships/${membershipId}/location`), token).send(body);

    const before = (await get('')).body.data;
    const noOfficeBefore = before.companies.find((c) => c.org.id === alpha.id).no_office_count;

    expect((await patch(nowhere.id, { location_id: bIndore.id })).status).toBe(400);
    expect((await patch(nowhere.id, { location_id: outsiderOffice.id })).status).toBe(400);
    expect((await patch(nowhere.id, { location_id: 'none' })).status).toBe(422);
    expect((await prisma.orgMembership.findUnique({ where: { id: nowhere.id } })).location_id).toBeNull();

    const ok = await patch(nowhere.id, { location_id: aIndore.id });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ membership_id: nowhere.id, location_id: aIndore.id, office: 'Indore' });

    const after = (await get('')).body.data;
    const a = after.companies.find((c) => c.org.id === alpha.id);
    expect(a.no_office_count).toBe(noOfficeBefore - 1);
    expect(a.locations.find((l) => l.id === aIndore.id).people_count).toBe(1);
    expect(after.totals.no_office).toBe(before.totals.no_office - 1);
    const none = await get(`/people?org_id=${alpha.id}&location_id=none`);
    expect(none.body.data.items.map((i) => i.name)).not.toContain('Nowhere');

    // a person of another holding group, a plain company admin, and no login
    const stranger = await person(outsider, null, 'Stranger');
    expect((await patch(stranger.id, { location_id: outsiderOffice.id })).status).toBe(404);
    expect((await patch(nowhere.id, { location_id: aIndore.id }, adminToken)).status).toBe(403);
    expect((await request(app).patch(`${base}/memberships/${nowhere.id}/location`).send({ location_id: aIndore.id })).status).toBe(401);
  });

  test('the group superadmin adds, edits and deletes a company location; another group and plain admins are refused', async () => {
    const add = await authed(request(app).post(`${base}/locations`), superToken).send({ org_id: beta.id, name: 'Pune', city: 'Pune', country: 'India', is_default: true });
    expect(add.status).toBe(201);
    expect(add.body.data).toMatchObject({ org_id: beta.id, name: 'Pune', is_default: true });
    // a second location with the same name in the same company is refused; the same name in another company is fine
    expect((await authed(request(app).post(`${base}/locations`), superToken).send({ org_id: beta.id, name: 'Pune' })).status).toBe(409);
    expect((await authed(request(app).post(`${base}/locations`), superToken).send({ org_id: alpha.id, name: 'Pune' })).status).toBe(201);
    // the default moves, never two defaults
    const second = await authed(request(app).post(`${base}/locations`), superToken).send({ org_id: beta.id, name: 'Noida', is_default: true });
    expect((await prisma.location.findUnique({ where: { id: add.body.data.id } })).is_default).toBe(false);
    expect(second.body.data.is_default).toBe(true);

    const edit = await authed(request(app).patch(`${base}/${beta.id}/locations/${add.body.data.id}`), superToken).send({ name: 'Pune HQ', address: 'Baner' });
    expect(edit.status).toBe(200);
    expect(edit.body.data).toMatchObject({ name: 'Pune HQ', address: 'Baner' });
    // the edited location shows up in the overview
    const view = await get('');
    expect(view.body.data.companies.find((c) => c.org.id === beta.id).locations.map((l) => l.name)).toEqual(expect.arrayContaining(['Pune HQ', 'Noida']));

    // a location still used by an employee cannot be deleted
    await person(beta, { id: add.body.data.id }, 'Sits Here');
    expect((await authed(request(app).delete(`${base}/${beta.id}/locations/${add.body.data.id}`), superToken)).status).toBe(409);
    expect((await authed(request(app).delete(`${base}/${beta.id}/locations/${second.body.data.id}`), superToken)).status).toBe(200);
    expect(await prisma.location.findUnique({ where: { id: second.body.data.id } })).toBeNull();

    // another group's company, a plain company admin, and no login
    expect((await authed(request(app).post(`${base}/locations`), superToken).send({ org_id: outsider.id, name: 'Hack' })).status).toBe(403);
    expect((await authed(request(app).post(`${base}/locations`), adminToken).send({ org_id: alpha.id, name: 'Nope' })).status).toBe(403);
    expect((await get('', adminToken)).status).toBe(403);
    expect((await request(app).get(base)).status).toBe(401);
  });
});
