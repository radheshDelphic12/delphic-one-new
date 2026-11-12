const { z } = require('zod');
const prisma = require('../../config/db');
const env = require('../../config/env');
const applicantsService = require('../applicants/applicants.service');
const screening = require('../applicants/screening');
const bench = require('../bench/bench.service');
const jobSearch = require('../jobs/jobSearch');
const referrals = require('../jobs/referrals');

// Internal job board: every employee of the master workspace sees the jobs that are published on the website, can refer
// someone (a friend, an ex-colleague) or apply for one themselves (for example from the bench). Both land in the same applicant
// pool as website applications - source "referral" or "internal" - so recruiters work one list. Both need the CV as a Google Drive link.
// The search itself (Job ID, title, skills, department, location) is shared with the public careers pages: modules/jobs.

const years = z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().min(0).max(70).optional());
// the CV is a mandatory Google Drive link, here too
const cvLink = z.string({ required_error: 'Google Drive link to the CV is required' }).trim().min(1, 'Google Drive link to the CV is required').max(500)
  .refine((v) => screening.isDriveUrl(v), 'Enter a Google Drive link to the CV (drive.google.com/...)');
const referSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().nullable(),
  experience_years: years,
  message: z.string().trim().max(2000).optional().nullable(),
  // what the referrer knows about the person; all optional
  ...screening.optionalShape,
  cv_url: cvLink,
}).superRefine(screening.checkScreening);
const applySchema = z.object({ cv_url: cvLink, phone: z.string().trim().max(40).optional().nullable(), experience_years: years, message: z.string().trim().max(2000).optional().nullable() });

const serialize = (p, orgSlug) => ({
  slug: p.slug,
  job_code: p.job_code,
  // the public page of this job; the client adds ?ref=<employee id> for the employee's personal referral link
  public_path: `/${orgSlug || 'delphic'}/career/${p.slug}`,
  public_base: env.publicCareersBase || null,
  title: p.title,
  department: p.department,
  location: p.location,
  employment_type: p.employment_type,
  description: p.public_description,
  posted_at: p.created_at,
});

const WORK_MODE = { remote: 'Remote', onsite: 'On-site', hybrid: 'Hybrid' };
const num = (v) => (v == null ? null : Number(v));
function jobDetails(r, p) {
  if (!r) return {};
  const body = String(r.job_description || r.description || '').trim();
  const published = String(p.public_description || '').trim();
  const min = num(r.experience_min);
  const max = num(r.experience_max);
  return {
    // the full text: the requirement's own job description when it says more than the published copy
    full_description: body.length > published.length ? body : published,
    designation: r.designation || null,
    openings: r.seats_total || 1,
    experience: min != null && max != null ? `${min}–${max} years` : min != null ? `${min}+ years` : max != null ? `Up to ${max} years` : null,
    primary_skills: r.primary_tech_stack || [],
    secondary_skills: r.secondary_tech_stack || [],
    domain: r.domain_experience || null,
    certifications: r.certifications_required || [],
    work_mode: WORK_MODE[r.work_mode] || null,
    time_zone: r.time_zone_preference || null,
    contract_months: r.contract_duration_months || null,
    notice_days: r.notice_period_max_days ?? null,
    start_date: r.start_date_target ? r.start_date_target.toISOString().slice(0, 10) : null,
    jd_url: r.jd_document_url || null,
  };
}

/**
 * One page of the open jobs: q (Job ID, title, skills, department, location), dept, loc, sort, page, limit.
 * Returns { rows, pagination, facets }; every row carries the Job ID and what this employee already did on the job.
 */
async function list(user, query = {}) {
  const canApply = await bench.canApplyInternally(user.org_id, user.org_membership_id);
  const found = await jobSearch.search({ q: String(query.q || '').slice(0, 100), dept: query.dept, loc: query.loc, sort: query.sort, page: query.page, limit: query.limit });
  const ids = found.rows.map((r) => r.posting.requirement_id);
  const mine = ids.length ? await prisma.jobApplicant.findMany({
    where: { requirement_id: { in: ids }, OR: [{ created_by: user.id }, { referrer_id: user.id }, ...(user.email ? [{ email: { equals: user.email, mode: 'insensitive' } }] : [])] },
    select: { requirement_id: true, source: true, referrer_id: true },
  }) : [];
  return {
    rows: found.rows.map((r) => {
      const p = r.posting;
      const mineHere = mine.filter((m) => m.requirement_id === p.requirement_id);
      return {
        ...serialize(p, r.org_slug),
        ...jobDetails(p.requirement, p),
        applied: mineHere.some((m) => m.source === 'internal'),
        can_apply: canApply,
        referrals: mineHere.filter((m) => m.referrer_id === user.id).length,
      };
    }),
    pagination: found.pagination,
    facets: found.facets,
  };
}

/** The people this employee referred, newest first, with how far each one got (no recruiter notes, no reject reasons). */
async function myReferrals(user) {
  const rows = await prisma.jobApplicant.findMany({
    where: { referrer_id: user.id, requirement: { deleted_at: null } },
    orderBy: { applied_at: 'desc' },
    take: 200,
    select: { id: true, name: true, status: true, profile_id: true, applied_at: true, requirement: { select: { title: true, website_posting: { select: { job_code: true, slug: true } } } } },
  });
  return rows.map((a) => ({
    id: a.id,
    candidate: a.name,
    job_code: a.requirement?.website_posting?.job_code || null,
    job_title: a.requirement?.title || null,
    slug: a.requirement?.website_posting?.slug || null,
    referred_at: a.applied_at,
    status: referrals.referralStatus(a),
  }));
}

async function posting(slug) {
  const row = await jobSearch.findOpen({ slug });
  return row ? { requirement_id: row.posting.requirement_id, title: row.posting.title, org_id: row.posting.org_id, job_code: row.posting.job_code } : null;
}

async function refer(user, slug, body) {
  const d = referSchema.parse(body);
  const p = await posting(slug);
  if (!p) return { error: 'not_found' };
  {
    const referrer = await referrals.snapshot(user, p.org_id);
    const r = await applicantsService.addApplicant(user, {
      requirement_id: p.requirement_id, name: d.name, email: d.email, phone: d.phone || '', experience_years: d.experience_years,
      notes: `Referred by ${user.name || user.email}${d.message ? `: ${d.message}` : ''}`, channel: 'referral',
      ...Object.fromEntries(Object.keys(screening.fields).map((k) => [k, d[k]])),
    }, { source: 'referral', referrer });
    return r.error === 'duplicate_applicant' ? { error: 'already_applied' } : r.error ? { error: 'not_found' } : { ok: true, job_code: p.job_code };
  }
}

async function applyMyself(user, slug, body) {
  const d = applySchema.parse(body || {});
  // Applying for yourself is for people on the bench or serving notice; referring someone stays open to everyone.
  if (!(await bench.canApplyInternally(user.org_id, user.org_membership_id))) return { error: 'not_eligible' };
  const p = await posting(slug);
  if (!p) return { error: 'not_found' };
  {
    const r = await applicantsService.addApplicant(user, {
      requirement_id: p.requirement_id, name: user.name || user.email, email: user.email, phone: d.phone || '', experience_years: d.experience_years,
      notes: `Internal application${d.message ? `: ${d.message}` : ''}`, channel: 'internal', cv_url: d.cv_url,
    }, { source: 'internal' });
    return r.error === 'duplicate_applicant' ? { error: 'already_applied' } : r.error ? { error: 'not_found' } : { ok: true, job_code: p.job_code };
  }
}

module.exports = { list, myReferrals, refer, applyMyself };
