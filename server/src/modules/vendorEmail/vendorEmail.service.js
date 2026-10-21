const { z } = require('zod');
const prisma = require('../../config/db');
const { enqueue } = require('../../lib/email/outbox');

// Requirements -> vendors. From the Requirements page the team picks one or more requirements and the active vendors to send
// them to (filterable by specialization). The vendor's internal account owner is CC'd, the exact email is previewed before it
// goes, and every send is logged. The client's name is never put in the email.

const MAX_REQUIREMENTS = 20;
const MAX_VENDORS = 100;

const selection = z.object({
  requirement_ids: z.array(z.string().uuid()).min(1).max(MAX_REQUIREMENTS),
  vendor_ids: z.array(z.string().uuid()).min(1).max(MAX_VENDORS),
  message: z.string().trim().max(2000).optional().nullable(),
  subject: z.string().trim().min(3).max(200).optional(),
});

const listQuery = z.object({ specialization: z.string().trim().max(120).optional(), search: z.string().trim().max(100).optional() });

const vendorSelect = { id: true, name: true, poc_name: true, poc_email: true, vendor_specializations: true, owner: { select: { id: true, name: true, email: true } } };

/** Active vendors that can receive requirements, newest name first by A-Z, optionally by specialization or name. */
async function vendors(orgId, rawQuery) {
  const q = listQuery.parse(rawQuery || {});
  const rows = await prisma.account.findMany({
    where: {
      org_id: orgId, type: 'vendor', stage: 'active', is_project: false, deleted_at: null,
      ...(q.specialization ? { vendor_specializations: { has: q.specialization } } : {}),
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
    },
    select: vendorSelect,
    orderBy: { name: 'asc' },
    take: 500,
  });
  const specializations = await prisma.account.findMany({ where: { org_id: orgId, type: 'vendor', stage: 'active', deleted_at: null }, select: { vendor_specializations: true } });
  return {
    vendors: rows.map((v) => ({ id: v.id, name: v.name, contact_name: v.poc_name, email: v.poc_email, specializations: v.vendor_specializations, owner: v.owner ? { id: v.owner.id, name: v.owner.name, email: v.owner.email } : null, can_email: Boolean(v.poc_email) })),
    specializations: [...new Set(specializations.flatMap((s) => s.vendor_specializations))].sort(),
  };
}

const money = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const range = (a, b, unit) => (a != null && b != null ? `${Number(a)}-${Number(b)} ${unit}` : a != null ? `${Number(a)}+ ${unit}` : b != null ? `up to ${Number(b)} ${unit}` : null);

function describe(r) {
  const lines = [`${r.title}${r.seats_total > 1 ? ` (${r.seats_total} openings)` : ''}`];
  const bits = [
    ['Experience', range(r.experience_min, r.experience_max, 'years')],
    ['Skills', [...(r.primary_tech_stack || []), ...(r.secondary_tech_stack || [])].join(', ') || null],
    ['Location', [r.work_location, r.work_mode].filter(Boolean).join(', ') || null],
    ['Engagement', [r.engagement_type, r.contract_duration_months ? `${r.contract_duration_months} months` : null].filter(Boolean).join(', ') || null],
    ['Notice period', r.notice_period_max_days != null ? `up to ${r.notice_period_max_days} days` : null],
    ['Budget', r.budget_max != null ? `${r.budget_currency} ${r.budget_min != null ? `${money(r.budget_min)} - ` : 'up to '}${money(r.budget_max)}${r.budget_type ? ` (${String(r.budget_type).replace(/_/g, ' ')})` : ''}` : null],
    ['Job description', r.jd_document_url || null],
  ];
  for (const [label, value] of bits) if (value) lines.push(`   ${label}: ${value}`);
  return lines.join('\n');
}

function compose(requirements, sender, message) {
  const subject = requirements.length === 1 ? `Requirement: ${requirements[0].title}` : `${requirements.length} open requirements from Delphic`;
  const body = [
    'Hello,',
    '',
    message || (requirements.length === 1 ? 'We have the following requirement and would like to know if you have suitable profiles.' : 'We have the following requirements and would like to know if you have suitable profiles.'),
    '',
    ...requirements.map((r, i) => `${requirements.length > 1 ? `${i + 1}. ` : ''}${describe(r)}`).flatMap((t) => [t, '']),
    'Please reply with profiles, expected rates and availability.',
    '',
    'Thanks,',
    sender.name || 'Delphic recruitment team',
  ].join('\n');
  return { subject, body };
}

