const prisma = require('../../config/db');
const { STUCK_THRESHOLD_DAYS } = require('../../config/constants');
const { requirementScopeWhere } = require('../access/requirementScope');

const REQUIREMENT_STATUSES = ['open', 'in_progress', 'on_hold', 'closed', 'dropped'];
const SUBMISSION_STAGES = [
  'sourced',
  'internal_screening',
  'submitted_to_client',
  'interview_scheduled',
  'interview_result',
  'offer_sent',
  'bgv',
  'closed',
  'backout',
  'rejected',
];

function parseCsvList(value, allowed) {
  if (!value) return [];
  const parts = String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!allowed) return parts;
  return parts.filter((part) => allowed.includes(part));
}

function daysSince(date) {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function summarizeStages(submissions) {
  const by_stage = Object.fromEntries(SUBMISSION_STAGES.map((stage) => [stage, 0]));
  for (const submission of submissions) {
    if (by_stage[submission.stage] != null) by_stage[submission.stage] += 1;
  }
  return {
    total: submissions.length,
    by_stage,
    active: submissions.filter((s) => !['closed', 'rejected', 'backout'].includes(s.stage)).length,
    closed: by_stage.closed || 0,
  };
}

function computeAging(requirement, submissions, thresholdDays) {
  const days_open = daysSince(requirement.created_at);
  const lastActivity = submissions.reduce((latest, submission) => {
    const stamp = submission.updated_at || submission.created_at;
    if (!latest) return stamp;
    return new Date(stamp) > new Date(latest) ? stamp : latest;
  }, requirement.updated_at || requirement.created_at);
  const days_since_last_activity = daysSince(lastActivity);
  // Stuck = still active with no update ("no movement") for thresholdDays — same rule as the
  // dashboard / requirements list, keyed off requirement.updated_at so counts agree everywhere.
  const is_stuck =
    ['open', 'in_progress'].includes(requirement.status)
    && (daysSince(requirement.updated_at) ?? 0) >= thresholdDays;
  const sla_overdue_by_days =
    requirement.sla_days != null && ['open', 'in_progress'].includes(requirement.status)
      ? Math.max(0, (days_open ?? 0) - requirement.sla_days)
      : 0;
  return {
    days_open,
    days_since_last_activity,
    last_activity: lastActivity,
    is_stuck,
    sla_days: requirement.sla_days,
    sla_overdue_by_days,
  };
}

function serializeRecruiters(assignments) {
  return (assignments || [])
    .filter((row) => row.role_on_req === 'recruiter' && !row.unassigned_at)
    .map((row) => ({ id: row.user.id, name: row.user.name }));
}

function buildRequirementWhere(scopeWhere, filters) {
  const statuses = parseCsvList(filters.requirement_status, REQUIREMENT_STATUSES);
  const priorities = parseCsvList(filters.priority);
  const where = { ...scopeWhere };

  if (filters.account_id) where.account_id = filters.account_id;
  if (filters.sales_id) where.sales_owner_id = filters.sales_id;
  if (filters.bda_id) where.account = { ...(where.account || {}), owner_id: filters.bda_id };
  if (filters.department_id) {
    where.sales_owner = { ...(where.sales_owner || {}), department_id: filters.department_id };
  }
  if (statuses.length) where.status = { in: statuses };
  if (priorities.length) where.priority = { in: priorities };
  if (filters.date_from || filters.date_to) {
    // IST calendar day (fixed +05:30) — matches the aggregate reports.
    where.created_at = {};
    if (filters.date_from) {
      where.created_at.gte = String(filters.date_from).length <= 10
        ? new Date(`${filters.date_from}T00:00:00.000+05:30`)
        : new Date(filters.date_from);
    }
    if (filters.date_to) {
      where.created_at.lte = String(filters.date_to).length <= 10
        ? new Date(`${filters.date_to}T23:59:59.999+05:30`)
        : new Date(filters.date_to);
    }
  }
  if (filters.search) {
    where.AND = [
      ...(where.AND || []),
      {
        OR: [
          { title: { contains: filters.search, mode: 'insensitive' } },
          { account: { name: { contains: filters.search, mode: 'insensitive' } } },
        ],
      },
    ];
  }
  if (filters.recruiter_id) {
    where.assignments = {
      some: {
        user_id: filters.recruiter_id,
        role_on_req: 'recruiter',
        unassigned_at: null,
      },
    };
  }
  return where;
}

function serializeRequirementRow(requirement, submissions, thresholdDays) {
  const recruiters = serializeRecruiters(requirement.assignments);
  const submissionSummary = summarizeStages(submissions);
  const aging = computeAging(requirement, submissions, thresholdDays);
  return {
    id: requirement.id,
    grain: 'requirement',
    requirement: {
      id: requirement.id,
      title: requirement.title,
      status: requirement.status,
      priority: requirement.priority,
      created_at: requirement.created_at,
      updated_at: requirement.updated_at,
      sla_days: requirement.sla_days,
    },
    client: requirement.account
      ? { id: requirement.account.id, name: requirement.account.name, stage: requirement.account.stage }
      : null,
    bda: requirement.account?.owner
      ? { id: requirement.account.owner.id, name: requirement.account.owner.name }
      : null,
    sales_owner: requirement.sales_owner
      ? { id: requirement.sales_owner.id, name: requirement.sales_owner.name }
      : null,
    recruiters,
    seats: {
      total: requirement.seats_total,
      closed: requirement.seats.filter((seat) => seat.seat_status === 'closed').length,
    },
    submissions: submissionSummary,
    aging,
    commercials: {
      total_margin: submissions.reduce((sum, row) => sum + Number(row.margin || 0), 0),
      closed_count: submissionSummary.closed,
    },
  };
}

function serializeSubmissionRow(submission, requirementRow) {
  return {
    id: submission.id,
    grain: 'submission',
    submission: {
      id: submission.id,
      stage: submission.stage,
      created_at: submission.created_at,
      updated_at: submission.updated_at,
      margin: submission.margin,
    },
    profile: submission.profile
      ? { id: submission.profile.id, name: submission.profile.name, source: submission.profile.source }
      : null,
    recruiter: submission.submitted_by_user
      ? { id: submission.submitted_by_user.id, name: submission.submitted_by_user.name }
      : null,
    vendor: submission.profile?.vendor_account
      ? { id: submission.profile.vendor_account.id, name: submission.profile.vendor_account.name }
      : null,
    requirement: requirementRow.requirement,
    client: requirementRow.client,
    bda: requirementRow.bda,
    sales_owner: requirementRow.sales_owner,
    recruiters: requirementRow.recruiters,
    aging: {
      days_in_stage: daysSince(submission.updated_at || submission.created_at),
      is_stuck:
        !['closed', 'rejected', 'backout'].includes(submission.stage)
        && (daysSince(submission.updated_at || submission.created_at) ?? 0) >= STUCK_THRESHOLD_DAYS,
    },
  };
}

/**
 * Row-level pipeline explorer joining client, BDA, sales owner, recruiters and submissions.
 */
async function pipelineExplorer(user, filters = {}) {
  const thresholdDays = filters.threshold_days || STUCK_THRESHOLD_DAYS;
  const grain = filters.grain === 'submission' ? 'submission' : 'requirement';
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(filters.limit) || 100));
  const submissionStages = parseCsvList(filters.submission_stage, SUBMISSION_STAGES);

  const scopeWhere = await requirementScopeWhere(user);
  const where = buildRequirementWhere(scopeWhere, filters);

  const requirementRows = await prisma.requirement.findMany({
    where,
    include: {
      account: {
        select: {
          id: true,
          name: true,
          stage: true,
          owner: { select: { id: true, name: true } },
        },
      },
      sales_owner: { select: { id: true, name: true } },
      seats: { select: { id: true, seat_status: true } },
      assignments: {
        where: { role_on_req: 'recruiter', unassigned_at: null },
        include: { user: { select: { id: true, name: true } } },
      },
    },
    orderBy: { created_at: 'desc' },
  });

  const seatIds = requirementRows.flatMap((row) => row.seats.map((seat) => seat.id));
  const submissionRows = seatIds.length
    ? await prisma.submission.findMany({
        where: {
          requirement_seat_id: { in: seatIds },
          ...(filters.vendor_id ? { profile: { vendor_account_id: filters.vendor_id } } : {}),
          ...(submissionStages.length ? { stage: { in: submissionStages } } : {}),
        },
        include: {
          profile: {
            select: {
              id: true,
              name: true,
              source: true,
              vendor_account: { select: { id: true, name: true } },
            },
          },
          submitted_by_user: { select: { id: true, name: true } },
          seat: { select: { id: true, requirement_id: true } },
        },
        orderBy: { created_at: 'asc' },
      })
    : [];

  const submissionsByRequirement = new Map();
  for (const submission of submissionRows) {
    const requirementId = submission.seat.requirement_id;
    if (!submissionsByRequirement.has(requirementId)) submissionsByRequirement.set(requirementId, []);
    submissionsByRequirement.get(requirementId).push(submission);
  }

  let rows = requirementRows.map((requirement) => {
    const submissions = submissionsByRequirement.get(requirement.id) || [];
    return serializeRequirementRow(requirement, submissions, thresholdDays);
  });

  if (filters.stuck_only) rows = rows.filter((row) => row.aging.is_stuck);
  if (filters.past_sla_only) rows = rows.filter((row) => row.aging.sla_overdue_by_days > 0);

  if (grain === 'submission') {
    const requirementById = new Map(rows.map((row) => [row.id, row]));
    rows = submissionRows
      .map((submission) => {
        const requirementRow = requirementById.get(submission.seat.requirement_id);
        if (!requirementRow) return null;
        return serializeSubmissionRow(submission, requirementRow);
      })
      .filter(Boolean);
  }

  const total = rows.length;
  const start = (page - 1) * limit;
  const pageRows = rows.slice(start, start + limit);

  return {
    grain,
    total,
    page,
    limit,
    truncated: total > pageRows.length,
    rows: pageRows,
  };
}

module.exports = {
  pipelineExplorer,
  parseCsvList,
  summarizeStages,
  computeAging,
  REQUIREMENT_STATUSES,
  SUBMISSION_STAGES,
};
