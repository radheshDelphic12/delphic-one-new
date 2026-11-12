const prisma = require('../../config/db');
const { decide } = require('../../lib/permissions');

// Interview feedback: the page where the person who took an interview round (an assigned interviewer), HR and the admins give the result, the
// feedback and the skill ratings of a round. Open to every signed-in person (basic access), but a person only ever sees the rounds they took
// (HR and admins see all of them), and only the candidate's name and work background - nothing about price, client terms or the pipeline.
// The feedback itself is saved through PATCH /interview-rounds/:id, whose own rules (the round's interviewer, HR, the manager) decide who may write.

const ROUND_INCLUDE = {
  interviewers: { include: { user: { select: { id: true, name: true } } } },
  skill_ratings: { orderBy: { skill_name: 'asc' } },
  template_round: { select: { id: true, name: true, rating_required: true, kind: true } },
  submission: {
    select: {
      id: true,
      stage: true,
      is_locked: true,
      profile: { select: { name: true, current_designation: true, current_company: true, total_experience_years: true, current_location: true } },
      seat: { select: { requirement: { select: { title: true, primary_tech_stack: true } } } },
    },
  },
};
// A candidate whose process has ended (closed, backed out, rejected) or whose record is locked is not waiting for anyone's feedback any more:
// the round can no longer be edited, and the outcome is already recorded on the submission.
const ENDED_STAGES = ['closed', 'backout', 'rejected'];
const isEnded = (submission) => Boolean(submission && (ENDED_STAGES.includes(submission.stage) || submission.is_locked));
// The same rule as a database filter: only rounds of candidates still in the process.
const STILL_IN_PROCESS = { submission: { is: { stage: { notIn: ENDED_STAGES }, is_locked: false } } };
const ACTIVE = { deleted_at: null, status: { not: 'cancelled' } };
const ROUND_LABEL = { hr: 'HR round', technical: 'Technical round', client: 'Client round', managerial: 'Managerial round', final: 'Final round' };

/** HR (the recruiter role) and admins see every round; anyone else only the rounds they took. */
async function seesAll(user) {
  const person = await prisma.user.findUnique({ where: { id: user.id }, select: { is_group_superadmin: true } });
  return Boolean(person?.is_group_superadmin) || user.role === 'admin' || user.role === 'recruiter'
    || decide(user, 'submissions.update') === true || decide(user, 'meetings.schedule') === true;
}

function view(r, userId) {
  const requirement = r.submission?.seat?.requirement;
  return {
    id: r.id,
    submission_id: r.submission_id,
    candidate: r.submission?.profile?.name || '',
    requirement: requirement?.title || '',
    round_number: r.round_number,
    round_name: r.round_name || r.template_round?.name || ROUND_LABEL[r.round_type] || String(r.round_type).replace(/_/g, ' '),
    round_type: r.round_type,
    scheduled_at: r.scheduled_at,
    status: r.status,
    result: r.result,
    feedback: r.feedback || '',
    has_feedback: Boolean(r.feedback && r.feedback.trim()),
    candidate_ended: isEnded(r.submission), // closed / backed out / rejected / locked: no feedback is awaited
    submission_stage: r.submission?.stage || null,
    completed_at: r.completed_at,
    score_percent: r.score_percent != null ? Number(r.score_percent) : null,
    rating_required: Boolean(r.template_round?.rating_required),
    interviewers: (r.interviewers || []).map((i) => ({ id: i.user.id, name: i.user.name })),
    mine: (r.interviewers || []).some((i) => i.user.id === userId),
    skill_ratings: (r.skill_ratings || []).map((s) => ({ skill_name: s.skill_name, rating: s.rating })),
  };
}

// Waiting for feedback first; a round with feedback, or of a candidate whose process has ended, counts as done.
const waiting = (r) => !r.has_feedback && !r.candidate_ended;
const byDueFirst = (a, b) => (Number(!waiting(a)) - Number(!waiting(b))) || (new Date(b.scheduled_at || 0) - new Date(a.scheduled_at || 0));

/** The rounds this person took (as an interviewer), those waiting for feedback first. */
async function mine(user) {
  const rows = await prisma.interviewRound.findMany({
    where: { ...ACTIVE, interviewers: { some: { user_id: user.id } } },
    include: ROUND_INCLUDE,
    orderBy: { scheduled_at: 'desc' },
    take: 200,
  });
  return rows.map((r) => view(r, user.id)).sort(byDueFirst);
}

/** HR and admins: every round, optionally only those still waiting for feedback. */
async function all(user, { pending } = {}) {
  if (!(await seesAll(user))) return { error: 'forbidden' };
  const rows = await prisma.interviewRound.findMany({
    where: { ...ACTIVE, ...(pending ? { OR: [{ feedback: null }, { feedback: '' }], ...STILL_IN_PROCESS } : {}), scheduled_at: { not: null } },
    include: ROUND_INCLUDE,
    orderBy: { scheduled_at: 'desc' },
    take: 300,
  });
  return { rounds: rows.map((r) => view(r, user.id)).sort(byDueFirst) };
}

/** One candidate: their short profile and the rounds this person may write feedback for (all of them for HR and admins). */
async function forSubmission(user, submissionId) {
  const all_ = await seesAll(user);
  const rows = await prisma.interviewRound.findMany({
    where: { ...ACTIVE, submission_id: submissionId, ...(all_ ? {} : { interviewers: { some: { user_id: user.id } } }) },
    include: ROUND_INCLUDE,
    orderBy: { round_number: 'asc' },
  });
  if (!rows.length) {
    // HR / an admin may open a candidate who has no round yet; anyone else was not assigned to this candidate
    const exists = all_ ? await prisma.submission.findUnique({ where: { id: submissionId }, select: { id: true } }) : null;
    if (!exists) return { error: 'forbidden' };
  }
  const sub = rows[0]?.submission || (await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, stage: true, profile: { select: { name: true, current_designation: true, current_company: true, total_experience_years: true, current_location: true } }, seat: { select: { requirement: { select: { title: true, primary_tech_stack: true } } } } },
  }));
  const p = sub?.profile || {};
  const requirement = sub?.seat?.requirement;
  return {
    candidate: {
      name: p.name || '',
      designation: p.current_designation || null,
      company: p.current_company || null,
      experience_years: p.total_experience_years != null ? Number(p.total_experience_years) : null,
      location: p.current_location || null,
    },
    requirement: requirement?.title || '',
    suggested_skills: Array.isArray(requirement?.primary_tech_stack) ? requirement.primary_tech_stack : [],
    rounds: rows.map((r) => view(r, user.id)),
  };
}

module.exports = { mine, all, forSubmission };
