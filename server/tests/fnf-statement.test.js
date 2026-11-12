/**
 * FnF statement of an exited employee: what is still payable, the lines added by hand, the PDF, the documents package (statement + every salary slip
 * since joining) as a zip, and emailing it. Also the salary slip's own PDF content is built here (one per payslip).
 */
const fs = require('fs');
const JSZip = require('jszip');
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const api = (p) => `/api/v1${p}`;

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
  const adminUser = await createUser({ role: 'admin', name: 'Boss Admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin', joined_at: new Date('2025-01-01') });
  const adminToken = (await loginAs(adminUser)).access_token;
  const user = await createUser({ role: 'employee', name: 'Leaver Person' });
  const membership = await createOrgMembership(user.id, org.id, { role: 'employee', joined_at: new Date('2026-01-12'), employee_code: 'E-901' });
  await prisma.orgMembership.update({ where: { id: membership.id }, data: { employment_status: 'terminated', left_at: new Date('2026-09-30') } });
  await prisma.salaryStructure.create({ data: { org_id: org.id, org_membership_id: membership.id, effective_from: new Date('2026-01-12'), ctc: 60000, components: { basic: 30000, hra: 30000 }, created_by: adminUser.id } });
  const slips = [];
  for (const [month, net, paid] of [[7, 60000, 60000], [8, 63000, 50000], [9, 58000, null]]) {
    const run = await prisma.payrollRun.create({ data: { org_id: org.id, period_month: month, period_year: 2026, status: 'processed' } });
    slips.push(await prisma.payslip.create({ data: { org_id: org.id, payroll_run_id: run.id, org_membership_id: membership.id, gross: net + 1000, deductions: 1000, net, breakdown: { ot_approved_hours: month === 8 ? 4 : 0, ot_amount: month === 8 ? 3000 : 0, hourly_rate: 375, ot_multiplier: 2 } } }));
    if (paid !== null) await prisma.salaryPayment.create({ data: { org_id: org.id, org_membership_id: membership.id, period_month: month, period_year: 2026, paid_on: new Date('2026-10-05'), amount_paid: paid, updated_by: adminUser.id } });
  }
  return { org, adminToken, membership, user, slips };
}

const bufferParse = (res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); };

