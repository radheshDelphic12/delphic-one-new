// Submissions list: vendor_id narrows the list to candidates that came through that vendor account.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createProfile, authed } = require('./helpers');

let token; let admin; let vendorA; let vendorB; let subA; let subB; let subDirect;
const get = (q) => authed(request(app).get('/api/v1/submissions').query(q || {}), token);
const names = async (q) => (await get({ limit: 50, ...q })).body.data.map((s) => s.profile?.name).sort();

beforeAll(async () => {
  await cleanDatabase();
  admin = await createUser({ role: 'admin' });
  ({ access_token: token } = await loginAs(admin));
  const mkVendor = (name) => prisma.account.create({ data: { type: 'vendor', name, stage: 'active', owner_id: admin.id, origin_owner_id: admin.id } });
  vendorA = await mkVendor('Vendor A');
  vendorB = await mkVendor('Vendor B');
  const client = await prisma.account.create({ data: { type: 'client', name: 'Some Client', stage: 'active', owner_id: admin.id, origin_owner_id: admin.id } });
  const req = await prisma.requirement.create({ data: { account_id: client.id, title: 'Some Req', req_type: 'recruitment', sales_owner_id: admin.id } });
  const mkSub = async (name, extra) => {
    const profile = await createProfile(token, { name, ...extra });
    const seat = await prisma.requirementSeat.create({ data: { requirement_id: req.id, seat_status: 'open' } });
    return prisma.submission.create({ data: { requirement_seat_id: seat.id, profile_id: profile.id, stage: 'sourced', submitted_by: admin.id } });
  };
  subA = await mkSub('Via A', { source: 'vendor', vendor_account_id: vendorA.id });
  subB = await mkSub('Via B', { source: 'vendor', vendor_account_id: vendorB.id });
  subDirect = await mkSub('Direct Person', { source: 'direct' });
}, 120000);
afterAll(async () => { await prisma.$disconnect(); });

describe('submissions list: vendor filter', () => {
  test('no filter lists everyone; vendor_id lists only the candidates of that vendor', async () => {
    expect(await names({})).toEqual(['Direct Person', 'Via A', 'Via B']);
    expect(await names({ vendor_id: vendorA.id })).toEqual(['Via A']);
    expect(await names({ vendor_id: vendorB.id })).toEqual(['Via B']);
    expect(subA.id && subB.id && subDirect.id).toBeTruthy();
  });

  test('it combines with the search, and a value that is not an id is refused', async () => {
    expect(await names({ vendor_id: vendorA.id, search: 'Via' })).toEqual(['Via A']);
    expect(await names({ vendor_id: vendorA.id, search: 'Direct' })).toEqual([]);
    expect((await get({ vendor_id: 'nope' })).status).toBe(422);
  });
});
