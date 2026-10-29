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
// Rules (see docs/features/INTERVIEW-TEMPLATES.md > Test link management):
//  * One LIVE attempt per submission + round: not deleted and not superseded. Sending a new test replaces an unopened link
//    (the old one is superseded); it is refused while the candidate is mid-test or already has a scored result.
//    Deleting a scored result (admin) lets the candidate retake.
//  * The org's attempt limit counts every attempt sent for the submission that is not deleted (superseded ones included, so
//    re-sending cannot dodge the limit). Deleting an attempt frees a slot; an admin can also send past the limit.
const attemptLink = (token) => `${env.corsOrigin.replace(/\/$/, '')}/assessment/${token}`;
const DEFAULT_MAX_ATTEMPTS = 3;
const isLive = (a) => !a.deleted_at && !a.superseded_at;
const adminOf = (user) => user?.role === 'admin' || Boolean(user?.is_superadmin);

const SETTINGS_SELECT = { assessment_max_attempts: true, assessment_email_candidate: true };

async function getSettings(orgId) {
  const org = orgId ? await prisma.org.findUnique({ where: { id: orgId }, select: SETTINGS_SELECT }) : null;
  return { assessment_max_attempts: org?.assessment_max_attempts ?? DEFAULT_MAX_ATTEMPTS, assessment_email_candidate: org?.assessment_email_candidate ?? false };
}

async function updateSettings(orgId, patch) {
  const data = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  await prisma.org.update({ where: { id: orgId }, data });
  return getSettings(orgId);
}

async function audit(db, user, action, attempt, reason, extra = {}) {
  await db.auditLog.create({
    data: {
      actor_id: user.id,
      action,
      entity_type: 'assessment_attempt',
      entity_id: attempt.id,
      reason: reason || (action === 'delete_attempt' ? 'Deleted by admin' : 'Changed by admin'),
      org_id: user.org_id || null,
      snapshot: {
        submission_id: attempt.submission_id, test_id: attempt.test_id, status: attempt.status,
        score_percent: attempt.score_percent != null ? Number(attempt.score_percent) : null, passed: attempt.passed,
        invited_at: attempt.invited_at, submitted_at: attempt.submitted_at, expires_at: attempt.expires_at, ...extra,
      },
    },
  });
}

// The screening round of the candidate's interview plan that a test belongs to (null for requirements without a template).
async function screeningRoundId(db, submissionId) {
  const sub = await db.submission.findUnique({
    where: { id: submissionId },
    select: { seat: { select: { requirement: { select: { interview_template: { select: { rounds: { where: { kind: 'screening_test' }, orderBy: { sort_order: 'asc' }, take: 1, select: { id: true } } } } } } } } },
  });
  return sub?.seat?.requirement?.interview_template?.rounds?.[0]?.id || null;
}

// Sends the test to the candidate of a submission: a new public link to copy. It is e-mailed only when the company setting
// "e-mail the test link to the candidate" is on (off by default).
async function invite({ testId, submissionId, overrideLimit = false }, user) {
  const test = await prisma.assessmentTest.findUnique({ where: { id: testId }, include: { _count: { select: { questions: true } } } });
  if (!test || !test.is_active) return { error: 'not_found' };
  if (!test._count.questions) return { error: 'empty_test' };
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, profile: { select: { name: true, email: true } }, seat: { select: { requirement: { select: { title: true } } } } },
  });
  if (!submission) return { error: 'not_found' };

  const roundId = await screeningRoundId(prisma, submissionId);
  const existing = await prisma.assessmentAttempt.findMany({ where: { submission_id: submissionId, deleted_at: null } });
  const live = existing.filter((a) => isLive(a) && (a.template_round_id || roundId) === roundId);
  if (live.some((a) => a.status === 'submitted')) return { error: 'already_completed' };
  if (live.some((a) => a.status === 'started')) return { error: 'in_progress' };

  const { assessment_max_attempts: limit, assessment_email_candidate: emailCandidate } = await getSettings(user.org_id);
  if (limit > 0 && existing.length >= limit && !(overrideLimit && adminOf(user))) return { error: 'limit_reached', limit, used: existing.length };

  const token = crypto.randomBytes(24).toString('hex');
  const attempt = await prisma.$transaction(async (tx) => {
    if (live.length) await tx.assessmentAttempt.updateMany({ where: { id: { in: live.map((a) => a.id) } }, data: { superseded_at: new Date() } });
    return tx.assessmentAttempt.create({
      data: {
        token,
        test_id: testId,
        submission_id: submissionId,
        template_round_id: roundId,
        candidate_name: submission.profile?.name || 'Candidate',
        candidate_email: submission.profile?.email || null,
        pass_percentage: test.pass_percentage,
        invited_by: user.id,
        expires_at: new Date(Date.now() + LINK_VALID_DAYS * 86400000),
      },
    });
  });
  const link = attemptLink(token);
  if (emailCandidate && attempt.candidate_email) {
    await enqueue(prisma, {
      kind: 'assessment_invite',
      to: { email: attempt.candidate_email, name: attempt.candidate_name },
      subject: `Your assessment for ${submission.seat?.requirement?.title || 'the role'}`,
      text: `Hi ${attempt.candidate_name},\n\nPlease complete this short assessment: ${link}\n\nThe link is valid for ${LINK_VALID_DAYS} days${test.duration_minutes ? ` and the test takes about ${test.duration_minutes} minutes` : ''}. You can open it once and submit your answers once.\n\nThank you,\nDelphic Team`,
    });
  }
  return { attempt: toAttemptView(attempt), link, superseded: live.length };
}

