const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { z } = require('zod');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const prisma = require('../../config/db');
const { projectListWhere } = require('../../lib/projectScope');
const env = require('../../config/env');
const storage = require('../storage/storage.service');
const { enqueue } = require('../../lib/email/outbox');

// Document Centre (docs/features/DOCUMENT-CENTRE.md):
//  1. what each client, vendor and employee should have on file, and what is missing ("?"), from the documents already uploaded;
//  2. documents waiting to be signed: someone uploads a PDF and tags it, the signer places their signature on it (drag and drop), the signed
//     PDF can be downloaded or attached to the client / vendor / employee it was tagged for;
//  3. how much storage all this takes, and a clean-up that removes the originals of documents already dealt with.
// Files live in private folders of the uploads directory (signing/, signatures/) and are read only through the routes of this module.

const KINDS = ['client', 'vendor', 'employee', 'project'];
const TAGS = ['client', 'vendor', 'employee', 'invoice', 'other'];
const DEFAULTS = { client: ['Agreement'], vendor: ['Agreement'], employee: ['Offer / appointment letter', 'ID proof', 'Address proof'], project: ['Agreement'] };
const WORKING = ['active', 'on_leave', 'notice_period'];
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_SIGNATURE_BYTES = 600 * 1024;
const STALE_DAYS = 14;

const uploadRoot = () => path.resolve(env.uploadDir);
const signingDir = () => path.join(uploadRoot(), 'signing');
const signaturesDir = () => path.join(uploadRoot(), 'signatures');
const ensure = (dir) => fs.mkdirSync(dir, { recursive: true });
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const sizeOf = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };
const safeUnlink = (p) => { try { if (p) fs.unlinkSync(p); return true; } catch { return false; } };

// ---------------------------------------------------------------------------------------------------------------------------
// What must be on file (admin-editable)

const requirementSchema = z.object({ kind: z.enum(KINDS), name: z.string().trim().min(1, 'Give it a name').max(80) });

async function ensureRequirements(orgId) {
  // each kind gets its defaults the first time it has no list at all (a kind added later, like projects, too)
  const counts = await prisma.documentRequirement.groupBy({ by: ['kind'], where: { org_id: orgId }, _count: { _all: true } });
  const have = new Set(counts.map((c) => c.kind));
  const rows = [];
  for (const kind of KINDS) if (!have.has(kind)) DEFAULTS[kind].forEach((name, i) => rows.push({ org_id: orgId, kind, name, sort_order: i }));
  if (rows.length) await prisma.documentRequirement.createMany({ data: rows, skipDuplicates: true });
}

async function listRequirements(orgId) {
  await ensureRequirements(orgId);
  const rows = await prisma.documentRequirement.findMany({ where: { org_id: orgId, active: true }, orderBy: [{ kind: 'asc' }, { sort_order: 'asc' }, { name: 'asc' }] });
  return rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name }));
}

async function addRequirement(orgId, input) {
  await ensureRequirements(orgId);
  const existing = await prisma.documentRequirement.findUnique({ where: { org_id_kind_name: { org_id: orgId, kind: input.kind, name: input.name } } });
  if (existing?.active) return { error: 'requirement_exists' };
  if (existing) {
    const row = await prisma.documentRequirement.update({ where: { id: existing.id }, data: { active: true } });
    return { requirement: { id: row.id, kind: row.kind, name: row.name } };
  }
  const last = await prisma.documentRequirement.findFirst({ where: { org_id: orgId, kind: input.kind }, orderBy: { sort_order: 'desc' } });
  const row = await prisma.documentRequirement.create({ data: { org_id: orgId, kind: input.kind, name: input.name, sort_order: (last?.sort_order ?? -1) + 1 } });
  return { requirement: { id: row.id, kind: row.kind, name: row.name } };
}

async function renameRequirement(orgId, id, name) {
  const row = await prisma.documentRequirement.findFirst({ where: { id, org_id: orgId } });
  if (!row) return { error: 'not_found' };
  const clash = await prisma.documentRequirement.findFirst({ where: { org_id: orgId, kind: row.kind, name, id: { not: id } } });
  if (clash) return { error: 'requirement_exists' };
  // files tagged with the old name follow the new one
  await prisma.$transaction([
    prisma.documentRequirement.update({ where: { id }, data: { name } }),
    prisma.document.updateMany({ where: { doc_type: row.name, entity_type: { in: row.kind === 'employee' ? ['org_membership'] : ['account'] } }, data: { doc_type: name } }),
  ]);
  return { requirement: { id, kind: row.kind, name } };
}