describe('FnF statement', () => {
  test('salary still due from the payslips, lines added by hand, totals, and only for an exited employee', async () => {
    const { adminToken, membership } = await seed();
    let res = await authed(request(app).get(api(`/payroll/fnf/${membership.id}/statement`)), adminToken);
    expect(res.status).toBe(200);
    const s = res.body.data;
    expect(s.employee).toMatchObject({ name: 'Leaver Person', employee_code: 'E-901', joined_at: '2026-01-12', last_working_day: '2026-09-30' });
    expect(s.employee.service_text).toContain('8 months');
    // August was paid 50,000 of 63,000; July is paid in full; September has no payment recorded (nothing to claim from here)
    expect(s.earnings.map((l) => [l.label, l.amount])).toEqual(expect.arrayContaining([['Salary due: Aug 2026', 13000]]));
    expect(s.earnings.find((l) => l.label.includes('Jul'))).toBeUndefined();
    expect(s.payslips.map((p) => p.period)).toEqual(['Jul 2026', 'Aug 2026', 'Sep 2026']);
    expect(s.salary_history).toEqual([{ effective_from: '2026-01-12', ctc: 60000 }]);

    // lines added by hand: leave encashment (earning) and a notice-period recovery (deduction)
    const saved = await authed(request(app).put(api(`/payroll/fnf/${membership.id}/items`)), adminToken).send({ items: [{ label: 'Leave encashment (6 days)', kind: 'earning', amount: 12000 }, { label: 'Notice period recovery', kind: 'deduction', amount: 5000, note: '10 days short' }] });
    expect(saved.status).toBe(200);
    res = await authed(request(app).get(api(`/payroll/fnf/${membership.id}/statement`)), adminToken);
    const manualEarning = res.body.data.earnings.find((l) => l.label.startsWith('Leave encashment'));
    expect(manualEarning).toMatchObject({ amount: 12000, auto: false });
    expect(res.body.data.deductions).toEqual([expect.objectContaining({ label: 'Notice period recovery', amount: 5000, note: '10 days short' })]);
    const earned = res.body.data.earnings.reduce((t, l) => t + l.amount, 0);
    expect(res.body.data.totals).toMatchObject({ earnings: earned, deductions: 5000, net_payable: earned - 5000 });
    expect((await authed(request(app).put(api(`/payroll/fnf/${membership.id}/items`)), adminToken).send({ items: [{ label: '', kind: 'earning', amount: 1 }] })).status).toBe(422);

    // a working employee has no FnF statement
    const stay = await createUser({ role: 'employee', name: 'Still Here' });
    const stayMember = await createOrgMembership(stay.id, (await prisma.org.findFirst()).id, { role: 'employee' });
    expect((await authed(request(app).get(api(`/payroll/fnf/${stayMember.id}/statement`)), adminToken)).status).toBe(422);
    expect((await authed(request(app).get(api(`/payroll/fnf/${'11111111-1111-4111-8111-111111111111'}/statement`)), adminToken)).status).toBe(404);
  });

  test('the statement PDF and the documents package: the statement and one salary slip per month since joining', async () => {
    const { adminToken, membership } = await seed();
    const pdf = await authed(request(app).get(api(`/payroll/fnf/${membership.id}/statement.pdf`)), adminToken).buffer(true).parse(bufferParse);
    expect(pdf.status).toBe(200);
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    expect(pdf.headers['content-disposition']).toContain('FnF-Statement-Leaver-Person.pdf');

    const pack = await authed(request(app).get(api(`/payroll/fnf/${membership.id}/documents.zip`)), adminToken).buffer(true).parse(bufferParse);
    expect(pack.status).toBe(200);
    expect(pack.headers['content-disposition']).toContain('FnF-Documents-Leaver-Person.zip');
    const zip = await JSZip.loadAsync(pack.body);
    expect(Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort()).toEqual(['FnF-Statement.pdf', 'Salary-Slips/2026-07-Salary-Slip.pdf', 'Salary-Slips/2026-08-Salary-Slip.pdf', 'Salary-Slips/2026-09-Salary-Slip.pdf']);
    const slip = await zip.file('Salary-Slips/2026-08-Salary-Slip.pdf').async('nodebuffer');
    expect(slip.slice(0, 4).toString()).toBe('%PDF');
    // an employee cannot pull it
    const emp = await createUser({ role: 'employee', name: 'Plain Employee' });
    await createOrgMembership(emp.id, (await prisma.org.findFirst()).id, { role: 'employee' });
    expect((await authed(request(app).get(api(`/payroll/fnf/${membership.id}/documents.zip`)), (await loginAs(emp)).access_token)).status).toBe(403);
  });

  test('emailing the package queues one mail with the zip attached; a bad address is refused', async () => {
    const { adminToken, membership } = await seed();
    expect((await authed(request(app).post(api(`/payroll/fnf/${membership.id}/email`)), adminToken).send({ to_email: 'not-an-email' })).status).toBe(422);
    const res = await authed(request(app).post(api(`/payroll/fnf/${membership.id}/email`)), adminToken).send({ to_email: 'leaver@gmail.com', note: 'Thank you for your work with us.' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ queued: true, to: 'leaver@gmail.com', payslips: 3 });
    const row = await prisma.emailOutbox.findFirst({ where: { kind: 'fnf_documents' } });
    expect(row).toMatchObject({ to_email: 'leaver@gmail.com', attachment_name: 'FnF-Documents-Leaver-Person.zip', status: 'queued' });
    expect(row.subject).toContain('Full & Final settlement documents');
    expect(row.body_text).toContain('Thank you for your work with us.');
    expect(row.body_text).toContain('3 salary slips');
    // the file waits on the server until it is sent, and it is the same zip
    expect(fs.existsSync(row.attachment_path)).toBe(true);
    const zip = await JSZip.loadAsync(fs.readFileSync(row.attachment_path));
    expect(zip.file('FnF-Statement.pdf')).toBeTruthy();
    // sending it hands the file to the mail transport and removes it afterwards
    const sent = [];
    const { processQueue } = require('../src/lib/email/outbox');
    await processQueue({ transport: { sendMail: async (mail) => { sent.push(mail); } } });
    expect(sent).toHaveLength(1);
    expect(sent[0].attachments[0]).toMatchObject({ filename: 'FnF-Documents-Leaver-Person.zip', contentType: 'application/zip' });
    expect(sent[0].attachments[0].content.slice(0, 2).toString()).toBe('PK');
    await new Promise((r) => setTimeout(r, 100));
    expect(fs.existsSync(row.attachment_path)).toBe(false);
    expect((await prisma.emailOutbox.findUnique({ where: { id: row.id } })).status).toBe('sent');
  });
});
