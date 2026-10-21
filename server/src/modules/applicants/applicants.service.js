const { z } = require('zod');
const prisma = require('../../config/db');
const screening = require('./screening');

// The applicant pool of in-progress requirements. People enter the pool (added by hand today; the website will feed it
// through the website module's career submissions), every recruiter sees the pool, and the first recruiter to claim an applicant
// owns them. Claiming does NOT create a Profile; the recruiter's "Create profile" does (it reuses the person's existing Profile, so
// one person applying to two requirements is one Profile).

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const CHANNELS = ['linkedin', 'website', 'whatsapp', 'referral', 'naukri', 'internal', 'other'];
const addBase = z.object({
  requirement_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  email: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().email().max(200).nullable().optional()),
  phone: text(40),
  experience_years: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().min(0).max(70).optional()),
  notes: text(2000),
  channel: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(CHANNELS).nullable().optional()),
  ...screening.optionalShape,
});
const addSchema = addBase.superRefine(screening.checkScreening);
// editing: every field optional, a blank one clears it
const updateSchema = addBase.omit({ requirement_id: true }).partial().superRefine(screening.checkScreening);
const listSchema = z.object({
  requirement_id: z.string().uuid().optional(),
  view: z.enum(['pool', 'mine', 'all']).default('pool'),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  // screening filters
  joiner: z.enum(screening.JOINER).optional(),
  working: z.enum(['yes', 'no']).optional(),
  work_mode: z.enum(screening.WORK_MODES).optional(),
  notice_max: z.coerce.number().int().min(0).max(365).optional(),
  expected_ctc_min: z.coerce.number().min(0).optional(),
  expected_ctc_max: z.coerce.number().min(0).optional(),
  current_ctc_max: z.coerce.number().min(0).optional(),
  exp_min: z.coerce.number().min(0).optional(),
  exp_max: z.coerce.number().min(0).optional(),
  lwd_before: z.coerce.date().optional(),
  skill: z.string().trim().max(60).optional(),
  // who has them / whether a Profile exists (they work together with the screening filters)
  assignment: z.enum(['unassigned', 'assigned']).optional(),
  profile: z.enum(['created', 'not_created']).optional(),
  recruiter_id: z.string().uuid().optional(),
});
const assignSchema = z.object({ user_id: z.string().uuid().optional() });

const LIVE_STATUSES = ['in_progress'];
const liveRequirement = { status: { in: LIVE_STATUSES }, deleted_at: null };
const num = (v) => (v === null || v === undefined ? null : Number(v));
const norm = (s) => (s ? String(s).trim().toLowerCase() : null);
const digits = (s) => (s ? String(s).replace(/\D/g, '').slice(-10) : null);

function serialize(a, userNames, reqs) {
  const r = reqs?.get(a.requirement_id);
  return {
    id: a.id,
    requirement_id: a.requirement_id,
    requirement_title: r?.title || null,
    client: r?.account?.name || null,
    name: a.name,
    email: a.email,
    phone: a.phone,
    experience_years: num(a.experience_years),
    linkedin_url: a.linkedin_url,
    cv_url: a.cv_url,
    has_cv_file: Boolean(a.cv_file),
    cv_file_name: a.cv_file_name || null,
    currently_working: a.currently_working,
    joiner_status: a.joiner_status,
    notice_period_days: a.notice_period_days,
    last_working_day: a.last_working_day,
    current_ctc_lpa: num(a.current_ctc_lpa),
    expected_ctc_lpa: num(a.expected_ctc_lpa),
    work_mode: a.work_mode,
    extra_skills: a.extra_skills || [],
    source: a.source,
    channel: a.channel,
    status: a.status,
    assigned_to: a.assigned_to ? { id: a.assigned_to, name: userNames.get(a.assigned_to) || null } : null,
    assigned_at: a.assigned_at,
    profile_id: a.profile_id,
    profile_created: Boolean(a.profile_id),
    unlinked_at: a.unlinked_at || null,
    notes: a.notes,
    applied_at: a.applied_at,
  };
}

