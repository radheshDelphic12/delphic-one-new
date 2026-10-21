const { z } = require('zod');
const prisma = require('../../config/db');
const applicantsService = require('../applicants/applicants.service');
const screening = require('../applicants/screening');

// The public side of a published job: the page behind /careers/<slug>. Only the public copy of the posting is ever returned
// (title, department, location, type, description) - no client, budget or owner fields.

const OPEN = { status: 'published', requirement: { status: 'in_progress', deleted_at: null } };
// With an org slug (the /<org>/career pages) only that company's jobs are visible.
const openFor = (orgSlug) => (orgSlug ? { ...OPEN, org: { slug: orgSlug } } : OPEN);

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
  // Honeypot: real visitors never see this field; bots fill it.
  company_website: z.string().optional().nullable(),
  // screening answers: most are required here, so the recruiters can filter the pool
  ...screening.fields,
}).superRefine((d, ctx) => {
  screening.requireScreening(d, ctx);
  screening.checkScreening(d, ctx);
  // the public form takes the CV as a Google Drive link only (recruiters may still paste any link by hand)
  if (d.cv_url && !screening.isDriveUrl(d.cv_url)) ctx.addIssue({ code: 'custom', path: ['cv_url'], message: 'Enter a Google Drive link to your CV (drive.google.com/...)' });
});

const serialize = (p) => ({ slug: p.slug, title: p.title, department: p.department, location: p.location, employment_type: p.employment_type, description: p.public_description, posted_at: p.created_at });

async function list(orgSlug) {
  const rows = await prisma.websiteJobPosting.findMany({ where: { ...openFor(orgSlug), slug: { not: null } }, orderBy: { created_at: 'desc' } });
  return rows.map(serialize);
}

async function get(slug, orgSlug) {
  const p = await prisma.websiteJobPosting.findFirst({ where: { slug: String(slug).toLowerCase(), ...openFor(orgSlug) } });
  return p ? { job: serialize(p) } : { error: 'not_found' };
}

async function apply(slug, body, orgSlug) {
  const d = applySchema.parse(body);
  const p = await prisma.websiteJobPosting.findFirst({ where: { slug: String(slug).toLowerCase(), ...openFor(orgSlug) }, select: { requirement_id: true } });
  if (!p) return { error: 'not_found' };
  if (d.company_website) return { ok: true, stored: false }; // a bot: pretend it worked, store nothing
  const known = ['linkedin', 'website', 'whatsapp', 'referral', 'naukri'];
  const channel = d.channel ? (known.includes(d.channel) ? d.channel : 'other') : 'website';
  const r = await applicantsService.addApplicant(null, {
    requirement_id: p.requirement_id, name: d.name, email: d.email, phone: d.phone, experience_years: d.experience_years, notes: d.message || '', channel,
    ...Object.fromEntries(Object.keys(screening.fields).map((k) => [k, d[k]])),
  }, { source: 'website' });
  if (r.error === 'duplicate_applicant') return { error: 'already_applied' };
  if (r.error) return { error: 'not_found' };
  return { ok: true };
}

module.exports = { list, get, apply };
