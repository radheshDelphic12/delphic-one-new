const { z } = require('zod');
const applicantsService = require('../applicants/applicants.service');
const screening = require('../applicants/screening');
const jobSearch = require('../jobs/jobSearch');
const referrals = require('../jobs/referrals');
const { JOB_CODE } = require('../jobs/jobFields');
const hiring = require('../hiring/hiring.service');

// The public side of a published job: the pages behind /<org>/career. Only the public copy of the posting is ever returned
// (Job ID, title, department, location, type, description) - no client, budget or owner fields.

const applySchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().min(1, 'Phone number is required').max(40)
    .transform((v, ctx) => {
      const p = screening.normalizePhone(v);
      if (!p) ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit mobile number' });
      return p || v;
    }),
  experience_years: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number({ required_error: 'Total years of experience is required', invalid_type_error: 'Total years of experience is required' }).min(0).max(70)),
  message: z.string().trim().max(2000).optional().nullable(),
  // Where the visitor came from (the ?src= of the link). Anything unknown is stored as "other".
  channel: z.string().trim().toLowerCase().max(40).optional().nullable(),
  // Referral: the employee id / code of a personal job link (?ref=), and an optional "Referred by" typed by the candidate.
  ref: z.string().trim().max(80).optional().nullable(),
  referred_by: z.string().trim().max(200).optional().nullable(),
  // Honeypot: real visitors never see this field; bots fill it.
  company_website: z.string().optional().nullable(),
  // screening answers: most are required here, so the recruiters can filter the pool
  ...screening.fields,
}).superRefine((d, ctx) => {
  screening.requireScreening(d, ctx);
  screening.checkScreening(d, ctx);
  // the CV is a mandatory Google Drive link (recruiters may still paste any link by hand)
  if (d.cv_url && !screening.isDriveUrl(d.cv_url)) ctx.addIssue({ code: 'custom', path: ['cv_url'], message: 'Enter a Google Drive link to your CV (drive.google.com/...)' });
});

const serialize = (row) => {
  const p = row.posting;
  return { slug: p.slug, job_code: p.job_code, title: p.title, department: p.department, location: p.location, employment_type: p.employment_type, description: p.public_description, posted_at: p.created_at };
};

/** Every open job (the JSON API of the public site). */
async function list(orgSlug) {
  return (await jobSearch.loadOpen(orgSlug)).map(serialize);
}

/** One page of the open jobs, searched / filtered / sorted: q, dept, loc, sort, page, limit. */
async function search(orgSlug, query = {}) {
  const r = await jobSearch.search({ orgSlug, q: String(query.q || '').slice(0, 100), dept: query.dept, loc: query.loc, sort: query.sort, page: query.page, limit: query.limit });
  return { jobs: r.rows.map((row) => ({ ...serialize(row), places: row.places, mode: jobSearch.modeOf(row.posting) })), pagination: r.pagination, facets: r.facets, sort: r.sort };
}

async function get(slug, orgSlug) {
  const row = await jobSearch.findOpen({ orgSlug, slug });
  return row ? { job: serialize(row) } : { error: 'not_found' };
}

/** The slug behind a Job ID ("DLP-0001"), so /career/DLP-0001 can go to the real job page. */
async function slugForCode(code, orgSlug) {
  if (!JOB_CODE.test(String(code || ''))) return null;
  const row = await jobSearch.findOpen({ orgSlug, code });
  return row ? row.posting.slug : null;
}

async function apply(slug, body, orgSlug) {
  const d = applySchema.parse(body);
  const row = await jobSearch.findOpen({ orgSlug, slug });
  if (!row) return { error: 'not_found' };
  if (d.company_website) return { ok: true, stored: false }; // a bot: pretend it worked, store nothing
  const p = row.posting;
  // a company's own job (Hiring) keeps its applications in that company's table
  if (p.company_job) return hiring.recordApplication(p, d, screening);
  const known = ['linkedin', 'website', 'whatsapp', 'referral', 'naukri'];
  const referrer = await referrals.resolve({ ref: d.ref, referredBy: d.referred_by, orgId: p.org_id, applicantEmail: d.email });
  const referred = Boolean(referrer.referrer_id || referrer.referrer_text);
  const channel = referred ? 'referral' : d.channel ? (known.includes(d.channel) ? d.channel : 'other') : 'website';
  {
    const r = await applicantsService.addApplicant(null, {
      requirement_id: p.requirement_id, name: d.name, email: d.email, phone: d.phone, experience_years: d.experience_years, notes: d.message || '', channel,
      ...Object.fromEntries(Object.keys(screening.fields).map((k) => [k, d[k]])),
    }, { source: referred ? 'referral' : 'website', referrer });
    if (r.error === 'duplicate_applicant') return { error: 'already_applied' };
    if (r.error) return { error: 'not_found' };
    return { ok: true, job_code: p.job_code, title: p.title };
  }
}

module.exports = { list, search, get, apply, slugForCode };
