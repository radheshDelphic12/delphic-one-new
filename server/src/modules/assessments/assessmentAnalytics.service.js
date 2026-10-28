// Tests & interviews analytics (Hiring setup > Tests & interviews).
//
// Counting rules (kept here so the numbers can be explained):
//  * Tests: only LIVE attempts count, i.e. not deleted and not superseded. A retake therefore replaces the deleted result
//    instead of adding to it, and a link replaced by a newer one is not counted twice. Dated by the day the test was sent.
//      sent = live attempts; started = opened (in progress + scored); completed = scored; passed / failed = scored attempts
//      against the pass mark the test had on the day it was sent.
//  * Interviews: every interview round that is not deleted, dated by its interview time. scheduled = not cancelled;
//    completed = a verdict (pass / fail) was recorded; cancelled is reported on its own and is not in `scheduled`.
//  * Filters (requirement, recruiter = the person who submitted the candidate, client = the requirement's account) apply to
//    both sections through the submission.
const prisma = require('../../config/db');

const DONE_RESULTS = ['pass', 'fail'];

function dayRange(from, to) {
  const range = {};
  if (from) range.gte = new Date(`${from}T00:00:00.000Z`);
  if (to) range.lte = new Date(`${to}T23:59:59.999Z`);
  return Object.keys(range).length ? range : undefined;
}