async function removeRequirement(orgId, id) {
  const row = await prisma.documentRequirement.findFirst({ where: { id, org_id: orgId } });
  if (!row) return { error: 'not_found' };
  await prisma.documentRequirement.update({ where: { id }, data: { active: false } }); // files already uploaded are kept
  return { removed: true };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The overview: who has what on file

const overviewQuery = z.object({
  kind: z.enum(KINDS).default('client'),
  q: z.string().trim().max(100).optional(),
  missing_only: z.preprocess((v) => v === true || v === 'true' || v === '1' || v === 1, z.boolean()).default(false),
  stage: z.enum(['active', 'all']).default('active'),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
const LIMIT = 400;

/** A requirement is on file when a document is tagged with its name, or (an older file with no tag) its label says so; an agreement link on the account counts too. */
function matches(requirement, doc) {
  const want = norm(requirement);
  if (doc.doc_type) return norm(doc.doc_type) === want;
  return norm(doc.label).includes(want);
}

async function overview(orgId, query) {
  await ensureRequirements(orgId);
  const { kind, q, missing_only: missingOnly, stage } = query;
  const now = new Date();
  const month = query.month || now.getUTCMonth() + 1;
  const year = query.year || now.getUTCFullYear();
  const reqs = (await prisma.documentRequirement.findMany({ where: { org_id: orgId, kind, active: true }, orderBy: [{ sort_order: 'asc' }, { name: 'asc' }] })).map((r) => r.name);

  let entities;
  let entityType;
  if (kind === 'employee') {
    entityType = 'org_membership';
    const rows = await prisma.orgMembership.findMany({
      where: { org_id: orgId, employment_status: { in: WORKING }, ...(q ? { person: { name: { contains: q, mode: 'insensitive' } } } : {}) },
      select: { id: true, employee_code: true, worker_type: true, designation: { select: { name: true } }, person: { select: { name: true } } },
      orderBy: { person: { name: 'asc' } },
      take: LIMIT + 1,
    });
    entities = rows.map((m) => ({ id: m.id, name: m.person?.name || '', sub: [m.employee_code, m.designation?.name, m.worker_type === 'contractor' ? 'Contractor' : null].filter(Boolean).join(' · '), link: null }));
  } else if (kind === 'project') {
    // projects (Finance > Projects: flagged projects and the older ones Finance lists): the agreement uploaded on the project itself
    entityType = 'account';
    const rows = await prisma.account.findMany({
      where: { AND: [projectListWhere(orgId), ...(q ? [{ OR: [{ name: { contains: q, mode: 'insensitive' } }, { project_name: { contains: q, mode: 'insensitive' } }] }] : [])] },
      select: { id: true, name: true, project_name: true, client_name: true, client_agreement_url: true, contract_status: true, agreement_end_date: true, client_account: { select: { name: true } } },
      orderBy: { name: 'asc' },
      take: LIMIT + 1,
    });
    entities = rows.map((a) => ({ id: a.id, name: a.project_name || a.name, sub: [a.client_account?.name || a.client_name, a.contract_status && a.contract_status !== 'active' ? a.contract_status : null, a.agreement_end_date ? `agreement ends ${ymd(a.agreement_end_date)}` : null].filter(Boolean).join(' · '), agreement_link: a.client_agreement_url }));
  } else {
    entityType = 'account';
    const rows = await prisma.account.findMany({
      where: { org_id: orgId, type: kind, is_project: false, ...(stage === 'active' ? { stage: 'active' } : {}), ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      select: { id: true, name: true, stage: true, client_agreement_url: true, vendor_agreement_url: true, owner: { select: { name: true } } },
      orderBy: { name: 'asc' },
      take: LIMIT + 1,
    });
    entities = rows.map((a) => ({ id: a.id, name: a.name, sub: [a.stage === 'active' ? null : a.stage, a.owner?.name ? `POC ${a.owner.name}` : null].filter(Boolean).join(' · '), agreement_link: kind === 'client' ? a.client_agreement_url : a.vendor_agreement_url }));
  }
  const truncated = entities.length > LIMIT;
  entities = entities.slice(0, LIMIT);
  const ids = entities.map((e) => e.id);
  const docs = ids.length ? await prisma.document.findMany({ where: { entity_type: entityType, entity_id: { in: ids } }, orderBy: { uploaded_at: 'desc' }, select: { id: true, entity_id: true, label: true, doc_type: true, file_url: true, uploaded_at: true } }) : [];
  const byEntity = new Map();
  for (const d of docs) byEntity.set(d.entity_id, [...(byEntity.get(d.entity_id) || []), d]);

  // clients: files uploaded on the client's projects (Finance > Projects > Client agreements) count as on file for the client too.
  // A project points to its client by account, or (older projects) only by the client's name.
  const projectLink = new Map(); // client id -> agreement link of one of its projects
  if (kind === 'client' && ids.length) {
    // the same rule Finance > Projects uses: flagged projects and older ones that predate the flag (they have billing rates, timesheets ...)
    const projects = await prisma.account.findMany({
      where: projectListWhere(orgId),
      select: { id: true, name: true, project_name: true, client_name: true, client_account_id: true, client_agreement_url: true },
    });
    const clientByName = new Map(entities.map((e) => [norm(e.name), e.id]));
    const owner = new Map(); // project id -> client id
    for (const pr of projects) {
      let clientId = pr.client_account_id && ids.includes(pr.client_account_id) ? pr.client_account_id : (!pr.client_account_id && pr.client_name ? clientByName.get(norm(pr.client_name)) : null);
      if (clientId === pr.id) clientId = null; // a client that is its own project already shows its own files
      if (clientId) owner.set(pr.id, { clientId, label: pr.project_name || pr.name, link: pr.client_agreement_url });
    }
    if (owner.size) {
      const projectDocs = await prisma.document.findMany({ where: { entity_type: 'account', entity_id: { in: [...owner.keys()] } }, orderBy: { uploaded_at: 'desc' }, select: { id: true, entity_id: true, label: true, doc_type: true, file_url: true, uploaded_at: true } });
      for (const d of projectDocs) {
        const o = owner.get(d.entity_id);
        byEntity.set(o.clientId, [...(byEntity.get(o.clientId) || []), { ...d, project: o.label }]);
      }
      for (const o of owner.values()) if (o.link && !projectLink.has(o.clientId)) projectLink.set(o.clientId, { url: o.link, label: o.label });
    }
  }

  // vendors: the month's invoices and whether each has a file
  let invoiceByVendor = new Map();
  if (kind === 'vendor' && ids.length) {
    const invoices = await prisma.projectVendorInvoice.findMany({ where: { org_id: orgId, vendor_account_id: { in: ids }, period_month: month, period_year: year }, select: { id: true, vendor_account_id: true } });
    const files = invoices.length ? await prisma.document.findMany({ where: { entity_type: 'project_vendor_invoice', entity_id: { in: invoices.map((i) => i.id) } }, select: { entity_id: true } }) : [];
    const withFile = new Set(files.map((f) => f.entity_id));
    for (const inv of invoices) {
      const cur = invoiceByVendor.get(inv.vendor_account_id) || { total: 0, with_file: 0 };
      cur.total += 1;
      if (withFile.has(inv.id)) cur.with_file += 1;
      invoiceByVendor.set(inv.vendor_account_id, cur);
    }
  }

  let rows = entities.map((e) => {
    const mine = byEntity.get(e.id) || [];
    const items = reqs.map((name) => {
      const doc = mine.find((d) => matches(name, d));
      if (doc) return { name, state: 'uploaded', document: { id: doc.id, label: doc.label, url: doc.file_url, uploaded_at: ymd(doc.uploaded_at), via_project: doc.project || null } };
      if (e.agreement_link && norm(name).includes('agreement')) return { name, state: 'uploaded', document: { id: null, label: 'Agreement link on the account', url: e.agreement_link, uploaded_at: null } };
      const viaProject = projectLink.get(e.id);
      if (viaProject && norm(name).includes('agreement')) return { name, state: 'uploaded', document: { id: null, label: 'Agreement link on the project', url: viaProject.url, uploaded_at: null, via_project: viaProject.label } };
      return { name, state: 'missing', document: null };
    });
    let invoices = null;
    if (kind === 'vendor') {
      const inv = invoiceByVendor.get(e.id) || { total: 0, with_file: 0 };
      invoices = { month, year, total: inv.total, with_file: inv.with_file, state: inv.total === 0 ? 'none' : inv.with_file >= inv.total ? 'complete' : 'missing' };
    }
    const missing = items.filter((i) => i.state === 'missing').length + (invoices?.state === 'missing' ? 1 : 0);
    return { id: e.id, name: e.name, sub: e.sub, items, invoices, missing_count: missing, other_documents: mine.filter((d) => !reqs.some((name) => matches(name, d))).length };
  });
  const summary = { total: rows.length, complete: rows.filter((r) => r.missing_count === 0).length, with_missing: rows.filter((r) => r.missing_count > 0).length, missing_items: rows.reduce((s, r) => s + r.missing_count, 0) };
  if (missingOnly) rows = rows.filter((r) => r.missing_count > 0);
  rows.sort((a, b) => b.missing_count - a.missing_count || a.name.localeCompare(b.name));
  return { kind, month, year, requirements: reqs, rows, summary, truncated };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Signatures

function decodeImage(dataUrl) {
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(String(dataUrl || ''));
  if (!m) return { error: 'bad_signature_image' };
  const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (!buf.length || buf.length > MAX_SIGNATURE_BYTES) return { error: 'signature_too_large' };
  const png = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const jpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
  if (!png && !jpg) return { error: 'bad_signature_image' };
  return { buf, type: png ? 'png' : 'jpg' };
}

async function mySignature(orgId, userId) {
  const row = await prisma.userSignature.findUnique({ where: { org_id_user_id: { org_id: orgId, user_id: userId } } });
  if (!row || !fs.existsSync(row.image_path)) return { has_signature: false };
  const buf = fs.readFileSync(row.image_path);
  return { has_signature: true, image: `data:image/${row.image_type === 'jpg' ? 'jpeg' : 'png'};base64,${buf.toString('base64')}`, updated_at: row.updated_at };
}

async function setMySignature(orgId, userId, image) {
  const img = decodeImage(image);
  if (img.error) return { error: img.error };
  ensure(signaturesDir());
  const file = path.join(signaturesDir(), `${crypto.randomUUID()}.${img.type}`);
  fs.writeFileSync(file, img.buf);
  const existing = await prisma.userSignature.findUnique({ where: { org_id_user_id: { org_id: orgId, user_id: userId } } });
  await prisma.userSignature.upsert({
    where: { org_id_user_id: { org_id: orgId, user_id: userId } },
    create: { org_id: orgId, user_id: userId, image_path: file, image_type: img.type },
    update: { image_path: file, image_type: img.type },
  });
  if (existing) safeUnlink(existing.image_path);
  return { saved: true };
}

async function clearMySignature(orgId, userId) {
  const existing = await prisma.userSignature.findUnique({ where: { org_id_user_id: { org_id: orgId, user_id: userId } } });
  if (!existing) return { removed: true };
  await prisma.userSignature.delete({ where: { id: existing.id } });
  safeUnlink(existing.image_path);
  return { removed: true };
}

// ---- the company stamp (seal): one per company, placed with the signature while signing

async function companyStamp(orgId) {
  const row = await prisma.companyStamp.findUnique({ where: { org_id: orgId } });
  if (!row || !fs.existsSync(row.image_path)) return { has_stamp: false };
  const buf = fs.readFileSync(row.image_path);
  return { has_stamp: true, image: `data:image/${row.image_type === 'jpg' ? 'jpeg' : 'png'};base64,${buf.toString('base64')}`, updated_at: row.updated_at };
}

async function setCompanyStamp(orgId, userId, image) {
  const img = decodeImage(image);
  if (img.error) return { error: img.error };
  ensure(signaturesDir());
  const file = path.join(signaturesDir(), `stamp-${crypto.randomUUID()}.${img.type}`);
  fs.writeFileSync(file, img.buf);
  const existing = await prisma.companyStamp.findUnique({ where: { org_id: orgId } });
  await prisma.companyStamp.upsert({
    where: { org_id: orgId },
    create: { org_id: orgId, image_path: file, image_type: img.type, uploaded_by: userId },
    update: { image_path: file, image_type: img.type, uploaded_by: userId },
  });
  if (existing) safeUnlink(existing.image_path);
  return { saved: true };
}

async function clearCompanyStamp(orgId) {
  const existing = await prisma.companyStamp.findUnique({ where: { org_id: orgId } });
  if (!existing) return { removed: true };
  await prisma.companyStamp.delete({ where: { id: existing.id } });
  safeUnlink(existing.image_path);
  return { removed: true };
}

/** Everyone who can be asked to sign: people in this company who have a signature, and whether they have set one up. */
async function listSigners(orgId) {
  const sigs = await prisma.userSignature.findMany({ where: { org_id: orgId }, select: { user_id: true } });
  const ids = sigs.map((s) => s.user_id);
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  return users.sort((a, b) => a.name.localeCompare(b.name)).map((u) => ({ id: u.id, name: u.name, has_signature: true }));
}

// ---------------------------------------------------------------------------------------------------------------------------
// Signing requests

const requestMeta = z.object({
  title: z.string().trim().min(1, 'Give the document a title').max(200),
  tag_kind: z.enum(TAGS).default('other'),
  entity_type: z.enum(['account', 'org_membership', 'project_vendor_invoice']).optional(),
  entity_id: z.string().uuid().optional(),
  doc_type: z.string().trim().max(80).optional(),
  signer_user_id: z.string().uuid(),
  note: z.string().trim().max(1000).optional(),
});

const placementSchema = z.object({
  page: z.coerce.number().int().min(1).max(2000),
  x: z.coerce.number().min(0).max(1),
  y: z.coerce.number().min(0).max(1),
  width: z.coerce.number().min(0.03).max(0.9),
  // the signer's signature (default) or the company stamp
  kind: z.enum(['signature', 'stamp']).default('signature'),
});
const signBody = z.object({ placements: z.array(placementSchema).min(1, 'Place the signature on the document').max(30) })
  .refine((b) => b.placements.some((p) => p.kind === 'signature'), { message: 'Place your signature on the document', path: ['placements'] });

const isManager = (user, decide) => user.role === 'admin' || decide(user, 'documents.manage') === true;

function viewRequest(r, names, { stale = false } = {}) {
  return {
    id: r.id, title: r.title, tag_kind: r.tag_kind, entity_type: r.entity_type, entity_id: r.entity_id, entity_name: r.entity_name, doc_type: r.doc_type, note: r.note,
    original_name: r.original_name, original_size: r.original_size, original_available: !r.original_deleted_at,
    status: r.status, signer: { id: r.signer_user_id, name: names.get(r.signer_user_id) || null }, requested_by: { id: r.requested_by, name: names.get(r.requested_by) || null },
    signed_at: r.signed_at, signed_size: r.signed_size, decline_reason: r.decline_reason, attached: Boolean(r.attached_document_id), created_at: r.created_at,
    stale: r.status === 'pending' && stale,
  };
}
async function namesOf(rows) {
  const ids = [...new Set(rows.flatMap((r) => [r.signer_user_id, r.requested_by]).filter(Boolean))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  return new Map(users.map((u) => [u.id, u.name]));
}

async function resolveEntity(orgId, entityType, entityId) {
  if (!entityType || !entityId) return { entity: null };
  if (entityType === 'account') {
    const a = await prisma.account.findFirst({ where: { id: entityId, org_id: orgId }, select: { id: true, name: true, type: true } });
    return a ? { entity: { type: 'account', id: a.id, name: a.name, kind: a.type } } : { error: 'entity_not_found' };
  }
  if (entityType === 'org_membership') {
    const m = await prisma.orgMembership.findFirst({ where: { id: entityId, org_id: orgId }, select: { id: true, person: { select: { name: true } } } });
    return m ? { entity: { type: 'org_membership', id: m.id, name: m.person?.name || '', kind: 'employee' } } : { error: 'entity_not_found' };
  }
  const inv = await prisma.projectVendorInvoice.findFirst({ where: { id: entityId, org_id: orgId }, select: { id: true, invoice_number: true, vendor_account: { select: { name: true } } } });
  return inv ? { entity: { type: 'project_vendor_invoice', id: inv.id, name: `${inv.vendor_account?.name || 'Vendor'} ${inv.invoice_number || 'invoice'}`.trim(), kind: 'invoice' } } : { error: 'entity_not_found' };
}

/** `file` is what multer saved (path, originalname, size). The caller removes it when this returns an error. */
// ---- emails: the signer is told a document waits for them; the person who sent it is told it was signed, declined or cancelled.
// Queued through the email outbox (never fails the action); a person without an email address simply gets none.
const appLink = () => `${env.corsOrigin.replace(/\/$/, '')}/people?section=documents&doc=sign`;
async function mailSigning(orgId, toUserId, subject, lines) {
  try {
    if (!toUserId) return;
    const to = await prisma.user.findUnique({ where: { id: toUserId }, select: { email: true, name: true, active: true } });
    if (!to?.email || to.active === false) return;
    await enqueue(prisma, { orgId, kind: 'document_signing', to: { email: to.email, name: to.name }, subject, text: `Hi ${to.name || ''},\n\n${lines.join('\n')}\n\nOpen it: ${appLink()}` });
  } catch { /* an email problem never blocks signing */ }
}

async function createRequest(orgId, user, meta, file) {
  if (!file) return { error: 'file_required' };
  const disk = storage.diskReport();
  if (disk.available && disk.level === 'critical') return { error: 'storage_full' };
  if (file.size > MAX_PDF_BYTES) return { error: 'file_too_large' };
  let pages;
  try {
    const bytes = fs.readFileSync(file.path);
    if (bytes.slice(0, 5).toString() !== '%PDF-') return { error: 'not_a_pdf' };
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
    pages = doc.getPageCount();
  } catch { return { error: 'unreadable_pdf' }; }
  if (!pages) return { error: 'unreadable_pdf' };
  const signer = await prisma.orgMembership.findFirst({ where: { person_id: meta.signer_user_id, org_id: orgId }, select: { id: true } });
  if (!signer) return { error: 'signer_not_found' };
  const resolved = await resolveEntity(orgId, meta.entity_type, meta.entity_id);
  if (resolved.error) return { error: resolved.error };
  const tag = meta.tag_kind !== 'other' || !resolved.entity ? meta.tag_kind : resolved.entity.kind; // tagged to a client / vendor / employee / invoice: its kind
  const row = await prisma.signatureRequest.create({
    data: {
      org_id: orgId, title: meta.title, tag_kind: tag, entity_type: resolved.entity?.type || null, entity_id: resolved.entity?.id || null, entity_name: resolved.entity?.name || null,
      doc_type: meta.doc_type || null, note: meta.note || null, original_path: file.path, original_name: path.basename(file.originalname || 'document.pdf'), original_size: file.size,
      signer_user_id: meta.signer_user_id, requested_by: user.id,
    },
  });
  const requester = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true } });
  await mailSigning(orgId, meta.signer_user_id, `Please sign: ${meta.title}`, [`${requester?.name || 'A colleague'} asked you to sign "${meta.title}"${resolved.entity?.name ? ` (${resolved.entity.name})` : ''}.`, ...(meta.note ? [`Note: ${meta.note}`] : []), 'Open Documents > Sign documents, place your signature and finish.']);
  return { request: viewRequest(row, await namesOf([row])), pages };
}

async function listRequests(orgId, user, { status, scope, decide }) {
  const manager = isManager(user, decide);
  const where = { org_id: orgId, ...(status ? { status } : {}) };
  if (scope === 'to_sign') where.signer_user_id = user.id;
  else if (scope === 'all' && manager) { /* everything in the company */ } else where.OR = [{ signer_user_id: user.id }, { requested_by: user.id }];
  const rows = await prisma.signatureRequest.findMany({ where, orderBy: [{ created_at: 'desc' }], take: 300 });
  const names = await namesOf(rows);
  const cutoff = Date.now() - STALE_DAYS * 86400000;
  return rows.map((r) => viewRequest(r, names, { stale: new Date(r.created_at).getTime() < cutoff }));
}

async function loadRequest(orgId, id) {
  return prisma.signatureRequest.findFirst({ where: { id, org_id: orgId } });
}
const mayRead = (r, user, decide) => r.signer_user_id === user.id || r.requested_by === user.id || isManager(user, decide);

async function originalFile(orgId, user, id, decide) {
  const r = await loadRequest(orgId, id);
  if (!r) return { error: 'not_found' };
  if (!mayRead(r, user, decide)) return { error: 'forbidden' };
  if (r.original_deleted_at || !fs.existsSync(r.original_path)) return { error: 'file_removed' };
  return { path: r.original_path, name: r.original_name };
}

async function signedFile(orgId, user, id, decide) {
  const r = await loadRequest(orgId, id);
  if (!r) return { error: 'not_found' };
  if (!mayRead(r, user, decide)) return { error: 'forbidden' };
  if (r.status !== 'signed' || !r.signed_path || !fs.existsSync(r.signed_path)) return { error: 'not_signed' };
  const base = r.original_name.replace(/\.pdf$/i, '');
  return { path: r.signed_path, name: `${base}-signed.pdf` };
}

/** Put the signer's signature on the PDF at the places they chose (fractions of the page, from the top-left), with a small line saying who and when. */
async function sign(orgId, user, id, body) {
  const r = await loadRequest(orgId, id);
  if (!r) return { error: 'not_found' };
  if (r.signer_user_id !== user.id) return { error: 'not_the_signer' };
  if (r.status !== 'pending') return { error: 'not_pending' };
  if (r.original_deleted_at || !fs.existsSync(r.original_path)) return { error: 'file_removed' };
  const sig = await prisma.userSignature.findUnique({ where: { org_id_user_id: { org_id: orgId, user_id: user.id } } });
  if (!sig || !fs.existsSync(sig.image_path)) return { error: 'no_signature' };
  const disk = storage.diskReport();
  if (disk.available && disk.level === 'critical') return { error: 'storage_full' };

  const wantsStamp = body.placements.some((p) => p.kind === 'stamp');
  const stampRow = wantsStamp ? await prisma.companyStamp.findUnique({ where: { org_id: orgId } }) : null;
  if (wantsStamp && (!stampRow || !fs.existsSync(stampRow.image_path))) return { error: 'no_stamp' };

  const pdf = await PDFDocument.load(fs.readFileSync(r.original_path));
  const image = sig.image_type === 'jpg' ? await pdf.embedJpg(fs.readFileSync(sig.image_path)) : await pdf.embedPng(fs.readFileSync(sig.image_path));
  const stampImage = stampRow ? (stampRow.image_type === 'jpg' ? await pdf.embedJpg(fs.readFileSync(stampRow.image_path)) : await pdf.embedPng(fs.readFileSync(stampRow.image_path))) : null;
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const signer = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true } });
  const stamp = `Signed by ${signer?.name || 'signer'} on ${new Date().toISOString().slice(0, 10)}`;
  const pageCount = pdf.getPageCount();
  for (const p of body.placements) {
    if (p.page > pageCount) return { error: 'bad_page' };
    const page = pdf.getPage(p.page - 1);
    const { width: pw, height: ph } = page.getSize();
    const picture = p.kind === 'stamp' ? stampImage : image;
    const w = p.width * pw;
    const h = w * (picture.height / picture.width);
    const x = Math.min(Math.max(p.x * pw, 0), Math.max(pw - w, 0));
    const yTop = Math.min(Math.max(p.y * ph, 0), Math.max(ph - h, 0));
    const y = ph - yTop - h;
    page.drawImage(picture, { x, y, width: w, height: h });
    // the "Signed by ... on ..." line goes under a signature, not under the company stamp
    if (p.kind !== 'stamp') page.drawText(stamp, { x, y: Math.max(y - 9, 2), size: 6.5, font, color: rgb(0.39, 0.45, 0.55) });
  }
  const bytes = await pdf.save();
  ensure(signingDir());
  const out = path.join(signingDir(), `${crypto.randomUUID()}-signed.pdf`);
  fs.writeFileSync(out, bytes);
  const row = await prisma.signatureRequest.update({ where: { id }, data: { status: 'signed', placements: body.placements, signed_path: out, signed_size: bytes.length, signed_at: new Date() } });
  await mailSigning(orgId, r.requested_by, `Signed: ${r.title}`, [`${signer?.name || 'The signer'} signed "${r.title}".`, `Download the signed copy${r.entity_name ? ` or attach it to ${r.entity_name}` : ''} from Documents > Sign documents.`]);
  return { request: viewRequest(row, await namesOf([row])) };
}

