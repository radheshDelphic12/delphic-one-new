const { z } = require('zod');
const prisma = require('../../config/db');
const applicantsService = require('../applicants/applicants.service');
const screening = require('../applicants/screening');
const bench = require('../bench/bench.service');

// Internal job board: every employee of the master workspace sees the jobs that are published on the website, can refer
// someone (a friend, an ex-colleague) or apply for one themselves (for example from the bench). Both land in the same applicant
// pool as website applications - source "referral" or "internal" - so recruiters work one list. No new table.

const OPEN = { status: 'published', requirement: { status: 'in_progress', deleted_at: null } };
const years = z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().min(0).max(70).optional());
const referSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().nullable(),
  experience_years: years,
  message: z.string().trim().max(2000).optional().nullable(),
  // what the referrer knows about the person; all optional
  ...screening.optionalShape,
}).superRefine(screening.checkScreening);
const applySchema = z.object({ phone: z.string().trim().max(40).optional().nullable(), experience_years: years, message: z.string().trim().max(2000).optional().nullable() });

const serialize = (p) => ({ slug: p.slug, title: p.title, department: p.department, location: p.location, employment_type: p.employment_type, description: p.public_description, posted_at: p.created_at });

const WORK_MODE = { remote: 'Remote', onsite: 'On-site', hybrid: 'Hybrid' };
const num = (v) => (v == null ? null : Number(v));
// Everything an employee needs to judge a job, from the requirement. Never the budget, billing, client or owner.
const REQUIREMENT_SELECT = { id: true, job_description: true, description: true, designation: true, seats_total: true, primary_tech_stack: true, secondary_tech_stack: true, domain_experience: true, experience_min: true, experience_max: true, certifications_required: true, work_mode: true, work_location: true, time_zone_preference: true, contract_duration_months: true, notice_period_max_days: true, start_date_target: true, jd_document_url: true };
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

async function list(user) {
  const canApply = await bench.canApplyInternally(user.org_id, user.org_membership_id);
  const rows = await prisma.websiteJobPosting.findMany({ where: { ...OPEN, slug: { not: null } }, include: { requirement: { select: REQUIREMENT_SELECT } }, orderBy: { created_at: 'desc' } });
  const mine = await prisma.jobApplicant.findMany({
    where: { requirement_id: { in: rows.map((r) => r.requirement_id) }, OR: [{ created_by: user.id }, ...(user.email ? [{ email: { equals: user.email, mode: 'insensitive' } }] : [])] },
    select: { requirement_id: true, source: true, email: true },
  });
  return rows.map((p) => {
    const mineHere = mine.filter((m) => m.requirement_id === p.requirement_id);
    return {
      ...serialize(p),
      ...jobDetails(p.requirement, p),
      applied: mineHere.some((m) => m.source === 'internal'),
      can_apply: canApply,
      referrals: mineHere.filter((m) => m.source === 'referral').length,
    };
  });
}

async function posting(slug) {
  return prisma.websiteJobPosting.findFirst({ where: { slug: String(slug).toLowerCase(), ...OPEN }, select: { requirement_id: true, title: true } });
}

async function refer(user, slug, body) {
  const d = referSchema.parse(body);
  const p = await posting(slug);
  if (!p) return { error: 'not_found' };
  const r = await applicantsService.addApplicant(user, {
    requirement_id: p.requirement_id, name: d.name, email: d.email, phone: d.phone || '', experience_years: d.experience_years,
    notes: `Referred by ${user.name || user.email}${d.message ? `: ${d.message}` : ''}`, channel: 'referral',
    ...Object.fromEntries(Object.keys(screening.fields).map((k) => [k, d[k]])),
  }, { source: 'referral' });
  return r.error === 'duplicate_applicant' ? { error: 'already_applied' } : r.error ? { error: 'not_found' } : { ok: true };
}

async function applyMyself(user, slug, body) {
  const d = applySchema.parse(body || {});
  // Applying for yourself is for people on the bench or serving notice; referring someone stays open to everyone.
  if (!(await bench.canApplyInternally(user.org_id, user.org_membership_id))) return { error: 'not_eligible' };
  const p = await posting(slug);
  if (!p) return { error: 'not_found' };
  const r = await applicantsService.addApplicant(user, {
    requirement_id: p.requirement_id, name: user.name || user.email, email: user.email, phone: d.phone || '', experience_years: d.experience_years,
    notes: `Internal application${d.message ? `: ${d.message}` : ''}`, channel: 'internal',
  }, { source: 'internal' });
  return r.error === 'duplicate_applicant' ? { error: 'already_applied' } : r.error ? { error: 'not_found' } : { ok: true };
}

module.exports = { list, refer, applyMyself };
