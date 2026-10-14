const { z } = require('zod');
const prisma = require('../../config/db');
const applicantsService = require('../applicants/applicants.service');

// Internal job board: every employee of the master workspace sees the jobs that are published on the website, can refer
// someone (a friend, an ex-colleague) or apply for one themselves (for example from the bench). Both land in the same applicant
// pool as website applications - source "referral" or "internal" - so recruiters work one list. No new table.

const OPEN = { status: 'published', requirement: { status: 'in_progress', deleted_at: null } };
const referSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().nullable(),
  experience_years: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().min(0).max(70).optional()),
  message: z.string().trim().max(2000).optional().nullable(),
});
const applySchema = z.object({ phone: z.string().trim().max(40).optional().nullable(), experience_years: referSchema.shape.experience_years, message: z.string().trim().max(2000).optional().nullable() });

const serialize = (p) => ({ slug: p.slug, title: p.title, department: p.department, location: p.location, employment_type: p.employment_type, description: p.public_description, posted_at: p.created_at });

async function list(user) {
  const rows = await prisma.websiteJobPosting.findMany({ where: { ...OPEN, slug: { not: null } }, orderBy: { created_at: 'desc' } });
  const mine = await prisma.jobApplicant.findMany({
    where: { requirement_id: { in: rows.map((r) => r.requirement_id) }, OR: [{ created_by: user.id }, ...(user.email ? [{ email: { equals: user.email, mode: 'insensitive' } }] : [])] },
    select: { requirement_id: true, source: true, email: true },
  });
  return rows.map((p) => {
    const mineHere = mine.filter((m) => m.requirement_id === p.requirement_id);
    return {
      ...serialize(p),
      applied: mineHere.some((m) => m.source === 'internal'),
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
  }, { source: 'referral' });
  return r.error === 'duplicate_applicant' ? { error: 'already_applied' } : r.error ? { error: 'not_found' } : { ok: true };
}

async function applyMyself(user, slug, body) {
  const d = applySchema.parse(body || {});
  const p = await posting(slug);
  if (!p) return { error: 'not_found' };
  const r = await applicantsService.addApplicant(user, {
    requirement_id: p.requirement_id, name: user.name || user.email, email: user.email, phone: d.phone || '', experience_years: d.experience_years,
    notes: `Internal application${d.message ? `: ${d.message}` : ''}`, channel: 'internal',
  }, { source: 'internal' });
  return r.error === 'duplicate_applicant' ? { error: 'already_applied' } : r.error ? { error: 'not_found' } : { ok: true };
}

module.exports = { list, refer, applyMyself };
