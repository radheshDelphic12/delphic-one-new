jest.setTimeout(120000);
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');

// The Delphic One workspace: customers, leads (notes, conversion to a customer), invoices with part payments, overdue collection follow-ups, dashboard, access.

const D = '/api/v1/delphic-one';
let org; let adminToken; let salesToken; let employeeToken; let otherToken;
const get = (path, query, token = adminToken) => authed(request(app).get(`${D}${path}`), token).query(query || {});
const post = (path, body, token = adminToken) => authed(request(app).post(`${D}${path}`), token).send(body || {});
const patch = (path, body, token = adminToken) => authed(request(app).patch(`${D}${path}`), token).send(body || {});
const del = (path, token = adminToken) => authed(request(app).delete(`${D}${path}`), token);
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

async function member(role, orgId = org.id) {
  const u = await createUser({ role, withOrg: false });
  await createOrgMembership(u.id, orgId, { role });
  return { user: u, token: (await loginAs(u)).access_token };
}

beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE dox_customers, dox_leads, dox_lead_notes, dox_invoices, dox_invoice_payments, invoice_followups');
  org = await createOrg({ name: 'Delphic One', slug: 'delphic-one' });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['delphic_one'] } });
  ({ token: adminToken } = await member('admin'));
  ({ token: salesToken } = await member('sales'));
  ({ token: employeeToken } = await member('employee'));
  const other = await createOrg({ name: 'Some Other Co', slug: 'some-other' });
  ({ token: otherToken } = await member('admin', other.id));
});
afterAll(async () => { await prisma.$disconnect(); });

const customer = (over = {}) => post('/customers', { name: 'Ginnar Tech', contact_email: 'ops@ginnar.example', status: 'active', plan_name: 'IT Services', users_count: 12, monthly_value: 4000, ...over });

describe('access', () => {
  test('admin and sales work here, an employee or another company does not', async () => {
    expect((await get('/me')).body.data.caps).toContain('invoicesEdit');
    expect((await get('/me', {}, salesToken)).body.data.caps).not.toContain('invoicesEdit');
    expect((await get('/customers', {}, employeeToken)).status).toBe(403);
    expect((await get('/customers', {}, otherToken)).status).toBe(403); // not a Delphic One workspace
    expect((await post('/invoices', {}, salesToken)).status).toBe(403);
  });
});

describe('customers', () => {
  test('add, edit, filter, and a customer with invoices is not deleted', async () => {
    const c = (await customer()).body.data;
    expect(c).toMatchObject({ name: 'Ginnar Tech', status: 'active', monthly_value: 4000 });
    expect((await patch(`/customers/${c.id}`, { status: 'read_only', users_count: 15 })).body.data).toMatchObject({ status: 'read_only', users_count: 15 });
    expect((await get('/customers', { status: 'active' })).body.data).toHaveLength(0);
    expect((await get('/customers', { q: 'ginnar' })).body.data).toHaveLength(1);
    await post('/invoices', { customer_id: c.id, amount: 1000 });
    expect((await del(`/customers/${c.id}`)).status).toBe(409);
    const empty = (await customer({ name: 'Empty Co' })).body.data;
    expect((await del(`/customers/${empty.id}`)).status).toBe(200);
    expect((await get('/customers')).body.data).toHaveLength(1);
  });
});

describe('leads', () => {
  test('notes move the stage, a follow-up date is due, and winning a lead creates a customer on a trial', async () => {
    const lead = (await post('/leads', { company_name: 'Acme Staffing', contact_name: 'Rita', contact_email: 'rita@acme.example', source: 'website', expected_value: 5000, users_expected: 20, next_followup_date: day(-1) }, salesToken)).body.data;
    expect(lead).toMatchObject({ stage: 'new', followup_due: true });
    expect((await get('/leads', { followup: 'due' })).body.data).toHaveLength(1);

    const note = await post(`/leads/${lead.id}/notes`, { note: 'Called, wants a demo on Friday', stage: 'demo', next_followup_date: day(4) }, salesToken);
    expect(note.status).toBe(201);
    expect(note.body.data.lead).toMatchObject({ stage: 'demo', followup_due: false });
    expect((await get(`/leads/${lead.id}/notes`)).body.data.map((n) => n.note)).toContain('Called, wants a demo on Friday');

    expect((await patch(`/leads/${lead.id}`, { stage: 'won' })).status).toBe(422); // won only through convert
    const won = await post(`/leads/${lead.id}/convert`, { trial_days: 15, plan_name: 'IT Services' }, salesToken);
    expect(won.status).toBe(201);
    expect(won.body.data.customer).toMatchObject({ name: 'Acme Staffing', status: 'trial', plan_name: 'IT Services', users_count: 20, monthly_value: 5000, trial_ends_on: day(15) });
    expect(won.body.data.lead).toMatchObject({ stage: 'won', customer_id: won.body.data.customer.id });
    expect((await post(`/leads/${lead.id}/convert`, {})).status).toBe(409);
    expect((await patch(`/leads/${lead.id}`, { stage: 'new' })).status).toBe(409);

    const lost = (await post('/leads', { company_name: 'Nope Ltd' })).body.data;
    expect((await patch(`/leads/${lost.id}`, { stage: 'lost', lost_reason: 'Too expensive' })).body.data).toMatchObject({ stage: 'lost', lost_reason: 'Too expensive' });
  });
});

