/**
 * GET /reports/clients-without-requirements and /reports/recruiter-vendor-gaps
 * — coverage-gap reports for team members / accounts with no downstream activity.
 */
const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createActiveClientAccount,
  createRequirement,
  createProfile,
  authed,
} = require('./helpers');

let adminToken;
let bda;
let bdaToken;
let bda2;
let recruiter;
let recruiterToken;
let recruiter2;
let sales;
let salesToken;

beforeEach(async () => {
  await cleanDatabase();
  const admin = await createUser({ role: 'admin' });
  bda = await createUser({ role: 'bda' });
  bda2 = await createUser({ role: 'bda' });
  recruiter = await createUser({ role: 'recruiter' });
  recruiter2 = await createUser({ role: 'recruiter' });
  sales = await createUser({ role: 'sales' });
  ({ access_token: adminToken } = await loginAs(admin));
  ({ access_token: bdaToken } = await loginAs(bda));
  ({ access_token: recruiterToken } = await loginAs(recruiter));
  ({ access_token: salesToken } = await loginAs(sales));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /reports/clients-without-requirements', () => {
  test('lists client accounts with zero requirements, with Sales POC (owner) + Brought by', async () => {
    const idle = await createActiveClientAccount(bda.id);
    const withReq = await createActiveClientAccount(bda.id);
    await createRequirement(salesToken, withReq.id, { title: 'Has a req' });

    const res = await authed(request(app).get('/api/v1/reports/clients-without-requirements'), adminToken);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((r) => r.client.id);
    expect(ids).toContain(idle.id);
    expect(ids).not.toContain(withReq.id);

    const row = res.body.data.find((r) => r.client.id === idle.id);
    expect(row).toEqual(
      expect.objectContaining({
        sales_poc: expect.objectContaining({ id: bda.id }),
        brought_by: expect.objectContaining({ id: bda.id }),
        days_idle: expect.any(Number),
      })
    );
    expect(row).not.toHaveProperty('sales_owner');
  });

  test('filters by stage', async () => {
    const activeClient = await createActiveClientAccount(bda.id);
    const leadClient = await prisma.account.create({
      data: {
        type: 'client',
        name: `Lead ${Math.random().toString(36).slice(2, 8)}`,
        stage: 'lead',
        owner_id: bda.id,
        origin_owner_id: bda.id,
      },
    });

    const activeRes = await authed(
      request(app).get('/api/v1/reports/clients-without-requirements').query({ stage: 'active' }),
      adminToken
    );
    expect(activeRes.status).toBe(200);
    const activeIds = activeRes.body.data.map((r) => r.client.id);
    expect(activeIds).toContain(activeClient.id);
    expect(activeIds).not.toContain(leadClient.id);

    const leadRes = await authed(
      request(app).get('/api/v1/reports/clients-without-requirements').query({ stage: 'lead' }),
      adminToken
    );
    expect(leadRes.status).toBe(200);
    const leadIds = leadRes.body.data.map((r) => r.client.id);
    expect(leadIds).toContain(leadClient.id);
    expect(leadIds).not.toContain(activeClient.id);
  });

  test('filters by created-date range', async () => {
    const recent = await createActiveClientAccount(bda.id);
    const old = await createActiveClientAccount(bda.id);
    await prisma.account.update({ where: { id: old.id }, data: { created_at: new Date('2020-01-01') } });

    const res = await authed(
      request(app)
        .get('/api/v1/reports/clients-without-requirements')
        .query({ stage: 'active', date_from: '2024-01-01' }),
      adminToken
    );
    expect(res.status).toBe(200);
    const ids = res.body.data.map((r) => r.client.id);
    expect(ids).toContain(recent.id);
    expect(ids).not.toContain(old.id);
  });

  test('includes not-yet-classified (type IS NULL) lead accounts', async () => {
    // A real lead is created with no type; it only becomes type=client on classification.
    const unclassifiedLead = await prisma.account.create({
      data: {
        type: null,
        name: `Unclassified ${Math.random().toString(36).slice(2, 8)}`,
        stage: 'lead',
        owner_id: bda.id,
        origin_owner_id: bda.id,
      },
    });

    const res = await authed(
      request(app).get('/api/v1/reports/clients-without-requirements').query({ stage: 'lead' }),
      adminToken
    );
    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => r.client.id)).toContain(unclassifiedLead.id);
  });

  test('buckets: with_requirements = has an open/in-progress/hold req; without = never had any', async () => {
    const idle = await createActiveClientAccount(bda.id);

    const withOpenReq = await createActiveClientAccount(bda.id);
    await createRequirement(salesToken, withOpenReq.id, { title: 'Open req' });

    const onlyHold = await createActiveClientAccount(bda.id);
    const holdReq = await createRequirement(salesToken, onlyHold.id, { title: 'Hold req' });
    await prisma.requirement.update({ where: { id: holdReq.id }, data: { status: 'on_hold' } });

    // Only a closed requirement — worked in the past, nothing open now.
    const onlyClosed = await createActiveClientAccount(bda.id);
    const closedReq = await createRequirement(salesToken, onlyClosed.id, { title: 'Closed req' });
    await prisma.requirement.update({ where: { id: closedReq.id }, data: { status: 'closed' } });

    const get = (bucket) =>
      authed(
        request(app).get('/api/v1/reports/clients-without-requirements').query({ stage: 'active', bucket }),
        adminToken
      );

    const allIds = (await get('all')).body.data.map((r) => r.client.id);
    const withIds = (await get('with_requirements')).body.data.map((r) => r.client.id);
    const withoutIds = (await get('without_active_requirements')).body.data.map((r) => r.client.id);

    // "Has requirements" = at least one open / in_progress / on_hold req.
    expect(withIds).toEqual(expect.arrayContaining([withOpenReq.id, onlyHold.id]));
    expect(withIds).not.toContain(idle.id);
    expect(withIds).not.toContain(onlyClosed.id);

    // "No requirements" = never had one at all.
    expect(withoutIds).toContain(idle.id);
    expect(withoutIds).not.toContain(onlyHold.id);
    expect(withoutIds).not.toContain(withOpenReq.id);
    expect(withoutIds).not.toContain(onlyClosed.id);

    // Buckets are disjoint; `all` is the superset (closed-only sits in neither).
    expect(allIds).toEqual(expect.arrayContaining([idle.id, withOpenReq.id, onlyHold.id, onlyClosed.id]));
    expect(withIds.filter((id) => withoutIds.includes(id))).toEqual([]);
  });

  test('buckets: no_active = never + closed-only; closed_only = has history, nothing active', async () => {
    const idle = await createActiveClientAccount(bda.id);

    const withOpenReq = await createActiveClientAccount(bda.id);
    await createRequirement(salesToken, withOpenReq.id, { title: 'Open req' });

    const onlyClosed = await createActiveClientAccount(bda.id);
    const closedReq = await createRequirement(salesToken, onlyClosed.id, { title: 'Closed req' });
    await prisma.requirement.update({ where: { id: closedReq.id }, data: { status: 'closed' } });

    const get = (bucket) =>
      authed(
        request(app).get('/api/v1/reports/clients-without-requirements').query({ stage: 'active', bucket }),
        adminToken
      );

    const noActiveIds = (await get('no_active')).body.data.map((r) => r.client.id);
    const closedOnlyIds = (await get('closed_only')).body.data.map((r) => r.client.id);
    const withIds = (await get('with_requirements')).body.data.map((r) => r.client.id);

    // "No open work" = never had one OR only closed/dropped.
    expect(noActiveIds).toEqual(expect.arrayContaining([idle.id, onlyClosed.id]));
    expect(noActiveIds).not.toContain(withOpenReq.id);

    // "Only closed / dropped" = has requirement history, none active.
    expect(closedOnlyIds).toContain(onlyClosed.id);
    expect(closedOnlyIds).not.toContain(idle.id);
    expect(closedOnlyIds).not.toContain(withOpenReq.id);

    // Invariants: with_requirements + no_active partitions the set; closed_only ⊆ no_active.
    expect(withIds.filter((id) => noActiveIds.includes(id))).toEqual([]);
    expect(closedOnlyIds.every((id) => noActiveIds.includes(id))).toBe(true);
  });

  test('filters by Brought by (origin_owner_id)', async () => {
    const mine = await createActiveClientAccount(bda.id);
    const other = await createActiveClientAccount(bda2.id);

    const res = await authed(
      request(app).get('/api/v1/reports/clients-without-requirements').query({ origin_owner_id: bda.id }),
      adminToken
    );
    expect(res.status).toBe(200);
    const ids = res.body.data.map((r) => r.client.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(other.id);
  });

  test('a BDA sees only their own idle clients', async () => {
    const mine = await createActiveClientAccount(bda.id);
    const theirs = await createActiveClientAccount(bda2.id);

    const res = await authed(request(app).get('/api/v1/reports/clients-without-requirements'), bdaToken);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((r) => r.client.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });

  test('recruiter cannot open it', async () => {
    const res = await authed(request(app).get('/api/v1/reports/clients-without-requirements'), recruiterToken);
    expect(res.status).toBe(403);
  });

  test('xlsx export returns a spreadsheet', async () => {
    await createActiveClientAccount(bda.id);
    const res = await authed(
      request(app).get('/api/v1/reports/export').query({ type: 'xlsx', report: 'clients-without-requirements' }),
      adminToken
    ).buffer();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
  });
});

