const prisma = require('../../config/db');
const { enqueue } = require('../../lib/email/outbox');

const DEFAULT_PASS_PERCENTAGE = 60;
const ROUND_INCLUDE = { rounds: { orderBy: { sort_order: 'asc' } } };

// A round counts as done once the interviewer recorded a verdict (pass / fail). Feedback (and ratings where required) are
// enforced when that verdict is saved, so a verdict implies them.
const DONE_RESULTS = ['pass', 'fail'];
const isDone = (round) => Boolean(round) && round.status !== 'cancelled' && DONE_RESULTS.includes(round.result);

// Overall % from per-skill ratings out of 10: sum / (skills * 10).
function scorePercent(ratings) {
  if (!ratings || !ratings.length) return null;
  const sum = ratings.reduce((s, r) => s + Number(r.rating), 0);
  return Math.round((sum / (ratings.length * 10)) * 10000) / 100;
}

// Finds the active template for a service type (+ hiring track). A template naming the track wins over a track-less one.
async function resolveTemplate(db, reqType, hiringTrack) {
  const rows = await db.interviewTemplate.findMany({
    where: { is_active: true, service_types: { has: reqType } },
    orderBy: { created_at: 'asc' },
  });
  const matching = rows.filter((t) => !t.hiring_track || t.hiring_track === (hiringTrack || null));
  return matching.find((t) => t.hiring_track) || matching[0] || null;
}

async function loadRequirementForSubmission(db, submissionId) {
  const sub = await db.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      seat: { select: { requirement: { select: { id: true, interview_template_id: true, pass_percentage: true, interview_template: { include: ROUND_INCLUDE } } } } },
    },
  });
  return sub?.seat?.requirement || null;
}

const passMarkFor = (requirement) => requirement?.pass_percentage ?? requirement?.interview_template?.pass_percentage ?? DEFAULT_PASS_PERCENTAGE;

// The candidate's interview plan: every template round, in order, with its state and whether it can be started now.
async function getPlan(db, submissionId) {
  const requirement = await loadRequirementForSubmission(db, submissionId);
  if (!requirement) return { error: 'not_found' };
  const template = requirement.interview_template;
  if (!template) return { plan: null };

  const rounds = await db.interviewRound.findMany({
    where: { submission_id: submissionId, template_round_id: { not: null }, status: { not: 'cancelled' } },
    include: { skill_ratings: true },
    orderBy: { round_number: 'asc' },
  });
  const byTemplateRound = new Map();
  rounds.forEach((r) => byTemplateRound.set(r.template_round_id, r));

  const passMark = passMarkFor(requirement);
  let blocked = false; // an earlier mandatory round is not done yet
  const steps = template.rounds.map((tr) => {
    const round = byTemplateRound.get(tr.id) || null;
    const done = isDone(round);
    const state = !round ? 'not_scheduled' : done ? 'completed' : 'scheduled';
    const below_pass = Boolean(round && round.score_percent != null && Number(round.score_percent) < passMark);
    const step = {
      template_round_id: tr.id,
      sort_order: tr.sort_order,
      name: tr.name,
      conducted_by: tr.conducted_by,
      kind: tr.kind,
      is_mandatory: tr.is_mandatory,
      rating_required: tr.rating_required,
      assessment_test_id: tr.assessment_test_id,
      state,
      can_start: !round && !blocked,
      interview_round_id: round?.id || null,
      result: round?.result || null,
      score_percent: round?.score_percent != null ? Number(round.score_percent) : null,
      below_pass,
    };
    if (tr.is_mandatory && !done) blocked = true;
    return step;
  });

  return {
    plan: {
      template: { id: template.id, name: template.name },
      pass_percentage: passMark,
      steps,
      mandatory_pending: steps.filter((s) => s.is_mandatory && s.state !== 'completed').length,
    },
  };
}

// Can this template round be scheduled for the submission right now? Returns an error code or the template round.
async function checkCanStart(db, submissionId, templateRoundId) {
  const requirement = await loadRequirementForSubmission(db, submissionId);
  const template = requirement?.interview_template;
  const target = template?.rounds.find((r) => r.id === templateRoundId);
  if (!target) return { error: 'invalid_template_round' };

  const existing = await db.interviewRound.findMany({
    where: { submission_id: submissionId, template_round_id: { not: null }, status: { not: 'cancelled' } },
  });
  if (existing.some((r) => r.template_round_id === templateRoundId)) return { error: 'round_already_exists' };
  const doneIds = new Set(existing.filter(isDone).map((r) => r.template_round_id));
  const pending = template.rounds.some((r) => r.sort_order < target.sort_order && r.is_mandatory && !doneIds.has(r.id));
  if (pending) return { error: 'previous_round_pending' };
  return { templateRound: target };
}

