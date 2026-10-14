const { z } = require('zod');
const prisma = require('../../config/db');
const applicantsService = require('../applicants/applicants.service');

// The public side of a published job: the page behind /careers/<slug>. Only the public copy of the posting is ever returned
// (title, department, location, type, description) - no client, budget or owner fields.

const OPEN = { status: 'published', requirement: { status: 'in_progress', deleted_at: null } };

const applySchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().nullable(),
  experience_years: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().min(0).max(70).optional()),
  message: z.string().trim().max(2000).optional().nullable(),
  // Where the visitor came from (the ?src= of the link). Anything unknown is stored as "other".
  channel: z.string().trim().toLowerCase().max(40).optional().nullable(),
  // Honeypot: real visitors never see this field; bots fill it.
  company_website: z.string().optional().nullable(),
});

const serialize = (p) => ({ slug: p.slug, title: p.title, department: p.department, location: p.location, employment_type: p.employment_type, description: p.public_description, posted_at: p.created_at });

async function list() {
  const rows = await prisma.websiteJobPosting.findMany({ where: { ...OPEN, slug: { not: null } }, orderBy: { created_at: 'desc' } });
  return rows.map(serialize);
}

async function get(slug) {
  const p = await prisma.websiteJobPosting.findFirst({ where: { slug: String(slug).toLowerCase(), ...OPEN } });
  return p ? { job: serialize(p) } : { error: 'not_found' };
}

async function apply(slug, body) {
  const d = applySchema.parse(body);
  const p = await prisma.websiteJobPosting.findFirst({ where: { slug: String(slug).toLowerCase(), ...OPEN }, select: { requirement_id: true } });
  if (!p) return { error: 'not_found' };
  if (d.company_website) return { ok: true }; // a bot: pretend it worked, store nothing
  const known = ['linkedin', 'website', 'whatsapp', 'referral', 'naukri'];
  const channel = d.channel ? (known.includes(d.channel) ? d.channel : 'other') : 'website';
  const r = await applicantsService.addApplicant(null, {
    requirement_id: p.requirement_id, name: d.name, email: d.email, phone: d.phone || '', experience_years: d.experience_years, notes: d.message || '', channel,
  }, { source: 'website' });
  if (r.error === 'duplicate_applicant') return { error: 'already_applied' };
  if (r.error) return { error: 'not_found' };
  return { ok: true };
}

module.exports = { list, get, apply };