describe('GET /reports/recruiter-vendor-gaps', () => {
  async function seedVendorProfile(token, { submitted } = {}) {
    const vendor = await prisma.account.create({
      data: {
        type: 'vendor',
        name: `Vendor ${Math.random().toString(36).slice(2, 8)}`,
        stage: 'active',
        owner_id: bda.id,
        origin_owner_id: bda.id,
      },
    });
    const profile = await createProfile(token, { source: 'vendor', vendor_account_id: vendor.id });
    if (submitted) {
      const account = await createActiveClientAccount(bda.id);
      const req = await createRequirement(salesToken, account.id);
      const seats = await authed(request(app).get(`/api/v1/requirements/${req.id}/seats`), salesToken);
      await authed(request(app).post('/api/v1/submissions'), token).send({
        requirement_seat_id: seats.body.data[0].id,
        profile_id: profile.id,
        proposed_rate: 100,
        proposed_rate_currency: 'INR',
        vendor_rate: 80,
        vendor_rate_currency: 'INR',
      });
    }
    return { vendor, profile };
  }

  async function createBareVendor(ownerId = bda.id) {
    return prisma.account.create({
      data: {
        type: 'vendor',
        name: `Vendor ${Math.random().toString(36).slice(2, 8)}`,
        stage: 'active',
        owner_id: ownerId,
        origin_owner_id: ownerId,
      },
    });
  }

  test('default view lists every active-stage vendor with its sourcing counts', async () => {
    const gap = await seedVendorProfile(recruiterToken);
    const used = await seedVendorProfile(recruiterToken, { submitted: true });

    const res = await authed(request(app).get('/api/v1/reports/recruiter-vendor-gaps'), adminToken);
    expect(res.status).toBe(200);
    const vendorIds = res.body.data.map((r) => r.vendor.id);
    expect(vendorIds).toEqual(expect.arrayContaining([gap.vendor.id, used.vendor.id]));

    const row = res.body.data.find((r) => r.vendor.id === gap.vendor.id);
    expect(row).toEqual(
      expect.objectContaining({
        our_poc: expect.objectContaining({ id: bda.id }),
        brought_by: expect.objectContaining({ id: bda.id }),
        recruiters: expect.arrayContaining([expect.objectContaining({ id: recruiter.id })]),
        profiles_sourced: 1,
        profiles_submitted: 0,
        has_live_submission: false,
        days_since_sourced: expect.any(Number),
      })
    );
  });

  test('excludes vendors not in the active stage', async () => {
    const active = await createBareVendor();
    const dropped = await prisma.account.create({
      data: {
        type: 'vendor',
        name: `Vendor ${Math.random().toString(36).slice(2, 8)}`,
        stage: 'dropped',
        owner_id: bda.id,
        origin_owner_id: bda.id,
      },
    });
    await createProfile(recruiterToken, { source: 'vendor', vendor_account_id: dropped.id });

    const res = await authed(request(app).get('/api/v1/reports/recruiter-vendor-gaps'), adminToken);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((r) => r.vendor.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(dropped.id);
  });

  test('recruiter_id keeps only vendors that recruiter has sourced from', async () => {
    const mine = await createBareVendor();
    await createProfile(recruiterToken, { source: 'vendor', vendor_account_id: mine.id });
    const theirs = await createBareVendor();
    const { access_token: r2Token } = await loginAs(recruiter2);
    await createProfile(r2Token, { source: 'vendor', vendor_account_id: theirs.id });

    const res = await authed(
      request(app).get('/api/v1/reports/recruiter-vendor-gaps').query({ recruiter_id: recruiter.id }),
      adminToken
    );
    expect(res.status).toBe(200);
    const ids = res.body.data.map((r) => r.vendor.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });

  test('includes a vendor with no sourced profiles at all (admin view)', async () => {
    const bare = await createBareVendor();

    const res = await authed(request(app).get('/api/v1/reports/recruiter-vendor-gaps'), adminToken);
    expect(res.status).toBe(200);
    const row = res.body.data.find((r) => r.vendor.id === bare.id);
    expect(row).toEqual(
      expect.objectContaining({
        profiles_sourced: 0,
        recruiters: [],
        last_sourced_at: null,
        days_since_sourced: null,
      })
    );
  });

  test('vendor_activity: active = all, inactive = no live, has_live = Active − Inactive', async () => {
    const live = await seedVendorProfile(recruiterToken, { submitted: true }); // fresh submission → `sourced` (a live stage)
    const noLive = await seedVendorProfile(recruiterToken); // sourced, never in a live submission
    const bare = await createBareVendor(); // nothing sourced

    const get = (vendor_activity) =>
      authed(
        request(app).get('/api/v1/reports/recruiter-vendor-gaps').query({ vendor_activity }),
        adminToken
      );

    const activeRows = (await get('active')).body.data;
    const activeIds = activeRows.map((r) => r.vendor.id);
    expect(activeIds).toEqual(expect.arrayContaining([live.vendor.id, noLive.vendor.id, bare.id]));

    const inactiveRows = (await get('inactive')).body.data;
    const inactiveIds = inactiveRows.map((r) => r.vendor.id);
    expect(inactiveIds).toContain(bare.id);
    expect(inactiveIds).toContain(noLive.vendor.id);
    expect(inactiveIds).not.toContain(live.vendor.id);
    expect(inactiveRows.every((r) => r.has_live_submission === false)).toBe(true);

    const hasLiveRows = (await get('has_live')).body.data;
    const hasLiveIds = hasLiveRows.map((r) => r.vendor.id);
    expect(hasLiveIds).toContain(live.vendor.id);
    expect(hasLiveIds).not.toContain(noLive.vendor.id);
    expect(hasLiveIds).not.toContain(bare.id);
    expect(hasLiveRows.every((r) => r.has_live_submission === true)).toBe(true);
  });

  test('a vendor whose only submission is terminal (rejected) counts as inactive', async () => {
    const v = await seedVendorProfile(recruiterToken, { submitted: true });
    const sub = await prisma.submission.findFirst({
      where: { profile: { vendor_account_id: v.vendor.id } },
    });
    await prisma.submission.update({ where: { id: sub.id }, data: { stage: 'rejected' } });

    const inactive = await authed(
      request(app).get('/api/v1/reports/recruiter-vendor-gaps').query({ vendor_activity: 'inactive' }),
      adminToken
    );
    const row = inactive.body.data.find((r) => r.vendor.id === v.vendor.id);
    expect(row).toBeTruthy();
    expect(row.has_live_submission).toBe(false);
    expect(row.profiles_submitted).toBe(1);

    const hasLive = await authed(
      request(app).get('/api/v1/reports/recruiter-vendor-gaps').query({ vendor_activity: 'has_live' }),
      adminToken
    );
    expect(hasLive.body.data.find((r) => r.vendor.id === v.vendor.id)).toBeFalsy();
  });

  test('filters by origin_owner_id (brought by)', async () => {
    const mine = await createBareVendor(bda.id);
    const other = await createBareVendor(bda2.id);

    const res = await authed(
      request(app).get('/api/v1/reports/recruiter-vendor-gaps').query({ origin_owner_id: bda2.id }),
      adminToken
    );
    expect(res.status).toBe(200);
    const ids = res.body.data.map((r) => r.vendor.id);
    expect(ids).toContain(other.id);
    expect(ids).not.toContain(mine.id);
  });

  test('date_from / date_to scopes the sourced-profile count (vendor still listed)', async () => {
    const v = await seedVendorProfile(recruiterToken); // 1 profile, created now
    await prisma.profile.update({ where: { id: v.profile.id }, data: { created_at: new Date('2020-01-01') } });

    const noRange = await authed(request(app).get('/api/v1/reports/recruiter-vendor-gaps'), adminToken);
    expect(noRange.body.data.find((r) => r.vendor.id === v.vendor.id).profiles_sourced).toBe(1);

    const afterCutoff = await authed(
      request(app).get('/api/v1/reports/recruiter-vendor-gaps').query({ date_from: '2024-01-01' }),
      adminToken
    );
    const row = afterCutoff.body.data.find((r) => r.vendor.id === v.vendor.id);
    // The vendor is still an active-stage vendor, but nothing was sourced in-window.
    expect(row).toBeTruthy();
    expect(row.profiles_sourced).toBe(0);
  });

  test('filters by vendor_id and by owner_id (our POC)', async () => {
    const a = await seedVendorProfile(recruiterToken);
    const b = await seedVendorProfile(recruiterToken);
    const otherPoc = await createBareVendor(bda2.id);

    const byVendor = await authed(
      request(app).get('/api/v1/reports/recruiter-vendor-gaps').query({ vendor_id: a.vendor.id }),
      adminToken
    );
    expect(byVendor.status).toBe(200);
    expect(byVendor.body.data.map((r) => r.vendor.id)).toEqual([a.vendor.id]);

    const byOwner = await authed(
      request(app).get('/api/v1/reports/recruiter-vendor-gaps').query({ owner_id: bda2.id }),
      adminToken
    );
    expect(byOwner.status).toBe(200);
    const ownerVendorIds = byOwner.body.data.map((r) => r.vendor.id);
    expect(ownerVendorIds).toContain(otherPoc.id);
    expect(ownerVendorIds).not.toContain(a.vendor.id);
    expect(ownerVendorIds).not.toContain(b.vendor.id);
  });

  test('a recruiter sees only their own gaps', async () => {
    const mine = await seedVendorProfile(recruiterToken);
    const { access_token: r2Token } = await loginAs(recruiter2);
    const theirs = await seedVendorProfile(r2Token);

    const res = await authed(request(app).get('/api/v1/reports/recruiter-vendor-gaps'), recruiterToken);
    expect(res.status).toBe(200);
    const vendorIds = res.body.data.map((r) => r.vendor.id);
    expect(vendorIds).toContain(mine.vendor.id);
    expect(vendorIds).not.toContain(theirs.vendor.id);
  });

  test('sales cannot open it', async () => {
    const res = await authed(request(app).get('/api/v1/reports/recruiter-vendor-gaps'), salesToken);
    expect(res.status).toBe(403);
  });
});
