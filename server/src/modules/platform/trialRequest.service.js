const { z } = require('zod');
const prisma = require('../../config/db');
const platform = require('./platform.service');

// "Request a trial" on the public website (SaaS launch plan, phase 3). A visitor leaves their details and a lead appears in the Delphic One workspace
// (Leads, source "website", unassigned) for Sales to call; Sales converts it to a customer and creates the trial workspace from there.
// The form is closed until a platform admin opens it (platform setting `trial_form_open`, 0 = closed, 1 = open), so no public door exists by default.

const text = (max) => z.string().trim().max(max);
const schema = z.object({
  company_name: text(150).min(1, 'Please tell us your company name'),
  contact_name: text(120).min(1, 'Please tell us your name'),
  email: z.string().trim().toLowerCase().email().max(150),
  phone: text(40).optional().default(''),
  users_expected: z.coerce.number().int().min(1).max(100000).optional(),
  message: text(1500).optional().default(''),
  website: text(200).optional().default(''), // honeypot: a real visitor never fills this in (it is hidden on the page)
});

async function delphicOneOrg() {
  const rows = await prisma.org.findMany({ where: { enabled_modules: { has: 'delphic_one' }, status: 'active' }, select: { id: true }, take: 1 });
  return rows[0] || null;
}

// { error } or { received: true }. A honeypot hit is answered like a success so a bot learns nothing.
async function receive(input) {
  if ((await platform.settingNumber('trial_form_open', 0)) !== 1) return { error: 'closed' };
  const body = schema.parse(input);
  if (body.website) return { received: true };
  const org = await delphicOneOrg();
  if (!org) return { error: 'closed' };

  // the same person asking twice within 30 days adds a note to their open lead instead of a second lead
  const since = new Date(Date.now() - 30 * 86400000);
  const existing = await prisma.doxLead.findFirst({ where: { org_id: org.id, contact_email: body.email, deleted_at: null, created_at: { gte: since }, stage: { notIn: ['won', 'lost'] } } });
  const note = `Trial request from the website${body.users_expected ? ` (about ${body.users_expected} users)` : ''}${body.message ? `: ${body.message}` : ''}`;
  if (existing) {
    await prisma.doxLeadNote.create({ data: { org_id: org.id, lead_id: existing.id, note: `Asked again. ${note}` } });
    return { received: true };
  }
  await prisma.$transaction(async (tx) => {
    const lead = await tx.doxLead.create({
      data: { org_id: org.id, company_name: body.company_name, contact_name: body.contact_name, contact_email: body.email, contact_phone: body.phone || null, source: 'website', stage: 'new', users_expected: body.users_expected ?? null, notes: body.message || null },
    });
    await tx.doxLeadNote.create({ data: { org_id: org.id, lead_id: lead.id, note } });
  });
  return { received: true };
}

module.exports = { receive, schema };
