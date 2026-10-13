// Apps Script is the only bridge to the website; here it is a fake in-memory
// "sheet" so the suite never leaves the process.
jest.mock('../src/modules/website/appsScriptClient', () => {
  const FORMS = ['contact', 'career', 'secure'];
  return {
    FORMS,
    SCRIPTS: ['jobs', ...FORMS],
    call: jest.fn(),
    isConfigured: jest.fn(() => true),
    configStatus: jest.fn(() => ({ configured: true })),
  };
});

const client = require('../src/modules/website/appsScriptClient');
const {
  app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed,
  createActiveClientAccount, createRequirement, createProfile,
} = require('./helpers');

const base = '/api/v1/website';
let sheets;
let jobs;
let admin;
let adminToken;
let master;

function fakeSheets(script, action, params) {
  if (action === 'upsertJob') {
    jobs[params.jobId] = { ...params };
    return { data: { success: true } };
  }
  const rows = sheets[script];
  if (action === 'listSubmissions') {
    const fresh = rows.filter((r) => !r.status).slice(0, params.limit || 200);
    return { data: { success: true, hasMore: false, submissions: fresh.map((r) => ({ submissionId: r.id, row: r.row, platformStatus: '', fields: r.fields })) } };
  }
  if (action === 'markSubmissions') {
    const missing = [];
    for (const u of params.updates) {
      const row = rows.find((r) => r.id === u.submissionId);
      if (row) row.status = u.status;
      else missing.push(u.submissionId);
    }
    return { data: { success: true, updated: params.updates.length - missing.length, missing } };
  }
  return { error: 'apps_script_failed', message: `unexpected ${action}` };
}

const sheetRow = (id, row, fields) => ({ id, row, status: '', fields: { Timestamp: '2026-10-01T10:00:00.000Z', ...fields } });
const api = (method, path, token = adminToken) => authed(request(app)[method](`${base}${path}`), token);

