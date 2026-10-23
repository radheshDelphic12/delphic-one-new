const { z } = require('zod');
const prisma = require('../../config/db');
const logger = require('../../config/logger');
const client = require('./appsScriptClient');
const { cleanTitle, normalizeEmployment } = require('../jobs/jobFields');

// A Requirement published to the website's /career page. Only the public copy
// below ever reaches the Jobs sheet — budget, billing, client and owner fields
// stay on the Requirement. The sheet row is keyed by requirement_id ("Job ID").

const optStr = (max) => z.string().trim().max(max).optional().nullable();
// The employment type is one of a fixed set ("Full Time" and "Full-time" are the same thing) and is stored as an enum too.
const employment = optStr(60).transform((v, ctx) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = normalizeEmployment(v);
  if (!n) { ctx.addIssue({ code: 'custom', message: 'Choose Full-time, Part-time, Contract or Internship' }); return z.NEVER; }
  return n.label;
});
const publicFieldsSchema = z.object({
  // no trailing punctuation, never ALL CAPS
  title: z.string().trim().min(1).max(200).transform(cleanTitle).refine((v) => v.length > 0, 'Job title is required'),
  department: z.string({ required_error: 'Department is required', invalid_type_error: 'Department is required' }).trim().min(1, 'Department is required').max(120),
  location: optStr(200),
  employment_type: employment,
  public_description: optStr(10000),
});
/** The columns for validated public fields: the label plus the enum behind it. */
const withKind = (fields) => (fields.employment_type === undefined ? fields : { ...fields, employment_kind: fields.employment_type ? normalizeEmployment(fields.employment_type).kind : null });
const updateSchema = publicFieldsSchema.partial();

