const { z } = require('zod');
const prisma = require('../../config/db');
const render = require('./letters.render');

// HR letters (docs/features/HR-LETTERS.md): admin-set templates, a unique serial number per letter, and every letter issued kept with its own text.
// Letters are per company (the caller's active workspace). A letter is never edited after it is issued: it is cancelled with a reason.

const KINDS = ['offer', 'appointment', 'appraisal', 'relieving', 'experience', 'warning', 'other'];
const AUDIENCES = ['any', 'employee', 'new_joiner', 'left_employee', 'vendor', 'other'];
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31');
const text = (max) => z.string().trim().max(max);

const templateSchema = z.object({
  name: text(120).min(1, 'Give the template a name'),
  kind: z.string().trim().toLowerCase().min(1).max(40).default('other'),
  audience: z.enum(AUDIENCES).default('any'),
  subject: text(200).nullable().optional(),
  body: z.string().trim().min(1, 'The letter text is empty').max(20000),
  signatory_name: text(120).nullable().optional(),
  signatory_title: text(120).nullable().optional(),
  serial_prefix: text(12).min(1).max(12).regex(/^[A-Za-z0-9-]+$/, 'The prefix can hold letters, digits and a dash').default('LTR'),
  serial_format: text(60).default('{PREFIX}/{FY}/{SEQ:4}'),
  active: z.boolean().optional(),
});
const templateUpdateSchema = templateSchema.partial();

const recipientSchema = z.object({
  type: z.enum(['employee', 'vendor', 'candidate', 'other']),
  org_membership_id: z.string().uuid().optional(),
  account_id: z.string().uuid().optional(),
  name: text(200).optional(),
  email: text(200).nullable().optional(),
  address: text(500).nullable().optional(),
});
const letterInputSchema = z.object({
  template_id: z.string().uuid(),
  recipient: recipientSchema,
  fields: z.record(z.string().max(80), z.string().max(2000)).default({}),
  issued_on: day.optional(),
});

const todayStr = () => new Date().toISOString().slice(0, 10);
const toDate = (v) => new Date(`${v}T00:00:00.000Z`);
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

function viewTemplate(t) {
  return {
    id: t.id, name: t.name, kind: t.kind, audience: t.audience, subject: t.subject, body: t.body, signatory_name: t.signatory_name, signatory_title: t.signatory_title,
    serial_prefix: t.serial_prefix, serial_format: t.serial_format, active: t.active, fields: render.fieldsIn(t.subject, t.body), example_serial: exampleSerial(t), updated_at: t.updated_at,
  };
}
function exampleSerial(t) {
  const { build } = render.serialParts(t.serial_format, { prefix: t.serial_prefix, issuedOn: new Date() });
  return build(1);
}
const viewLetter = (l, { withBody = false } = {}) => ({
  id: l.id, serial_number: l.serial_number, kind: l.kind, template_name: l.template_name, recipient_type: l.recipient_type, recipient_name: l.recipient_name, recipient_email: l.recipient_email,
  org_membership_id: l.org_membership_id, account_id: l.account_id, issued_on: ymd(l.issued_on), status: l.status, cancelled_reason: l.cancelled_reason, created_at: l.created_at,
  ...(withBody ? { subject: l.subject, body: l.body, fields: l.fields, recipient_address: l.recipient_address, signatory_name: l.signatory_name, signatory_title: l.signatory_title } : {}),
});

// ---- templates ---------------------------------------------------------------------------------------------------------------

async function listTemplates(orgId, { includeInactive = false } = {}) {
  const rows = await prisma.letterTemplate.findMany({ where: { org_id: orgId, deleted_at: null, ...(includeInactive ? {} : { active: true }) }, orderBy: [{ kind: 'asc' }, { name: 'asc' }] });
  return rows.map(viewTemplate);
}

async function createTemplate(orgId, user, body) {
  const bad = render.checkSerialFormat(body.serial_format);
  if (bad) return { error: 'bad_serial_format', message: bad };
  const row = await prisma.letterTemplate.create({ data: { ...body, org_id: orgId, created_by: user.id } });
  return { template: viewTemplate(row) };
}

async function updateTemplate(orgId, id, body) {
  const existing = await prisma.letterTemplate.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!existing) return { error: 'not_found' };
  if (body.serial_format !== undefined) {
    const bad = render.checkSerialFormat(body.serial_format);
    if (bad) return { error: 'bad_serial_format', message: bad };
  }
  const row = await prisma.letterTemplate.update({ where: { id }, data: body });
  return { template: viewTemplate(row) };
}

async function removeTemplate(orgId, id) {
  const existing = await prisma.letterTemplate.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!existing) return { error: 'not_found' };
  await prisma.letterTemplate.update({ where: { id }, data: { deleted_at: new Date(), active: false } }); // issued letters keep their own text
  return { deleted: true };
}

