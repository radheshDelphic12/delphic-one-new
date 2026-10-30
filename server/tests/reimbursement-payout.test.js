// Bank payout of reimbursements: one row per employee with the bank account on their profile and the total of their claims
// for a month and status, as a preview (json) and as an Excel file. Read only.
const ExcelJS = require('exceljs');
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const PAYOUT = '/api/v1/expenses/claims/payout';

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
  const admin = await createUser({ role: 'admin' });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(admin)).access_token;
  const location = await prisma.location.create({ data: { org_id: org.id, name: 'Indore' } });
  const person = async (name, bank) => {
    const user = await createUser({ role: 'recruiter', name });
    const membership = await createOrgMembership(user.id, org.id, { role: 'recruiter' });
    if (bank) await prisma.orgMembership.update({ where: { id: membership.id }, data: bank });
    return { user, membership, token: (await loginAs(user)).access_token };
  };
  const claim = (who, { amount, status = 'approved', date = '2026-10-05', currency = 'INR', category = 'Travel' }) =>
    prisma.expenseClaim.create({ data: { org_id: org.id, org_membership_id: who.membership.id, location_id: location.id, category, description: `${category} claim`, amount, currency, status, expense_date: new Date(`${date}T00:00:00Z`) } });
  return { org, adminToken, person, claim };
}