async function decline(orgId, user, id, reason) {
  const r = await loadRequest(orgId, id);
  if (!r) return { error: 'not_found' };
  if (r.signer_user_id !== user.id) return { error: 'not_the_signer' };
  if (r.status !== 'pending') return { error: 'not_pending' };
  const row = await prisma.signatureRequest.update({ where: { id }, data: { status: 'declined', decline_reason: reason } });
  const who = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true } });
  await mailSigning(orgId, r.requested_by, `Not signed: ${r.title}`, [`${who?.name || 'The signer'} did not sign "${r.title}".`, `Reason: ${reason}`]);
  return { request: viewRequest(row, await namesOf([row])) };
}

async function cancel(orgId, user, id, decide) {
  const r = await loadRequest(orgId, id);
  if (!r) return { error: 'not_found' };
  if (r.requested_by !== user.id && !isManager(user, decide)) return { error: 'forbidden' };
  if (r.status !== 'pending') return { error: 'not_pending' };
  const row = await prisma.signatureRequest.update({ where: { id }, data: { status: 'cancelled' } });
  await mailSigning(orgId, r.signer_user_id, `No longer needed: ${r.title}`, [`The request to sign "${r.title}" was cancelled; nothing to do.`]);
  return { request: viewRequest(row, await namesOf([row])) };
}