describe('invoices, payments and collection', () => {
  test('numbering, GST, part payments, overdue, follow-ups and the filters', async () => {
    const c = (await customer()).body.data;
    const a = (await post('/invoices', { customer_id: c.id, amount: 10000, gst_rate: 18, invoice_date: '2026-11-01', due_date: day(-10), description: 'Nov 2026 subscription' })).body.data;
    expect(a).toMatchObject({ number: 'DO/2026-27/0001', amount: 10000, gst_amount: 1800, total: 11800, balance: 11800, payment_status: 'unpaid', overdue: true, days_overdue: 10 });
    const b = (await post('/invoices', { customer_id: c.id, amount: 2000, invoice_date: '2026-11-05', due_date: day(20) })).body.data;
    expect(b.number).toBe('DO/2026-27/0002');
    expect((await post('/invoices', { customer_id: c.id, amount: 1, number: a.number })).status).toBe(409); // an edited number cannot repeat

    // a part payment, then too much
    const part = await post(`/invoices/${a.id}/payments`, { amount: 5000, mode: 'neft', reference: 'UTR123' });
    expect(part.body.data).toMatchObject({ paid: 5000, balance: 6800, payment_status: 'part_paid', overdue: true });
    expect((await post(`/invoices/${a.id}/payments`, { amount: 9999 })).status).toBe(422);

    // overdue filter and totals
    const overdue = (await get('/invoices', { filter: 'overdue' })).body.data;
    expect(overdue.rows.map((r) => r.number)).toEqual([a.number]);
    expect(overdue.totals).toMatchObject({ overdue: 6800, overdue_count: 1 });

    // a follow-up with its note and the next date
    const chase = await post(`/invoices/${a.id}/followups`, { note: 'Accounts will pay on Monday', next_followup_date: day(-1) });
    expect(chase.status).toBe(201);
    const due = (await get('/invoices', { filter: 'followup_due' })).body.data.rows;
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ number: a.number, followup_count: 1, last_followup_note: 'Accounts will pay on Monday' });
    expect((await get(`/invoices/${a.id}/followups`)).body.data.followups).toHaveLength(1);

    // paying the rest clears it: not overdue, no follow-up left
    const paid = await post(`/invoices/${a.id}/payments`, { amount: 6800 });
    expect(paid.body.data).toMatchObject({ payment_status: 'paid', balance: 0, overdue: false, next_followup_date: null });
    expect((await get('/invoices', { filter: 'overdue' })).body.data.rows).toHaveLength(0);
    expect((await get('/invoices', { filter: 'paid' })).body.data.rows).toHaveLength(1);

    // an invoice with no due date shows in its own filter and a due date can be set
    const c2 = (await post('/invoices', { customer_id: c.id, amount: 100 })).body.data;
    expect((await get('/invoices', { filter: 'no_due_date' })).body.data.rows.map((r) => r.id)).toEqual([c2.id]);
    expect((await patch(`/invoices/${c2.id}/collection`, { due_date: day(-3) })).status).toBe(200);
    expect((await get('/invoices', { filter: 'overdue' })).body.data.rows.map((r) => r.id)).toEqual([c2.id]);

    // cancel: refused with payments, allowed without
    expect((await post(`/invoices/${a.id}/cancel`, { reason: 'mistake' })).status).toBe(409);
    expect((await post(`/invoices/${c2.id}/cancel`, { reason: 'Raised by mistake' })).body.data).toMatchObject({ status: 'cancelled', payment_status: 'cancelled' });
    // the customer's outstanding balance follows the invoices
    expect((await get('/customers')).body.data[0].outstanding).toBe(2360);
  });

  test('the dashboard adds it up', async () => {
    const c = (await customer({ monthly_value: 4000 })).body.data;
    await customer({ name: 'Trial Co', status: 'trial', monthly_value: 999, trial_ends_on: day(3) });
    await post('/invoices', { customer_id: c.id, amount: 1000, due_date: day(-2) });
    await post('/leads', { company_name: 'L1', stage: 'demo', expected_value: 300 });
    await post('/leads', { company_name: 'L2', next_followup_date: day(-1) });
    const s = (await get('/summary')).body.data;
    expect(s.customers).toMatchObject({ total: 2, mrr: 4000 }); // only active customers count for the recurring revenue
    expect(s.customers.by_status).toMatchObject({ active: 1, trial: 1 });
    expect(s.customers.trials_ending).toHaveLength(1);
    expect(s.leads).toMatchObject({ total: 2, open: 2, followups_due: 1 });
    expect(s.leads.stages.find((x) => x.stage === 'demo')).toMatchObject({ count: 1, expected_value: 300 });
    expect(s.receivables).toMatchObject({ outstanding: 1180, overdue: 1180, overdue_count: 1 });
  });
});
