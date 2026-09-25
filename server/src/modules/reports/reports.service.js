const prisma = require('../../config/db');
const { STUCK_THRESHOLD_DAYS } = require('../../config/constants');
const { ROUND_TYPES, computeMissingMandatoryRounds } = require('../submissions/stageMachines');

function daysBetween(from, to) {
  return (new Date(to) - new Date(from)) / 86400000;
}

// The business runs on IST (Asia/Kolkata — fixed +05:30, no DST). Every report
// buckets rows and closes date ranges on the IST calendar day/month, regardless
// of the server clock (UTC in prod). `date_from`/`date_to` from the UI are IST
// `YYYY-MM-DD` strings.
const IST_OFFSET_MS = 330 * 60 * 1000;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A Date shifted so its UTC getters (`getUTCFullYear`, `toISOString`, …) read the IST wall clock. */
function asIst(value) {
  return new Date(new Date(value).getTime() + IST_OFFSET_MS);
}

/** IST calendar day of an instant, as `YYYY-MM-DD`. */
function dayKey(value) {
  return value ? asIst(value).toISOString().slice(0, 10) : null;
}

/** IST month of an instant: `{ label: 'Sep 2026', sort: '2026-09' }`. */
function monthKey(value) {
  const d = asIst(value);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return { label: `${MONTHS_SHORT[m]} ${y}`, sort: `${y}-${String(m + 1).padStart(2, '0')}` };
}

/** Report `date_from` → instant: start of the IST day for `YYYY-MM-DD`, else pass-through. */
function reportFrom(value) {
  return typeof value === 'string' && value.length <= 10
    ? new Date(`${value}T00:00:00.000+05:30`)
    : new Date(value);
}

/** Report `date_to` → instant: end of the IST day for `YYYY-MM-DD`, else pass-through. */
function reportTo(value) {
  return typeof value === 'string' && value.length <= 10
    ? new Date(`${value}T23:59:59.999+05:30`)
    : new Date(value);
}

/** Build a Prisma date filter from optional YYYY-MM-DD (or ISO) strings; IST, end day inclusive. */
function optionalDateRange(date_from, date_to) {
  const range = {};
  if (date_from) range.gte = reportFrom(date_from);
  if (date_to) range.lte = reportTo(date_to);
  return Object.keys(range).length ? range : undefined;
}

function averageDays(values) {
  if (!values.length) return null;
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1));
}

function firstArrivalAt(historyAsc, stage) {
  const row = historyAsc.find((h) => h.to_stage === stage);
  return row ? row.changed_at : null;
}

function computeRecruiterCycleAverages(submissions, historyBySubmission, firstRoundBySubmission) {
  const sourcedToSubmitted = [];
  const submittedToInterview = [];
  const interviewToOffer = [];
  const offerToClosed = [];
  const totalCycle = [];

  for (const submission of submissions) {
    const history = historyBySubmission.get(submission.id) || [];
    const submittedAt = firstArrivalAt(history, 'submitted_to_client');
    const interviewAt =
      firstArrivalAt(history, 'interview_scheduled') ||
      firstArrivalAt(history, 'interview_result') ||
      firstRoundBySubmission.get(submission.id) ||
      null;
    const offerAt = firstArrivalAt(history, 'offer_sent');
    const closedAt = firstArrivalAt(history, 'closed') || submission.actual_joining_date;

    if (submittedAt) sourcedToSubmitted.push(daysBetween(submission.created_at, submittedAt));
    if (submittedAt && interviewAt) submittedToInterview.push(daysBetween(submittedAt, interviewAt));
    if (interviewAt && offerAt) interviewToOffer.push(daysBetween(interviewAt, offerAt));
    if (offerAt && closedAt) offerToClosed.push(daysBetween(offerAt, closedAt));
    if (closedAt) totalCycle.push(daysBetween(submission.created_at, closedAt));
  }

  return {
    avg_days_sourced_to_submitted: averageDays(sourcedToSubmitted),
    avg_days_submitted_to_interview: averageDays(submittedToInterview),
    avg_days_interview_to_offer: averageDays(interviewToOffer),
    avg_days_offer_to_closed: averageDays(offerToClosed),
    avg_days_total_cycle: averageDays(totalCycle),
  };
}

async function loadSubmissionTimingMaps(submissionIds) {
  if (!submissionIds.length) {
    return { historyBySubmission: new Map(), firstRoundBySubmission: new Map() };
  }

  const [historyRows, roundRows] = await Promise.all([
    prisma.stageHistory.findMany({
      where: { entity_type: 'submission', entity_id: { in: submissionIds } },
      orderBy: { changed_at: 'asc' },
    }),
    prisma.interviewRound.findMany({
      where: { submission_id: { in: submissionIds } },
      orderBy: { round_number: 'asc' },
    }),
  ]);

  const historyBySubmission = new Map();
  for (const row of historyRows) {
    if (!historyBySubmission.has(row.entity_id)) historyBySubmission.set(row.entity_id, []);
    historyBySubmission.get(row.entity_id).push(row);
  }

  const firstRoundBySubmission = new Map();
  for (const round of roundRows) {
    if (!firstRoundBySubmission.has(round.submission_id)) {
      firstRoundBySubmission.set(round.submission_id, round.scheduled_at || round.completed_at);
    }
  }

  return { historyBySubmission, firstRoundBySubmission };
}

function summarizeInterviewRounds(rounds, from, to) {
  const inPeriod = rounds.filter((r) => {
    const anchor = r.completed_at || r.scheduled_at;
    if (!anchor) return true;
    const t = new Date(anchor);
    return t >= from && t <= to;
  });

  const completed = inPeriod.filter((r) => r.result !== 'pending');
  const pending = inPeriod.filter((r) => r.result === 'pending');
  const withFeedback = inPeriod.filter((r) => r.feedback && r.feedback.trim().length > 0);
  const ratings = inPeriod.map((r) => r.rating).filter((n) => n != null);
  const turnaroundDays = completed
    .filter((r) => r.scheduled_at && r.completed_at)
    .map((r) => daysBetween(r.scheduled_at, r.completed_at));

  const by_type = ROUND_TYPES.reduce((acc, type) => ({ ...acc, [type]: 0 }), {});
  const by_result = { pending: 0, pass: 0, fail: 0, no_show: 0, rescheduled: 0 };
  for (const r of inPeriod) {
    if (by_type[r.round_type] !== undefined) by_type[r.round_type] += 1;
    if (by_result[r.result] !== undefined) by_result[r.result] += 1;
  }

  return {
    interviews_total: inPeriod.length,
    interviews_completed: completed.length,
    interviews_pending: pending.length,
    interviews_internal: by_type.internal_r1 + by_type.internal_r2,
    interviews_client: by_type.client_r1 + by_type.client_r2 + by_type.client_r3 + by_type.hr_cto_ceo,
    interviews_by_type: by_type,
    interviews_by_result: by_result,
    interviews_with_feedback: withFeedback.length,
    interviews_missing_feedback: completed.filter((r) => !r.feedback || !r.feedback.trim()).length,
    avg_interview_rating: ratings.length ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)) : null,
    avg_days_interview_turnaround: averageDays(turnaroundDays),
  };
}