/** What the editor offers: the fields that fill themselves and the serial tokens. */
function fieldCatalog() {
  return {
    common: render.COMMON_FIELDS.map(([key, label]) => ({ key, label })),
    employee: render.EMPLOYEE_FIELDS.map(([key, label]) => ({ key, label })),
    recipient: render.RECIPIENT_FIELDS.map(([key, label]) => ({ key, label })),
    serial_tokens: [['{PREFIX}', 'the template prefix, e.g. OFR'], ['{FY}', 'financial year, e.g. 2026-27'], ['{YYYY}', 'year, e.g. 2026'], ['{YY}', 'year, e.g. 26'], ['{MM}', 'month, e.g. 11'], ['{SEQ:4}', 'running number, 4 digits']].map(([token, label]) => ({ token, label })),
    kinds: KINDS,
    audiences: AUDIENCES,
  };
}

// ---- recipients --------------------------------------------------------------------------------------------------------------

async function searchRecipients(orgId, { type = 'employee', q = '' } = {}) {
  const term = String(q).trim();
  if (type === 'vendor') {
    const rows = await prisma.account.findMany({ where: { org_id: orgId, type: 'vendor', ...(term ? { name: { contains: term, mode: 'insensitive' } } : {}) }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 30 });
    return rows.map((a) => ({ type: 'vendor', account_id: a.id, name: a.name }));
  }
  const rows = await prisma.orgMembership.findMany({
    where: { org_id: orgId, ...(term ? { OR: [{ person: { name: { contains: term, mode: 'insensitive' } } }, { employee_code: { contains: term, mode: 'insensitive' } }] } : {}) },
    select: { id: true, employee_code: true, employment_status: true, joined_at: true, left_at: true, designation: { select: { name: true } }, person: { select: { name: true } } },
    orderBy: { joined_at: 'desc' }, take: 30,
  });
  return rows.map((m) => ({ type: 'employee', org_membership_id: m.id, name: m.person?.name || '', employee_code: m.employee_code, designation: m.designation?.name || null, joined_at: ymd(m.joined_at), left_at: ymd(m.left_at), status: m.left_at ? 'left' : m.employment_status }));
}

/** The values a recipient's record gives, plus the recipient block. Returns { values, recipient } or { error }. */
async function resolveRecipient(orgId, r) {
  if (r.type === 'employee') {
    if (!r.org_membership_id) return { error: 'recipient_required' };
    const m = await prisma.orgMembership.findFirst({
      where: { id: r.org_membership_id, org_id: orgId },
      select: { id: true, employee_code: true, joined_at: true, left_at: true, designation: { select: { name: true } }, department: { select: { name: true } }, person: { select: { name: true, email: true } }, manager: { select: { person: { select: { name: true } } } } },
    });
    if (!m) return { error: 'recipient_not_found' };
    return {
      recipient: { type: 'employee', org_membership_id: m.id, name: m.person?.name || '', email: m.person?.email || null, address: r.address || null },
      values: {
        employee_name: m.person?.name, employee_code: m.employee_code, designation: m.designation?.name, department: m.department?.name, joining_date: render.longDate(m.joined_at),
        last_working_day: render.longDate(m.left_at), manager_name: m.manager?.person?.name, work_email: m.person?.email,
      },
    };
  }
  if (r.type === 'vendor') {
    if (!r.account_id) return { error: 'recipient_required' };
    const a = await prisma.account.findFirst({ where: { id: r.account_id, org_id: orgId, type: 'vendor' }, select: { id: true, name: true } });
    if (!a) return { error: 'recipient_not_found' };
    return { recipient: { type: 'vendor', account_id: a.id, name: a.name, email: r.email || null, address: r.address || null }, values: {} };
  }
  if (!r.name || !r.name.trim()) return { error: 'recipient_required' };
  return { recipient: { type: r.type, name: r.name.trim(), email: r.email || null, address: r.address || null }, values: {} };
}

