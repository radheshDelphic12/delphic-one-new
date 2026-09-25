/**
 * interviewReminders.run() — T-24h reminders fire once per round, stamp
 * reminder_sent_at, and a second run is a no-op.
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
  createInterviewRound,
  authed,
} = require('./helpers');
const interviewReminders = require('../src/jobs/interviewReminders');

const HOUR = 60 * 60 * 1000;

let roundId;

beforeEach(async () => {
  await cleanDatabase();
  const bda = await createUser({ role: 'bda' });
  const sales = await createUser({ role: 'sales' });
  const recruiter = await createUser({ role: 'recruiter' });
  const { access_token: salesToken } = await loginAs(sales);
  const { access_token: recruiterToken } = await loginAs(recruiter);

  const account = await createActiveClientAccount(bda.id);
  const requirement = await createRequirement(salesToken, account.id);
  const seats = await authed(request(app).get(`/api/v1/requirements/${requirement.id}/seats`), salesToken);
  const profile = await createProfile(recruiterToken);
  const sub = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
    requirement_seat_id: seats.body.data[0].id,
    profile_id: profile.id,
    proposed_rate: 100,
    proposed_rate_currency: 'INR',
  });

  const round = await createInterviewRound(sub.body.data.id, {
    round_type: 'internal_r1',
    scheduled_at: new Date(Date.now() + 24 * HOUR),
    status: 'scheduled',
  });
  roundId = round.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

test('a round ~24h out gets one batch of reminders, then the run is idempotent', async () => {
  const first = await interviewReminders.run();
  expect(first.sent).toBeGreaterThanOrEqual(1);

  const notifs = await prisma.notification.findMany({ where: { type: 'interview_reminder' } });
  expect(notifs.length).toBeGreaterThanOrEqual(1);

  const round = await prisma.interviewRound.findUnique({ where: { id: roundId } });
  expect(round.reminder_sent_at).not.toBeNull();

  const second = await interviewReminders.run();
  expect(second.sent).toBe(0);

  const after = await prisma.notification.count({ where: { type: 'interview_reminder' } });
  expect(after).toBe(notifs.length);
});

test('a cancelled round is skipped by the reminder job', async () => {
  await prisma.interviewRound.update({ where: { id: roundId }, data: { status: 'cancelled' } });
  const res = await interviewReminders.run();
  expect(res.sent).toBe(0);
  expect(await prisma.notification.count({ where: { type: 'interview_reminder' } })).toBe(0);
});