// Every mandatory template round of the submission is done (used before the offer stage).
async function mandatoryRoundsDone(db, submissionId) {
  const requirement = await loadRequirementForSubmission(db, submissionId);
  const template = requirement?.interview_template;
  if (!template) return true;
  const rounds = await db.interviewRound.findMany({
    where: { submission_id: submissionId, template_round_id: { not: null }, status: { not: 'cancelled' } },
  });
  const doneIds = new Set(rounds.filter(isDone).map((r) => r.template_round_id));
  return template.rounds.filter((r) => r.is_mandatory).every((r) => doneIds.has(r.id));
}

// Replaces the skill ratings of a round and returns the overall %.
async function saveSkillRatings(tx, roundId, skillRatings) {
  await tx.interviewRoundSkillRating.deleteMany({ where: { interview_round_id: roundId } });
  if (skillRatings.length) {
    await tx.interviewRoundSkillRating.createMany({
      data: skillRatings.map((s) => ({ interview_round_id: roundId, skill_name: s.skill_name.trim(), rating: s.rating, comment: s.comment || null })),
    });
  }
  return scorePercent(skillRatings);
}

// ---- template CRUD (admin-editable) ----
const listTemplates = (includeInactive = false) =>
  prisma.interviewTemplate.findMany({ where: includeInactive ? {} : { is_active: true }, include: ROUND_INCLUDE, orderBy: { created_at: 'asc' } });

const getTemplate = (id) => prisma.interviewTemplate.findUnique({ where: { id }, include: ROUND_INCLUDE });

function roundData(r, index) {
  return {
    sort_order: index + 1,
    name: r.name,
    conducted_by: r.conducted_by || 'delphic',
    kind: r.kind || 'interview',
    is_mandatory: r.is_mandatory !== false,
    rating_required: Boolean(r.rating_required),
    assessment_test_id: r.kind === 'screening_test' ? r.assessment_test_id || null : null,
  };
}

async function createTemplate(data) {
  const { rounds = [], ...rest } = data;
  const row = await prisma.interviewTemplate.create({ data: { ...rest, rounds: { create: rounds.map(roundData) } }, include: ROUND_INCLUDE });
  return { template: row };
}

// Rounds with an id are updated, without an id created, and omitted ones removed - unless interviews already use them.
async function updateTemplate(id, data) {
  const existing = await getTemplate(id);
  if (!existing) return { error: 'not_found' };
  const { rounds, ...rest } = data;

  return prisma.$transaction(async (tx) => {
    if (rounds) {
      const keep = new Set(rounds.filter((r) => r.id).map((r) => r.id));
      if ([...keep].some((rid) => !existing.rounds.some((er) => er.id === rid))) return { error: 'invalid_template_round' };
      const removed = existing.rounds.filter((er) => !keep.has(er.id));
      if (removed.length) {
        const used = await tx.interviewRound.count({ where: { template_round_id: { in: removed.map((r) => r.id) } } });
        if (used) return { error: 'template_round_in_use' };
        await tx.interviewTemplateRound.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
      }
      for (const [index, r] of rounds.entries()) {
        if (r.id) await tx.interviewTemplateRound.update({ where: { id: r.id }, data: roundData(r, index) });
        else await tx.interviewTemplateRound.create({ data: { template_id: id, ...roundData(r, index) } });
      }
    }
    const row = await tx.interviewTemplate.update({ where: { id }, data: rest, include: ROUND_INCLUDE });
    return { template: row };
  });
}

// "You will get your feedback" message to the candidate, sent by the manager after a round (typically a below-pass one).
async function sendCandidateFeedbackMessage(submissionId, { note }, user) {
  const sub = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, profile: { select: { name: true, email: true } }, seat: { select: { requirement: { select: { title: true } } } } },
  });
  if (!sub) return { error: 'not_found' };
  if (!sub.profile?.email) return { error: 'candidate_email_missing' };
  const title = sub.seat?.requirement?.title || 'the role';
  const text = `Hi ${sub.profile.name},\n\nThank you for taking the time to interview with us for ${title}. Your interview feedback has been recorded and you will receive it shortly.${note ? `\n\n${note}` : ''}\n\nRegards,\n${user.name || 'Delphic Team'}`;
  await enqueue(prisma, { kind: 'candidate_feedback', to: { email: sub.profile.email, name: sub.profile.name }, subject: `Your interview feedback - ${title}`, text });
  await prisma.auditLog.create({ data: { actor_id: user.id, action: 'candidate_feedback_message', entity_type: 'submission', entity_id: submissionId, reason: note || null, snapshot: { to: sub.profile.email } } });
  return { sent: true };
}

module.exports = {
  sendCandidateFeedbackMessage,
  DEFAULT_PASS_PERCENTAGE,
  isDone,
  scorePercent,
  resolveTemplate,
  getPlan,
  checkCanStart,
  mandatoryRoundsDone,
  saveSkillRatings,
  passMarkFor,
  loadRequirementForSubmission,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
};
