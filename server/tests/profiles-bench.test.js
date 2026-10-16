/**
 * Candidate on_bench flag: create/update with on_bench, and filtering the list by it.
 */
const { app, prisma, request, cleanDatabase, createUser, loginAs, authed } = require('./helpers');

let recruiterToken;

beforeEach(async () => {
  await cleanDatabase();
  const recruiter = await createUser({ role: 'recruiter' });
  ({ access_token: recruiterToken } = await loginAs(recruiter));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('candidate on_bench flag', () => {
  test('a direct-sourced profile can be created and flagged on_bench', async () => {
    const res = await authed(request(app).post('/api/v1/profiles'), recruiterToken).send({
      name: 'Bench Candidate',
      total_experience_years: 4,
      primary_skills: ['Java'],
      source: 'direct',
      on_bench: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.on_bench).toBe(true);
  });

  test('list can be filtered to on_bench candidates only', async () => {
    await authed(request(app).post('/api/v1/profiles'), recruiterToken).send({
      name: 'On Bench One',
      total_experience_years: 3,
      primary_skills: ['React'],
      source: 'direct',
      on_bench: true,
    });
    await authed(request(app).post('/api/v1/profiles'), recruiterToken).send({
      name: 'Not On Bench',
      total_experience_years: 3,
      primary_skills: ['React'],
      source: 'direct',
      on_bench: false,
    });

    const res = await authed(request(app).get('/api/v1/profiles'), recruiterToken).query({ on_bench: 'true' });
    expect(res.status).toBe(200);
    expect(res.body.data.every((p) => p.on_bench === true)).toBe(true);
    expect(res.body.data.some((p) => p.name === 'On Bench One')).toBe(true);
    expect(res.body.data.some((p) => p.name === 'Not On Bench')).toBe(false);
  });

  test('on_bench defaults to false when not set', async () => {
    const res = await authed(request(app).post('/api/v1/profiles'), recruiterToken).send({
      name: 'Default Candidate',
      total_experience_years: 2,
      primary_skills: ['Python'],
      source: 'linkedin',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.on_bench).toBe(false);
  });
});

describe('profile Added by', () => {
  test('an admin can reassign Added by; a recruiter cannot', async () => {
    const admin = await createUser({ role: 'admin' });
    const { access_token: adminToken } = await loginAs(admin);
    const other = await createUser({ role: 'recruiter' });
    const created = await authed(request(app).post('/api/v1/profiles'), recruiterToken).send({
      name: 'Owned Candidate',
      total_experience_years: 2,
      primary_skills: ['Go'],
      source: 'direct',
    });
    const id = created.body.data.id;

    const denied = await authed(request(app).patch(`/api/v1/profiles/${id}`), recruiterToken).send({ added_by: other.id });
    expect(denied.status).toBe(403);

    const bad = await authed(request(app).patch(`/api/v1/profiles/${id}`), adminToken).send({ added_by: '00000000-0000-4000-8000-000000000000' });
    expect(bad.status).toBe(422);

    const ok = await authed(request(app).patch(`/api/v1/profiles/${id}`), adminToken).send({ added_by: other.id });
    expect(ok.status).toBe(200);
    expect(ok.body.data.added_by.id).toBe(other.id);
  });
});