async function load(orgId, input) {
  const requirements = await prisma.requirement.findMany({
    where: { id: { in: input.requirement_ids }, org_id: orgId, deleted_at: null },
    orderBy: { created_at: 'asc' },
  });
  const accounts = await prisma.account.findMany({
    where: { id: { in: input.vendor_ids }, org_id: orgId, type: 'vendor', stage: 'active', is_project: false, deleted_at: null },
    select: vendorSelect,
  });
  return { requirements, accounts };
}

function plan(accounts, wantedIds) {
  const ready = [];
  const skipped = [];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const id of wantedIds) {
    const a = byId.get(id);
    if (!a) { skipped.push({ account_id: id, vendor: null, reason: 'Not an active vendor of this company' }); continue; }
    if (!a.poc_email) { skipped.push({ account_id: id, vendor: a.name, reason: 'No contact email on the vendor account' }); continue; }
    ready.push({ account_id: a.id, vendor: a.name, to: { email: a.poc_email, name: a.poc_name || a.name }, cc: a.owner?.email ? { email: a.owner.email, name: a.owner.name } : null });
  }
  return { ready, skipped };
}

/** What would be sent: the exact subject and text, and who gets it (with the CC), without sending anything. */
async function preview(orgId, user, rawInput) {
  const input = selection.parse(rawInput);
  const { requirements, accounts } = await load(orgId, input);
  if (requirements.length !== new Set(input.requirement_ids).size) return { error: 'requirement_not_found' };
  const { subject, body } = compose(requirements, user, input.message);
  const { ready, skipped } = plan(accounts, input.vendor_ids);
  return { subject: input.subject || subject, body_text: body, recipients: ready.map((r) => ({ account_id: r.account_id, vendor: r.vendor, to: r.to.email, cc: r.cc?.email || null })), skipped };
}

/** Queues one email per vendor (CC: the vendor's internal owner) and logs the send. The text is rebuilt here, never trusted from the browser. */
async function send(orgId, user, rawInput) {
  const input = selection.parse(rawInput);
  const { requirements, accounts } = await load(orgId, input);
  if (requirements.length !== new Set(input.requirement_ids).size) return { error: 'requirement_not_found' };
  const { subject: autoSubject, body } = compose(requirements, user, input.message);
  const subject = input.subject || autoSubject;
  const { ready, skipped } = plan(accounts, input.vendor_ids);
  if (!ready.length) return { error: 'no_recipients', skipped };
  const recipients = [];
  for (const r of ready) {
    const row = await enqueue(prisma, { orgId, kind: 'vendor_requirements', to: r.to, cc: r.cc, subject, text: body });
    recipients.push({ account_id: r.account_id, vendor: r.vendor, to: r.to.email, cc: r.cc?.email || null, outbox_id: row?.id || null });
  }
  const log = await prisma.vendorEmailLog.create({ data: { org_id: orgId, sent_by: user.id, sent_by_name: user.name || null, requirement_ids: input.requirement_ids, subject, body_text: body, recipients, skipped } });
  return { log: serialize(log), queued: recipients.length, skipped };
}

const serialize = (l) => ({ id: l.id, sent_by: l.sent_by_name, subject: l.subject, body_text: l.body_text, requirement_ids: l.requirement_ids, recipients: l.recipients, skipped: l.skipped, created_at: l.created_at });

async function log(orgId) {
  const rows = await prisma.vendorEmailLog.findMany({ where: { org_id: orgId }, orderBy: { created_at: 'desc' }, take: 100 });
  const outboxIds = rows.flatMap((r) => (r.recipients || []).map((x) => x.outbox_id)).filter(Boolean);
  const status = new Map((await prisma.emailOutbox.findMany({ where: { id: { in: outboxIds } }, select: { id: true, status: true } })).map((o) => [o.id, o.status]));
  return rows.map((r) => ({ ...serialize(r), recipients: (r.recipients || []).map((x) => ({ ...x, status: status.get(x.outbox_id) || 'unknown' })) }));
}

module.exports = { vendors, preview, send, log };