async function recruiterPerformance({ date_from, date_to, recruiter_id, department_id }) {
  const recruiters = await prisma.user.findMany({
    where: {
      role: 'recruiter',
      ...(recruiter_id ? { id: recruiter_id } : {}),
      ...(department_id ? { department_id } : {}),
    },
  });

  const from = reportFrom(date_from);
  const to = reportTo(date_to);

  return Promise.all(
    recruiters.map(async (r) => {
      const profiles = await prisma.profile.findMany({
        where: { added_by: r.id, created_at: { gte: from, lte: to } },
      });
      const sourceMap = profiles.reduce((acc, p) => {
        acc[p.source] = (acc[p.source] || 0) + 1;
        return acc;
      }, {});

      const submissions = await prisma.submission.findMany({
        where: { submitted_by: r.id, created_at: { gte: from, lte: to } },
        include: { seat: { select: { requirement_id: true } } },
      });

      const byStage = submissions.reduce((acc, s) => {
        acc[s.stage] = (acc[s.stage] || 0) + 1;
        return acc;
      }, {});

      const closures = submissions.filter(
        (s) => s.actual_joining_date && s.actual_joining_date >= from && s.actual_joining_date <= to
      );
      const backouts = submissions.filter((s) => s.stage === 'backout').length;
      const requirementIds = new Set(submissions.map((s) => s.seat.requirement_id));

      const submissionIds = (
        await prisma.submission.findMany({ where: { submitted_by: r.id }, select: { id: true } })
      ).map((s) => s.id);

      const rounds = submissionIds.length
        ? await prisma.interviewRound.findMany({ where: { submission_id: { in: submissionIds } } })
        : [];
      const interviewStats = summarizeInterviewRounds(rounds, from, to);

      const roundsBySubmission = rounds.reduce((acc, round) => {
        if (!acc.has(round.submission_id)) acc.set(round.submission_id, []);
        acc.get(round.submission_id).push(round);
        return acc;
      }, new Map());
      const rounds_missing_mandatory_count = submissions.filter(
        (s) => computeMissingMandatoryRounds(roundsBySubmission.get(s.id) || []).length > 0
      ).length;

      const { historyBySubmission, firstRoundBySubmission } = await loadSubmissionTimingMaps(
        submissions.map((s) => s.id)
      );
      const cycleAverages = computeRecruiterCycleAverages(submissions, historyBySubmission, firstRoundBySubmission);

      const closureRate = submissions.length
        ? Number(((closures.length / submissions.length) * 100).toFixed(2))
        : 0;

      return {
        recruiter: { id: r.id, name: r.name },
        profiles_sourced: profiles.length,
        profiles_sourced_by_source: {
          direct: sourceMap.direct || 0,
          vendor: sourceMap.vendor || 0,
          linkedin: sourceMap.linkedin || 0,
        },
        submissions_total: submissions.length,
        submissions_in_screening: byStage.internal_screening || 0,
        submissions_submitted_to_client: byStage.submitted_to_client || 0,
        submissions_in_interview: (byStage.interview_scheduled || 0) + (byStage.interview_result || 0),
        submissions_in_offer: byStage.offer_sent || 0,
        submissions_in_bgv: byStage.bgv || 0,
        submissions_closed: byStage.closed || 0,
        submissions_rejected: byStage.rejected || 0,
        submissions_backout: backouts,
        backout_rate_percentage: submissions.length ? Number(((backouts / submissions.length) * 100).toFixed(2)) : 0,
        ...cycleAverages,
        ...interviewStats,
        rounds_missing_mandatory_count,
        requirements_worked_on: requirementIds.size,
        closures_count: closures.length,
        closure_rate_percentage: closureRate,
      };
    })
  );
}

async function salesPerformance({ date_from, date_to, sales_id, department_id }) {
  const salesUsers = await prisma.user.findMany({
    where: {
      role: 'sales',
      ...(sales_id ? { id: sales_id } : {}),
      ...(department_id ? { department_id } : {}),
    },
  });
  const from = reportFrom(date_from);
  const to = reportTo(date_to);

  return Promise.all(
    salesUsers.map(async (s) => {
      const requirements = await prisma.requirement.findMany({
        where: { sales_owner_id: s.id, created_at: { gte: from, lte: to } },
      });
      const requirements_closed = requirements.filter((r) => r.status === 'closed');
      const requirements_dropped = requirements.filter((r) => r.status === 'dropped').length;
      const requirements_in_progress = requirements.filter((r) => r.status === 'in_progress').length;

      const allOwnedReqIds = (
        await prisma.requirement.findMany({ where: { sales_owner_id: s.id }, select: { id: true } })
      ).map((r) => r.id);

      const closedSubmissions = requirements_closed.length
        ? await prisma.submission.findMany({
            where: { seat: { requirement_id: { in: requirements_closed.map((r) => r.id) } }, stage: 'closed' },
          })
        : [];

      const periodClosures = allOwnedReqIds.length
        ? await prisma.submission.findMany({
            where: {
              seat: { requirement_id: { in: allOwnedReqIds } },
              actual_joining_date: { gte: from, lte: to },
            },
          })
        : [];

      const rounds = allOwnedReqIds.length
        ? await prisma.interviewRound.findMany({
            where: { submission: { seat: { requirement_id: { in: allOwnedReqIds } } } },
          })
        : [];
      const interviewStats = summarizeInterviewRounds(rounds, from, to);

      const ownedSubmissions = allOwnedReqIds.length
        ? await prisma.submission.findMany({
            where: {
              seat: { requirement_id: { in: allOwnedReqIds } },
              stage: { notIn: ['backout', 'rejected'] },
            },
            select: { id: true },
          })
        : [];
      const roundTypesBySubmission = rounds.reduce((acc, round) => {
        if (!acc.has(round.submission_id)) acc.set(round.submission_id, new Set());
        acc.get(round.submission_id).add(round.round_type);
        return acc;
      }, new Map());
      const submissions_missing_hr_cto_ceo_round = ownedSubmissions.filter(
        (s) => !(roundTypesBySubmission.get(s.id) || new Set()).has('hr_cto_ceo')
      ).length;

      const total_closed_revenue = closedSubmissions.reduce((sum, x) => sum + Number(x.final_agreed_rate || 0), 0);
      const total_margin_generated = closedSubmissions.reduce((sum, x) => sum + Number(x.margin || 0), 0);

      const openRequirements = requirements.filter((r) => r.status === 'open' || r.status === 'in_progress');
      const total_budget_pipeline = openRequirements.reduce((sum, r) => sum + Number(r.budget_max || 0), 0);

      // Active clients linked via requirements this person owns (not BDA lead ownership).
      const clientIds = [
        ...new Set(
          (
            await prisma.requirement.findMany({
              where: { sales_owner_id: s.id, account: { type: 'client' } },
              select: { account_id: true },
            })
          ).map((r) => r.account_id)
        ),
      ];
      const clients_active = clientIds.length
        ? await prisma.account.count({ where: { id: { in: clientIds }, stage: 'active' } })
        : 0;

      // Anchored on closed_at falling in the period (same closure-event window as periodClosures),
      // not on created_at — a requirement opened long before the period can still close within it.
      // status: 'closed' excludes dropped requirements, which also stamp closed_at.
      const closedInPeriod = await prisma.requirement.findMany({
        where: { sales_owner_id: s.id, status: 'closed', closed_at: { gte: from, lte: to } },
      });
      let avg_closure_days = null;
      if (closedInPeriod.length) {
        const days = closedInPeriod.map((r) => (new Date(r.closed_at) - new Date(r.created_at)) / 86400000);
        avg_closure_days = Number((days.reduce((a, b) => a + b, 0) / days.length).toFixed(1));
      }

      return {
        sales_person: { id: s.id, name: s.name },
        requirements_opened: requirements.length,
        requirements_closed: requirements_closed.length,
        requirements_dropped,
        requirements_in_progress,
        avg_closure_days,
        total_budget_pipeline,
        total_closed_revenue,
        total_margin_generated,
        clients_active,
        closures_count: periodClosures.length,
        ...interviewStats,
        submissions_missing_hr_cto_ceo_round,
      };
    })
  );
}

/**
 * BDA lead/account funnel. Leads are owned by BDA (owner_id), not sales.
 * "Brought"/funnel metrics credit origin_owner_id (immutable — who first added the
 * client/vendor). The *_current snapshots credit owner_id (the present POC), so a
 * reassigned account moves in the snapshot but the origin BDA keeps the acquisition credit.
 */