async function names(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** The in-progress requirements ("leads") with how many applicants wait in each pool. */
async function inProgressRequirements() {
  const rows = await prisma.requirement.findMany({
    where: liveRequirement,
    orderBy: { updated_at: 'desc' },
    select: {
      id: true, title: true, designation: true, work_mode: true, work_location: true, experience_min: true, experience_max: true,
      budget_min: true, budget_max: true, budget_currency: true, primary_tech_stack: true, job_description: true, priority: true, updated_at: true,
      account: { select: { id: true, name: true } },
      assignments: { where: { role_on_req: 'recruiter', unassigned_at: null }, select: { user: { select: { id: true, name: true } } } },
      applicants: { select: { status: true, channel: true } },
      website_posting: { select: { status: true, slug: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    designation: r.designation,
    client: r.account?.name || null,
    priority: r.priority,
    work_mode: r.work_mode,
    work_location: r.work_location,
    experience_min: num(r.experience_min),
    experience_max: num(r.experience_max),
    budget_min: num(r.budget_min),
    budget_max: num(r.budget_max),
    budget_currency: r.budget_currency,
    tech_stack: r.primary_tech_stack,
    has_jd: Boolean(r.job_description),
    recruiters: r.assignments.map((a) => a.user),
    updated_at: r.updated_at,
    applicants: { new: r.applicants.filter((a) => a.status === 'new').length, assigned: r.applicants.filter((a) => a.status === 'assigned').length },
    // Publishing itself lives in modules/website (Apps Script); this is only the listing's state.
    website: { published: r.website_posting?.status === 'published', closed: r.website_posting?.status === 'closed', slug: r.website_posting?.slug || null },
    // How many applicants came from each channel (linkedin, website, ...).
    channels: r.applicants.reduce((acc, a) => { const k = a.channel || 'unknown'; acc[k] = (acc[k] || 0) + 1; return acc; }, {}),
  }));
}

/** The screening filters of the Applicants list; a person with no answer for a filtered question never matches it. */
function screeningWhere(q) {
  const and = [];
  if (q.joiner) and.push({ joiner_status: q.joiner });
  if (q.working) and.push({ currently_working: q.working === 'yes' });
  if (q.work_mode) and.push({ work_mode: q.work_mode });
  if (q.notice_max !== undefined) and.push({ notice_period_days: { lte: q.notice_max } });
  if (q.expected_ctc_min !== undefined || q.expected_ctc_max !== undefined) and.push({ expected_ctc_lpa: { ...(q.expected_ctc_min !== undefined ? { gte: q.expected_ctc_min } : {}), ...(q.expected_ctc_max !== undefined ? { lte: q.expected_ctc_max } : {}) } });
  if (q.current_ctc_max !== undefined) and.push({ current_ctc_lpa: { lte: q.current_ctc_max } });
  if (q.exp_min !== undefined || q.exp_max !== undefined) and.push({ experience_years: { ...(q.exp_min !== undefined ? { gte: q.exp_min } : {}), ...(q.exp_max !== undefined ? { lte: q.exp_max } : {}) } });
  if (q.lwd_before) and.push({ last_working_day: { lte: q.lwd_before } });
  if (q.skill) and.push({ extra_skills: { has: q.skill.toLowerCase() } });
  return and.length ? { AND: and } : {};
}

async function list(user, rawQuery) {
  const q = listSchema.parse(rawQuery);
  const where = {
    ...(q.requirement_id ? { requirement_id: q.requirement_id } : {}),
    requirement: liveRequirement,
    ...(q.view === 'pool' ? { status: 'new' } : q.view === 'mine' ? { assigned_to: user.id, status: 'assigned' } : {}),
    ...(q.assignment ? { status: q.assignment === 'unassigned' ? 'new' : 'assigned' } : {}),
    ...(q.profile ? { profile_id: q.profile === 'created' ? { not: null } : null } : {}),
    ...(q.recruiter_id ? { assigned_to: q.recruiter_id } : {}),
    ...screeningWhere(q),
    ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search } }] } : {}),
  };
  const [total, rows, pool, mine, everyone] = await Promise.all([
    prisma.jobApplicant.count({ where }),
    prisma.jobApplicant.findMany({ where, orderBy: { applied_at: 'asc' }, skip: (q.page - 1) * q.limit, take: q.limit }),
    prisma.jobApplicant.count({ where: { status: 'new', requirement: liveRequirement } }),
    prisma.jobApplicant.count({ where: { status: 'assigned', assigned_to: user.id, requirement: liveRequirement } }),
    prisma.jobApplicant.count({ where: { requirement: liveRequirement } }),
  ]);
  const reqs = new Map((await prisma.requirement.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.requirement_id))] } }, select: { id: true, title: true, account: { select: { name: true } } } })).map((r) => [r.id, r]));
  const userNames = await names(rows.map((r) => r.assigned_to));
  return {
    rows: rows.map((r) => serialize(r, userNames, reqs)),
    pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
    counts: { pool, mine, all: everyone },
  };
}