describe('reimbursement bank payout', () => {
  test('sums the approved claims of each employee for the month, with the bank account from their profile', async () => {
    const ctx = await seed();
    const abhishek = await ctx.person('Abhishek', { bank_account_number: '160005001749', bank_ifsc: 'ICIC0001600', employee_code: 'E001' });
    const riya = await ctx.person('Riya', { bank_account_number: '50100123456', bank_ifsc: 'HDFC0000001' });
    const noBank = await ctx.person('Zed');
    for (const amount of [1000, 250.5, 400, 99.5]) await ctx.claim(abhishek, { amount });
    await ctx.claim(riya, { amount: 700 });
    await ctx.claim(noBank, { amount: 300 });
    // not part of this payout: another month, another status
    await ctx.claim(abhishek, { amount: 5000, date: '2026-09-28' });
    await ctx.claim(abhishek, { amount: 111, status: 'reimbursed' });
    await ctx.claim(riya, { amount: 222, status: 'pending' });
    await ctx.claim(riya, { amount: 333, status: 'rejected' });

    const res = await authed(request(app).get(PAYOUT), ctx.adminToken).query({ period_month: 10, period_year: 2026, format: 'json' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
    expect(res.body.data.rows.map((r) => [r.employee, r.claims, r.amount])).toEqual([['Abhishek', 4, 1750], ['Riya', 1, 700], ['Zed', 1, 300]]);
    expect(res.body.data.rows[0]).toMatchObject({ bank_account_number: '160005001749', bank_ifsc: 'ICIC0001600', employee_code: 'E001', currency: 'INR', bank_missing: false });
    expect(res.body.data.rows[2]).toMatchObject({ bank_account_number: '', bank_missing: true });
    expect(res.body.data.totals).toEqual([{ currency: 'INR', amount: 2750 }]);
    expect(res.body.data.bank_missing_count).toBe(1);
    expect(res.body.data.details).toHaveLength(6);
  });

  test('month and status are the filters: another month, or the reimbursed ones, give their own list', async () => {
    const ctx = await seed();
    const a = await ctx.person('Abhishek', { bank_account_number: '1111222233', bank_ifsc: 'ICIC0000001' });
    await ctx.claim(a, { amount: 5000, date: '2026-09-28' });
    await ctx.claim(a, { amount: 111, status: 'reimbursed' });
    await ctx.claim(a, { amount: 40 });

    const sept = await authed(request(app).get(PAYOUT), ctx.adminToken).query({ period_month: 9, period_year: 2026, format: 'json' });
    expect(sept.body.data.rows.map((r) => r.amount)).toEqual([5000]);
    const done = await authed(request(app).get(PAYOUT), ctx.adminToken).query({ period_month: 10, period_year: 2026, status: 'reimbursed', format: 'json' });
    expect(done.body.data.rows.map((r) => r.amount)).toEqual([111]);
    const none = await authed(request(app).get(PAYOUT), ctx.adminToken).query({ period_month: 1, period_year: 2026, format: 'json' });
    expect(none.body.data.rows).toEqual([]);
    expect(none.body.data.totals).toEqual([]);
  });

  test('a claim without an expense date counts in the month it was submitted; another currency stays on its own row', async () => {
    const ctx = await seed();
    const a = await ctx.person('Abhishek', { bank_account_number: '1111222233', bank_ifsc: 'ICIC0000001' });
    const old = await ctx.claim(a, { amount: 90 });
    await prisma.expenseClaim.update({ where: { id: old.id }, data: { expense_date: null, created_at: new Date('2026-10-12T10:00:00Z') } });
    await ctx.claim(a, { amount: 15, currency: 'USD' });

    const res = await authed(request(app).get(PAYOUT), ctx.adminToken).query({ period_month: 10, period_year: 2026, format: 'json' });
    expect(res.body.data.rows.map((r) => [r.currency, r.amount])).toEqual([['INR', 90], ['USD', 15]]);
    expect(res.body.data.totals).toEqual([{ currency: 'INR', amount: 90 }, { currency: 'USD', amount: 15 }]);
  });

  test('downloads as an Excel file: the bank sheet (with a total) and the claims behind it', async () => {
    const ctx = await seed();
    const a = await ctx.person('Abhishek', { bank_account_number: '160005001749', bank_ifsc: 'ICIC0001600' });
    await ctx.claim(a, { amount: 1000 });
    await ctx.claim(a, { amount: 250.5, category: 'Food' });

    const res = await authed(request(app).get(PAYOUT), ctx.adminToken).query({ period_month: 10, period_year: 2026 }).buffer(true).parse((r, cb) => { const c = []; r.on('data', (x) => c.push(x)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.headers['content-disposition']).toContain('reimbursement-payout-2026-10-approved.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const bank = wb.getWorksheet('Bank payout');
    expect(bank.getRow(1).getCell(1).value).toMatch(/October 2026 \(approved\)/);
    expect(bank.getRow(2).values.slice(1)).toEqual(['Employee', 'Code', 'Department', 'Account Number', 'IFSC Code', 'Claims', 'Amount', 'Currency']);
    expect(bank.getRow(3).getCell(1).value).toBe('Abhishek');
    expect(bank.getRow(3).getCell(4).value).toBe('160005001749'); // the account number stays text, never a number
    expect(bank.getRow(3).getCell(7).value).toBe(1250.5);
    expect(bank.getRow(4).getCell(1).value).toBe('Total (INR)');
    expect(bank.getRow(4).getCell(7).value).toBe(1250.5);
    expect(wb.getWorksheet('Claims').rowCount).toBe(3);
  });

  test('admin only, and a month is required', async () => {
    const ctx = await seed();
    const emp = await ctx.person('Abhishek');
    expect((await authed(request(app).get(PAYOUT), emp.token).query({ period_month: 10, period_year: 2026, format: 'json' })).status).toBe(403);
    expect((await authed(request(app).get(PAYOUT), ctx.adminToken).query({ format: 'json' })).status).toBe(422);
    expect((await authed(request(app).get(PAYOUT), ctx.adminToken).query({ period_month: 10, period_year: 2026, status: 'nonsense' })).status).toBe(422);
  });

  test('read only: the claims keep their status', async () => {
    const ctx = await seed();
    const a = await ctx.person('Abhishek', { bank_account_number: '1111222233', bank_ifsc: 'ICIC0000001' });
    await ctx.claim(a, { amount: 40 });
    await authed(request(app).get(PAYOUT), ctx.adminToken).query({ period_month: 10, period_year: 2026 }).buffer(true).parse((r, cb) => { r.on('data', () => {}); r.on('end', () => cb(null, null)); });
    expect(await prisma.expenseClaim.count({ where: { status: 'approved' } })).toBe(1);
    expect(await prisma.expenseClaim.count({ where: { status: 'reimbursed' } })).toBe(0);
  });
});
