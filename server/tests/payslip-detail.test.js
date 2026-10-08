// Payslip redesign: the slip's detail (employee + bank, leaves, salary breakup, itemized
// adjustments), employee-only access to one's own payslip, Aadhaar / PAN on the profile,
// and bank columns in the salary Excel export.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const api = (p) => `/api/v1${p}`;
const PERIOD = { period_month: 9, period_year: 2026 };

async function member(org, role, name) {
  const user = await createUser({ role, name });
  const membership = await createOrgMembership(user.id, org.id, { role, joined_at: new Date('2026-01-01'), employee_code: `E-${name.slice(0, 3)}` });
  return { user, membership, token: (await loginAs(user)).access_token };
}

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
  const admin = await member(org, 'admin', 'Boss Admin');
  const a = await member(org, 'employee', 'Alice Employee');
  const b = await member(org, 'employee', 'Bob Employee');
  const dept = await prisma.department.create({ data: { name: 'Engineering', org_id: org.id } });
  await prisma.orgMembership.update({ where: { id: a.membership.id }, data: { department_id: dept.id } });
  const run = await prisma.payrollRun.create({ data: { org_id: org.id, ...PERIOD, status: 'processed' } });
  const slip = (m, net) => prisma.payslip.create({ data: { org_id: org.id, payroll_run_id: run.id, org_membership_id: m.membership.id, gross: 60000, deductions: 3000, net, breakdown: {} } });
  return { org, admin, a, b, slipA: await slip(a, 62000), slipB: await slip(b, 57000) };
}

describe('Payslip detail', () => {
  test('details, bank + identity, salary breakup, leaves and itemized adjustments', async () => {
    const { org, admin, a, slipA } = await seed();
    const saved = await authed(request(app).put(api('/orgs/me/details')), a.token).send({ bank_account_number: '123456789012', bank_ifsc: 'hdfc0001234', aadhaar_number: '1234 5678 9012', pan_number: 'abcde1234f' });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ aadhaar_number: '123456789012', pan_number: 'ABCDE1234F', bank_ifsc: 'HDFC0001234' });
    expect((await authed(request(app).put(api('/orgs/me/details')), a.token).send({ pan_number: 'nope' })).status).toBe(422);
    expect((await authed(request(app).put(api('/orgs/me/details')), a.token).send({ aadhaar_number: '12345' })).status).toBe(422);

    await prisma.salaryStructure.create({ data: { org_id: org.id, org_membership_id: a.membership.id, effective_from: new Date('2026-01-01'), ctc: 60000, components: { basic: 30000, hra: 20000, special_allowance: 10000 }, created_by: admin.user.id } });
    await authed(request(app).post(api('/payroll/adjustments')), admin.token).send({ org_membership_id: a.membership.id, kind: 'variable_pay', amount: 6000, ...PERIOD, note: 'Q2 bonus' });
    await authed(request(app).post(api('/payroll/adjustments')), admin.token).send({ org_membership_id: a.membership.id, kind: 'tds', amount: 1000, ...PERIOD });

    const res = await authed(request(app).get(api(`/payroll/payslips/${slipA.id}`)), a.token);
    expect(res.status).toBe(200);
    const d = res.body.data.detail;
    expect(d.employee).toMatchObject({ employee_code: 'E-Ali', name: 'Alice Employee', department: 'Engineering', aadhaar_number: '123456789012', pan_number: 'ABCDE1234F', bank_account_number: '123456789012', bank_ifsc: 'HDFC0001234' });
    expect(d.salary.monthly_ctc).toBe(60000);
    expect(d.salary.components.map((c) => c.name).sort()).toEqual(['basic', 'hra', 'special_allowance']);
    expect(d.leaves.map((l) => l.code)).toEqual(expect.arrayContaining(['CL', 'SL', 'EL']));
    expect(d.additions).toEqual([expect.objectContaining({ label: 'Variable pay', amount: 6000, note: 'Q2 bonus' })]);
    expect(d.other_deductions).toEqual([expect.objectContaining({ label: 'TDS adjustment', amount: 1000 })]);
    expect(d.totals).toMatchObject({ gross: 60000, loss_of_pay: 3000, net_paid: 62000 });
  });

  test('an employee reads only their own payslip; admin reads any; "me" lists only own', async () => {
    const { admin, a, b, slipA, slipB } = await seed();
    expect((await authed(request(app).get(api(`/payroll/payslips/${slipA.id}`)), a.token)).status).toBe(200);
    expect((await authed(request(app).get(api(`/payroll/payslips/${slipB.id}`)), a.token)).status).toBe(404);
    expect((await authed(request(app).get(api(`/payroll/payslips/${slipA.id}`)), b.token)).status).toBe(404);
    expect((await authed(request(app).get(api(`/payroll/payslips/${slipB.id}`)), admin.token)).status).toBe(200);
    const mine = await authed(request(app).get(api('/payroll/payslips/me')), a.token);
    expect(mine.body.data.map((p) => p.id)).toEqual([slipA.id]);
  });
});

describe('Salary sheet bank columns', () => {
  test('the salary rows (table) and the Excel export carry account number and IFSC', async () => {
    const { org, admin, a } = await seed();
    await prisma.orgMembership.update({ where: { id: a.membership.id }, data: { bank_account_number: '9988776655', bank_ifsc: 'SBIN0000001' } });
    await prisma.salaryStructure.create({ data: { org_id: org.id, org_membership_id: a.membership.id, effective_from: new Date('2026-01-01'), ctc: 60000, components: { basic: 60000 }, created_by: admin.user.id } });
    const json = await authed(request(app).get(api('/calculations/export/salary')), admin.token).query({ ...PERIOD, format: 'json' });
    expect(json.status).toBe(200);
    expect(json.body.data.find((r) => r.employee === 'Alice Employee')).toMatchObject({ bank_account_number: '9988776655', bank_ifsc: 'SBIN0000001' });

    const ExcelJS = require('exceljs');
    const xlsx = await authed(request(app).get(api('/calculations/export/salary')), admin.token).query(PERIOD).buffer(true).parse((r, cb) => { const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body);
    const sheet = wb.worksheets[0];
    const headerRow = sheet.getRow(1).values.includes('Employee') ? 1 : 2;
    const headers = sheet.getRow(headerRow).values;
    expect(headers).toEqual(expect.arrayContaining(['Account Number', 'IFSC Code']));
  });
});