beforeEach(async () => {
  await cleanDatabase();
  jobs = {};
  sheets = {
    contact: [
      sheetRow('c-1', 2, { Name: 'Asha Rao', Company: 'Acme Ltd', Email: 'asha@acme.test', Phone: '+91 98765 43210', Message: 'Need a delivery team' }),
      sheetRow('c-2', 3, { Name: 'Ben', Company: 'Beta', Email: 'not-an-email', Phone: '', Message: 'Hello' }),
    ],
    career: [
      sheetRow('k-1', 2, { Name: 'Chen Li', Email: 'chen@mail.test', Phone: '+1 555', 'Resume Link': 'https://drive.test/cv', About: 'Backend dev', Role: 'Node Engineer' }),
    ],
    secure: [],
  };
  client.call.mockReset();
  client.call.mockImplementation(async (...args) => fakeSheets(...args));
  client.isConfigured.mockReturnValue(true);

  master = await createOrg({ name: 'Delphic Global' });
  admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, master.id, { role: 'admin' });
  ({ access_token: adminToken } = await loginAs(admin));
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function openRequirement(overrides = {}) {
  const account = await createActiveClientAccount(admin.id);
  return createRequirement(adminToken, account.id, {
    title: 'Senior Node Engineer',
    department: 'Engineering',
    work_location: 'Gurugram',
    work_mode: 'hybrid',
    engagement_type: 'full_time',
    job_description: 'Build APIs.',
    budget_min: 1500000,
    budget_max: 2500000,
    billing_notes: 'Client pays 18% margin',
    ...overrides,
  });
}

describe('access', () => {
  it('is admin-only inside the master workspace', async () => {
    const sales = await createUser({ role: 'sales', withOrg: false });
    await createOrgMembership(sales.id, master.id, { role: 'sales' });
    const { access_token: salesToken } = await loginAs(sales);
    expect((await api('get', '/postings', salesToken)).status).toBe(403);

    const other = await createOrg({ name: 'Zephyr', is_master_workspace: false });
    const otherAdmin = await createUser({ role: 'admin', withOrg: false });
    await createOrgMembership(otherAdmin.id, other.id, { role: 'admin' });
    const { access_token: otherToken } = await loginAs(otherAdmin);
    expect((await api('get', '/postings', otherToken)).status).toBe(403);
  });

  it('answers 503 when the Apps Script bridge is not configured, but still reports status', async () => {
    client.isConfigured.mockReturnValue(false);
    expect((await api('get', '/postings')).status).toBe(503);
    expect((await api('get', '/status')).status).toBe(200);
  });
});

describe('job postings', () => {
  it('offers the requirement public fields as defaults', async () => {
    const req = await openRequirement();
    const res = await api('get', `/postings/requirement/${req.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.posting).toBeNull();
    expect(res.body.data.defaults).toEqual({
      title: 'Senior Node Engineer',
      department: 'Engineering',
      location: 'Gurugram · Hybrid',
      employment_type: 'Full-time',
      public_description: 'Build APIs.',
    });
  });

  it('publishes only public fields to the Jobs sheet, keyed by requirement id', async () => {
    const req = await openRequirement();
    const res = await api('post', '/postings').send({ requirement_id: req.id, title: 'Node Engineer', location: 'Remote', public_description: 'Ship things.' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('published');
    expect(res.body.data.last_synced_at).toBeTruthy();
    expect(res.body.data.sync_error).toBeNull();

    const [script, action, payload] = client.call.mock.calls[0];
    expect([script, action]).toEqual(['jobs', 'upsertJob']);
    expect(Object.keys(payload).sort()).toEqual(['department', 'description', 'jobId', 'location', 'status', 'title', 'type']);
    expect(payload).toMatchObject({ jobId: req.id, title: 'Node Engineer', status: 'Open' });
    expect(JSON.stringify(payload)).not.toMatch(/1500000|2500000|margin/);
  });

  it('keeps the posting and records the error when Apps Script fails, and retry clears it', async () => {
    const req = await openRequirement();
    client.call.mockResolvedValueOnce({ error: 'apps_script_failed', message: 'jobs script: timed out' });
    const res = await api('post', '/postings').send({ requirement_id: req.id, title: 'Node Engineer' });
    expect(res.status).toBe(201);
    expect(res.body.data.sync_error).toBe('jobs script: timed out');

    const retried = await api('post', `/postings/${res.body.data.id}/retry`);
    expect(retried.status).toBe(200);
    expect(retried.body.data.sync_error).toBeNull();
    expect(jobs[req.id].status).toBe('Open');
  });

  it('closes and reopens on the website', async () => {
    const req = await openRequirement();
    const { body } = await api('post', '/postings').send({ requirement_id: req.id, title: 'Node Engineer' });
    expect((await api('post', `/postings/${body.data.id}/close`)).body.data.status).toBe('closed');
    expect(jobs[req.id].status).toBe('Closed');
    expect((await api('post', `/postings/${body.data.id}/reopen`)).body.data.status).toBe('published');
    expect(jobs[req.id].status).toBe('Open');
  });

  it('takes the posting off the website when the requirement is dropped, and refuses to republish it', async () => {
    const req = await openRequirement();
    const { body } = await api('post', '/postings').send({ requirement_id: req.id, title: 'Node Engineer' });

    const dropped = await authed(request(app).post(`/api/v1/requirements/${req.id}/status`), adminToken).send({ to_status: 'dropped', reason: 'Client paused hiring' });
    expect(dropped.status).toBe(200);

    const posting = await prisma.websiteJobPosting.findUnique({ where: { id: body.data.id } });
    expect(posting.status).toBe('closed');
    // The sheet write runs in the background.
    for (let i = 0; i < 20 && jobs[req.id].status !== 'Closed'; i += 1) await new Promise((r) => setImmediate(r));
    expect(jobs[req.id].status).toBe('Closed');

    expect((await api('post', `/postings/${body.data.id}/reopen`)).status).toBe(409);
    expect((await api('post', '/postings').send({ requirement_id: req.id, title: 'Again' })).status).toBe(409);
  });
});

describe('form submissions', () => {
  it('imports each sheet row once and marks it Imported in the sheet', async () => {
    const first = await api('post', '/submissions/sync');
    expect(first.status).toBe(200);
    expect(first.body.data.imported).toBe(3);
    expect(first.body.data.by_form).toEqual({ contact: 2, career: 1, secure: 0 });
    expect(sheets.contact.map((r) => r.status)).toEqual(['Imported', 'Imported']);

    const second = await api('post', '/submissions/sync');
    expect(second.body.data.imported).toBe(0);
    expect(await prisma.websiteSubmission.count()).toBe(3);

    const list = await api('get', '/submissions?form_type=contact');
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data[0]).toMatchObject({ form_type: 'contact', status: 'new' });
  });

  it('does not duplicate rows when the sheet mark failed on the previous run', async () => {
    client.call.mockImplementation(async (script, action, params) =>
      action === 'markSubmissions' ? { error: 'apps_script_failed', message: 'down' } : fakeSheets(script, action, params)
    );
    const failed = await api('post', '/submissions/sync');
    expect(failed.body.data.imported).toBe(3);
    expect(failed.body.data.errors.length).toBeGreaterThan(0);

    client.call.mockImplementation(async (...args) => fakeSheets(...args));
    const healed = await api('post', '/submissions/sync');
    expect(healed.body.data.imported).toBe(0);
    expect(await prisma.websiteSubmission.count()).toBe(3);
    expect(sheets.career[0].status).toBe('Imported');
  });

  it('converts a contact enquiry to a lead and marks the sheet row Converted', async () => {
    await api('post', '/submissions/sync');
    const row = await prisma.websiteSubmission.findUnique({ where: { external_id: 'c-1' } });

    const res = await api('post', `/submissions/${row.id}/convert-lead`);
    expect(res.status).toBe(201);
    expect(res.body.data.lead).toMatchObject({ name: 'Acme Ltd', contact_name: 'Asha Rao', email: 'asha@acme.test', source: 'Website: contact form', org_id: master.id });
    expect(res.body.data.submission).toMatchObject({ status: 'converted', converted_lead_id: res.body.data.lead.id, sheet_status_synced: true });
    expect(sheets.contact[0].status).toBe('Converted');

    expect((await api('post', `/submissions/${row.id}/convert-lead`)).status).toBe(409);
  });

  it('drops an invalid email rather than failing the lead', async () => {
    await api('post', '/submissions/sync');
    const row = await prisma.websiteSubmission.findUnique({ where: { external_id: 'c-2' } });
    const res = await api('post', `/submissions/${row.id}/convert-lead`);
    expect(res.status).toBe(201);
    expect(res.body.data.lead.email).toBeNull();
  });

  it('converts a career application to a candidate, or links an existing one', async () => {
    await api('post', '/submissions/sync');
    const row = await prisma.websiteSubmission.findUnique({ where: { external_id: 'k-1' } });

    expect((await api('post', `/submissions/${row.id}/convert-lead`)).status).toBe(422);
    expect((await api('post', `/submissions/${row.id}/convert-profile`).send({})).status).toBe(400);

    const res = await api('post', `/submissions/${row.id}/convert-profile`).send({ total_experience_years: 4, primary_skills: ['Node.js'] });
    expect(res.status).toBe(201);
    expect(res.body.data.linked_existing).toBe(false);
    const profile = await prisma.profile.findUnique({ where: { id: res.body.data.profile.id } });
    expect(profile).toMatchObject({ name: 'Chen Li', email: 'chen@mail.test', resume_url: 'https://drive.test/cv', source: 'direct' });
    expect(profile.recruiter_notes).toContain('Node Engineer');
    expect(sheets.career[0].status).toBe('Converted');
  });

  it('links a career application to a candidate already in the pool', async () => {
    const existing = await createProfile(adminToken, { email: 'CHEN@mail.test' });
    await api('post', '/submissions/sync');
    const row = await prisma.websiteSubmission.findUnique({ where: { external_id: 'k-1' } });
    const res = await api('post', `/submissions/${row.id}/convert-profile`).send({ total_experience_years: 4, primary_skills: ['Node.js'] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ linked_existing: true, profile: { id: existing.id } });
    expect(await prisma.profile.count()).toBe(1);
  });

  it('dismisses a submission', async () => {
    await api('post', '/submissions/sync');
    const row = await prisma.websiteSubmission.findUnique({ where: { external_id: 'c-2' } });
    const res = await api('post', `/submissions/${row.id}/dismiss`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('dismissed');
    expect(sheets.contact[1].status).toBe('Dismissed');
  });
});
