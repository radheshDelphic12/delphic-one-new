/**
 * HR letters: admin-set templates with {{fields}}, an editable serial number format with a gap-safe counter, letters for employees,
 * past employees, candidates and vendors, cancel with a reason, and the PDF.
 */
const { app, prisma, request, cleanDatabase, createUser, createOrgMembership, createOrg, loginAs, authed } = require('./helpers');
const render = require('../src/modules/letters/letters.render');

let admin;
let adminToken;
let org;
const L = '/api/v1/letters';
const get = (path, query) => authed(request(app).get(`${L}${path}`), adminToken).query(query || {});
const post = (path, body, token = adminToken) => authed(request(app).post(`${L}${path}`), token).send(body);
const patch = (path, body) => authed(request(app).patch(`${L}${path}`), adminToken).send(body);

beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE letters, letter_templates, letter_counters'); // these tables have no link to orgs, so cleanDatabase leaves them
  admin = await createUser({ role: 'admin' });
  ({ access_token: adminToken } = await loginAs(admin));
  org = await prisma.org.findUnique({ where: { id: (await prisma.orgMembership.findFirst({ where: { person_id: admin.id } })).org_id } });
});
afterAll(async () => { await prisma.$disconnect(); });

async function employee(name, extra = {}) {
  const u = await createUser({ role: 'employee', name, withOrg: false });
  const designation = await prisma.designation.create({ data: { org_id: org.id, name: 'Software Engineer' } }).catch(() => null);
  const m = await createOrgMembership(u.id, org.id, { role: 'employee', employee_code: 'E-101', joined_at: new Date('2026-03-02T00:00:00Z') });
  if (designation) await prisma.orgMembership.update({ where: { id: m.id }, data: { designation_id: designation.id, ...extra } });
  return m;
}
const offerTemplate = (over = {}) => post('/templates', {
  name: 'Offer letter', kind: 'offer', audience: 'new_joiner', serial_prefix: 'OFR', subject: 'Offer of employment - {{designation}}',
  body: 'Dear {{employee_name}},\n\nWe are pleased to offer you the position of {{designation}} at {{company_name}} with an annual CTC of Rs. {{ctc}}, joining on {{joining_date}}.\n\nRef {{serial_number}}',
  signatory_name: 'Paras', signatory_title: 'Director', ...over,
});

describe('serial numbers and fields (pure)', () => {
  test('serial format tokens, financial year and one running number per series', () => {
    const d = new Date('2026-11-11T00:00:00Z');
    const { series, build } = render.serialParts('{PREFIX}/{FY}/{SEQ:4}', { prefix: 'ofr', issuedOn: d });
    expect(series).toBe('OFR/2026-27/#');
    expect(build(7)).toBe('OFR/2026-27/0007');
    expect(render.serialParts('{PREFIX}-{YYYY}{MM}-{SEQ:3}', { prefix: 'APR', issuedOn: d }).build(12)).toBe('APR-202611-012');
    expect(render.serialParts('{PREFIX}/{FY}/{SEQ:4}', { prefix: 'OFR', issuedOn: new Date('2027-03-31T00:00:00Z') }).series).toBe('OFR/2026-27/#'); // March is still 2026-27
    expect(render.serialParts('{PREFIX}/{FY}/{SEQ:4}', { prefix: 'OFR', issuedOn: new Date('2027-04-01T00:00:00Z') }).series).toBe('OFR/2027-28/#');
    expect(render.checkSerialFormat('{PREFIX}/{FY}/{SEQ:4}')).toBeNull();
    expect(render.checkSerialFormat('{PREFIX}/{FY}')).toMatch(/exactly one \{SEQ\}/);
    expect(render.checkSerialFormat('{PREFIX}/{SEQ}/{SEQ}')).toMatch(/exactly one/);
    expect(render.checkSerialFormat('{NOPE}/{SEQ}')).toMatch(/Unknown serial token/);
  });

  test('fields are found once, filled, and a missing one stays visible', () => {
    expect(render.fieldsIn('Hi {{ Name }}, {{name}} {{ctc}}', '{{date}}')).toEqual(['name', 'ctc', 'date']);
    const r = render.fill('Dear {{name}}, CTC {{ctc}}', { name: 'Asha' });
    expect(r).toEqual({ text: 'Dear Asha, CTC [ctc]', missing: ['ctc'] });
  });
});