/** The signed PDF becomes a normal document of the client / vendor / employee it was tagged for (so the overview shows it as on file). */
async function attach(orgId, user, id, decide) {
  const r = await loadRequest(orgId, id);
  if (!r) return { error: 'not_found' };
  if (r.requested_by !== user.id && !isManager(user, decide)) return { error: 'forbidden' };
  if (r.status !== 'signed' || !r.signed_path || !fs.existsSync(r.signed_path)) return { error: 'not_signed' };
  if (!r.entity_type || !r.entity_id) return { error: 'no_entity' };
  if (r.attached_document_id) return { error: 'already_attached' };
  ensure(uploadRoot());
  const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}.pdf`;
  fs.copyFileSync(r.signed_path, path.join(uploadRoot(), name));
  const doc = await prisma.document.create({
    data: { entity_type: r.entity_type, entity_id: r.entity_id, label: `${r.title} (signed)`, file_url: `/uploads/${name}`, file_type: 'application/pdf', file_size_bytes: r.signed_size, uploaded_by: user.id, org_id: orgId, doc_type: r.doc_type || null },
  });
  await prisma.signatureRequest.update({ where: { id }, data: { attached_document_id: doc.id } });
  return { document: { id: doc.id, label: doc.label } };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Storage

const FINISHED = ['signed', 'declined', 'cancelled'];

async function storageInfo(orgId, { fresh = false } = {}) {
  const rep = await storage.report({ fresh });
  const rows = await prisma.signatureRequest.findMany({ where: { org_id: orgId }, select: { status: true, original_path: true, original_size: true, original_deleted_at: true, signed_size: true, created_at: true } });
  const signing = rows.reduce((s, r) => s + (r.original_deleted_at ? 0 : r.original_size || 0) + (r.signed_size || 0), 0);
  const cutoff = Date.now() - 30 * 86400000;
  const candidates = rows.filter((r) => FINISHED.includes(r.status) && !r.original_deleted_at && new Date(r.created_at).getTime() < cutoff);
  return {
    disk: rep.disk,
    uploads: { total_bytes: rep.uploads.total_bytes, total_files: rep.uploads.total_files },
    signing: { requests: rows.length, pending: rows.filter((r) => r.status === 'pending').length, bytes: signing },
    cleanup: { older_than_days: 30, files: candidates.length, bytes: candidates.reduce((s, r) => s + (r.original_size || 0), 0) },
    rules: { max_pdf_mb: MAX_PDF_BYTES / 1024 / 1024, upload_blocked_when: 'the disk is almost full (less than 10% free)', kept: 'the signed copy is always kept; only the unsigned original of a finished request is removed' },
  };
}

/** Remove the unsigned originals of requests that are finished (signed, declined or cancelled) and older than the given days. The signed copies stay. */
async function cleanup(orgId, { days = 30 } = {}) {
  const cutoff = new Date(Date.now() - days * 86400000);
  const rows = await prisma.signatureRequest.findMany({ where: { org_id: orgId, status: { in: FINISHED }, original_deleted_at: null, created_at: { lt: cutoff } } });
  let bytes = 0;
  let files = 0;
  for (const r of rows) {
    const size = sizeOf(r.original_path);
    if (safeUnlink(r.original_path) || !fs.existsSync(r.original_path)) {
      bytes += size;
      files += 1;
      await prisma.signatureRequest.update({ where: { id: r.id }, data: { original_deleted_at: new Date() } });
    }
  }
  storage.report({ fresh: true }).catch(() => {});
  return { files, bytes };
}

module.exports = {
  companyStamp, setCompanyStamp, clearCompanyStamp,
  KINDS, TAGS, MAX_PDF_BYTES, signingDir, requirementSchema, overviewQuery, requestMeta, signBody,
  listRequirements, addRequirement, renameRequirement, removeRequirement, overview,
  mySignature, setMySignature, clearMySignature, listSigners,
  createRequest, listRequests, originalFile, signedFile, sign, decline, cancel, attach,
  storageInfo, cleanup,
};