async function bdaPerformance({ date_from, date_to, bda_id, department_id }) {
  const bdaUsers = await prisma.user.findMany({
    where: {
      role: 'bda',
      ...(bda_id ? { id: bda_id } : {}),
      ...(department_id ? { department_id } : {}),
    },
  });
  const from = reportFrom(date_from);
  const to = reportTo(date_to);
  const stuckCutoff = new Date(Date.now() - STUCK_THRESHOLD_DAYS * 86400000);

  return Promise.all(
    bdaUsers.map(async (b) => {
      const ownedInRange = await prisma.account.findMany({
        where: {
          OR: [{ origin_owner_id: b.id }, { origin_owner_id: null, owner_id: b.id }],
          created_at: { gte: from, lte: to },
        },
      });
      const clientLeads = ownedInRange.filter((a) => a.type === 'client');
      const vendorLeads = ownedInRange.filter((a) => a.type === 'vendor');
      const unclassifiedLeads = ownedInRange.filter((a) => a.type == null);

      const leads_created = clientLeads.length;
      const leads_in_meeting = clientLeads.filter((a) => a.stage === 'meeting_scheduled' || a.stage === 'rescheduled').length;
      const leads_converted_active = clientLeads.filter((a) => a.stage === 'active').length;
      const leads_dropped = clientLeads.filter((a) => a.stage === 'dropped').length;
      const leads_unclassified = unclassifiedLeads.length;
      const leads_via_linkedin = ownedInRange.filter((a) => !!a.linkedin_url).length;

      const meetingDays = ownedInRange
        .filter((a) => a.created_at && a.meeting_date)
        .map((a) => daysBetween(a.created_at, a.meeting_date));
      const avg_days_lead_to_meeting = averageDays(meetingDays);

      // Snapshot counts "as of now" — intentionally NOT scoped to date_from/date_to like the
      // fields above, since "currently active clients" is a present-state fact, not a period
      // event. Named *_current so the report doesn't imply they're period-scoped.
      const clients_active_current = await prisma.account.count({
        where: { owner_id: b.id, type: 'client', stage: 'active' },
      });
      const vendors_active_current = await prisma.account.count({
        where: { owner_id: b.id, type: 'vendor', stage: 'active' },
      });
      const stuck_leads_current = await prisma.account.count({
        where: {
          owner_id: b.id,
          type: 'client',
          stage: { in: ['lead', 'meeting_scheduled', 'rescheduled'] },
          updated_at: { lte: stuckCutoff },
        },
      });

      return {
        bda: { id: b.id, name: b.name },
        leads_created,
        leads_in_meeting,
        leads_converted_active,
        leads_dropped,
        conversion_rate_percentage: leads_created
          ? Number(((leads_converted_active / leads_created) * 100).toFixed(2))
          : 0,
        vendors_created: vendorLeads.length,
        leads_unclassified,
        leads_via_linkedin,
        avg_days_lead_to_meeting,
        clients_active_current,
        vendors_active_current,
        stuck_leads_current,
      };
    })
  );
}

async function vendorPerformance({ date_from, date_to, vendor_id }) {
  const vendors = await prisma.account.findMany({ where: { type: 'vendor', ...(vendor_id ? { id: vendor_id } : {}) } });
  const from = reportFrom(date_from);
  const to = reportTo(date_to);

  return Promise.all(
    vendors.map(async (v) => {
      const submissions = await prisma.submission.findMany({
        where: { profile: { vendor_account_id: v.id }, created_at: { gte: from, lte: to } },
        include: { seat: { include: { requirement: { select: { created_at: true } } } } },
      });

      const shortlisted = submissions.filter((s) => !['sourced', 'internal_screening'].includes(s.stage)).length;
      const interviewed = submissions.filter((s) => ['interview_scheduled', 'interview_result', 'offer_sent', 'bgv', 'closed'].includes(s.stage)).length;
      const offered = submissions.filter((s) => ['offer_sent', 'bgv', 'closed'].includes(s.stage)).length;
      const closed = submissions.filter((s) => s.stage === 'closed');
      const backout = submissions.filter((s) => s.stage === 'backout').length;

      const margins = closed.map((s) => Number(s.margin || 0));
      const total_margin = margins.reduce((a, b) => a + b, 0);
      const daysToSubmit = submissions.map((s) => daysBetween(s.seat.requirement.created_at, s.created_at));

      return {
        vendor: { id: v.id, name: v.name },
        profiles_submitted: submissions.length,
        profiles_shortlisted: shortlisted,
        profiles_interviewed: interviewed,
        profiles_offered: offered,
        profiles_closed: closed.length,
        profiles_backout: backout,
        backout_rate_percentage: submissions.length ? Number(((backout / submissions.length) * 100).toFixed(2)) : 0,
        avg_margin_per_profile: closed.length ? Number((total_margin / closed.length).toFixed(2)) : 0,
        total_margin,
        avg_days_to_submit: averageDays(daysToSubmit),
        reliability_score: submissions.length ? Number(((closed.length / submissions.length) * 100).toFixed(2)) : null,
      };
    })
  );
}

async function clientPerformance({ date_from, date_to, client_id }) {
  const clients = await prisma.account.findMany({ where: { type: 'client', ...(client_id ? { id: client_id } : {}) } });
  const from = reportFrom(date_from);
  const to = reportTo(date_to);
  const stuckCutoff = new Date(Date.now() - STUCK_THRESHOLD_DAYS * 86400000);

  return Promise.all(
    clients.map(async (c) => {
      const requirements = await prisma.requirement.findMany({
        where: { account_id: c.id, created_at: { gte: from, lte: to } },
      });
      const requirementIds = requirements.map((r) => r.id);

      const allReqIds = (
        await prisma.requirement.findMany({ where: { account_id: c.id }, select: { id: true } })
      ).map((r) => r.id);

      const submissions = requirementIds.length
        ? await prisma.submission.findMany({
            where: { seat: { requirement_id: { in: requirementIds } } },
          })
        : [];
      const closedSubmissions = submissions.filter((s) => s.stage === 'closed');

      const total_revenue = closedSubmissions.reduce((sum, s) => sum + Number(s.final_agreed_rate || 0), 0);
      const total_margin = closedSubmissions.reduce((sum, s) => sum + Number(s.margin || 0), 0);
      const closureDays = closedSubmissions
        .filter((s) => s.actual_joining_date)
        .map((s) => daysBetween(s.created_at, s.actual_joining_date));

      const stuck_requirements_count = allReqIds.length
        ? await prisma.requirement.count({
            where: {
              id: { in: allReqIds },
              status: { in: ['open', 'in_progress'] },
              updated_at: { lte: stuckCutoff },
            },
          })
        : 0;

      return {
        client: { id: c.id, name: c.name },
        requirements_total: requirements.length,
        requirements_open: requirements.filter((r) => r.status === 'open' || r.status === 'in_progress').length,
        requirements_closed: requirements.filter((r) => r.status === 'closed').length,
        submissions_total: submissions.length,
        submissions_closed: closedSubmissions.length,
        avg_days_to_close: averageDays(closureDays),
        total_revenue,
        total_margin,
        stuck_requirements_count,
      };
    })
  );
}

