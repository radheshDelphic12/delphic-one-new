const prisma = require('../../config/db');
const { computeClosureDetail } = require('../../utils/closureProgress');

function serialize(row, submissionCounts, progress) {
  if (!row) return null;
  const { vendor_account_id, vendor_account, added_by, added_by_user, ...rest } = row;

  return {
    ...rest,
    vendor_account: vendor_account ? { id: vendor_account.id, name: vendor_account.name } : null,
    added_by: added_by_user,
    total_submissions_count: submissionCounts?.total ?? 0,
    active_submissions_count: submissionCounts?.active ?? 0,
    progress: progress ?? null,
  };
}

async function decorateOne(row) {
  if (!row) return null;
  const [counts, activeSubmissions] = await Promise.all([
    prisma.submission.groupBy({ by: ['stage'], where: { profile_id: row.id }, _count: { id: true } }),
    prisma.submission.findMany({
      where: { profile_id: row.id, stage: { notIn: ['rejected', 'backout'] } },
      select: { stage: true, interview_rounds: { select: { result: true } } },
    }),
  ]);
  const total = counts.reduce((sum, c) => sum + c._count.id, 0);
  const active = counts
    .filter((c) => !['rejected', 'backout', 'closed'].includes(c.stage))
    .reduce((sum, c) => sum + c._count.id, 0);

  const progress = activeSubmissions
    .map((s) => computeClosureDetail(s.stage, s.interview_rounds))
    .filter(Boolean)
    .sort((a, b) => b.percent - a.percent)[0] || null;

  return serialize(row, { total, active }, progress);
}

const INCLUDE = {
  vendor_account: { select: { id: true, name: true } },
  added_by_user: { select: { id: true, name: true } },
};

const DATE_FIELDS = ['date_of_birth', 'last_working_day', 'earliest_join_date'];

function normalizeProfileDates(data) {
  const next = { ...data };
  for (const field of DATE_FIELDS) {
    if (next[field] === undefined || next[field] === null || next[field] === '') {
      if (next[field] === '') delete next[field];
      continue;
    }
    if (typeof next[field] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(next[field])) {
      next[field] = new Date(`${next[field]}T00:00:00.000Z`);
      continue;
    }
    next[field] = new Date(next[field]);
  }
  return next;
}

async function list(filters) {
  const {
    source, vendor_id, primary_skills, experience_min, experience_max, expected_ctc_min, expected_ctc_max,
    notice_period_max, is_serving_notice, current_location, willing_to_relocate, preferred_work_mode,
    is_active, on_bench, added_by, search, sort_by, sort_order, page, limit,
  } = filters;

  const where = {
    ...(source ? { source } : {}),
    ...(on_bench !== undefined ? { on_bench } : {}),
    ...(vendor_id ? { vendor_account_id: vendor_id } : {}),
    ...(experience_min !== undefined || experience_max !== undefined
      ? { total_experience_years: { ...(experience_min !== undefined ? { gte: experience_min } : {}), ...(experience_max !== undefined ? { lte: experience_max } : {}) } }
      : {}),
    ...(expected_ctc_min !== undefined || expected_ctc_max !== undefined
      ? { expected_ctc: { ...(expected_ctc_min !== undefined ? { gte: expected_ctc_min } : {}), ...(expected_ctc_max !== undefined ? { lte: expected_ctc_max } : {}) } }
      : {}),
    ...(notice_period_max !== undefined ? { notice_period_days: { lte: notice_period_max } } : {}),
    ...(is_serving_notice !== undefined ? { is_serving_notice } : {}),
    ...(current_location ? { current_location: { contains: current_location, mode: 'insensitive' } } : {}),
    ...(willing_to_relocate !== undefined ? { willing_to_relocate } : {}),
    ...(preferred_work_mode ? { preferred_work_mode } : {}),
    ...(is_active !== undefined ? { is_active } : {}),
    ...(added_by ? { added_by } : {}),
    ...(primary_skills ? { primary_skills: { hasSome: primary_skills.split(',').map((s) => s.trim()) } } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
            { current_company: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.profile.count({ where }),
    prisma.profile.findMany({ where, include: INCLUDE, orderBy: { [sort_by]: sort_order }, take: limit, skip: (page - 1) * limit }),
  ]);

  const decorated = await Promise.all(rows.map(decorateOne));
  return { rows: decorated, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

async function getById(id) {
  const row = await prisma.profile.findUnique({ where: { id }, include: INCLUDE });
  return decorateOne(row);
}

async function create(data, addedBy) {
  const row = await prisma.profile.create({
    data: { ...normalizeProfileDates(data), added_by: addedBy },
    include: INCLUDE,
  });
  return decorateOne(row);
}

async function update(id, patch) {
  const row = await prisma.profile.update({
    where: { id },
    data: normalizeProfileDates(patch),
    include: INCLUDE,
  });
  return decorateOne(row);
}

async function getSubmissions(profileId) {
  const rows = await prisma.submission.findMany({
    where: { profile_id: profileId },
    orderBy: { created_at: 'desc' },
    include: {
      seat: { include: { requirement: { include: { account: { select: { name: true } } } } } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    stage: r.stage,
    requirement: { id: r.seat.requirement.id, title: r.seat.requirement.title, account_name: r.seat.requirement.account.name },
    seat: { id: r.seat.id, seat_label: r.seat.seat_label },
    proposed_rate: r.proposed_rate,
    created_at: r.created_at,
  }));
}

module.exports = { list, getById, create, update, getSubmissions };