/** Everything a letter is built from (shared by preview and issue). */
async function compose(orgId, input, { serial } = {}) {
  const template = await prisma.letterTemplate.findFirst({ where: { id: input.template_id, org_id: orgId, deleted_at: null } });
  if (!template) return { error: 'template_not_found' };
  if (!template.active) return { error: 'template_inactive' };
  const resolved = await resolveRecipient(orgId, input.recipient);
  if (resolved.error) return { error: resolved.error };
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { name: true } });
  const issuedOn = input.issued_on || todayStr();
  const typed = Object.fromEntries(Object.entries(input.fields || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const values = {
    ...resolved.values,
    company_name: org?.name, date: render.longDate(issuedOn), serial_number: serial || '[serial number]',
    recipient_name: resolved.recipient.name, recipient_email: resolved.recipient.email, recipient_address: resolved.recipient.address,
    ...Object.fromEntries(Object.entries(typed).filter(([, v]) => String(v).trim() !== '')), // what HR typed wins over the record
  };
  const subject = render.fill(template.subject || '', values);
  const body = render.fill(template.body, values);
  const missing = [...new Set([...subject.missing, ...body.missing])].filter((k) => k !== 'serial_number');
  const needs = render.fieldsIn(template.subject, template.body);
  return { template, recipient: resolved.recipient, issuedOn, values, subject: subject.text, body: body.text, missing, needs, manual: needs.filter((k) => !(k in resolved.values) && !['company_name', 'date', 'serial_number', 'recipient_name', 'recipient_email', 'recipient_address'].includes(k)) };
}

async function preview(orgId, input) {
  const c = await compose(orgId, input);
  if (c.error) return { error: c.error };
  const { build } = render.serialParts(c.template.serial_format, { prefix: c.template.serial_prefix, issuedOn: toDate(c.issuedOn) });
  return { preview: { subject: c.subject, body: c.body, missing: c.missing, fields_needed: c.needs, fields_to_type: c.manual, example_serial: build(1), recipient: c.recipient, issued_on: c.issuedOn } };
}

// ---- issuing -----------------------------------------------------------------------------------------------------------------

/** Next number of a series, atomically: two HR people issuing at once never get the same one. */
async function nextNumber(tx, orgId, series) {
  const rows = await tx.$queryRaw`
    INSERT INTO letter_counters (org_id, series, last_number) VALUES (${orgId}::uuid, ${series}, 1)
    ON CONFLICT (org_id, series) DO UPDATE SET last_number = letter_counters.last_number + 1
    RETURNING last_number`;
  return Number(rows[0].last_number);
}

async function issue(orgId, user, input) {
  const first = await compose(orgId, input);
  if (first.error) return { error: first.error };
  if (first.missing.length) return { error: 'missing_fields', missing: first.missing };
  const { series, build } = render.serialParts(first.template.serial_format, { prefix: first.template.serial_prefix, issuedOn: toDate(first.issuedOn) });
  const letter = await prisma.$transaction(async (tx) => {
    const seq = await nextNumber(tx, orgId, series);
    const serial = build(seq);
    const done = await compose(orgId, input, { serial });
    return tx.letter.create({
      data: {
        org_id: orgId, template_id: first.template.id, template_name: first.template.name, kind: first.template.kind, serial_number: serial, serial_series: series, serial_seq: seq,
        recipient_type: done.recipient.type, org_membership_id: done.recipient.org_membership_id || null, account_id: done.recipient.account_id || null,
        recipient_name: done.recipient.name, recipient_email: done.recipient.email || null, recipient_address: done.recipient.address || null,
        fields: Object.fromEntries(Object.entries(done.values).filter(([, v]) => v !== undefined && v !== null)),
        subject: done.subject || null, body: done.body, signatory_name: first.template.signatory_name, signatory_title: first.template.signatory_title,
        issued_on: toDate(done.issuedOn), created_by: user.id,
      },
    });
  });
  return { letter: viewLetter(letter, { withBody: true }) };
}

async function list(orgId, q = {}) {
  const rows = await prisma.letter.findMany({
    where: {
      org_id: orgId,
      ...(q.kind ? { kind: q.kind } : {}), ...(q.status ? { status: q.status } : {}), ...(q.org_membership_id ? { org_membership_id: q.org_membership_id } : {}), ...(q.account_id ? { account_id: q.account_id } : {}),
      ...(q.from || q.to ? { issued_on: { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) } } : {}),
      ...(q.q ? { OR: [{ serial_number: { contains: q.q, mode: 'insensitive' } }, { recipient_name: { contains: q.q, mode: 'insensitive' } }, { template_name: { contains: q.q, mode: 'insensitive' } }] } : {}),
    },
    orderBy: [{ issued_on: 'desc' }, { created_at: 'desc' }], take: 500,
  });
  return rows.map((l) => viewLetter(l));
}

async function get(orgId, id) {
  const l = await prisma.letter.findFirst({ where: { id, org_id: orgId } });
  return l ? { letter: viewLetter(l, { withBody: true }), raw: l } : null;
}

async function cancel(orgId, user, id, reason) {
  const l = await prisma.letter.findFirst({ where: { id, org_id: orgId } });
  if (!l) return { error: 'not_found' };
  if (l.status === 'cancelled') return { error: 'already_cancelled' };
  const row = await prisma.letter.update({ where: { id }, data: { status: 'cancelled', cancelled_reason: reason, cancelled_by: user.id, cancelled_at: new Date() } });
  return { letter: viewLetter(row, { withBody: true }) };
}

module.exports = {
  KINDS, AUDIENCES, templateSchema, templateUpdateSchema, letterInputSchema, recipientSchema,
  listTemplates, createTemplate, updateTemplate, removeTemplate, fieldCatalog, searchRecipients, preview, issue, list, get, cancel, viewLetter,
};
