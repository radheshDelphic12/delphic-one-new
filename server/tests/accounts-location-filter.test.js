// Phase 6.2: the Accounts list can be filtered by location (the Location text, the city or the country), for clients and vendors.
const { app, prisma, request, cleanDatabase, createUser, loginAs, authed } = require('./helpers');

let token; let user;

beforeAll(async () => {
  await cleanDatabase();
  user = await createUser({ role: 'admin' });
  ({ access_token: token } = await loginAs(user));
  const make = (data) => prisma.account.create({ data: { type: 'client', stage: 'active', owner_id: user.id, origin_owner_id: user.id, ...data } });
  await make({ name: 'Pune Client', location: 'Pune, India' });
  await make({ name: 'Mumbai Client', location_city: 'Mumbai', location_country: 'India' });
  await make({ name: 'Dubai Vendor', type: 'vendor', location_country: 'UAE' });
  await make({ name: 'Nowhere Client' });
}, 120000);
afterAll(async () => { await prisma.$disconnect(); });

const names = async (query) => (await authed(request(app).get('/api/v1/accounts').query({ limit: 50, ...query }), token)).body.data.map((a) => a.name).sort();

describe('accounts location filter', () => {
  test('matches the location text, the city and the country, case-insensitively, for clients and vendors', async () => {
    expect(await names({ location: 'pune' })).toEqual(['Pune Client']);
    expect(await names({ location: 'MUMBAI' })).toEqual(['Mumbai Client']);
    expect(await names({ location: 'india' })).toEqual(['Mumbai Client', 'Pune Client']);
    expect(await names({ location: 'uae' })).toEqual(['Dubai Vendor']);
    expect(await names({ location: 'uae', type: 'client' })).toEqual([]);
  });

  test('no location filter lists everything, including accounts with no location', async () => {
    expect(await names({})).toEqual(['Dubai Vendor', 'Mumbai Client', 'Nowhere Client', 'Pune Client']);
    expect(await names({ location: '   ' })).toEqual(['Dubai Vendor', 'Mumbai Client', 'Nowhere Client', 'Pune Client']);
  });
});