/** Adds one applicant to a requirement's pool. The same person (email or phone) is never added twice to one requirement. */
async function addApplicant(user, body, { source = 'manual', cvFile = null } = {}) {
  const d = addSchema.parse(body);
  const requirement = await prisma.requirement.findFirst({ where: { id: d.requirement_id, deleted_at: null }, select: { id: true, status: true } });
  if (!requirement) return { error: 'requirement_not_found' };
  if (!LIVE_STATUSES.includes(requirement.status)) return { error: 'requirement_not_in_progress' };
  const email = norm(d.email);
  const phone = digits(d.phone);
  const profile = d.linkedin_url ? screening.linkedInKey(d.linkedin_url) : null;
  // The check and the insert run under one lock per requirement, so two quick clicks cannot both get in.
  const done = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`applicant:${d.requirement_id}`}))`;
    if (email || phone || profile) {
      const existing = await tx.jobApplicant.findMany({ where: { requirement_id: d.requirement_id }, select: { email: true, phone: true, linkedin_url: true } });
      const same = (e) => (email && norm(e.email) === email) || (phone && digits(e.phone) === phone) || (profile && e.linkedin_url && screening.linkedInKey(e.linkedin_url) === profile);
      if (existing.some(same)) return { error: 'duplicate_applicant' };
    }
    const row = await tx.jobApplicant.create({
      data: {
        requirement_id: d.requirement_id, name: d.name, email, phone: d.phone || null, experience_years: d.experience_years ?? null, notes: d.notes || null, source, channel: d.channel || null,
        ...screening.toColumns(d), cv_file: cvFile?.filename || null, cv_file_name: cvFile?.name || null, created_by: user?.id || null,
        dedupe_key: email,
      },
    });
    return { applicant: serialize(row, new Map(), null) };
  }).catch((err) => {
    // the database allows one application per (email, requirement): two simultaneous ones end here, not as a 500
    if (err?.code === 'P2002') return { error: 'duplicate_applicant' };
    throw err;
  });
  return done;
}

/** The stored CV of an applicant, for the authenticated download. */
async function cvFileOf(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const a = await prisma.jobApplicant.findUnique({ where: { id }, select: { cv_file: true, cv_file_name: true } });
  return a?.cv_file ? { filename: a.cv_file, name: a.cv_file_name || a.cv_file } : null;
}

async function findOrCreateProfile(tx, applicant, addedBy) {
  const email = norm(applicant.email);
  const phone = digits(applicant.phone);
  const or = [...(email ? [{ email: { equals: email, mode: 'insensitive' } }] : []), ...(phone ? [{ phone: { contains: phone } }] : [])];
  const found = or.length ? await tx.profile.findMany({ where: { deleted_at: null, OR: or }, select: { id: true, email: true, phone: true } }) : [];
  const match = found.find((p) => (email && norm(p.email) === email) || (phone && digits(p.phone) === phone));
  if (match) return match.id;
  const created = await tx.profile.create({
    data: {
      name: applicant.name,
      email,
      phone: applicant.phone || null,
      total_experience_years: applicant.experience_years ?? 0,
      source: 'linkedin',
      added_by: addedBy,
      linkedin_url: applicant.linkedin_url || null,
      resume_url: applicant.cv_url || null,
      // the candidate typed CTC in lakh per annum; the Profile keeps rupees
      current_ctc: applicant.current_ctc_lpa == null ? null : Number(applicant.current_ctc_lpa) * 100000,
      expected_ctc: applicant.expected_ctc_lpa == null ? null : Number(applicant.expected_ctc_lpa) * 100000,
      notice_period_days: applicant.notice_period_days ?? null,
      is_serving_notice: applicant.joiner_status === 'serving_notice',
      last_working_day: applicant.last_working_day || null,
      preferred_work_mode: applicant.work_mode || null,
      preferred_locations: [],
      primary_skills: [],
      secondary_skills: applicant.extra_skills || [],
      certifications: [],
      domain_experience: [],
      recruiter_notes: `Applied (${applicant.source}) to a requirement; claimed from the applicant pool.`,
    },
  });
  return created.id;
}

/**
 * First come, first served: the claim only succeeds while the applicant is still unassigned. An admin may hand an
 * applicant to a specific recruiter. The claimer is added to the requirement's recruiters so they can work on it.
 */
async function assign(user, id, rawBody = {}) {
  const body = assignSchema.parse(rawBody);
  if (body.user_id && user.role !== 'admin' && body.user_id !== user.id) return { error: 'forbidden' };
  const target = body.user_id || user.id;
  const applicant = await prisma.jobApplicant.findUnique({ where: { id }, include: { requirement: { select: { status: true, deleted_at: true } } } });
  if (!applicant || applicant.requirement.deleted_at) return { error: 'not_found' };
  if (!LIVE_STATUSES.includes(applicant.requirement.status)) return { error: 'requirement_not_in_progress' };
  if (applicant.status !== 'new') return { error: 'already_assigned' };
  const who = await prisma.user.findUnique({ where: { id: target }, select: { id: true, role: true, active: true } });
  if (!who || who.active === false || !['recruiter', 'admin'].includes(who.role)) return { error: 'not_a_recruiter' };

  const result = await prisma.$transaction(async (tx) => {
    // the conditional update is what makes it first come, first served even when two recruiters click together
    const claimed = await tx.jobApplicant.updateMany({ where: { id, status: 'new', assigned_to: null }, data: { status: 'assigned', assigned_to: target, assigned_at: new Date() } });
    if (claimed.count !== 1) return { error: 'already_assigned' };
    // Claiming only moves the person from the Pool to the recruiter's candidates; the Profile is created by "Create profile".
    if (who.role === 'recruiter') {
      const on = await tx.requirementAssignment.findFirst({ where: { requirement_id: applicant.requirement_id, user_id: target, role_on_req: 'recruiter', unassigned_at: null } });
      if (!on) await tx.requirementAssignment.create({ data: { requirement_id: applicant.requirement_id, user_id: target, role_on_req: 'recruiter', assigned_by: user.id } });
    }
    return { ok: true };
  });
  if (result.error) return result;
  await prisma.auditLog.create({ data: { actor_id: user.id, action: 'applicant_assign', entity_type: 'job_applicant', entity_id: id, reason: `Assigned to ${target}`, snapshot: { requirement_id: applicant.requirement_id } } });
  const row = await prisma.jobApplicant.findUnique({ where: { id } });
  return { applicant: serialize(row, await names([row.assigned_to]), null) };
}

/** Puts a claimed applicant back in the pool (by the recruiter who holds them, or an admin). The Profile stays. */
async function release(user, id) {
  const applicant = await prisma.jobApplicant.findUnique({ where: { id } });
  if (!applicant) return { error: 'not_found' };
  if (applicant.status !== 'assigned') return { error: 'not_assigned' };
  if (user.role !== 'admin' && applicant.assigned_to !== user.id) return { error: 'forbidden' };
  const row = await prisma.jobApplicant.update({ where: { id }, data: { status: 'new', assigned_to: null, assigned_at: null } });
  await prisma.auditLog.create({ data: { actor_id: user.id, action: 'applicant_release', entity_type: 'job_applicant', entity_id: id, reason: 'Released to the pool', snapshot: {} } });
  return { applicant: serialize(row, new Map(), null) };
}

const SCREENING_COLUMNS = ['linkedin_url', 'cv_url', 'currently_working', 'joiner_status', 'notice_period_days', 'last_working_day', 'current_ctc_lpa', 'expected_ctc_lpa', 'work_mode', 'extra_skills'];

/** An admin / recruiter corrects an applicant: any field sent is changed, a blank one is cleared. Same duplicate rules as adding. */
async function updateApplicant(user, id, body) {
  const d = updateSchema.parse(body || {});
  const existing = await prisma.jobApplicant.findUnique({ where: { id } });
  if (!existing) return { error: 'not_found' };
  const sent = (k) => Object.prototype.hasOwnProperty.call(body || {}, k);
  const data = {};
  if (sent('name') && d.name) data.name = d.name;
  if (sent('email')) data.email = norm(d.email);
  if (sent('phone')) data.phone = d.phone || null;
  if (sent('experience_years')) data.experience_years = d.experience_years ?? null;
  if (sent('notes')) data.notes = d.notes || null;
  if (sent('channel')) data.channel = d.channel || null;
  const cols = screening.toColumns(d);
  for (const k of SCREENING_COLUMNS) if (sent(k)) data[k] = cols[k];
  if (sent('joiner_status') && d.joiner_status !== 'serving_notice' && !sent('last_working_day')) data.last_working_day = null;

  const email = norm('email' in data ? data.email : existing.email);
  const phone = digits('phone' in data ? data.phone : existing.phone);
  const profile = 'linkedin_url' in data ? (data.linkedin_url ? screening.linkedInKey(data.linkedin_url) : null) : (existing.linkedin_url ? screening.linkedInKey(existing.linkedin_url) : null);
  const others = await prisma.jobApplicant.findMany({ where: { requirement_id: existing.requirement_id, id: { not: id } }, select: { email: true, phone: true, linkedin_url: true } });
  const same = (e) => (email && norm(e.email) === email) || (phone && digits(e.phone) === phone) || (profile && e.linkedin_url && screening.linkedInKey(e.linkedin_url) === profile);
  if (others.some(same)) return { error: 'duplicate_applicant' };

  if ('email' in data) data.dedupe_key = data.email;
  let row;
  try {
    row = await prisma.jobApplicant.update({ where: { id }, data });
  } catch (err) {
    if (err?.code === 'P2002') return { error: 'duplicate_applicant' };
    throw err;
  }
  await prisma.auditLog.create({ data: { actor_id: user.id, action: 'applicant_update', entity_type: 'job_applicant', entity_id: id, reason: row.name, snapshot: JSON.parse(JSON.stringify({ before: existing, after: row })) } });
  return { applicant: serialize(row, new Map(), null) };
}

/**
 * "Create profile" - the second step after claiming. Only the recruiter who holds the applicant (or an admin) can do it;
 * it creates the candidate Profile (or reuses the person's existing one, so one person applying twice is one Profile).
 * Pressing it again changes nothing.
 */
async function createProfile(user, id) {
  const applicant = await prisma.jobApplicant.findUnique({ where: { id } });
  if (!applicant) return { error: 'not_found' };
  if (applicant.status !== 'assigned') return { error: 'not_assigned' };
  if (user.role !== 'admin' && applicant.assigned_to !== user.id) return { error: 'forbidden' };
  if (applicant.profile_id) return { applicant: serialize(applicant, await names([applicant.assigned_to]), null), created: false };
  const profileId = await prisma.$transaction(async (tx) => {
    const pid = await findOrCreateProfile(tx, applicant, applicant.assigned_to);
    await tx.jobApplicant.update({ where: { id }, data: { profile_id: pid } });
    return pid;
  });
  await prisma.auditLog.create({ data: { actor_id: user.id, action: 'applicant_create_profile', entity_type: 'job_applicant', entity_id: id, reason: `Profile created for ${applicant.name}`, snapshot: { profile_id: profileId } } });
  const row = await prisma.jobApplicant.findUnique({ where: { id } });
  return { applicant: serialize(row, await names([row.assigned_to]), null), created: true };
}

/** "Unlink from job": the person leaves this requirement (no longer in anyone's candidates); their Profile is kept as it is. */
async function unlink(user, id) {
  const applicant = await prisma.jobApplicant.findUnique({ where: { id } });
  if (!applicant) return { error: 'not_found' };
  if (applicant.status !== 'assigned') return { error: 'not_assigned' };
  if (user.role !== 'admin' && applicant.assigned_to !== user.id) return { error: 'forbidden' };
  const row = await prisma.jobApplicant.update({ where: { id }, data: { status: 'unlinked', unlinked_at: new Date() } });
  await prisma.auditLog.create({ data: { actor_id: user.id, action: 'applicant_unlink', entity_type: 'job_applicant', entity_id: id, reason: `Unlinked from the job: ${applicant.name}`, snapshot: { profile_id: applicant.profile_id } } });
  return { applicant: serialize(row, await names([row.assigned_to]), null) };
}

/**
 * Soft delete (restorable by the group super admin from Group Dashboard > Logs). Anyone who handles applicants may delete a
 * person from the pool; a claimed applicant only by whoever holds them, or an admin. The one-application-per-email key is
 * freed so the same person can apply again; restoring takes it back. The CV file stays, since the record can come back.
 */
async function remove(user, id, reason) {
  const applicant = await prisma.jobApplicant.findUnique({ where: { id } });
  if (!applicant) return { error: 'not_found' };
  if (applicant.status !== 'new' && user.role !== 'admin' && applicant.assigned_to !== user.id) return { error: 'forbidden' };
  await prisma.jobApplicant.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: user.id, delete_reason: reason || 'Deleted from the applicant pool', dedupe_key: null } });
  await prisma.auditLog.create({ data: { actor_id: user.id, action: 'applicant_delete', entity_type: 'job_applicant', entity_id: id, reason: applicant.name, snapshot: { status: applicant.status } } });
  return { id };
}

module.exports = { inProgressRequirements, list, addApplicant, updateApplicant, cvFileOf, assign, release, createProfile, unlink, remove };
