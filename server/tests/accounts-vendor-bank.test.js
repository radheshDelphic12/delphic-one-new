// Accounts > vendor bank details: added on create or edit, formats checked, the account number masked in every response, the full
// number read only by people who may edit the account (and logged), never written to the audit trail.
const { app, prisma, request, cleanDatabase, createUser, loginAs, authed } = require('./helpers');

let adminToken;
let recruiterToken;
beforeAll(async () => {
  await cleanDatabase();
  ({ access_token: adminToken } = await loginAs(await createUser({ role: 'admin' })));
  ({ access_token: recruiterToken } = await loginAs(await createUser({ role: 'recruiter' })));
}, 120000);
afterAll(async () => { await prisma.$disconnect(); });

const post = (p, b, t = adminToken) => authed(request(app).post(`/api/v1${p}`), t).send(b);
const patch = (p, b, t = adminToken) => authed(request(app).patch(`/api/v1${p}`), t).send(b);
const get = (p, t = adminToken) => authed(request(app).get(`/api/v1${p}`), t);

const BANK = {
  vendor_bank_holder: 'Acme Staffing Pvt Ltd', vendor_bank_name: 'HDFC Bank', vendor_bank_branch: 'Indore Main',
  vendor_bank_account_number: '50200012345678', vendor_bank_ifsc: 'hdfc0001234', vendor_bank_swift: 'hdfcinbb', vendor_upi_id: 'acme@hdfcbank',
};

describe('vendor bank details', () => {
  test('saved on create; the account number comes back masked everywhere, the rest as typed (IFSC / SWIFT upper-cased)', async () => {
    const created = await post('/accounts', { type: 'vendor', name: 'Bank Vendor', ...BANK });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ vendor_bank_holder: 'Acme Staffing Pvt Ltd', vendor_bank_name: 'HDFC Bank', vendor_bank_ifsc: 'HDFC0001234', vendor_bank_swift: 'HDFCINBB', vendor_upi_id: 'acme@hdfcbank', has_bank_account_number: true });
    expect(created.body.data.vendor_bank_account_number).toBe('••••••••••5678'); // never the full number
    const id = created.body.data.id;
    expect((await get(`/accounts/${id}`)).body.data.vendor_bank_account_number).toBe('••••••••••5678');
    expect(JSON.stringify((await get('/accounts?search=Bank%20Vendor')).body)).not.toContain('50200012345678'); // not in the list either
    expect(JSON.stringify((await get(`/accounts/${id}`, recruiterToken)).body)).not.toContain('50200012345678'); // nor for a person who cannot edit it
    // the database holds the real value
    expect((await prisma.account.findUnique({ where: { id } })).vendor_bank_account_number).toBe('50200012345678');
  });

  test('only people who may edit the account read the full details, and every read is logged', async () => {
    const id = (await get('/accounts?search=Bank%20Vendor')).body.data[0].id;
    const full = await get(`/accounts/${id}/bank-details`);
    expect(full.status).toBe(200);
    expect(full.body.data).toMatchObject({ holder: 'Acme Staffing Pvt Ltd', bank_name: 'HDFC Bank', account_number: '50200012345678', ifsc: 'HDFC0001234', branch: 'Indore Main', swift: 'HDFCINBB', upi_id: 'acme@hdfcbank' });
    expect(full.headers['cache-control']).toMatch(/no-store/);
    expect((await get(`/accounts/${id}/bank-details`, recruiterToken)).status).toBe(403);
    expect((await request(app).get(`/api/v1/accounts/${id}/bank-details`)).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { entity_id: id, action: 'view_bank_details' } })).toBe(1);
    // a client account has no bank details
    const client = await post('/accounts', { type: 'client', name: 'Some Client' });
    expect((await get(`/accounts/${client.body.data.id}/bank-details`)).status).toBe(404);
  });

  test('editing: change one field, clear another; the audit trail never holds the full account number', async () => {
    const id = (await get('/accounts?search=Bank%20Vendor')).body.data[0].id;
    const edit = await patch(`/accounts/${id}`, { vendor_bank_name: 'ICICI Bank', vendor_upi_id: '', vendor_bank_account_number: '60100099998888' });
    expect(edit.status).toBe(200);
    expect(edit.body.data).toMatchObject({ vendor_bank_name: 'ICICI Bank', vendor_upi_id: null });
    expect(edit.body.data.vendor_bank_account_number).toBe('••••••••••8888');
    expect((await get(`/accounts/${id}/bank-details`)).body.data.account_number).toBe('60100099998888');
    const logs = await prisma.auditLog.findMany({ where: { entity_id: id, entity_type: 'account' } });
    const text = JSON.stringify(logs);
    expect(text).not.toContain('50200012345678');
    expect(text).not.toContain('60100099998888');
    expect(text).toMatch(/vendor bank account number/); // it records that the number changed, not what it was
    // saving the other fields without touching the number keeps it
    await patch(`/accounts/${id}`, { vendor_bank_branch: 'Pune' });
    expect((await get(`/accounts/${id}/bank-details`)).body.data.account_number).toBe('60100099998888');
    // the account number can be removed on purpose
    await patch(`/accounts/${id}`, { vendor_bank_account_number: '' });
    expect((await get(`/accounts/${id}`)).body.data).toMatchObject({ vendor_bank_account_number: null, has_bank_account_number: false });
  });

  test('formats are checked, and a masked value cannot be saved back by mistake', async () => {
    const id = (await get('/accounts?search=Bank%20Vendor')).body.data[0].id;
    const bad = async (body) => (await patch(`/accounts/${id}`, body)).status;
    expect(await bad({ vendor_bank_ifsc: 'HDFC1234567' })).toBe(422); // the fifth character must be a zero
    expect(await bad({ vendor_bank_swift: 'ABC' })).toBe(422);
    expect(await bad({ vendor_upi_id: 'no-at-sign' })).toBe(422);
    expect(await bad({ vendor_bank_account_number: '••••••••••8888' })).toBe(422); // the masked text from the screen
    expect(await bad({ vendor_bank_account_number: '12' })).toBe(422);
    expect(await bad({ vendor_bank_holder: 'x'.repeat(200) })).toBe(422);
    // spaces and dashes in an account number are tidied, not refused
    expect(await bad({ vendor_bank_account_number: '6010 0099-998888' })).toBe(200);
    expect((await get(`/accounts/${id}/bank-details`)).body.data.account_number).toBe('60100099998888');
  });
});