describe('templates', () => {
  test('an admin writes a template; a serial format without a running number is refused; the fields are listed', async () => {
    expect((await offerTemplate({ serial_format: '{PREFIX}/{FY}' })).status).toBe(422);
    const res = await offerTemplate();
    expect(res.status).toBe(201);
    expect(res.body.data.fields).toEqual(['designation', 'employee_name', 'company_name', 'ctc', 'joining_date', 'serial_number']);
    expect(res.body.data.example_serial).toMatch(/^OFR\/\d{4}-\d{2}\/0001$/);
    expect((await get('/templates')).body.data).toHaveLength(1);
    expect((await get('/fields')).body.data.employee.map((f) => f.key)).toContain('joining_date');
    // the serial format can be edited later
    const edited = await patch(`/templates/${res.body.data.id}`, { serial_format: '{PREFIX}-{YYYY}-{SEQ:3}' });
    expect(edited.status).toBe(200);
    expect(edited.body.data.example_serial).toMatch(/^OFR-\d{4}-001$/);
    expect((await patch(`/templates/${res.body.data.id}`, { serial_format: 'no number' })).status).toBe(422);
  });
});

describe('fields a template defines itself', () => {
  test('the template defines its own fields with a label and a hint; HR types them when issuing and they reach the letter and the PDF', async () => {
    const created = await offerTemplate({
      body: 'Dear {{employee_name}},\n\nYou will work from {{office_location}} on {{work_timing}}. Your joining bonus is {{bonus}}.\n\nRef {{serial_number}}',
      subject: null,
      custom_fields: [
        { key: 'office_location', label: 'Office location', hint: 'City and office name' },
        { key: 'work_timing', label: 'Work timing' },
        { key: 'bonus', label: 'Joining bonus' },
      ],
    });
    expect(created.status).toBe(201);
    const tpl = created.body.data;
    expect(tpl.custom_fields.map((x) => x.key)).toEqual(['office_location', 'work_timing', 'bonus']);
    const e = await employee('Asha Rao');
    const recipient = { type: 'employee', org_membership_id: e.id };

    // nothing typed yet: the preview asks for the three fields, with their labels and hints, and issuing is refused
    const pre = (await post('/preview', { template_id: tpl.id, recipient })).body.data;
    expect(pre.fields_to_type).toEqual(['office_location', 'work_timing', 'bonus']);
    expect(pre.field_info).toEqual([
      { key: 'office_location', label: 'Office location', hint: 'City and office name', custom: true },
      { key: 'work_timing', label: 'Work timing', hint: null, custom: true },
      { key: 'bonus', label: 'Joining bonus', hint: null, custom: true },
    ]);
    expect((await post('', { template_id: tpl.id, recipient })).status).toBe(422);

    // typed by HR: the letter carries them
    const fields = { office_location: 'Indore, Vijay Nagar', work_timing: '10:00 am - 7:00 pm', bonus: 'Rs. 25,000' };
    const issued = await post('', { template_id: tpl.id, recipient, fields });
    expect(issued.status).toBe(201);
    const letter = issued.body.data;
    expect(letter.body).toContain('Indore, Vijay Nagar');
    expect(letter.body).toContain('10:00 am - 7:00 pm');
    expect(letter.body).not.toMatch(/\[office_location\]|\{\{/);
    const pdf = await authed(request(app).get(`${L}/${letter.id}/pdf`), adminToken);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);
  });

  test('a field that fills itself cannot be redefined, a name must be valid and unique, and the fields can be edited later', async () => {
    const bad = (custom_fields) => offerTemplate({ custom_fields });
    expect((await bad([{ key: 'employee_name', label: 'Mine' }])).status).toBe(422); // built-in
    expect((await bad([{ key: 'ctc', label: 'CTC' }, { key: 'CTC', label: 'again' }])).status).toBe(422); // twice
    expect((await bad([{ key: '9lives', label: 'x' }])).status).toBe(422); // not a valid name
    const ok = await offerTemplate({ custom_fields: [{ key: 'ctc', label: 'Annual CTC' }] });
    expect(ok.status).toBe(201);
    const id = ok.body.data.id;
    const edited = await patch(`/templates/${id}`, { custom_fields: [{ key: 'ctc', label: 'Annual CTC (INR)', hint: 'in rupees' }, { key: 'grade', label: 'Grade' }] });
    expect(edited.status).toBe(200);
    expect(edited.body.data.custom_fields).toHaveLength(2);
    // a template saved without any keeps an empty list
    const none = await offerTemplate({ name: 'Plain' });
    expect(none.body.data.custom_fields).toEqual([]);
  });
});

describe('letters on the letterhead: the issuing office', () => {
  const offices = async () => {
    const gurugram = await prisma.location.create({ data: { org_id: org.id, name: 'Gurugram Office', city: 'Gurugram', country: 'India', address: 'Sector 44, Gurugram, Haryana', is_default: true, legal_name: 'Delphic Global Private Limited', letter_prefix: 'dgpl', registration_info: 'CIN U72900HR2020PTC000000' } });
    const dubai = await prisma.location.create({ data: { org_id: org.id, name: 'Dubai Office', city: 'Dubai', country: 'United Arab Emirates', address: 'Business Bay, Dubai', legal_name: 'Delphic Global LLC', letter_prefix: 'DGL' } });
    const ahmedabad = await prisma.location.create({ data: { org_id: org.id, name: 'Ahmedabad Office', city: 'Ahmedabad', country: 'India', address: 'SG Highway, Ahmedabad' } });
    return { gurugram, dubai, ahmedabad };
  };
  const template = (over = {}) => offerTemplate({ serial_prefix: 'LTR', serial_format: '{PREFIX}/Appo/{OFFICE}/{SEQ:4}', subject: 'Letter of Appointment', body: 'Dear {{employee_name}},\n\n{{company_name}} ({{office_name}}) is delighted to appoint you. Address: {{office_address}}. Ref {{serial_number}}', ...over });

  test('the serial number carries the office; each office has its own legal name and prefix on the letter', async () => {
    const o = await offices();
    const t = (await template()).body.data;
    expect(t.example_serial).toBe('LTR/Appo/ahmedabad/0001');
    const m = await employee('Asha Rao');
    const recipient = { type: 'employee', org_membership_id: m.id };

    // Dubai: its own legal name and prefix, the office in the number
    const dubai = (await post('', { template_id: t.id, recipient, location_id: o.dubai.id })).body.data;
    expect(dubai.serial_number).toBe('DGL/Appo/dubai/0001');
    expect(dubai.body).toContain('Delphic Global LLC (Dubai Office)');
    expect(dubai.body).toContain('Business Bay, Dubai');
    expect(dubai.location_id).toBe(o.dubai.id);
    expect(dubai.issuing_office).toBe('Dubai Office');
    expect(dubai.letterhead.legal_name).toBe('Delphic Global LLC');
    expect(dubai.letterhead.offices.map((x) => x.name)).toEqual(['Gurugram Office', 'Ahmedabad Office', 'Dubai Office']); // the default first, then by name

    // Ahmedabad has no legal name or prefix of its own: the company name and the template prefix are used
    const ahd = (await post('', { template_id: t.id, recipient, location_id: o.ahmedabad.id })).body.data;
    expect(ahd.serial_number).toBe('LTR/Appo/ahmedabad/0001');
    expect(ahd.body).toContain(`${org.name} (Ahmedabad Office)`);

    // no office chosen: the default office; and each office has its own running number
    const def = (await post('', { template_id: t.id, recipient })).body.data;
    expect(def.serial_number).toBe('DGPL/Appo/gurugram/0001');
    expect(def.letterhead.office.name).toBe('Gurugram Office');
    const again = (await post('', { template_id: t.id, recipient, location_id: o.dubai.id })).body.data;
    expect(again.serial_number).toBe('DGL/Appo/dubai/0002');

    // another company's office, or an unknown one, is refused
    expect((await post('', { template_id: t.id, recipient, location_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);

    // the list shows the office, the PDF is on the letterhead (a real PDF with the logo and footer), and the preview names the office
    const list = (await get('')).body.data;
    expect(list.find((l) => l.id === dubai.id).issuing_office).toBe('Dubai Office');
    const pdf = await authed(request(app).get(`${L}/${dubai.id}/pdf`), adminToken).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.status).toBe(200);
    expect(pdf.body.slice(0, 5).toString()).toBe('%PDF-');
    const pre = (await post('/preview', { template_id: t.id, recipient, location_id: o.dubai.id })).body.data;
    expect(pre.office).toMatchObject({ name: 'Dubai Office', legal_name: 'Delphic Global LLC' });
    expect(pre.example_serial).toBe('DGL/Appo/dubai/0001'); // the preview shows the shape of the number, numbered 1
  });

  test('an office saves its legal name, letter prefix and registration line', async () => {
    const created = await authed(request(app).post('/api/v1/orgs/locations'), adminToken).send({ name: 'Pune Office', city: 'Pune', legal_name: 'Delphic Pune LLP', letter_prefix: 'dpl', registration_info: 'LLPIN AAA-0000' });
    expect(created.status).toBe(201);
    const loc = created.body.data;
    expect(loc).toMatchObject({ legal_name: 'Delphic Pune LLP', letter_prefix: 'DPL', registration_info: 'LLPIN AAA-0000' });
    const edited = await authed(request(app).patch(`/api/v1/orgs/locations/${loc.id}`), adminToken).send({ legal_name: '', letter_prefix: 'dp2' });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ legal_name: null, letter_prefix: 'DP2' });
    expect((await authed(request(app).patch(`/api/v1/orgs/locations/${loc.id}`), adminToken).send({ letter_prefix: 'bad prefix!' })).status).toBe(422);
  });
});

describe('issuing letters', () => {
  test('an employee letter fills from the record, asks for what is typed by hand, and gets the next serial number', async () => {
    const m = await employee('Asha Rao');
    const t = (await offerTemplate()).body.data;
    const input = { template_id: t.id, recipient: { type: 'employee', org_membership_id: m.id }, issued_on: '2026-11-11' };

    const pre = await post('/preview', input);
    expect(pre.status).toBe(200);
    expect(pre.body.data.fields_to_type).toEqual(['ctc']);
    expect(pre.body.data.missing).toEqual(['ctc']);
    expect(pre.body.data.body).toContain('Dear Asha Rao');
    expect(pre.body.data.body).toContain('joining on 2 March 2026');
    expect(await prisma.letter.count()).toBe(0); // a preview issues nothing and uses no number

    const missing = await post('/', input);
    expect(missing.status).toBe(422);
    expect(missing.body.errors.missing).toEqual(['ctc']);

    const first = await post('/', { ...input, fields: { ctc: '12,00,000' } });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ serial_number: 'OFR/2026-27/0001', status: 'issued', recipient_name: 'Asha Rao', kind: 'offer' });
    expect(first.body.data.body).toContain('annual CTC of Rs. 12,00,000');
    expect(first.body.data.body).toContain('Ref OFR/2026-27/0001'); // the serial number is inside the text too
    expect(first.body.data.subject).toBe('Offer of employment - Software Engineer');

    const second = await post('/', { ...input, fields: { ctc: '13,00,000' } });
    expect(second.body.data.serial_number).toBe('OFR/2026-27/0002');
    // a new financial year starts again at 1; the old series is untouched
    const next = await post('/', { ...input, issued_on: '2027-04-02', fields: { ctc: '14,00,000' } });
    expect(next.body.data.serial_number).toBe('OFR/2027-28/0001');
    // changing the format later starts a new series without touching the issued letters
    await patch(`/templates/${t.id}`, { serial_format: '{PREFIX}-{YYYY}-{SEQ:3}' });
    expect((await post('/', { ...input, fields: { ctc: '1' } })).body.data.serial_number).toBe('OFR-2026-001');
    expect((await get('/', { org_membership_id: m.id })).body.data).toHaveLength(4);
  });

  test('two letters issued at the same moment never share a number', async () => {
    const m = await employee('Asha Rao');
    const t = (await offerTemplate()).body.data;
    const input = { template_id: t.id, recipient: { type: 'employee', org_membership_id: m.id }, fields: { ctc: '1' }, issued_on: '2026-11-11' };
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => post('/', input)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const serials = results.map((r) => r.body.data.serial_number).sort();
    expect(new Set(serials).size).toBe(5);
    expect(serials[0]).toBe('OFR/2026-27/0001');
    expect(serials[4]).toBe('OFR/2026-27/0005');
  });

  test('letters for a past employee, a candidate and a vendor', async () => {
    const past = await employee('Left Person');
    await prisma.orgMembership.update({ where: { id: past.id }, data: { left_at: new Date('2026-10-31T00:00:00Z'), employment_status: 'terminated' } });
    const relieving = (await post('/templates', { name: 'Relieving letter', kind: 'relieving', audience: 'left_employee', serial_prefix: 'REL', body: 'This is to confirm that {{employee_name}} ({{employee_code}}) was relieved on {{last_working_day}}.' })).body.data;
    const a = await post('/', { template_id: relieving.id, recipient: { type: 'employee', org_membership_id: past.id } });
    expect(a.status).toBe(201);
    expect(a.body.data.body).toBe('This is to confirm that Left Person (E-101) was relieved on 31 October 2026.');

    const generic = (await post('/templates', { name: 'Offer (candidate)', kind: 'offer', serial_prefix: 'OFR', body: 'Dear {{recipient_name}}, we offer you {{position}}.' })).body.data;
    const cand = await post('/', { template_id: generic.id, recipient: { type: 'candidate', name: 'Ravi Kumar', email: 'ravi@example.com', address: 'Pune' }, fields: { position: 'Analyst' } });
    expect(cand.status).toBe(201);
    expect(cand.body.data).toMatchObject({ recipient_type: 'candidate', recipient_name: 'Ravi Kumar', recipient_email: 'ravi@example.com' });
    expect((await post('/', { template_id: generic.id, recipient: { type: 'candidate' }, fields: { position: 'x' } })).status).toBe(422);

    const vendor = await prisma.account.create({ data: { org_id: org.id, type: 'vendor', name: 'ekamNext Technologies', stage: 'active', owner_id: admin.id, origin_owner_id: admin.id } });
    const ven = await post('/', { template_id: generic.id, recipient: { type: 'vendor', account_id: vendor.id }, fields: { position: 'a rate card' } });
    expect(ven.status).toBe(201);
    expect(ven.body.data.body).toContain('Dear ekamNext Technologies');
    expect((await get('/', { account_id: vendor.id })).body.data).toHaveLength(1);
    expect((await get('/recipients', { type: 'vendor', q: 'ekam' })).body.data[0].name).toBe('ekamNext Technologies');
    expect((await get('/recipients', { type: 'employee', q: 'Left' })).body.data[0]).toMatchObject({ name: 'Left Person', status: 'left' });
  });

  test('a letter is cancelled with a reason, never edited; the PDF is downloadable; another company cannot reach it', async () => {
    const m = await employee('Asha Rao');
    const t = (await offerTemplate()).body.data;
    const letter = (await post('/', { template_id: t.id, recipient: { type: 'employee', org_membership_id: m.id }, fields: { ctc: '1' } })).body.data;

    const pdf = await authed(request(app).get(`${L}/${letter.id}/pdf`), adminToken).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');

    expect((await post(`/${letter.id}/cancel`, { reason: 'x' })).status).toBe(422);
    const cancelled = await post(`/${letter.id}/cancel`, { reason: 'Wrong designation' });
    expect(cancelled.body.data).toMatchObject({ status: 'cancelled', cancelled_reason: 'Wrong designation' });
    expect((await post(`/${letter.id}/cancel`, { reason: 'again' })).status).toBe(409);
    expect((await get('/', { status: 'cancelled' })).body.data).toHaveLength(1);
    expect((await get('/', { q: 'OFR/2026' })).body.data.length).toBeGreaterThan(0);

    const other = await createOrg({ name: 'Other Co', slug: 'other-co' });
    const stranger = await createUser({ role: 'admin', withOrg: false });
    await createOrgMembership(stranger.id, other.id, { role: 'admin' });
    const { access_token: strangerToken } = await loginAs(stranger);
    expect((await authed(request(app).get(`${L}/${letter.id}`), strangerToken)).status).toBe(404);
    expect((await post('/', { template_id: t.id, recipient: { type: 'employee', org_membership_id: m.id }, fields: { ctc: '1' } }, strangerToken)).status).toBe(404);
  });

  test('an employee without the letters permission cannot open them', async () => {
    const plain = await createUser({ role: 'employee' });
    const { access_token } = await loginAs(plain);
    expect((await authed(request(app).get(`${L}`), access_token)).status).toBe(403);
    expect((await authed(request(app).get(`${L}/templates`), access_token)).status).toBe(403);
  });
});
