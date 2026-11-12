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

  test('processed reimbursements report: the day each claim was reimbursed, with submitted / approved dates, filters and Excel', async () => {
    const ctx = await seed();
    const a = await ctx.person('Abhishek', { employee_code: 'E001' });
    const b = await ctx.person('Riya');
    const done = (who, amount, { processed, submitted, approved, category }) => ctx.claim(who, { amount, status: 'reimbursed', category }).then((c) => prisma.expenseClaim.update({
      where: { id: c.id }, data: { reimbursed_at: new Date(processed), created_at: new Date(submitted), decided_at: new Date(approved) },
    }));
    await done(a, 1000, { submitted: '2026-10-01T06:00:00Z', approved: '2026-10-03T06:00:00Z', processed: '2026-10-10T06:00:00Z', category: 'Travel' });
    await done(a, 250.5, { submitted: '2026-10-05T06:00:00Z', approved: '2026-10-06T06:00:00Z', processed: '2026-10-20T06:00:00Z', category: 'Food' });
    await done(b, 700, { submitted: '2026-10-08T06:00:00Z', approved: '2026-10-09T06:00:00Z', processed: '2026-10-10T20:00:00Z', category: 'Food' });
    await ctx.claim(a, { amount: 55, status: 'approved' }); // approved but never reimbursed: not in the report
    await ctx.claim(b, { amount: 66, status: 'pending' });
    // late evening UTC is the next IST day: 2026-10-31T19:00Z -> 1 Nov 00:30 IST
    await done(b, 10, { submitted: '2026-10-30T06:00:00Z', approved: '2026-10-30T07:00:00Z', processed: '2026-10-31T19:00:00Z', category: 'Food' });

    const REPORT = '/api/v1/expenses/claims/processed';
    const all = await authed(request(app).get(REPORT), ctx.adminToken);
    expect(all.status).toBe(200);
    expect(all.body.data.rows).toHaveLength(4);
    // newest processed first
    expect(all.body.data.rows.map((r) => [r.employee, r.processed_on])).toEqual([['Riya', '2026-11-01'], ['Abhishek', '2026-10-20'], ['Riya', '2026-10-11'], ['Abhishek', '2026-10-10']]);
    expect(all.body.data.rows[3]).toMatchObject({ employee_code: 'E001', category: 'Travel', submitted_on: '2026-10-01', approved_on: '2026-10-03', days_to_process: 9, amount: 1000, currency: 'INR' });
    expect(all.body.data.totals).toEqual([{ currency: 'INR', amount: 1960.5 }]);

    // the date range is on the processing day (IST), both ends inclusive
    const day = await authed(request(app).get(REPORT), ctx.adminToken).query({ from: '2026-10-10', to: '2026-10-10' });
    expect(day.body.data.rows.map((r) => r.employee)).toEqual(['Abhishek']); // Riya's 20:00 UTC is already 11 Oct in IST
    const two = await authed(request(app).get(REPORT), ctx.adminToken).query({ from: '2026-10-10', to: '2026-10-11' });
    expect(two.body.data.rows.map((r) => r.employee).sort()).toEqual(['Abhishek', 'Riya']);
    const edge = await authed(request(app).get(REPORT), ctx.adminToken).query({ from: '2026-11-01', to: '2026-11-01' });
    expect(edge.body.data.rows.map((r) => r.amount)).toEqual([10]);
    expect((await authed(request(app).get(REPORT), ctx.adminToken).query({ from: '2026-12-01' })).body.data.rows).toEqual([]);
    // one employee
    const mine = await authed(request(app).get(REPORT), ctx.adminToken).query({ org_membership_id: a.membership.id });
    expect(mine.body.data.rows.map((r) => r.amount)).toEqual([250.5, 1000]);
    expect(mine.body.data.average_days).toBeGreaterThan(0);

    // Excel
    const xl = await authed(request(app).get(REPORT), ctx.adminToken).query({ from: '2026-10-10', to: '2026-10-20', format: 'xlsx' }).buffer(true).parse((r, cb) => { const c = []; r.on('data', (x) => c.push(x)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(xl.status).toBe(200);
    expect(xl.headers['content-disposition']).toContain('processed-reimbursements-2026-10-10-to-2026-10-20.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xl.body);
    const sheet = wb.getWorksheet('Processed reimbursements');
    expect(sheet.getRow(2).getCell(1).value).toBe('Processed on');
    expect(sheet.getRow(3).getCell(1).value).toBe('2026-10-20');
    expect(sheet.getRow(sheet.rowCount).getCell(2).value).toBe('Total (INR)');
  });

  test('processed report is admin only', async () => {
    const ctx = await seed();
    const emp = await ctx.person('Abhishek');
    expect((await authed(request(app).get('/api/v1/expenses/claims/processed'), emp.token)).status).toBe(403);
    expect((await authed(request(app).get('/api/v1/expenses/claims/processed'), ctx.adminToken).query({ from: 'yesterday' })).status).toBe(422);
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