// Submission ids matching the requirement / recruiter / client filters, or null when no such filter is set.
async function submissionScope({ requirementId, recruiterId, accountId }) {
  if (!requirementId && !recruiterId && !accountId) return null;
  const rows = await prisma.submission.findMany({
    where: {
      ...(recruiterId ? { submitted_by: recruiterId } : {}),
      ...(requirementId || accountId ? { seat: { requirement: { ...(requirementId ? { id: requirementId } : {}), ...(accountId ? { account_id: accountId } : {}) } } } : {}),
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

const testWhere = (filters, scope) => ({
  submission_id: scope ? { in: scope } : { not: null },
  deleted_at: null,
  superseded_at: null,
  ...(dayRange(filters.from, filters.to) ? { invited_at: dayRange(filters.from, filters.to) } : {}),
});

const roundWhere = (filters, scope) => ({
  ...(scope ? { submission_id: { in: scope } } : {}),
  ...(dayRange(filters.from, filters.to) ? { scheduled_at: dayRange(filters.from, filters.to) } : {}),
});

async function summary(filters) {
  const scope = await submissionScope(filters);
  const attempts = await prisma.assessmentAttempt.findMany({ where: testWhere(filters, scope), select: { status: true, passed: true, expires_at: true } });
  const rounds = await prisma.interviewRound.findMany({ where: roundWhere(filters, scope), select: { status: true, result: true } });

  const scored = attempts.filter((a) => a.status === 'submitted');
  const passed = scored.filter((a) => a.passed === true).length;
  const live = rounds.filter((r) => r.status !== 'cancelled');
  const completed = live.filter((r) => DONE_RESULTS.includes(r.result)).length;
  return {
    tests: {
      sent: attempts.length,
      not_opened: attempts.filter((a) => a.status === 'invited').length,
      in_progress: attempts.filter((a) => a.status === 'started').length,
      started: attempts.filter((a) => a.status !== 'invited').length,
      completed: scored.length,
      passed,
      failed: scored.length - passed,
      pass_rate: scored.length ? Math.round((passed / scored.length) * 10000) / 100 : null,
    },
    interviews: {
      scheduled: live.length,
      completed,
      pending: live.length - completed,
      cancelled: rounds.length - live.length,
    },
  };
}

const nameOf = (u) => u?.name || null;

async function submissionInfo(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const rows = await prisma.submission.findMany({
    where: { id: { in: list } },
    select: {
      id: true,
      profile: { select: { name: true } },
      submitted_by_user: { select: { id: true, name: true } },
      seat: { select: { requirement: { select: { id: true, title: true, account: { select: { id: true, name: true } } } } } },
    },
  });
  return new Map(rows.map((s) => [s.id, {
    candidate: s.profile?.name || null,
    recruiter: nameOf(s.submitted_by_user),
    requirement_id: s.seat?.requirement?.id || null,
    requirement: s.seat?.requirement?.title || null,
    client_id: s.seat?.requirement?.account?.id || null,
    client: s.seat?.requirement?.account?.name || null,
  }]));
}

async function records(kind, filters, { page = 1, limit = 25 } = {}) {
  const scope = await submissionScope(filters);
  const skip = (page - 1) * limit;

  if (kind === 'interviews') {
    const where = roundWhere(filters, scope);
    const [total, rows] = await Promise.all([
      prisma.interviewRound.count({ where }),
      prisma.interviewRound.findMany({ where, orderBy: { scheduled_at: 'desc' }, skip, take: limit, include: { template_round: { select: { name: true } } } }),
    ]);
    const info = await submissionInfo(rows.map((r) => r.submission_id));
    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        submission_id: r.submission_id,
        ...(info.get(r.submission_id) || {}),
        round: r.template_round?.name || r.round_name || `Round ${r.round_number}`,
        status: r.status === 'cancelled' ? 'cancelled' : DONE_RESULTS.includes(r.result) ? 'completed' : 'scheduled',
        result: r.result,
        score_percent: r.score_percent != null ? Number(r.score_percent) : null,
        scheduled_at: r.scheduled_at,
        completed_at: r.completed_at,
      })),
    };
  }

  const where = testWhere(filters, scope);
  const [total, rows] = await Promise.all([
    prisma.assessmentAttempt.count({ where }),
    prisma.assessmentAttempt.findMany({ where, orderBy: { invited_at: 'desc' }, skip, take: limit, include: { test: { select: { name: true } } } }),
  ]);
  const info = await submissionInfo(rows.map((a) => a.submission_id));
  const roundIds = [...new Set(rows.map((a) => a.template_round_id).filter(Boolean))];
  const roundNames = new Map((roundIds.length ? await prisma.interviewTemplateRound.findMany({ where: { id: { in: roundIds } }, select: { id: true, name: true } }) : []).map((r) => [r.id, r.name]));
  const creators = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((a) => a.invited_by).filter(Boolean))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return {
    total,
    items: rows.map((a) => ({
      id: a.id,
      submission_id: a.submission_id,
      ...(info.get(a.submission_id) || {}),
      round: roundNames.get(a.template_round_id) || 'Screening test',
      test: a.test.name,
      status: a.status === 'submitted' ? 'scored' : a.status === 'started' ? 'in_progress' : 'not_opened',
      score_percent: a.score_percent != null ? Number(a.score_percent) : null,
      passed: a.passed,
      pass_percentage: a.pass_percentage,
      sent_at: a.invited_at,
      submitted_at: a.submitted_at,
      sent_by: creators.get(a.invited_by) || null,
    })),
  };
}

// Options for the filter dropdowns: only requirements / recruiters / clients that actually have a test or an interview.
async function filterOptions() {
  const [attempts, rounds] = await Promise.all([
    prisma.assessmentAttempt.findMany({ where: { submission_id: { not: null }, deleted_at: null }, select: { submission_id: true } }),
    prisma.interviewRound.findMany({ select: { submission_id: true } }),
  ]);
  const ids = [...new Set([...attempts, ...rounds].map((r) => r.submission_id))];
  const info = await submissionInfo(ids);
  const subs = ids.length ? await prisma.submission.findMany({ where: { id: { in: ids } }, select: { id: true, submitted_by: true } }) : [];
  const pick = (idKey, nameKey) => {
    const seen = new Map();
    for (const s of subs) {
      const i = info.get(s.id);
      const id = idKey === 'recruiter_id' ? s.submitted_by : i?.[idKey];
      const name = i?.[nameKey];
      if (id && name && !seen.has(id)) seen.set(id, name);
    }
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  };
  return { requirements: pick('requirement_id', 'requirement'), clients: pick('client_id', 'client'), recruiters: pick('recruiter_id', 'recruiter') };
}

module.exports = { summary, records, filterOptions };