/** A readable, unique public slug: the title plus 4 random hex characters ("senior-react-developer-3fa9"). */
async function newSlug(title) {
  const base = String(title || 'job').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'job';
  for (let i = 0; i < 6; i += 1) {
    const slug = `${base}-${Math.random().toString(16).slice(2, 6).padEnd(4, '0')}`;
    if (!(await prisma.websiteJobPosting.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

const CLOSED_REQUIREMENT = ['closed', 'dropped'];
const ENGAGEMENT_LABEL = { full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract' };
const WORK_MODE_LABEL = { remote: 'Remote', onsite: 'On-site', hybrid: 'Hybrid' };

/** What the publish form starts from: the Requirement's own public-safe fields. */
function defaultsFor(requirement) {
  const mode = WORK_MODE_LABEL[requirement.work_mode];
  const location = [requirement.work_location, mode].filter(Boolean).join(' · ');
  const min = requirement.experience_min == null ? null : Number(requirement.experience_min);
  const max = requirement.experience_max == null ? null : Number(requirement.experience_max);
  const experience = min != null && max != null ? `${min}–${max} years` : min != null ? `${min}+ years` : max != null ? `Up to ${max} years` : null;
  const body = requirement.job_description || requirement.description || null;
  const description = [experience && `Experience: ${experience}`, body].filter(Boolean).join('\n\n');
  return {
    title: requirement.title,
    department: requirement.department || null,
    location: location || null,
    employment_type: ENGAGEMENT_LABEL[requirement.engagement_type] || null,
    public_description: description || null,
  };
}

async function audit(actorId, posting, action, reason) {
  if (!actorId) return;
  await prisma.auditLog.create({
    data: {
      actor_id: actorId,
      action,
      // Logged against the requirement so it shows in the requirement's activity feed.
      entity_type: 'requirement',
      entity_id: posting.requirement_id,
      reason,
      snapshot: { posting_id: posting.id, status: posting.status, title: posting.title },
      org_id: posting.org_id,
    },
  });
}

/** Writes the posting's current state to the Jobs sheet and records the outcome on the row. */
async function push(posting) {
  const result = await client.call('jobs', 'upsertJob', {
    jobId: posting.requirement_id,
    jobCode: posting.job_code,
    title: posting.title,
    department: posting.department || '',
    location: posting.location || '',
    type: posting.employment_type || '',
    description: posting.public_description || '',
    status: posting.status === 'published' ? 'Open' : 'Closed',
  });
  const data = result.error
    ? { sync_error: result.message || result.error }
    : { sync_error: null, last_synced_at: new Date() };
  return prisma.websiteJobPosting.update({ where: { id: posting.id }, data });
}

async function findRequirement(orgId, requirementId) {
  // Requirements predating the org_id backfill may have a null org_id; the
  // route is master-workspace only, so those belong to it.
  return prisma.requirement.findFirst({ where: { id: requirementId, OR: [{ org_id: orgId }, { org_id: null }] } });
}

async function list(orgId, { status } = {}) {
  const rows = await prisma.websiteJobPosting.findMany({
    where: { org_id: orgId, ...(status ? { status } : {}) },
    include: { requirement: { select: { id: true, title: true, status: true } } },
    orderBy: { updated_at: 'desc' },
  });
  return rows;
}

/** The publish form's state for one requirement: its posting (if any) plus defaults. */
async function forRequirement(orgId, requirementId) {
  const requirement = await findRequirement(orgId, requirementId);
  if (!requirement) return { error: 'requirement_not_found' };
  const posting = await prisma.websiteJobPosting.findUnique({ where: { requirement_id: requirementId } });
  return { posting, defaults: defaultsFor(requirement), requirement_status: requirement.status };
}

async function publish(orgId, userId, requirementId, fields) {
  const requirement = await findRequirement(orgId, requirementId);
  if (!requirement) return { error: 'requirement_not_found' };
  if (CLOSED_REQUIREMENT.includes(requirement.status)) return { error: 'requirement_closed' };

  const data = { ...withKind(fields), status: 'published', updated_by: userId };
  const saved = await prisma.websiteJobPosting.upsert({
    where: { requirement_id: requirementId },
    create: { ...data, org_id: orgId, requirement_id: requirementId, created_by: userId, slug: await newSlug(fields.title) },
    update: data,
  });
  if (!saved.slug) saved.slug = (await prisma.websiteJobPosting.update({ where: { id: saved.id }, data: { slug: await newSlug(saved.title) } })).slug;
  const posting = await push(saved);
  await audit(userId, posting, 'website_publish', `Published to website as "${posting.title}"`);
  return { posting };
}

async function getOwned(orgId, id) {
  return prisma.websiteJobPosting.findFirst({ where: { id, org_id: orgId } });
}

async function update(orgId, userId, id, patch) {
  const existing = await getOwned(orgId, id);
  if (!existing) return { error: 'not_found' };
  const saved = await prisma.websiteJobPosting.update({ where: { id }, data: { ...withKind(patch), updated_by: userId } });
  const posting = await push(saved);
  await audit(userId, posting, 'website_update', 'Edited the website job posting');
  return { posting };
}

async function setStatus(orgId, userId, id, status) {
  const existing = await getOwned(orgId, id);
  if (!existing) return { error: 'not_found' };
  if (status === 'published') {
    const requirement = await findRequirement(orgId, existing.requirement_id);
    if (!requirement || CLOSED_REQUIREMENT.includes(requirement.status)) return { error: 'requirement_closed' };
  }
  const saved = await prisma.websiteJobPosting.update({ where: { id }, data: { status, updated_by: userId } });
  const posting = await push(saved);
  await audit(userId, posting, status === 'published' ? 'website_reopen' : 'website_close', status === 'published' ? 'Reopened on the website' : 'Closed on the website');
  return { posting };
}

async function retry(orgId, id) {
  const existing = await getOwned(orgId, id);
  if (!existing) return { error: 'not_found' };
  return { posting: await push(existing) };
}

/**
 * Takes a posting off the website once its requirement is closed, dropped or
 * deleted. Called after requirement status changes and by the sync job as a
 * backstop. Never throws: a requirement change must not fail on the website.
 * With background: true the sheet write isn't awaited, so a slow Apps Script
 * never holds up the requirement request (a failure lands in sync_error and
 * the sync job retries it).
 */
async function followRequirement(requirementId, { background = false } = {}) {
  try {
    const posting = await prisma.websiteJobPosting.findUnique({ where: { requirement_id: requirementId } });
    if (!posting || posting.status !== 'published') return;
    const requirement = await prisma.requirement.findFirst({ where: { id: requirementId } });
    if (requirement && !CLOSED_REQUIREMENT.includes(requirement.status)) return;
    const saved = await prisma.websiteJobPosting.update({ where: { id: posting.id }, data: { status: 'closed' } });
    const pushed = push(saved).catch((err) => logger.error('website_push_failed', { postingId: saved.id, err }));
    if (!background) await pushed;
  } catch (err) {
    logger.error('website_follow_requirement_failed', { requirementId, err });
  }
}

/** Sync-job backstop: close postings whose requirement closed, and retry failed pushes. */
async function reconcile() {
  const rows = await prisma.websiteJobPosting.findMany({
    where: { OR: [{ status: 'published' }, { sync_error: { not: null } }] },
    select: { id: true, requirement_id: true, status: true, sync_error: true },
  });
  for (const row of rows) {
    if (row.status === 'published') await followRequirement(row.requirement_id);
    const fresh = await prisma.websiteJobPosting.findUnique({ where: { id: row.id } });
    if (fresh?.sync_error) await push(fresh);
  }
}

module.exports = {
  publicFieldsSchema,
  updateSchema,
  defaultsFor,
  list,
  forRequirement,
  publish,
  update,
  setStatus,
  retry,
  followRequirement,
  reconcile,
  newSlug,
};
