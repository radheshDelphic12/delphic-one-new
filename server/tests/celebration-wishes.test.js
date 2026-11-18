/**
 * Announcements: colleagues can wish someone on the day of their birthday / work anniversary; the wishes live for that day only.
 */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');
const announcements = require('../src/modules/orgs/announcements.service');
const { todayIst } = require('../src/lib/istDate');

beforeEach(async () => { await cleanDatabase(); });
afterAll(async () => { await prisma.$disconnect(); });

describe('celebration wishes', () => {
  test('wish today only, never yourself, once each; the list shows who wished; old wishes are deleted', async () => {
    const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
    const today = todayIst();
    const mk = async (name, extra = {}) => {
      const user = await createUser({ role: 'employee', name, withOrg: false });
      const membership = await createOrgMembership(user.id, org.id, { role: 'employee' });
      if (Object.keys(extra).length) await prisma.orgMembership.update({ where: { id: membership.id }, data: extra });
      return { user, membership, token: (await loginAs(user)).access_token };
    };
    const celebrant = await mk('Mamoon Jan', { date_of_birth: new Date(Date.UTC(1990, today.getUTCMonth(), today.getUTCDate())) });
    const ankit = await mk('Ankit Gupta');
    const arunim = await mk('Arunim Malviya');
    const later = await mk('Later Birthday', { date_of_birth: new Date(today.getTime() + 5 * 86400000) }); // five days away

    const wish = (who, body) => authed(request(app).post('/api/v1/orgs/announcements/wishes'), who.token).send(body);
    const read = async (who) => (await authed(request(app).get('/api/v1/orgs/announcements').query({ days: 14 }), who.token)).body.data;
    const target = { org_membership_id: celebrant.membership.id, kind: 'birthday' };

    expect((await wish(celebrant, target)).status).toBe(422); // not yourself
    expect((await wish(ankit, { org_membership_id: later.membership.id, kind: 'birthday' })).status).toBe(422); // not today
    expect((await wish(ankit, { ...target, kind: 'anniversary' })).status).toBe(422); // wrong kind

    expect((await wish(ankit, target)).status).toBe(201); // default message
    expect((await wish(arunim, { ...target, message: 'Many happy returns!' })).status).toBe(201);
    expect((await wish(ankit, target)).status).toBe(409); // once each

    // anyone sees who wished (the celebrant too); "is_mine" / "wished_by_me" are per viewer
    const asCelebrant = (await read(celebrant)).birthdays.find((b) => b.org_membership_id === celebrant.membership.id);
    expect(asCelebrant.is_me).toBe(true);
    expect(asCelebrant.wishes.map((w) => w.from_name).sort()).toEqual(['Ankit Gupta', 'Arunim Malviya']);
    expect(asCelebrant.wishes.find((w) => w.from_name === 'Arunim Malviya').message).toBe('Many happy returns!');
    const asAnkit = (await read(ankit)).birthdays.find((b) => b.org_membership_id === celebrant.membership.id);
    expect(asAnkit.wished_by_me).toBe(true);
    expect(asAnkit.wishes.find((w) => w.is_mine).from_name).toBe('Ankit Gupta');
    const upcomingRow = (await read(ankit)).birthdays.find((b) => b.org_membership_id === later.membership.id);
    expect(upcomingRow.wishes).toBeUndefined(); // not their day yet

    // the celebrant is told in the bell (once per wish), the admins are not copied
    const bell = await prisma.notification.findMany({ where: { user_id: celebrant.user.id, type: 'celebration_wish' } });
    expect(bell).toHaveLength(2);

    // the next day the wishes are gone: a row from yesterday is deleted by the nightly job and never shown for today
    await prisma.celebrationWish.updateMany({ data: { on_date: new Date(today.getTime() - 86400000) } });
    expect((await read(ankit)).birthdays.find((b) => b.org_membership_id === celebrant.membership.id).wishes).toEqual([]);
    expect(await announcements.purgeOldWishes()).toEqual({ deleted: 2 });
    expect(await prisma.celebrationWish.count()).toBe(0);
  });

  test('a GIF can go with (or instead of) the text, only from Giphy; the GIF search is off without a key and returns G-rated results with one', async () => {
    const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
    const today = todayIst();
    const mk = async (name, extra = {}) => {
      const user = await createUser({ role: 'employee', name, withOrg: false });
      const membership = await createOrgMembership(user.id, org.id, { role: 'employee' });
      if (Object.keys(extra).length) await prisma.orgMembership.update({ where: { id: membership.id }, data: extra });
      return { user, membership, token: (await loginAs(user)).access_token };
    };
    const celebrant = await mk('Mamoon Jan', { date_of_birth: new Date(Date.UTC(1990, today.getUTCMonth(), today.getUTCDate())) });
    const ankit = await mk('Ankit Gupta');
    const send = (body) => authed(request(app).post('/api/v1/orgs/announcements/wishes'), ankit.token).send({ org_membership_id: celebrant.membership.id, kind: 'birthday', ...body });

    expect((await send({ gif_url: 'https://evil.example.com/x.gif' })).status).toBe(422); // not a Giphy host
    expect((await send({ gif_url: 'http://media.giphy.com/x.gif' })).status).toBe(422); // not https
    const ok = await send({ gif_url: 'https://media2.giphy.com/media/abc/200.gif' }); // GIF only, no text
    expect(ok.status).toBe(201);
    const row = (await authed(request(app).get('/api/v1/orgs/announcements').query({ days: 14 }), celebrant.token)).body.data.birthdays.find((b) => b.is_me);
    expect(row.wishes[0]).toMatchObject({ gif_url: 'https://media2.giphy.com/media/abc/200.gif', message: '' });
    const bell = await prisma.notification.findFirst({ where: { user_id: celebrant.user.id, type: 'celebration_wish' } });
    expect(bell.body).toMatch(/with a GIF/);

    const env = require('../src/config/env');
    const search = (q) => authed(request(app).get('/api/v1/orgs/announcements/gifs').query({ q }), ankit.token);
    env.gifs.apiKey = null;
    expect((await search('happy birthday')).body.data).toEqual({ enabled: false, results: [] });
    env.gifs.apiKey = 'test-key';
    const realFetch = global.fetch;
    let asked;
    global.fetch = async (url) => { asked = String(url); return { ok: true, json: async () => ({ data: [{ id: 'g1', title: 'cake', images: { fixed_height: { url: 'https://media1.giphy.com/a.gif' }, fixed_height_small: { url: 'https://media1.giphy.com/a_s.gif' } } }] }) }; };
    try {
      const res = await search('happy birthday');
      expect(res.body.data).toEqual({ enabled: true, results: [{ id: 'g1', title: 'cake', url: 'https://media1.giphy.com/a.gif', preview: 'https://media1.giphy.com/a_s.gif' }] });
      expect(asked).toMatch(/rating=g/);
      expect((await search('')).status).toBe(422);
    } finally {
      global.fetch = realFetch;
      env.gifs.apiKey = null;
    }
  });
});
