const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const prisma = require('../../config/db');
const env = require('../../config/env');
const { writeAudit } = require('./audit');

const ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.xlsx', '.csv'];
const CATEGORIES = ['agreement', 'lease', 'sale_deed', 'valuation', 'tax', 'work_order', 'license', 'gst', 'pan', 'insurance', 'invoice', 'other'];

// Which Zephyr capability lets a role touch documents of each owner type, and
// the table that proves the owner exists in the caller's org. Later phases add
// project / person / lead here.
const OWNERS = {
  entry: { cap: 'ledger', exists: (orgId, id) => prisma.zxLedgerEntry.findFirst({ where: { id, org_id: orgId, deleted_at: null }, select: { id: true } }) },
  project: { cap: 'projects', exists: (orgId, id) => prisma.zxProject.findFirst({ where: { id, org_id: orgId, deleted_at: null }, select: { id: true } }) },
  lead: { cap: 'leads', exists: (orgId, id) => prisma.zxLead.findFirst({ where: { id, org_id: orgId, deleted_at: null }, select: { id: true } }) },
  property: { cap: 'properties', exists: (orgId, id) => prisma.zxProperty.findFirst({ where: { id, org_id: orgId, deleted_at: null }, select: { id: true } }) },
  tenant: { cap: 'rent', exists: (orgId, id) => prisma.zxTenant.findFirst({ where: { id, org_id: orgId, deleted_at: null }, select: { id: true } }) },
  lease: { cap: 'rent', exists: (orgId, id) => prisma.zxLease.findFirst({ where: { id, org_id: orgId, deleted_at: null }, select: { id: true } }) },
  party: { cap: 'parties', exists: (orgId, id) => prisma.zxParty.findFirst({ where: { id, org_id: orgId, deleted_at: null }, select: { id: true } }) },
};

const dateField = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable()
);
const uploadSchema = z
  .object({
    owner_type: z.enum(Object.keys(OWNERS)),
    owner_id: z.string().uuid(),
    category: z.enum(CATEGORIES).default('other'),
    title: z.string().trim().min(1).max(200),
    ref_no: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(120).nullable().optional()),
    issue_date: dateField.optional(),
    expiry_date: dateField.optional(),
  })
  .refine((v) => !v.issue_date || !v.expiry_date || v.expiry_date >= v.issue_date, { message: 'Expiry must be on or after the issue date', path: ['expiry_date'] });
const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    category: z.enum(CATEGORIES),
    ref_no: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(120).nullable()),
    issue_date: dateField,
    expiry_date: dateField,
  })
  .partial();
const listSchema = z.object({ owner_type: z.enum(Object.keys(OWNERS)), owner_id: z.string().uuid() });

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

function capFor(ownerType) {
  return OWNERS[ownerType]?.cap;
}

async function ownerExists(orgId, ownerType, ownerId) {
  return Boolean(await OWNERS[ownerType].exists(orgId, ownerId));
}

function removeFile(fileUrl) {
  fs.promises.unlink(path.join(env.uploadDir, path.basename(fileUrl))).catch(() => {});
}

async function list(orgId, { owner_type, owner_id }) {
  return prisma.zxDocument.findMany({
    where: { org_id: orgId, owner_type, owner_id, deleted_at: null },
    orderBy: [{ expiry_date: { sort: 'asc', nulls: 'last' } }, { created_at: 'desc' }],
  });
}

async function create(orgId, actorId, input, file) {
  const { issue_date, expiry_date, ...rest } = input;
  const doc = await prisma.zxDocument.create({
    data: {
      org_id: orgId,
      uploaded_by: actorId,
      ...rest,
      issue_date: toDate(issue_date),
      expiry_date: toDate(expiry_date),
      file_url: `/uploads/${file.filename}`,
      file_name: file.originalname,
      size_bytes: file.size,
    },
  });
  await writeAudit(null, { orgId, actorId, entity: 'document', entityId: doc.id, action: 'create', after: { owner_type: doc.owner_type, owner_id: doc.owner_id, title: doc.title } });
  return { document: doc };
}

async function find(orgId, id) {
  return prisma.zxDocument.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
}

async function update(orgId, actorId, id, input) {
  const before = await find(orgId, id);
  if (!before) return { error: 'not_found' };
  const issue = input.issue_date !== undefined ? input.issue_date : before.issue_date ? new Date(before.issue_date).toISOString().slice(0, 10) : null;
  const expiry = input.expiry_date !== undefined ? input.expiry_date : before.expiry_date ? new Date(before.expiry_date).toISOString().slice(0, 10) : null;
  if (issue && expiry && expiry < issue) return { error: 'bad_dates' };
  const { issue_date, expiry_date, ...rest } = input;
  const document = await prisma.zxDocument.update({
    where: { id },
    data: { ...rest, ...(issue_date !== undefined ? { issue_date: toDate(issue_date) } : {}), ...(expiry_date !== undefined ? { expiry_date: toDate(expiry_date) } : {}) },
  });
  await writeAudit(null, { orgId, actorId, entity: 'document', entityId: id, action: 'update', before: { title: before.title, category: before.category, expiry_date: before.expiry_date }, after: { title: document.title, category: document.category, expiry_date: document.expiry_date } });
  return { document };
}

async function remove(orgId, actorId, id) {
  const doc = await prisma.zxDocument.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!doc) return { error: 'not_found' };
  await prisma.zxDocument.update({ where: { id }, data: { deleted_at: new Date() } });
  removeFile(doc.file_url);
  await writeAudit(null, { orgId, actorId, entity: 'document', entityId: id, action: 'delete', before: { owner_type: doc.owner_type, title: doc.title } });
  return { ok: true, owner_type: doc.owner_type };
}

module.exports = { ALLOWED_EXT, CATEGORIES, uploadSchema, updateSchema, listSchema, capFor, ownerExists, removeFile, list, find, create, update, remove };
