const crypto = require('crypto');
const prisma = require('../../config/db');
const env = require('../../config/env');
const { enqueue } = require('../../lib/email/outbox');

const CATEGORIES = ['behavioural', 'reasoning', 'aptitude', 'mind'];
const LINK_VALID_DAYS = 7;

const TEST_INCLUDE = { questions: { orderBy: { sort_order: 'asc' }, include: { question: true } } };

// ---- scoring ----
// Each option carries marks; a question's full marks are its best option's. Overall % = marks got / full marks.
function scoreAnswers(questions, answers) {
  let got = 0;
  let full = 0;
  for (const q of questions) {
    const options = Array.isArray(q.options) ? q.options : [];
    full += Math.max(0, ...options.map((o) => Number(o.marks) || 0));
    const picked = options[Number(answers?.[q.id])];
    if (picked) got += Number(picked.marks) || 0;
  }
  return full > 0 ? Math.round((got / full) * 10000) / 100 : 0;
}

// ---- question bank ----
const listQuestions = ({ category, includeInactive } = {}) =>
  prisma.assessmentQuestion.findMany({
    where: { ...(category ? { category } : {}), ...(includeInactive ? {} : { is_active: true }) },
    orderBy: [{ category: 'asc' }, { created_at: 'asc' }],
  });

const createQuestion = (data, userId) => prisma.assessmentQuestion.create({ data: { ...data, created_by: userId } });

async function updateQuestion(id, data) {
  const existing = await prisma.assessmentQuestion.findUnique({ where: { id } });
  if (!existing) return { error: 'not_found' };
  return { question: await prisma.assessmentQuestion.update({ where: { id }, data }) };
}

// ---- tests ----
async function listTests(includeInactive = false) {
  const rows = await prisma.assessmentTest.findMany({
    where: includeInactive ? {} : { is_active: true },
    include: { _count: { select: { questions: true } } },
    orderBy: { created_at: 'asc' },
  });
  return rows.map(({ _count, ...t }) => ({ ...t, question_count: _count.questions }));
}

async function getTest(id) {
  const t = await prisma.assessmentTest.findUnique({ where: { id }, include: TEST_INCLUDE });
  if (!t) return null;
  const { questions, ...rest } = t;
  return { ...rest, questions: questions.map((q) => ({ ...q.question, sort_order: q.sort_order })) };
}

async function validQuestionIds(db, ids) {
  const found = await db.assessmentQuestion.count({ where: { id: { in: ids } } });
  return found === new Set(ids).size;
}

async function createTest(data, userId) {
  const { question_ids = [], ...rest } = data;
  if (!(await validQuestionIds(prisma, question_ids))) return { error: 'invalid_questions' };
  const row = await prisma.assessmentTest.create({
    data: { ...rest, created_by: userId, questions: { create: [...new Set(question_ids)].map((question_id, i) => ({ question_id, sort_order: i + 1 })) } },
  });
  return { test: await getTest(row.id) };
}

async function updateTest(id, data) {
  const existing = await prisma.assessmentTest.findUnique({ where: { id } });
  if (!existing) return { error: 'not_found' };
  const { question_ids, ...rest } = data;
  if (question_ids && !(await validQuestionIds(prisma, question_ids))) return { error: 'invalid_questions' };
  await prisma.$transaction(async (tx) => {
    await tx.assessmentTest.update({ where: { id }, data: rest });
    if (question_ids) {
      await tx.assessmentTestQuestion.deleteMany({ where: { test_id: id } });
      await tx.assessmentTestQuestion.createMany({ data: [...new Set(question_ids)].map((question_id, i) => ({ test_id: id, question_id, sort_order: i + 1 })) });
    }
  });
  return { test: await getTest(id) };
}

// ---- attempts ----
const attemptLink = (token) => `${env.corsOrigin.replace(/\/$/, '')}/assessment/${token}`;

