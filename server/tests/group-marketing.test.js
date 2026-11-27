/** Group Dashboard > Marketing: campaigns across companies, spend log, results, and the summary by channel and company. */
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');

test('campaigns with budget, spend and results; totals by channel and company; cost per lead and return on spend', async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE group_campaign_spends, group_campaigns CASCADE');
  const group = await prisma.orgGroup.create({ data: { name: 'Mkt Group' } });
  const alpha = await createOrg({ name: 'Alpha Co', slug: 'alpha-mkt', org_group_id: group.id });
  const beta = await createOrg({ name: 'Beta Co', slug: 'beta-mkt', org_group_id: group.id });
  const sup = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: sup.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: sup.id, org_group_id: group.id } }).catch(() => null);
  await createOrgMembership(sup.id, alpha.id, { role: 'admin' });
  const token = (await loginAs(sup)).access_token;
  const m = (method, url = '') => authed(request(app)[method](`/api/v1/group-marketing${url}`), token);

  const a = (await m('post').send({ name: 'LinkedIn Q4', channel: 'linkedin', company_ids: [alpha.id], status: 'live', start_date: '2026-10-01', end_date: '2026-12-31', budget: 100000, target_leads: 50 })).body.data;
  const b = (await m('post').send({ name: 'Expo stall', channel: 'event', company_ids: [alpha.id, beta.id], budget: 50000 })).body.data;
  expect((await m('post').send({ name: 'Bad', start_date: '2026-12-01', end_date: '2026-11-01' })).status).toBe(422);
  await m('post', `/${a.id}/spends`).send({ spent_on: '2026-10-05', amount: 40000, note: 'Oct ads' });
  const spent = (await m('post', `/${a.id}/spends`).send({ spent_on: '2026-11-05', amount: 70000 })).body.data;
  expect(spent).toMatchObject({ spent: 110000, left: -10000, over_budget: true });
  const upd = (await m('patch', `/${a.id}`).send({ leads: 44, deals_won: 3, revenue: 330000 })).body.data;
  expect(upd).toMatchObject({ cost_per_lead: 2500, return_on_spend: 3 });
  await m('post', `/${b.id}/spends`).send({ amount: 20000 });
  await m('patch', `/${b.id}`).send({ leads: 10 });

  const d = (await m('get')).body.data;
  expect(d.summary.totals).toMatchObject({ campaigns: 2, live: 1, budget: 150000, spent: 130000, leads: 54, revenue: 330000 });
  expect(d.summary.by_channel.map((x) => [x.key, x.spent])).toEqual([['linkedin', 110000], ['event', 20000]]);
  expect(d.summary.by_company.find((x) => x.key === 'Alpha Co')).toMatchObject({ campaigns: 2, spent: 130000 });
  expect(d.summary.by_company.find((x) => x.key === 'Beta Co')).toMatchObject({ campaigns: 1, spent: 20000 });
  expect((await m('get').query({ company_id: beta.id })).body.data.campaigns.map((c) => c.name)).toEqual(['Expo stall']);
  const sid = spent.spends[0].id;
  expect((await m('delete', `/${a.id}/spends/${sid}`)).body.data.spent).toBe(40000);
  expect((await m('delete', `/${b.id}`)).status).toBe(200);
  expect((await m('get')).body.data.campaigns).toHaveLength(1);
  await prisma.$disconnect();
});
