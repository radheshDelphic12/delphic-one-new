/**
 * Group Dashboard > Companies & Stakes: a workspace renamed to a hand-added business no longer leaves a ghost row that carries the ownership, and the group's
 * business classification (sector > industry > sub-industry, edited freely, seeded from the standard list) with each business's place in it and the map.
 */
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');
const { parseStandardList } = require('../src/modules/groupCompanies/taxonomy.seed');

let group;
let alpha;
let superToken;
let adminToken;
const base = '/api/v1/group-companies';

beforeEach(async () => {
  await cleanDatabase();
  alpha = await createOrg({ name: 'Alpha Global' });
  group = { id: alpha.org_group_id };
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

const get = (path = '', query = {}, token = superToken) => authed(request(app).get(`${base}${path}`), token).query(query);
const post = (path, body, token = superToken) => authed(request(app).post(`${base}${path}`), token).send(body || {});
const patch = (path, body) => authed(request(app).patch(`${base}${path}`), superToken).send(body);
const put = (path, body) => authed(request(app).put(`${base}${path}`), superToken).send(body);
const del = (path) => authed(request(app).delete(`${base}${path}`), superToken);
const byName = (res, name) => res.body.data.companies.filter((c) => c.name === name);

describe('a workspace renamed to the name of a business added by hand', () => {
  test('is one business: the ownership, sector and holdings of the hand-made row move onto it, no ghost row stays', async () => {
    const ws = await createOrg({ name: 'Gulati Industries', org_group_id: group.id });
    await get();
    const hand = (await post('', { name: 'Gulati Enterprises', status: 'planning', sector: 'Trading', tagline: 'Group trading arm' })).body.data;
    expect((await put(`/${hand.id}/stakes`, { stakes: [{ holder_kind: 'group', pct: 100 }] })).status).toBe(200);
    const child = (await post('', { name: 'Gulati Retail' })).body.data;
    expect((await put(`/${child.id}/stakes`, { stakes: [{ holder_kind: 'company', holder_company_id: hand.id, pct: 60 }] })).status).toBe(200);

    // the workspace is renamed in its own Settings to the same name
    await prisma.org.update({ where: { id: ws.id }, data: { name: 'Gulati Enterprises' } });
    const res = await get();
    const rows = byName(res, 'Gulati Enterprises');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ is_current: true, status: 'operational', total_pct: 100, sector: 'Trading', tagline: 'Group trading arm' });
    expect(rows[0].holders).toEqual([expect.objectContaining({ holder_kind: 'group', pct: 100 })]);
    // what it held in another business follows it
    expect(byName(res, 'Gulati Retail')[0].holders).toEqual([expect.objectContaining({ holder_kind: 'company', holder_company_id: rows[0].id, pct: 60 })]);
    expect(res.body.data.summary.total).toBe(3);
    // stable on the next read
    expect(byName(await get(), 'Gulati Enterprises')).toHaveLength(1);

    // when the workspace row already has its own holders, those win and the hand-made row's are dropped
    const ws2 = await createOrg({ name: 'Zephyr Old', org_group_id: group.id });
    await get();
    const wsRow = byName(await get(), 'Zephyr Old')[0];
    await put(`/${wsRow.id}/stakes`, { stakes: [{ holder_kind: 'external', holder_name: 'Mr Shah', pct: 40 }] });
    const hand2 = (await post('', { name: 'Zephyr New' })).body.data;
    await put(`/${hand2.id}/stakes`, { stakes: [{ holder_kind: 'group', pct: 100 }] });
    await prisma.org.update({ where: { id: ws2.id }, data: { name: 'Zephyr New' } });
    const merged = byName(await get(), 'Zephyr New');
    expect(merged).toHaveLength(1);
    expect(merged[0].holders).toEqual([expect.objectContaining({ holder_kind: 'external', holder_name: 'Mr Shah', pct: 40 })]);
  });
});