// Sends the test to the candidate of a submission: a new public link, also emailed when the profile has an email.
async function invite({ testId, submissionId }, user) {
  const test = await prisma.assessmentTest.findUnique({ where: { id: testId }, include: { _count: { select: { questions: true } } } });
  if (!test || !test.is_active) return { error: 'not_found' };
  if (!test._count.questions) return { error: 'empty_test' };
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, profile: { select: { name: true, email: true } }, seat: { select: { requirement: { select: { title: true } } } } },
  });
  if (!submission) return { error: 'not_found' };

  const token = crypto.randomBytes(24).toString('hex');
  const attempt = await prisma.assessmentAttempt.create({
    data: {
      token,
      test_id: testId,
      submission_id: submissionId,
      candidate_name: submission.profile?.name || 'Candidate',
      candidate_email: submission.profile?.email || null,
      pass_percentage: test.pass_percentage,
      invited_by: user.id,
      expires_at: new Date(Date.now() + LINK_VALID_DAYS * 86400000),
    },
  });
  const link = attemptLink(token);
  if (attempt.candidate_email) {
    await enqueue(prisma, {
      kind: 'assessment_invite',
      to: { email: attempt.candidate_email, name: attempt.candidate_name },
      subject: `Your assessment for ${submission.seat?.requirement?.title || 'the role'}`,
      text: `Hi ${attempt.candidate_name},\n\nPlease complete this short assessment: ${link}\n\nThe link is valid for ${LINK_VALID_DAYS} days${test.duration_minutes ? ` and the test takes about ${test.duration_minutes} minutes` : ''}. You can open it once and submit your answers once.\n\nThank you,\nDelphic Team`,
    });
  }
  return { attempt: toAttemptView(attempt), link };
}

function toAttemptView(a) {
  return {
    id: a.id,
    test_id: a.test_id,
    submission_id: a.submission_id,
    candidate_name: a.candidate_name,
    status: a.status,
    score_percent: a.score_percent != null ? Number(a.score_percent) : null,
    passed: a.passed,
    pass_percentage: a.pass_percentage,
    invited_at: a.invited_at,
    expires_at: a.expires_at,
    submitted_at: a.submitted_at,
    link: a.status === 'submitted' ? null : attemptLink(a.token),
  };
}

async function listAttempts({ submissionId }) {
  const rows = await prisma.assessmentAttempt.findMany({
    where: { submission_id: submissionId },
    include: { test: { select: { name: true } } },
    orderBy: { invited_at: 'desc' },
  });
  return rows.map((a) => ({ ...toAttemptView(a), test_name: a.test.name }));
}

// ---- public (candidate) side: the token is the only credential ----
async function loadByToken(token) {
  const a = await prisma.assessmentAttempt.findUnique({ where: { token }, include: { test: { include: TEST_INCLUDE } } });
  if (!a) return { error: 'not_found' };
  if (a.status === 'submitted') return { error: 'already_submitted' };
  if (a.expires_at < new Date()) return { error: 'expired' };
  return { attempt: a };
}

async function openForCandidate(token) {
  const r = await loadByToken(token);
  if (r.error) return r;
  const a = r.attempt;
  if (a.status === 'invited') await prisma.assessmentAttempt.update({ where: { id: a.id }, data: { status: 'started', started_at: new Date() } });
  return {
    test: {
      name: a.test.name,
      description: a.test.description,
      duration_minutes: a.test.duration_minutes,
      candidate_name: a.candidate_name,
      // never send the marks: only the wording of each option
      questions: a.test.questions.map((q) => ({
        id: q.question.id,
        category: q.question.category,
        text: q.question.text,
        options: q.question.options.map((o) => o.text),
      })),
    },
  };
}

async function submitForCandidate(token, answers) {
  const r = await loadByToken(token);
  if (r.error) return r;
  const a = r.attempt;
  const questions = a.test.questions.map((q) => q.question);
  const score = scoreAnswers(questions, answers);
  await prisma.assessmentAttempt.update({
    where: { id: a.id },
    data: { status: 'submitted', answers, score_percent: score, passed: score >= a.pass_percentage, submitted_at: new Date(), started_at: a.started_at || new Date() },
  });
  return { submitted: true };
}

module.exports = {
  CATEGORIES,
  scoreAnswers,
  listQuestions,
  createQuestion,
  updateQuestion,
  listTests,
  getTest,
  createTest,
  updateTest,
  invite,
  listAttempts,
  openForCandidate,
  submitForCandidate,
};
