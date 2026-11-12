const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

// Acconcy investee companies: a pipeline under discussion, funding rounds that become ordinary investments, company-wise returns.
jest.setTimeout(120000);
beforeAll(async () => { await cleanDatabase(); }, 180000);
afterAll(async () => { await cleanDatabase(); await prisma.$disconnect(); }, 180000);

async function setup() {
  const slug = `ax-inv-${Date.now()}`;
  const org = await createOrg({ name: `Acconcy ${slug}`, slug });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['acconcy'] } });
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return {
    org,
    post: (p, b) => authed(request(app).post(`/api/v1/acconcy${p}`), access_token).send(b),
    get: (p) => authed(request(app).get(`/api/v1/acconcy${p}`), access_token),
    patch: (p, b) => authed(request(app).patch(`/api/v1/acconcy${p}`), access_token).send(b),
    del: (p) => authed(request(app).delete(`/api/v1/acconcy${p}`), access_token),
  };
}

describe('Acconcy investee companies', () => {
  test('a company under discussion, then funded in two rounds, then a dividend and a part sale: company-wise return', async () => {
    const a = await setup();
    const fresh = await a.post('/investees', { name: 'Fresh Funding Co', sector: 'Fintech', stage: 'discussion', proposed_amount: 1250000, proposed_stake_pct: 10, expected_return_pct: 20 });
    expect(fresh.status).toBe(201);
    const vidya = await a.post('/investees', { name: 'Vidhyasri Mapsystems', sector: 'GIS', proposed_amount: 500000, expected_return_pct: 15 });
    expect(vidya.body.data.stage).toBe('discussion');
    expect(vidya.body.data.expected_return_amount).toBe(75000);

    // the pipeline shows what is under discussion and the expected return, nothing is invested yet
    let list = await a.get('/investees');
    expect(list.body.data.length).toBe(2);
    expect(list.body.totals).toMatchObject({ companies: 0, pipeline_count: 2, pipeline_amount: 1750000, invested: 0 });

    // fund Fresh Funding Co: two rounds, stake adds up
    const id = fresh.body.data.id;
    const r1 = await a.post(`/investees/${id}/fund`, { investment_date: '2026-09-01', amount: 1250000, equity_pct: 8 });
    expect(r1.status).toBe(200);
    expect(r1.body.data.stage).toBe('funded');
    const r2 = await a.post(`/investees/${id}/fund`, { investment_date: '2026-10-01', amount: 250000, equity_pct: 2, current_value: 300000 });
    expect(r2.body.data).toMatchObject({ rounds_count: 2, invested: 1500000, stake_pct: 10 });
    expect(r2.body.data.rounds.map((r) => r.name)).toEqual(['Fresh Funding Co - round 1', 'Fresh Funding Co - round 2']);

    // a dividend (cash back, no cost released) and a part sale come back through the existing realisation
    const roundId = r2.body.data.rounds[0].id;
    const dividend = await a.post(`/investments/${roundId}/realise`, { realised_date: '2026-10-10', amount_received: 50000, cost_released: 0 });
    expect(dividend.status).toBe(200);
    const sale = await a.get(`/investees/${id}`);
    expect(sale.body.data.amount_received).toBe(50000);
    expect(sale.body.data.realised_gain).toBe(50000);
    expect(sale.body.data.multiple).toBeGreaterThan(1);

    list = await a.get('/investees');
    expect(list.body.totals).toMatchObject({ companies: 1, invested: 1500000, pipeline_count: 1 });
    const filtered = await a.get('/investees?stage=discussion');
    expect(filtered.body.data.map((x) => x.name)).toEqual(['Vidhyasri Mapsystems']);
  });

  test('take over, a dropped company cannot be funded, a company with money cannot be deleted, other companies are not visible', async () => {
    const a = await setup();
    const c = (await a.post('/investees', { name: 'Takeover Target', stage: 'committed' })).body.data;
    const took = await a.post(`/investees/${c.id}/fund`, { investment_date: '2026-10-02', amount: 900000, equity_pct: 60, takeover: true });
    expect(took.body.data.stage).toBe('taken_over');
    expect(took.body.data.stake_pct).toBe(60);
    expect((await a.del(`/investees/${c.id}`)).status).toBe(409);

    const d = (await a.post('/investees', { name: 'Not Going Ahead' })).body.data;
    await a.patch(`/investees/${d.id}`, { stage: 'dropped' });
    expect((await a.post(`/investees/${d.id}/fund`, { investment_date: '2026-10-03', amount: 1000 })).status).toBe(409);
    expect((await a.del(`/investees/${d.id}`)).status).toBe(200);

    const other = await setup();
    expect((await other.get('/investees')).body.data).toEqual([]);
    expect((await other.get(`/investees/${c.id}`)).status).toBe(404);
  });
});
