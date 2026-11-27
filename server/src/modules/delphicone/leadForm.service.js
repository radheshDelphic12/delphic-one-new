const crypto = require('crypto');
const { z } = require('zod');
const prisma = require('../../config/db');

// Delphic One > Leads > Lead form: a public link the team shares (website, email, social). Whoever opens it can leave their details;
// each submission becomes a lead (source website, stage new) in the workspace that owns the link. The link can be switched off or
// replaced; a hidden field catches simple bots.

const settingsSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  intro: z.string().trim().max(1000).nullable().optional(),
  active: z.boolean().optional(),
});
const opt = (n) => z.preprocess((v) => (v == null || String(v).trim() === '' ? undefined : String(v).trim()), z.string().max(n).optional());
const submitSchema = z.object({
  company_name: z.string().trim().min(1, 'Your company name').max(150),
  contact_name: z.string().trim().min(1, 'Your name').max(120),
  contact_email: z.string().trim().toLowerCase().email('A valid email'),
  contact_phone: opt(40),
  users_expected: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().min(0).max(100000).optional()),
  message: opt(3000),
  website: opt(200), // the hidden field: people leave it empty
});

const newToken = () => crypto.randomBytes(18).toString('base64url');
const view = (f) => (f ? { id: f.id, token: f.token, title: f.title, intro: f.intro, active: f.active, submissions: f.submissions, created_at: f.created_at } : null);

async function current(orgId) {
  return view(await prisma.publicLeadForm.findFirst({ where: { org_id: orgId }, orderBy: { created_at: 'desc' } }));
}

/** Make the link (the first time) or a new link that replaces the old one (the old link stops working). */
async function renew(orgId, userId) {
  const old = await prisma.publicLeadForm.findFirst({ where: { org_id: orgId }, orderBy: { created_at: 'desc' } });
  if (old) await prisma.publicLeadForm.update({ where: { id: old.id }, data: { active: false } });
  const row = await prisma.publicLeadForm.create({ data: { org_id: orgId, token: newToken(), title: old?.title || 'Talk to us', intro: old?.intro || null, created_by: userId } });
  return view(row);
}

async function update(orgId, input) {
  const row = await prisma.publicLeadForm.findFirst({ where: { org_id: orgId }, orderBy: { created_at: 'desc' } });
  if (!row) return { error: 'not_found' };
  return { form: view(await prisma.publicLeadForm.update({ where: { id: row.id }, data: input })) };
}

/** What the public page shows: the title, intro and the company's name. Nothing when the link is off or unknown. */
async function publicForm(token) {
  const f = await prisma.publicLeadForm.findUnique({ where: { token } });
  if (!f || !f.active) return null;
  const org = await prisma.org.findUnique({ where: { id: f.org_id }, select: { name: true, enabled_modules: true } });
  if (!org?.enabled_modules?.includes('delphic_one')) return null;
  return { title: f.title, intro: f.intro, company: org.name };
}

async function submit(token, input) {
  const f = await prisma.publicLeadForm.findUnique({ where: { token } });
  if (!f || !f.active) return { error: 'not_found' };
  if (input.website) return { ok: true }; // a bot filled the hidden field: answer as if it worked, keep nothing
  const notes = [input.message, `Sent through the lead form "${f.title}".`].filter(Boolean).join('\n\n');
  const lead = await prisma.doxLead.create({
    data: {
      org_id: f.org_id, company_name: input.company_name, contact_name: input.contact_name, contact_email: input.contact_email, contact_phone: input.contact_phone || null,
      users_expected: input.users_expected ?? null, source: 'website', stage: 'new', notes,
    },
  });
  await prisma.publicLeadForm.update({ where: { id: f.id }, data: { submissions: { increment: 1 } } });
  return { ok: true, lead_id: lead.id };
}

module.exports = { settingsSchema, submitSchema, current, renew, update, publicForm, submit };