describe('business classification', () => {
  test('the standard list: 27 sectors, loaded once, never duplicated, and anything the group added stays', async () => {
    const std = parseStandardList();
    expect(std).toHaveLength(27);
    expect((await post('/taxonomy/sectors', { name: 'Gulati Own Sector' })).status).toBe(200);
    const first = await post('/taxonomy/seed');
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ sectors: 27, industries: std.reduce((n, s) => n + s.industries.length, 0), sub_industries: std.reduce((n, s) => n + s.industries.reduce((m, i) => m + i.subs.length, 0), 0) });
    expect((await post('/taxonomy/seed')).body.data).toEqual({ sectors: 0, industries: 0, sub_industries: 0 });
    const tree = (await get('/taxonomy')).body.data;
    expect(tree.counts.sectors).toBe(28);
    expect(tree.sectors.map((s) => s.name)).toEqual(expect.arrayContaining(['Information Technology & Software', 'Gulati Own Sector', 'Government, Public Administration & Public Infrastructure']));
    const it = tree.sectors.find((s) => s.name === 'Information Technology & Software');
    expect(it.industries.find((i) => i.name === 'Artificial Intelligence').subs.map((x) => x.name)).toEqual(['Generative AI', 'Machine Learning', 'Deep Learning', 'Computer Vision', 'NLP']);
    // the standard list never overwrites an edit: a renamed industry is re-added only under its old name if the old name is gone
    expect((await patch(`/taxonomy/industries/${it.industries.find((i) => i.name === 'SaaS').id}`, { name: 'Software as a Service' })).status).toBe(200);
    const again = (await post('/taxonomy/seed')).body.data;
    expect(again).toMatchObject({ sectors: 0, industries: 1, sub_industries: 5 });
  }, 120000);

  test('add, rename and remove sectors, industries and sub-industries; names stay unique; a batch of sub-industries', async () => {
    const sec = (await post('/taxonomy/sectors', { name: 'Mining' })).body.data;
    expect((await post('/taxonomy/sectors', { name: ' mining ' })).status).toBe(409);
    expect((await post('/taxonomy/sectors', { name: '  ' })).status).toBe(422);
    const ind = (await post(`/taxonomy/sectors/${sec.id}/industries`, { name: 'Copper Mining' })).body.data;
    expect((await post(`/taxonomy/sectors/${sec.id}/industries`, { name: 'copper mining' })).status).toBe(409);
    const subs = await post(`/taxonomy/industries/${ind.id}/sub-industries`, { names: 'Open Pit, Underground\nCopper Smelting, open pit' });
    expect(subs.body.data).toEqual({ added: 3, skipped: 1 });
    expect((await patch(`/taxonomy/sectors/${sec.id}`, { name: 'Mining & Metals' })).body.data.name).toBe('Mining & Metals');
    expect((await patch(`/taxonomy/industries/${ind.id}`, { name: 'Copper' })).body.data.name).toBe('Copper');
    const tree = (await get('/taxonomy')).body.data;
    const open = tree.sectors[0].industries[0].subs.find((x) => x.name === 'Open Pit');
    expect((await patch(`/taxonomy/sub-industries/${open.id}`, { name: 'Underground' })).status).toBe(409);
    expect((await patch(`/taxonomy/sub-industries/${open.id}`, { name: 'Open-pit mining' })).body.data.name).toBe('Open-pit mining');
    expect((await del(`/taxonomy/sub-industries/${open.id}`)).status).toBe(200);
    expect((await get('/taxonomy')).body.data.counts).toEqual({ sectors: 1, industries: 1, sub_industries: 2 });
    expect((await del(`/taxonomy/sectors/${sec.id}`)).body.data).toMatchObject({ deleted: true, businesses_unmapped: 0 });
    expect((await get('/taxonomy')).body.data.counts).toEqual({ sectors: 0, industries: 0, sub_industries: 0 });
    // only the group superadmin
    expect((await get('/taxonomy', {}, adminToken)).status).toBe(403);
    expect((await post('/taxonomy/sectors', { name: 'X' }, adminToken)).status).toBe(403);
  });

  test('a business sits in several sectors, industries and sub-industries; the register and the sector view follow; removing an item keeps the rest', async () => {
    await get();
    const it = (await post('/taxonomy/sectors', { name: 'Information Technology' })).body.data;
    const fin = (await post('/taxonomy/sectors', { name: 'Financial Services' })).body.data;
    const ai = (await post(`/taxonomy/sectors/${it.id}/industries`, { name: 'Artificial Intelligence' })).body.data;
    const saas = (await post(`/taxonomy/sectors/${it.id}/industries`, { name: 'SaaS' })).body.data;
    const lending = (await post(`/taxonomy/sectors/${fin.id}/industries`, { name: 'Lending' })).body.data;
    await post(`/taxonomy/industries/${ai.id}/sub-industries`, { names: 'Generative AI, NLP' });
    const tree = (await get('/taxonomy')).body.data;
    const genAi = tree.sectors.find((s) => s.name === 'Information Technology').industries.find((i) => i.name === 'Artificial Intelligence').subs.find((x) => x.name === 'Generative AI');
    const co = byName(await get(), 'Alpha Global')[0];

    // wrong combinations are refused: an industry outside the chosen sectors, a sub-industry outside the chosen industries
    expect((await put(`/${co.id}/classification`, { sector_ids: [fin.id], industry_ids: [ai.id], sub_industry_ids: [] })).status).toBe(400);
    expect((await put(`/${co.id}/classification`, { sector_ids: [it.id], industry_ids: [saas.id], sub_industry_ids: [genAi.id] })).status).toBe(400);
    expect((await put(`/${co.id}/classification`, { sector_ids: ['11111111-1111-4111-8111-111111111111'], industry_ids: [], sub_industry_ids: [] })).status).toBe(400);

    const saved = await put(`/${co.id}/classification`, { sector_ids: [it.id, fin.id], industry_ids: [ai.id, saas.id, lending.id], sub_industry_ids: [genAi.id] });
    expect(saved.status).toBe(200);
    // stored once per deepest choice: Generative AI, SaaS, Lending
    expect(saved.body.data.rows).toBe(3);
    let row = byName(await get(), 'Alpha Global')[0];
    expect(row.classification.sectors.map((s) => s.name)).toEqual(['Financial Services', 'Information Technology']);
    expect(row.classification.industries.map((i) => i.name)).toEqual(['Artificial Intelligence', 'Lending', 'SaaS']);
    expect(row.classification.sub_industries.map((x) => x.name)).toEqual(['Generative AI']);
    expect(row.sectors).toEqual(['Financial Services', 'Information Technology']);
    // the sector view lists the business under each sector it is in
    const sv = (await get()).body.data.sectors;
    expect(sv.map((s) => [s.sector, s.count]).sort()).toEqual([['Financial Services', 1], ['Information Technology', 1]]);
    expect((await get()).body.data.sector_options).toEqual(expect.arrayContaining(['Information Technology', 'Financial Services']));

    // removing the industry the sub-industry sat in keeps the business in the sector (and its other industries)
    await del(`/taxonomy/industries/${ai.id}`);
    row = byName(await get(), 'Alpha Global')[0];
    expect(row.classification.industries.map((i) => i.name)).toEqual(['Lending', 'SaaS']);
    expect(row.classification.sub_industries).toEqual([]);
    expect(row.classification.sectors.map((s) => s.name)).toEqual(['Financial Services', 'Information Technology']);
    // removing a sector takes the business out of it; removing the business drops its rows
    await del(`/taxonomy/sectors/${fin.id}`);
    expect(byName(await get(), 'Alpha Global')[0].sectors).toEqual(['Information Technology']);
    const off = (await post('', { name: 'Planned Mining' })).body.data;
    await put(`/${off.id}/classification`, { sector_ids: [it.id], industry_ids: [], sub_industry_ids: [] });
    expect(await prisma.businessClassification.count({ where: { entity_id: off.id } })).toBe(1);
    expect((await del(`/${off.id}`)).status).toBe(200);
    expect(await prisma.businessClassification.count({ where: { entity_id: off.id } })).toBe(0);
    // clearing: nothing chosen
    await put(`/${co.id}/classification`, { sector_ids: [], industry_ids: [], sub_industry_ids: [] });
    expect(byName(await get(), 'Alpha Global')[0].sectors).toEqual([]);
  });

  test('the business map: which businesses cover each sector, industry and sub-industry, what is still empty, the unclassified ones, and the status filter', async () => {
    await get();
    const it = (await post('/taxonomy/sectors', { name: 'Information Technology' })).body.data;
    const mining = (await post('/taxonomy/sectors', { name: 'Mining' })).body.data;
    const ai = (await post(`/taxonomy/sectors/${it.id}/industries`, { name: 'Artificial Intelligence' })).body.data;
    const saas = (await post(`/taxonomy/sectors/${it.id}/industries`, { name: 'SaaS' })).body.data;
    const copper = (await post(`/taxonomy/sectors/${mining.id}/industries`, { name: 'Copper' })).body.data;
    await post(`/taxonomy/industries/${ai.id}/sub-industries`, { names: 'Generative AI, NLP' });
    await post(`/taxonomy/industries/${saas.id}/sub-industries`, { names: 'CRM, ERP' });
    await post(`/taxonomy/industries/${copper.id}/sub-industries`, { names: 'Smelting' });
    const tree = (await get('/taxonomy')).body.data;
    const sub = (sector, industry, name) => tree.sectors.find((s) => s.name === sector).industries.find((i) => i.name === industry).subs.find((x) => x.name === name).id;

    const delphic = byName(await get(), 'Alpha Global')[0];
    const planned = (await post('', { name: 'Planned AI Lab', status: 'future' })).body.data;
    await post('', { name: 'Not Mapped Yet', status: 'planning' });
    await put(`/${delphic.id}/classification`, { sector_ids: [it.id], industry_ids: [ai.id, saas.id], sub_industry_ids: [sub('Information Technology', 'SaaS', 'ERP')] });
    await put(`/${planned.id}/classification`, { sector_ids: [it.id], industry_ids: [ai.id], sub_industry_ids: [sub('Information Technology', 'Artificial Intelligence', 'Generative AI')] });

    let map = (await get('/business-map')).body.data;
    const sector = (name) => map.sectors.find((s) => s.name === name);
    expect(sector('Information Technology').companies.map((c) => c.name)).toEqual(['Alpha Global', 'Planned AI Lab']);
    expect(sector('Information Technology')).toMatchObject({ industries_covered: 2, subs_total: 4, subs_covered: 2 });
    const aiRow = sector('Information Technology').industries.find((i) => i.name === 'Artificial Intelligence');
    expect(aiRow.companies.map((c) => c.name)).toEqual(['Alpha Global', 'Planned AI Lab']);
    expect(aiRow.subs.find((x) => x.name === 'Generative AI').companies.map((c) => c.name)).toEqual(['Planned AI Lab']);
    expect(aiRow.subs.find((x) => x.name === 'NLP').companies).toEqual([]); // still empty: a gap
    expect(sector('Mining')).toMatchObject({ companies: [], industries_covered: 0, subs_covered: 0 }); // a sector nobody is in
    expect(map.unclassified.map((c) => c.name)).toEqual(['Not Mapped Yet']);
    expect(map.summary).toEqual({ sectors: 2, sectors_covered: 1, industries: 3, industries_covered: 2, sub_industries: 5, sub_industries_covered: 2, companies: 3, companies_classified: 2 });

    // only the operational ones: the future AI lab drops out and its sub-industry is empty again
    map = (await get('/business-map', { statuses: 'operational' })).body.data;
    expect(map.summary).toMatchObject({ companies: 1, companies_classified: 1, sub_industries_covered: 1 });
    expect(map.sectors.find((s) => s.name === 'Information Technology').companies.map((c) => c.name)).toEqual(['Alpha Global']);
    expect(map.unclassified).toEqual([]);
    expect((await get('/business-map', {}, adminToken)).status).toBe(403);
  });
});