// not_opened | in_progress | scored | expired | superseded (what the team sees); deleted attempts are never listed.
function viewStatus(a) {
  if (a.superseded_at) return 'superseded';
  if (a.status === 'submitted') return 'scored';
  if (a.expires_at < new Date()) return 'expired';
  return a.status === 'started' ? 'in_progress' : 'not_opened';
}

function toAttemptView(a, names = new Map()) {
  return {
    id: a.id,
    test_id: a.test_id,
    submission_id: a.submission_id,
    template_round_id: a.template_round_id,
    candidate_name: a.candidate_name,
    status: a.status,
    view_status: viewStatus(a),
    is_live: isLive(a),
    score_percent: a.score_percent != null ? Number(a.score_percent) : null,
    passed: a.passed,
    pass_percentage: a.pass_percentage,
    invited_at: a.invited_at,
    invited_by: a.invited_by,
    created_by_name: names.get(a.invited_by) || null,
    expires_at: a.expires_at,
    submitted_at: a.submitted_at,
    link: a.status === 'submitted' || a.superseded_at ? null : attemptLink(a.token),
  };
}

async function userNames(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } });
  return new Map(rows.map((u) => [u.id, u.name]));
}

// Attempts of a submission (newest first) plus the live one and the limit position. Deleted attempts are not listed.
async function listAttempts({ submissionId }, user) {
  const rows = await prisma.assessmentAttempt.findMany({
    where: { submission_id: submissionId, deleted_at: null },
    include: { test: { select: { name: true } } },
    orderBy: { invited_at: 'desc' },
  });
  const names = await userNames(rows.map((a) => a.invited_by));
  const { assessment_max_attempts: limit } = await getSettings(user?.org_id);
  const items = rows.map((a) => ({ ...toAttemptView(a, names), test_name: a.test.name }));
  const live = items.find((a) => a.is_live) || null;
  return { items, live_id: live?.id || null, used: rows.length, limit, remaining: limit > 0 ? Math.max(0, limit - rows.length) : null };
}

// Opens a submitted attempt for review: every question with the candidate's pick, the marks it carried and whether it was right.
// Uses the test's questions as they are now (answers are stored by question id); a question removed since is simply not listed.
async function reviewAttempt(id) {
  const a = await prisma.assessmentAttempt.findFirst({ where: { id, deleted_at: null }, include: { test: { include: TEST_INCLUDE } } });
  if (!a) return { error: 'not_found' };
  if (a.status !== 'submitted') return { error: 'not_submitted' };
  const answers = a.answers || {};
  const questions = a.test.questions.map((tq, i) => {
    const q = tq.question;
    const options = Array.isArray(q.options) ? q.options : [];
    const best = Math.max(0, ...options.map((o) => Number(o.marks) || 0));
    const raw = answers[q.id];
    const picked = raw === undefined || raw === null ? null : Number(raw);
    const pickedOption = picked != null ? options[picked] : null;
    const got = pickedOption ? Number(pickedOption.marks) || 0 : 0;
    const result = !pickedOption ? 'not_answered' : got >= best && best > 0 ? 'correct' : got > 0 ? 'partial' : 'wrong';
    return {
      number: i + 1,
      id: q.id,
      category: q.category,
      text: q.text,
      options: options.map((o, idx) => ({ text: o.text, marks: Number(o.marks) || 0, picked: idx === picked, best: best > 0 && (Number(o.marks) || 0) === best })),
      marks_got: got,
      marks_full: best,
      result,
    };
  });
  const count = (r) => questions.filter((q) => q.result === r).length;
  return {
    review: {
      id: a.id,
      test_name: a.test.name,
      candidate_name: a.candidate_name,
      score_percent: a.score_percent != null ? Number(a.score_percent) : null,
      passed: a.passed,
      pass_percentage: a.pass_percentage,
      submitted_at: a.submitted_at,
      summary: { total: questions.length, correct: count('correct'), partial: count('partial'), wrong: count('wrong'), not_answered: count('not_answered') },
      questions,
    },
  };
}

// Admin: delete a link or a scored result. A deleted attempt stops working, drops out of every count and frees a slot of the limit.
async function deleteAttempt(id, { reason }, user) {
  const attempt = await prisma.assessmentAttempt.findFirst({ where: { id, deleted_at: null } });
  if (!attempt) return { error: 'not_found' };
  await prisma.$transaction(async (tx) => {
    await tx.assessmentAttempt.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: user.id } });
    await audit(tx, user, 'delete_attempt', attempt, reason);
  });
  return { deleted: true };
}

// Admin: give an unfinished link a fresh validity window (e.g. it expired before the candidate could start).
async function extendAttempt(id, { days }, user) {
  const attempt = await prisma.assessmentAttempt.findFirst({ where: { id, deleted_at: null } });
  if (!attempt) return { error: 'not_found' };
  if (attempt.status === 'submitted' || attempt.superseded_at) return { error: 'not_extendable' };
  const expires = new Date(Date.now() + (days || LINK_VALID_DAYS) * 86400000);
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.assessmentAttempt.update({ where: { id }, data: { expires_at: expires } });
    await audit(tx, user, 'extend_attempt', attempt, `Validity extended to ${expires.toISOString().slice(0, 10)}`, { new_expires_at: expires });
    return row;
  });
  return { attempt: toAttemptView(updated) };
}

// ---- public (candidate) side: the token is the only credential ----
async function loadByToken(token) {
  const a = await prisma.assessmentAttempt.findUnique({ where: { token }, include: { test: { include: TEST_INCLUDE } } });
  if (!a || a.deleted_at) return { error: 'not_found' };
  if (a.superseded_at) return { error: 'superseded' };
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
  deleteAttempt,
  reviewAttempt,
  extendAttempt,
  getSettings,
  updateSettings,
  openForCandidate,
  submitForCandidate,
};