async function aging({ threshold_days = STUCK_THRESHOLD_DAYS, department_id }) {
  const cutoff = new Date(Date.now() - threshold_days * 86400000);
  const ownerDept = department_id ? { owner: { department_id } } : {};
  const salesDept = department_id ? { sales_owner: { department_id } } : {};
  const recruiterDept = department_id ? { submitted_by_user: { department_id } } : {};

  const stuckLeadsRaw = await prisma.account.findMany({
    where: {
      stage: { in: ['lead', 'meeting_scheduled', 'rescheduled'] },
      updated_at: { lte: cutoff },
      ...ownerDept,
    },
    include: {
      owner: { select: { id: true, name: true } },
      requirements: { select: { id: true } },
    },
  });

  const stuckReqsRaw = await prisma.requirement.findMany({
    where: { status: { in: ['open', 'in_progress'] }, updated_at: { lte: cutoff }, ...salesDept },
    include: {
      sales_owner: { select: { id: true, name: true } },
      account: {
        select: {
          id: true,
          name: true,
          owner: { select: { id: true, name: true } },
        },
      },
      seats: { select: { id: true } },
      assignments: {
        where: { role_on_req: 'recruiter', unassigned_at: null },
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });

  const allSeatIds = stuckReqsRaw.flatMap((r) => r.seats.map((s) => s.id));
  const submissionAgg = allSeatIds.length
    ? await prisma.submission.groupBy({
        by: ['requirement_seat_id'],
        where: { requirement_seat_id: { in: allSeatIds } },
        _count: { _all: true },
        _max: { created_at: true, updated_at: true },
      })
    : [];
  const seatAggById = new Map(submissionAgg.map((row) => [row.requirement_seat_id, row]));

  const stuckReqs = stuckReqsRaw.map((r) => {
    const seatStats = r.seats.map((seat) => seatAggById.get(seat.id)).filter(Boolean);
    const submissions_count = seatStats.reduce((sum, row) => sum + row._count._all, 0);
    const last_submission_date = seatStats.reduce((latest, row) => {
      const stamp = row._max.created_at;
      if (!stamp) return latest;
      if (!latest) return stamp;
      return new Date(stamp) > new Date(latest) ? stamp : latest;
    }, null);
    const lastActivity = last_submission_date || r.updated_at || r.created_at;
    return {
      requirement: {
        id: r.id,
        title: r.title,
        status: r.status,
        priority: r.priority,
        sla_days: r.sla_days,
      },
      client: r.account ? { id: r.account.id, name: r.account.name } : null,
      bda: r.account?.owner ? { id: r.account.owner.id, name: r.account.owner.name } : null,
      sales_owner: r.sales_owner,
      recruiters: r.assignments.map((a) => ({ id: a.user.id, name: a.user.name })),
      days_open: Math.floor((Date.now() - new Date(r.created_at)) / 86400000),
      days_since_last_activity: Math.floor((Date.now() - new Date(lastActivity)) / 86400000),
      submissions_count,
      last_submission_date,
    };
  });

  const stuckSubmissionsRaw = await prisma.submission.findMany({
    where: {
      stage: { notIn: ['closed', 'rejected', 'backout'] },
      updated_at: { lte: cutoff },
      ...recruiterDept,
    },
    include: {
      profile: { select: { id: true, name: true } },
      seat: {
        include: {
          requirement: {
            select: {
              id: true,
              title: true,
              sales_owner: { select: { id: true, name: true } },
              account: {
                select: {
                  id: true,
                  name: true,
                  owner: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      },
      submitted_by_user: { select: { id: true, name: true } },
    },
  });

  const pastSlaRaw = await prisma.requirement.findMany({
    where: {
      sla_days: { not: null },
      status: { in: ['open', 'in_progress'] },
      ...salesDept,
    },
    include: {
      sales_owner: { select: { id: true, name: true } },
      account: {
        select: {
          id: true,
          name: true,
          owner: { select: { id: true, name: true } },
        },
      },
      assignments: {
        where: { role_on_req: 'recruiter', unassigned_at: null },
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });

  return {
    stuck_leads: stuckLeadsRaw.map((l) => ({
      account: { id: l.id, name: l.name, stage: l.stage },
      owner: l.owner,
      bda: l.owner,
      requirements_count: l.requirements.length,
      days_in_stage: Math.floor((Date.now() - new Date(l.updated_at)) / 86400000),
      last_activity: l.updated_at,
    })),
    stuck_requirements: stuckReqs,
    stuck_submissions: stuckSubmissionsRaw.map((s) => ({
      submission: { id: s.id, stage: s.stage },
      profile: s.profile,
      requirement: { id: s.seat.requirement.id, title: s.seat.requirement.title },
      client: s.seat.requirement.account
        ? { id: s.seat.requirement.account.id, name: s.seat.requirement.account.name }
        : null,
      bda: s.seat.requirement.account?.owner
        ? { id: s.seat.requirement.account.owner.id, name: s.seat.requirement.account.owner.name }
        : null,
      sales_owner: s.seat.requirement.sales_owner,
      recruiter: s.submitted_by_user,
      days_in_current_stage: Math.floor((Date.now() - new Date(s.updated_at)) / 86400000),
    })),
    past_sla_requirements: pastSlaRaw
      .map((r) => {
        const days_open = Math.floor((Date.now() - new Date(r.created_at)) / 86400000);
        return {
          requirement: { id: r.id, title: r.title, sla_days: r.sla_days, priority: r.priority },
          client: r.account ? { id: r.account.id, name: r.account.name } : null,
          bda: r.account?.owner ? { id: r.account.owner.id, name: r.account.owner.name } : null,
          sales_owner: r.sales_owner,
          recruiters: r.assignments.map((a) => ({ id: a.user.id, name: a.user.name })),
          days_open,
          overdue_by_days: days_open - r.sla_days,
        };
      })
      .filter((r) => r.overdue_by_days > 0),
  };
}

async function closure({ date_from, date_to, group_by = 'month', department_id }) {
  const rows = await prisma.submission.findMany({
    where: {
      stage: 'closed',
      actual_joining_date: { gte: reportFrom(date_from), lte: reportTo(date_to) },
      ...(department_id ? { submitted_by_user: { department_id } } : {}),
    },
    include: {
      seat: { include: { requirement: { include: { account: { select: { id: true, name: true } } } } } },
      profile: { select: { id: true, name: true } },
      submitted_by_user: { select: { id: true, name: true } },
    },
  });

  const groupKey = (row) => {
    const d = asIst(row.actual_joining_date);
    if (group_by === 'client') return row.seat.requirement.account.name;
    if (group_by === 'recruiter') return row.submitted_by_user.name;
    if (group_by === 'quarter') return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
    return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  };

  const groups = new Map();
  for (const row of rows) {
    const key = groupKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return [...groups.entries()].map(([group_label, items]) => {
    const total_revenue = items.reduce((s, x) => s + Number(x.final_agreed_rate || 0), 0);
    const total_margin = items.reduce((s, x) => s + Number(x.margin || 0), 0);
    const cycles = items.map((x) => (new Date(x.actual_joining_date) - new Date(x.created_at)) / 86400000);
    const avg_cycle_days = cycles.length ? Number((cycles.reduce((a, b) => a + b, 0) / cycles.length).toFixed(1)) : 0;

    return {
      group_label,
      closures_count: items.length,
      total_revenue,
      total_margin,
      avg_cycle_days,
      details: items.map((x) => ({
        requirement: { id: x.seat.requirement.id, title: x.seat.requirement.title },
        client: x.seat.requirement.account,
        profile: x.profile,
        joined_at: x.actual_joining_date,
        final_agreed_rate: x.final_agreed_rate,
        margin: x.margin,
        recruiter: x.submitted_by_user,
      })),
    };
  });
}

// Requirement statuses that count as "active work" for the coverage buckets.
const ACTIVE_REQUIREMENT_STATUSES = ['open', 'in_progress', 'on_hold'];

/**
 * Active client coverage report (UI: "Clients without requirements").
 *
 * With a `bucket` (the report UI) this is "active-stage clients":
 * `type = 'client'`, `stage = 'active'`, split by their current requirement mix:
 *   - `all` — every active-stage client, no requirement filter.
 *   - `with_requirements` ("Has requirements") — ≥1 requirement open / in_progress
 *     / on_hold (closed / dropped do not count).
 *   - `no_active` ("No requirements") — no requirement open / in_progress /
 *     on_hold: closed / dropped only, or never had one.
 *   - `without_active_requirements` / `closed_only` — kept for the export route
 *     and back-compat; not surfaced in the UI.
 * Legacy callers with no bucket keep the old behaviour: no requirement rows, and
 * unclassified (`type IS NULL`) accounts are included so `stage = 'lead'` works.
 */
async function clientsWithoutRequirements({ bda_id, origin_owner_id, stage, bucket, date_from, date_to }) {
  const effectiveStage = bucket ? (stage || 'active') : stage;
  const createdRange = optionalDateRange(date_from, date_to);
  const baseWhere = {
    // Report UI ("active-stage clients") is strictly `type = 'client'`. The
    // legacy no-bucket path keeps unclassified accounts so `stage = 'lead'`
    // still returns not-yet-classified leads.
    ...(bucket ? { type: 'client' } : { OR: [{ type: 'client' }, { type: null }] }),
    ...(bda_id ? { owner_id: bda_id } : {}),
    ...(origin_owner_id ? { origin_owner_id } : {}),
    ...(effectiveStage ? { stage: effectiveStage } : {}),
    ...(createdRange ? { created_at: createdRange } : {}),
  };

  let requirementFilter;
  if (bucket === 'all') {
    requirementFilter = {};
  } else if (bucket === 'with_requirements') {
    requirementFilter = { requirements: { some: { status: { in: ACTIVE_REQUIREMENT_STATUSES } } } };
  } else if (bucket === 'no_active') {
    requirementFilter = { requirements: { none: { status: { in: ACTIVE_REQUIREMENT_STATUSES } } } };
  } else if (bucket === 'closed_only') {
    requirementFilter = {
      AND: [
        { requirements: { some: {} } },
        { requirements: { none: { status: { in: ACTIVE_REQUIREMENT_STATUSES } } } },
      ],
    };
  } else if (bucket === 'without_active_requirements') {
    requirementFilter = { requirements: { none: {} } };
  } else {
    // Legacy default (no bucket): no requirements at all.
    requirementFilter = { requirements: { none: {} } };
  }

  const rows = await prisma.account.findMany({
    where: { ...baseWhere, ...requirementFilter },
    include: {
      owner: { select: { id: true, name: true } },
      origin_owner: { select: { id: true, name: true } },
      // Count only requirements that are currently active work.
      _count: { select: { requirements: { where: { status: { in: ACTIVE_REQUIREMENT_STATUSES } } } } },
    },
    orderBy: { created_at: 'asc' },
  });

  return rows.map((a) => ({
    client: { id: a.id, name: a.name },
    stage: a.stage,
    brought_by: a.origin_owner ? { id: a.origin_owner.id, name: a.origin_owner.name } : null,
    sales_poc: a.owner ? { id: a.owner.id, name: a.owner.name } : null,
    active_requirements_count: a._count.requirements,
    created_at: a.created_at,
    days_idle: Math.floor(daysBetween(a.created_at, new Date())),
  }));
}

// A candidate is "in a live submission" while its submission stage is anything
// other than a terminal one — i.e. still in flight against some requirement.
const LIVE_SUBMISSION_STAGES = [
  'sourced',
  'internal_screening',
  'submitted_to_client',
  'interview_scheduled',
  'interview_result',
  'offer_sent',
  'bgv',
];

/**
 * One row per vendor account (`type = 'vendor'`, `stage = 'active'`), carrying
 * the vendor's POC from our end (`account.owner`), "brought by"
 * (`account.origin_owner`), every recruiter who has sourced a profile from it,
 * `profiles_sourced` / `profiles_submitted`, and `has_live_submission` — whether
 * any sourced candidate currently sits in a non-terminal submission stage.
 *
 * Filters:
 *   - `vendor_id` — a single vendor account.
 *   - `owner_id` — the vendor's POC from our end (`account.owner_id`).
 *   - `origin_owner_id` — who brought the vendor in.
 *   - `recruiter_id` — keep only vendors this user has sourced ≥1 profile from
 *     (the route also forces this to the caller for the recruiter role).
 *   - `date_from` / `date_to` — scope the sourced-profile counts by profile
 *     created date.
 *   - `vendor_activity` (no value = every active-stage vendor):
 *       `active` — every active-stage vendor (same as omitting the filter).
 *       `inactive` — no sourced candidate currently in a live submission.
 *       `has_live` — Active − Inactive: at least one live submission
 *         (sourced → BGV).
 */
async function recruiterVendorGaps({
  recruiter_id, vendor_id, owner_id, origin_owner_id, vendor_activity, date_from, date_to,
}) {
  const sourcedRange = optionalDateRange(date_from, date_to);

  const vendors = await prisma.account.findMany({
    where: {
      AND: [
        { type: 'vendor' },
        { stage: 'active' },
        ...(vendor_id ? [{ id: vendor_id }] : []),
        ...(owner_id ? [{ owner_id }] : []),
        ...(origin_owner_id ? [{ origin_owner_id }] : []),
      ],
    },
    include: {
      owner: { select: { id: true, name: true } },
      origin_owner: { select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
  });

  const rows = await Promise.all(
    vendors.map(async (v) => {
      const profiles = await prisma.profile.findMany({
        where: {
          vendor_account_id: v.id,
          ...(sourcedRange ? { created_at: sourcedRange } : {}),
        },
        select: {
          id: true,
          created_at: true,
          added_by_user: { select: { id: true, name: true } },
          submissions: { select: { stage: true } },
        },
      });

      const submittedCount = profiles.filter((p) => p.submissions.length > 0).length;
      const has_live_submission = profiles.some((p) =>
        p.submissions.some((s) => LIVE_SUBMISSION_STAGES.includes(s.stage))
      );
      const recruiters = [
        ...new Map(
          profiles.filter((p) => p.added_by_user).map((p) => [p.added_by_user.id, p.added_by_user])
        ).values(),
      ];
      const last_sourced_at = profiles.reduce(
        (latest, p) => (!latest || p.created_at > latest ? p.created_at : latest),
        null
      );

      return {
        vendor: { id: v.id, name: v.name },
        our_poc: v.owner ? { id: v.owner.id, name: v.owner.name } : null,
        brought_by: v.origin_owner ? { id: v.origin_owner.id, name: v.origin_owner.name } : null,
        recruiters: recruiters.map((r) => ({ id: r.id, name: r.name })),
        profiles_sourced: profiles.length,
        profiles_submitted: submittedCount,
        has_live_submission,
        last_sourced_at,
        days_since_sourced: last_sourced_at
          ? Math.floor(daysBetween(last_sourced_at, new Date()))
          : null,
      };
    })
  );

  return rows
    .filter((r) => !recruiter_id || r.recruiters.some((x) => x.id === recruiter_id))
    // `active` (or omitted) = every active-stage vendor;
    // `inactive` = no live candidate; `has_live` = Active − Inactive.
    .filter((r) => {
      if (vendor_activity === 'inactive') return !r.has_live_submission;
      if (vendor_activity === 'has_live') return r.has_live_submission;
      return true;
    })
    .sort((a, b) => (b.days_since_sourced ?? -1) - (a.days_since_sourced ?? -1));
}

// --- HR report -------------------------------------------------------------
// Recruiter-ops throughput grouped per day. Four tables; on-bench profiles are
// excluded everywhere. Date anchors: sourcing = Profile.created_at, submission =
// Submission.created_at, round = InterviewRound.scheduled_at.

// Display labels for the candidate-source enum; stored values stay direct/linkedin.
const SOURCE_LABEL = { direct: 'Bench', vendor: 'Vendor', linkedin: 'Market' };

function bump(map, key, seed, mutate) {
  if (!map.has(key)) map.set(key, seed());
  mutate(map.get(key));
}

async function hrReport({ date_from, date_to, sourcer_id, interviewer_id, source }) {
  const range = optionalDateRange(date_from, date_to);
  const profileWhere = { on_bench: false, ...(source ? { source } : {}) };

  // Table 1 - sourcing
  const sourcedProfiles = await prisma.profile.findMany({
    where: {
      ...profileWhere,
      ...(range ? { created_at: range } : {}),
      ...(sourcer_id ? { added_by: sourcer_id } : {}),
    },
    select: { added_by: true, created_at: true, source: true, added_by_user: { select: { id: true, name: true } } },
  });
  // One row per (sourcer, day); the per-source split lives in `by_type` and is
  // shown on hover, not as extra rows.
  const addTyped = (map, personId, personName, day, sourceKey) => {
    const key = `${personId}|${day}`;
    if (!map.has(key)) {
      map.set(key, { sourcer: personName || 'Unknown', sourcer_id: personId, date: day, count: 0, by_type: {} });
    }
    const row = map.get(key);
    row.count += 1;
    const label = SOURCE_LABEL[sourceKey] || sourceKey;
    row.by_type[label] = (row.by_type[label] || 0) + 1;
  };

  const sourcingMap = new Map();
  for (const p of sourcedProfiles) {
    addTyped(sourcingMap, p.added_by, p.added_by_user?.name, dayKey(p.created_at), p.source);
  }

  // Table 2 - submissions
  const submissions = await prisma.submission.findMany({
    where: {
      ...(range ? { created_at: range } : {}),
      profile: { ...profileWhere, ...(sourcer_id ? { added_by: sourcer_id } : {}) },
    },
    select: {
      created_at: true,
      profile: { select: { added_by: true, source: true, added_by_user: { select: { id: true, name: true } } } },
    },
  });
  const submissionMap = new Map();
  for (const s of submissions) {
    const p = s.profile;
    addTyped(submissionMap, p.added_by, p.added_by_user?.name, dayKey(s.created_at), p.source);
  }

  // Tables 3 & 4 - internal round 1
  const rounds = await prisma.interviewRound.findMany({
    where: {
      round_type: 'internal_r1',
      ...(range ? { scheduled_at: range } : {}),
      submission: { profile: profileWhere },
    },
    select: {
      scheduled_at: true,
      status: true,
      result: true,
      interviewer_name: true,
      submission: {
        select: {
          profile: {
            select: { added_by: true, source: true, added_by_user: { select: { id: true, name: true } } },
          },
        },
      },
      interviewers: { select: { user: { select: { id: true, name: true } } } },
    },
  });

  const metricSeed = (base) => () => ({ ...base, scheduled: 0, completed: 0, shortlisted: 0 });
  const applyMetrics = (row, r) => {
    // Scheduled = every internal round 1. Completed = the interview actually
    // happened, i.e. a pass/fail result was recorded (recording a result stamps
    // completed_at but NOT `status`, so `status` alone can't be trusted).
    // Shortlisted = the pass ones.
    row.scheduled += 1;
    if (['pass', 'fail'].includes(r.result)) row.completed += 1;
    if (r.result === 'pass') row.shortlisted += 1;
  };

  const bySourcer = new Map();
  const byInterviewer = new Map();
  for (const r of rounds) {
    const p = r.submission?.profile;
    const day = dayKey(r.scheduled_at);

    if (p && (!sourcer_id || p.added_by === sourcer_id)) {
      const key = `${p.added_by}|${day}`;
      bump(
        bySourcer,
        key,
        metricSeed({ sourcer: p.added_by_user?.name || 'Unknown', sourcer_id: p.added_by, date: day }),
        (row) => applyMetrics(row, r)
      );
    }

    const people = r.interviewers.length
      ? r.interviewers.map((i) => i.user)
      : [{ id: null, name: r.interviewer_name || 'Unassigned' }];
    for (const person of people) {
      if (interviewer_id && person.id !== interviewer_id) continue;
      const key = `${person.id || `name:${person.name}`}|${day}`;
      bump(
        byInterviewer,
        key,
        metricSeed({ interviewer: person.name || 'Unassigned', interviewer_id: person.id, date: day }),
        (row) => applyMetrics(row, r)
      );
    }
  }

  const byDateThenName = (nameKey) => (a, b) =>
    (b.date || '').localeCompare(a.date || '') || (a[nameKey] || '').localeCompare(b[nameKey] || '');

  return {
    tables: [
      {
        key: 'sourcing',
        title: 'Sourcing',
        rows: [...sourcingMap.values()].sort(byDateThenName('sourcer')),
      },
      {
        key: 'submissions',
        title: 'Submissions',
        rows: [...submissionMap.values()].sort(byDateThenName('sourcer')),
      },
      {
        key: 'round1_by_sourcer',
        title: 'Internal round 1 - by sourcer',
        rows: [...bySourcer.values()].sort(byDateThenName('sourcer')),
      },
      {
        key: 'round1_by_interviewer',
        title: 'Internal round 1 - by interviewer',
        rows: [...byInterviewer.values()].sort(byDateThenName('interviewer')),
      },
    ],
  };
}

// --- Joinings + time-to-submit -------------------------------------------------

/** ms -> "1d 6h" / "4h 20m" / "12m" / "<1m"; null/negative -> null. */
function formatDuration(ms) {
  if (ms == null || Number.isNaN(ms) || ms < 0) return null;
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return m ? `${m}m` : '<1m';
}

const dur = (fromDate, toDate) => {
  const from = fromDate ? new Date(fromDate).toISOString() : null;
  const to = toDate ? new Date(toDate).toISOString() : null;
  if (!fromDate || !toDate) return { ms: null, label: null, from, to };
  const ms = new Date(toDate) - new Date(fromDate);
  return { ms, label: formatDuration(ms), from, to };
};

// A joining = a submission that reached `closed` with a joining date in range.
async function joinings({ date_from, date_to }) {
  const range = optionalDateRange(date_from, date_to);
  const rows = await prisma.submission.findMany({
    where: { stage: 'closed', actual_joining_date: range },
    select: {
      actual_joining_date: true,
      seat: {
        select: {
          requirement: {
            select: {
              sales_owner_id: true,
              sales_owner: { select: { id: true, name: true } },
            },
          },
        },
      },
      profile: {
        select: {
          added_by: true,
          added_by_user: { select: { id: true, name: true } },
          vendor_account_id: true,
          vendor_account: { select: { id: true, name: true } },
        },
      },
      interview_rounds: {
        select: {
          round_type: true,
          interviewer_name: true,
          interviewers: { select: { user: { select: { id: true, name: true } } } },
        },
      },
    },
  });

  const bySourcer = new Map();
  const byInterviewer = new Map();
  const byVendor = new Map();
  const bySalesPoc = new Map();

  for (const r of rows) {
    const mk = monthKey(r.actual_joining_date);
    const p = r.profile || {};

    // by sales POC (the sales owner of the requirement this joining closed on)
    const req = r.seat?.requirement;
    const spId = req?.sales_owner_id || 'none';
    const spKey = `${mk.sort}|${spId}`;
    if (!bySalesPoc.has(spKey)) {
      bySalesPoc.set(spKey, {
        month: mk.label,
        sort: mk.sort,
        sales_poc: req?.sales_owner?.name || 'Unassigned',
        sales_poc_id: req?.sales_owner_id || null,
        joinings: 0,
      });
    }
    bySalesPoc.get(spKey).joinings += 1;

    // by sourcer
    const sKey = `${mk.sort}|${p.added_by}`;
    if (!bySourcer.has(sKey)) {
      bySourcer.set(sKey, {
        month: mk.label,
        sort: mk.sort,
        sourcer: p.added_by_user?.name || 'Unknown',
        sourcer_id: p.added_by,
        joinings: 0,
      });
    }
    bySourcer.get(sKey).joinings += 1;

    // by vendor (vendor-sourced only)
    if (p.vendor_account_id) {
      const vKey = `${mk.sort}|${p.vendor_account_id}`;
      if (!byVendor.has(vKey)) {
        byVendor.set(vKey, {
          month: mk.label,
          sort: mk.sort,
          vendor: p.vendor_account?.name || 'Unknown vendor',
          joinings: 0,
        });
      }
      byVendor.get(vKey).joinings += 1;
    }

    // by interviewer, split L1 (internal_r1) / L2 (internal_r2)
    const perLevel = { l1: new Map(), l2: new Map() };
    for (const round of r.interview_rounds || []) {
      const level = round.round_type === 'internal_r1' ? 'l1' : round.round_type === 'internal_r2' ? 'l2' : null;
      if (!level) continue;
      const people = round.interviewers.length
        ? round.interviewers.map((i) => i.user)
        : [{ id: null, name: round.interviewer_name || 'Unassigned' }];
      for (const person of people) {
        perLevel[level].set(person.id || `name:${person.name}`, person);
      }
    }
    for (const [level, people] of Object.entries(perLevel)) {
      for (const [pid, person] of people) {
        const iKey = `${mk.sort}|${pid}`;
        if (!byInterviewer.has(iKey)) {
          byInterviewer.set(iKey, {
            month: mk.label,
            sort: mk.sort,
            interviewer: person.name || 'Unassigned',
            interviewer_id: person.id,
            l1: 0,
            l2: 0,
            total: 0,
          });
        }
        const row = byInterviewer.get(iKey);
        row[level] += 1;
        row.total += 1;
      }
    }
  }

  const sortRows = (nameKey) => (a, b) =>
    b.sort.localeCompare(a.sort) || (a[nameKey] || '').localeCompare(b[nameKey] || '');

  return {
    tables: [
      { key: 'by_sourcer', title: 'By sourcer', rows: [...bySourcer.values()].sort(sortRows('sourcer')) },
      { key: 'by_interviewer', title: 'By interviewer (L1 / L2)', rows: [...byInterviewer.values()].sort(sortRows('interviewer')) },
      { key: 'by_vendor', title: 'By vendor', rows: [...byVendor.values()].sort(sortRows('vendor')) },
      { key: 'by_sales_poc', title: 'By sales requirement', rows: [...bySalesPoc.values()].sort(sortRows('sales_poc')) },
    ],
  };
}

// --- BDA + Sales daily activity reports --------------------------------------

const byDateThenNameDesc = (nameKey) => (a, b) =>
  (b.date || '').localeCompare(a.date || '') || (a[nameKey] || '').localeCompare(b[nameKey] || '');

/**
 * BDA reports — 5 tables, all keyed off `origin_owner_id` ("Brought by", the
 * immutable account creator). `bda_id` scopes every table to one person;
 * `client_id` scopes every table to one account (client or vendor);
 * `account_type` further narrows `accounts_created` to client/vendor/unclassified.
 *   1. accounts_created        - accounts brought per BDA per day (+ type split on hover)
 *   2. meetings_scheduled      - account meetings scheduled per BDA per day, with how
 *                                many of those accounts are active now
 *   3. meetings_conversion     - the same, rolled up per BDA (no date)
 *   4. requirements_brought    - one row per requirement on a BDA-brought *client*
 *   5. requirements_brought_counts - those requirements counted per BDA per day
 */
async function bdaReports({ date_from, date_to, bda_id, client_id, account_type }) {
  const range = optionalDateRange(date_from, date_to);
  const ownerScope = bda_id ? { origin_owner_id: bda_id } : { origin_owner_id: { not: null } };
  // `client_id` here is really "account id" — accounts_created / meetings can be a
  // client OR a vendor account, so the filter isn't restricted to type=client.
  const accountScope = client_id ? { id: client_id } : {};
  const typeScope = account_type ? { type: account_type === 'unclassified' ? null : account_type } : {};

  // 1. accounts created (brought)
  const accounts = await prisma.account.findMany({
    where: { ...ownerScope, ...accountScope, ...typeScope, ...(range ? { created_at: range } : {}) },
    select: {
      created_at: true,
      type: true,
      origin_owner_id: true,
      origin_owner: { select: { id: true, name: true } },
    },
  });
  const TYPE_LABEL = { client: 'Client', vendor: 'Vendor' };
  const accountsCreated = new Map();
  for (const a of accounts) {
    const day = dayKey(a.created_at);
    const key = `${a.origin_owner_id}|${day}`;
    if (!accountsCreated.has(key)) {
      accountsCreated.set(key, {
        bda: a.origin_owner?.name || 'Unknown',
        bda_id: a.origin_owner_id,
        date: day,
        count: 0,
        by_type: {},
      });
    }
    const row = accountsCreated.get(key);
    row.count += 1;
    const label = TYPE_LABEL[a.type] || 'Unclassified';
    row.by_type[label] = (row.by_type[label] || 0) + 1;
  }

  // 2 & 3. meetings scheduled (stage_history: account -> meeting_scheduled)
  const meetingEvents = await prisma.stageHistory.findMany({
    where: {
      entity_type: 'account',
      to_stage: 'meeting_scheduled',
      ...(range ? { changed_at: range } : {}),
      ...(bda_id ? { changed_by: bda_id } : {}),
      ...(client_id ? { entity_id: client_id } : {}),
    },
    select: {
      changed_at: true,
      changed_by: true,
      changed_by_user: { select: { id: true, name: true } },
      entity_id: true,
    },
  });
  const meetingAccountIds = [...new Set(meetingEvents.map((e) => e.entity_id))];
  const activeNow = meetingAccountIds.length
    ? new Set(
        (
          await prisma.account.findMany({
            where: { id: { in: meetingAccountIds }, stage: 'active' },
            select: { id: true },
          })
        ).map((a) => a.id)
      )
    : new Set();

  const meetingsScheduled = new Map();
  const meetingsConversion = new Map();
  for (const e of meetingEvents) {
    const day = dayKey(e.changed_at);
    const converted = activeNow.has(e.entity_id) ? 1 : 0;
    const dayKeyStr = `${e.changed_by}|${day}`;
    if (!meetingsScheduled.has(dayKeyStr)) {
      meetingsScheduled.set(dayKeyStr, {
        bda: e.changed_by_user?.name || 'Unknown',
        bda_id: e.changed_by,
        date: day,
        meetings_scheduled: 0,
        converted_to_active: 0,
      });
    }
    const dRow = meetingsScheduled.get(dayKeyStr);
    dRow.meetings_scheduled += 1;
    dRow.converted_to_active += converted;

    if (!meetingsConversion.has(e.changed_by)) {
      meetingsConversion.set(e.changed_by, {
        bda: e.changed_by_user?.name || 'Unknown',
        bda_id: e.changed_by,
        meetings_scheduled: 0,
        converted_to_active: 0,
      });
    }
    const cRow = meetingsConversion.get(e.changed_by);
    cRow.meetings_scheduled += 1;
    cRow.converted_to_active += converted;
  }

  // 4 & 5. requirements on BDA-brought *client* accounts
  const requirements = await prisma.requirement.findMany({
    where: {
      ...(range ? { created_at: range } : {}),
      account: { type: 'client', ...ownerScope, ...accountScope },
    },
    select: {
      title: true,
      created_at: true,
      account: {
        select: {
          id: true,
          name: true,
          origin_owner_id: true,
          origin_owner: { select: { id: true, name: true } },
        },
      },
    },
  });
  const requirementsBrought = requirements
    .map((r) => ({
      bda: r.account?.origin_owner?.name || 'Unknown',
      bda_id: r.account?.origin_owner_id || null,
      client: r.account?.name || '—',
      client_id: r.account?.id || null,
      requirement: r.title,
      date: dayKey(r.created_at),
    }))
    .sort(byDateThenNameDesc('bda'));

  const requirementsBroughtCounts = new Map();
  for (const r of requirementsBrought) {
    const key = `${r.bda_id}|${r.date}`;
    if (!requirementsBroughtCounts.has(key)) {
      requirementsBroughtCounts.set(key, {
        bda: r.bda,
        bda_id: r.bda_id,
        date: r.date,
        count: 0,
        clients: {},
      });
    }
    const row = requirementsBroughtCounts.get(key);
    row.count += 1;
    row.clients[r.client] = (row.clients[r.client] || 0) + 1;
  }

  return {
    tables: [
      {
        key: 'accounts_created',
        title: 'Accounts brought',
        rows: [...accountsCreated.values()].sort(byDateThenNameDesc('bda')),
      },
      {
        key: 'meetings_scheduled',
        title: 'Meetings scheduled',
        rows: [...meetingsScheduled.values()].sort(byDateThenNameDesc('bda')),
      },
      {
        key: 'meetings_conversion',
        title: 'Meetings → active (by BDA)',
        rows: [...meetingsConversion.values()].sort((a, b) => (a.bda || '').localeCompare(b.bda || '')),
      },
      {
        key: 'requirements_brought',
        title: 'Requirements from BDA clients',
        rows: requirementsBrought,
      },
      {
        key: 'requirements_brought_counts',
        title: 'Requirements from BDA clients (count)',
        rows: [...requirementsBroughtCounts.values()].sort(byDateThenNameDesc('bda')),
      },
    ],
  };
}

/**
 * Sales reports — 2 tables. `sales_id` scopes both to one person; `client_id`
 * scopes both to one client account.
 *   1. requirements_created - requirements per Sales POC (`sales_owner_id`) per day,
 *                             client names on hover
 *   2. meetings_attended    - account meetings the Sales POC is an attendee of,
 *                             per day (day = the account's meeting_date)
 */
async function salesReports({ date_from, date_to, sales_id, client_id }) {
  const range = optionalDateRange(date_from, date_to);

  // 1. requirements created, by sales owner
  const requirements = await prisma.requirement.findMany({
    where: {
      ...(range ? { created_at: range } : {}),
      ...(sales_id ? { sales_owner_id: sales_id } : {}),
      ...(client_id ? { account_id: client_id } : {}),
    },
    select: {
      created_at: true,
      sales_owner_id: true,
      sales_owner: { select: { id: true, name: true } },
      account: { select: { name: true } },
    },
  });
  const requirementsCreated = new Map();
  for (const r of requirements) {
    const day = dayKey(r.created_at);
    const key = `${r.sales_owner_id}|${day}`;
    if (!requirementsCreated.has(key)) {
      requirementsCreated.set(key, {
        sales_poc: r.sales_owner?.name || 'Unknown',
        sales_poc_id: r.sales_owner_id,
        date: day,
        count: 0,
        clients: {},
      });
    }
    const row = requirementsCreated.get(key);
    row.count += 1;
    const client = r.account?.name || '—';
    row.clients[client] = (row.clients[client] || 0) + 1;
  }

  // 2. meetings attended (sales user is a meeting attendee; day = meeting_date).
  // The attendee picker isn't role-restricted (anyone can be added to a meeting),
  // so this "Sales POC" table only counts attendees who actually hold a sales-ish
  // role — a BDA or recruiter tagged as an attendee shouldn't show up here.
  const attendedAccounts = await prisma.account.findMany({
    where: {
      meeting_date: range || { not: null },
      meeting_attendees: {
        some: { ...(sales_id ? { user_id: sales_id } : {}), user: { role: { in: ['sales', 'admin'] } } },
      },
      ...(client_id ? { id: client_id } : {}),
    },
    select: {
      meeting_date: true,
      meeting_attendees: { select: { user: { select: { id: true, name: true, role: true } } } },
    },
  });
  const meetingsAttended = new Map();
  for (const a of attendedAccounts) {
    const day = dayKey(a.meeting_date);
    for (const att of a.meeting_attendees) {
      if (!['sales', 'admin'].includes(att.user?.role)) continue;
      if (sales_id && att.user?.id !== sales_id) continue;
      const key = `${att.user?.id}|${day}`;
      if (!meetingsAttended.has(key)) {
        meetingsAttended.set(key, {
          sales_poc: att.user?.name || 'Unknown',
          sales_poc_id: att.user?.id || null,
          date: day,
          count: 0,
        });
      }
      meetingsAttended.get(key).count += 1;
    }
  }

  // 3. profiles submitted to client — every submission (any source, any
  // creator) that reaches the submitted_to_client stage on a requirement this
  // sales person owns. Attributed by requirement.sales_owner_id, same as
  // "Requirements created" above — NOT by who clicked submit, since in
  // practice almost every submission is put forward by a recruiter on a
  // requirement the sales person owns, not by the sales person themselves.
  // (An earlier version filtered to submitted_by = sales/admin + bench
  // candidates only, which matched the sales "put forward" UI flow but missed
  // the vast majority of real submitted-to-client candidates — audited
  // 2026-09-16 against prod: 15 submissions reached submitted_to_client for
  // one sales owner in a day, only 2 of which she'd personally submitted.)
  // Counted/dated by the stage transition itself, not by submission creation,
  // so a candidate still sitting in internal_screening doesn't count.
  const candidateSubmissions = await prisma.submission.findMany({
    where: {
      seat: {
        requirement: {
          ...(sales_id ? { sales_owner_id: sales_id } : {}),
          ...(client_id ? { account_id: client_id } : {}),
        },
      },
    },
    select: {
      id: true,
      profile: { select: { name: true } },
      seat: {
        select: {
          requirement: {
            select: {
              title: true,
              sales_owner_id: true,
              sales_owner: { select: { id: true, name: true } },
              account: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
  const submittedToClientHistory = candidateSubmissions.length
    ? await prisma.stageHistory.findMany({
        where: {
          entity_type: 'submission',
          entity_id: { in: candidateSubmissions.map((s) => s.id) },
          to_stage: 'submitted_to_client',
          ...(range ? { changed_at: range } : {}),
        },
        orderBy: { changed_at: 'asc' },
      })
    : [];
  const submittedAtBySubmission = new Map();
  for (const h of submittedToClientHistory) {
    if (!submittedAtBySubmission.has(h.entity_id)) submittedAtBySubmission.set(h.entity_id, h.changed_at);
  }
  const profilesSubmittedToClient = new Map();
  for (const s of candidateSubmissions) {
    const submittedAt = submittedAtBySubmission.get(s.id);
    if (!submittedAt) continue;
    const salesOwner = s.seat?.requirement?.sales_owner;
    if (!salesOwner) continue; // requirement has no sales owner assigned — nothing to attribute
    const day = dayKey(submittedAt);
    const key = `${salesOwner.id}|${day}`;
    if (!profilesSubmittedToClient.has(key)) {
      profilesSubmittedToClient.set(key, {
        sales_poc: salesOwner.name || 'Unknown',
        sales_poc_id: salesOwner.id,
        date: day,
        count: 0,
        profiles: {},
        details: [],
      });
    }
    const row = profilesSubmittedToClient.get(key);
    row.count += 1;
    const profileName = s.profile?.name || '—';
    row.profiles[profileName] = (row.profiles[profileName] || 0) + 1;
    row.details.push({
      profile: { name: profileName },
      requirement: { title: s.seat?.requirement?.title || '—' },
      client: { name: s.seat?.requirement?.account?.name || '—', id: s.seat?.requirement?.account?.id || null },
    });
  }

  return {
    tables: [
      {
        key: 'requirements_created',
        title: 'Requirements created',
        rows: [...requirementsCreated.values()].sort(byDateThenNameDesc('sales_poc')),
      },
      {
        key: 'meetings_attended',
        title: 'Meetings attended',
        rows: [...meetingsAttended.values()].sort(byDateThenNameDesc('sales_poc')),
      },
      {
        key: 'profiles_submitted_to_client',
        title: 'Profiles submitted to client',
        rows: [...profilesSubmittedToClient.values()].sort(byDateThenNameDesc('sales_poc')),
      },
    ],
  };
}

// One row per submission. All three duration columns are measured from the
// requirement's creation time: requirement created -> submission created,
// -> first internal round 1 scheduled, -> submitted to client.
async function timeToSubmit({ date_from, date_to, client_id, requirement_id, sourcer_id, search }) {
  const range = optionalDateRange(date_from, date_to);
  const profileWhere = {
    ...(sourcer_id ? { added_by: sourcer_id } : {}),
    ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
  };
  const reqWhere = {
    ...(requirement_id ? { id: requirement_id } : {}),
    ...(client_id ? { account_id: client_id } : {}),
  };
  const subs = await prisma.submission.findMany({
    where: {
      created_at: range,
      ...(Object.keys(profileWhere).length ? { profile: profileWhere } : {}),
      ...(Object.keys(reqWhere).length ? { seat: { requirement: reqWhere } } : {}),
    },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      created_at: true,
      profile: {
        select: {
          name: true,
          created_at: true,
          source: true,
          added_by: true,
          added_by_user: { select: { id: true, name: true } },
          vendor_account: { select: { name: true } },
        },
      },
      seat: {
        select: {
          requirement: { select: { id: true, title: true, created_at: true, account: { select: { name: true } } } },
        },
      },
    },
  });

  const ids = subs.map((s) => s.id);
  const [historyRows, roundRows] = await Promise.all([
    ids.length
      ? prisma.stageHistory.findMany({
          where: { entity_type: 'submission', entity_id: { in: ids }, to_stage: 'submitted_to_client' },
          orderBy: { changed_at: 'asc' },
        })
      : [],
    ids.length
      ? prisma.interviewRound.findMany({
          where: { submission_id: { in: ids }, round_type: 'internal_r1' },
          orderBy: [{ scheduled_at: 'asc' }, { round_number: 'asc' }],
        })
      : [],
  ]);

  const submittedAtBySub = new Map();
  for (const h of historyRows) {
    if (!submittedAtBySub.has(h.entity_id)) submittedAtBySub.set(h.entity_id, h.changed_at);
  }
  const firstR1BySub = new Map();
  for (const r of roundRows) {
    const at = r.scheduled_at || r.completed_at;
    if (at && !firstR1BySub.has(r.submission_id)) firstR1BySub.set(r.submission_id, at);
  }

  return {
    rows: subs.map((s) => {
      const req = s.seat?.requirement;
      const r1At = firstR1BySub.get(s.id) || null;
      const submittedAt = submittedAtBySub.get(s.id) || null;
      const reqAt = req?.created_at || null;
      return {
        id: s.id,
        requirement_created_at: reqAt,
        requirement: req?.title || '—',
        client: req?.account?.name || '—',
        candidate: s.profile?.name || '—',
        sourcer: s.profile?.added_by_user?.name || '—',
        sourcer_id: s.profile?.added_by || null,
        type: SOURCE_LABEL[s.profile?.source] || '—',
        vendor_name: s.profile?.vendor_account?.name || '—',
        // all three clocks start when the requirement was created
        req_to_submission: dur(reqAt, s.created_at),
        req_to_r1: dur(reqAt, r1At),
        req_to_submitted: dur(reqAt, submittedAt),
      };
    }),
  };
}

module.exports = {
  recruiterPerformance,
  salesPerformance,
  bdaPerformance,
  vendorPerformance,
  clientPerformance,
  aging,
  closure,
  clientsWithoutRequirements,
  recruiterVendorGaps,
  hrReport,
  joinings,
  timeToSubmit,
  bdaReports,
  salesReports,
};
