const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const prisma = require('../../config/db');
const env = require('../../config/env');
const { writeAudit } = require('./audit');

const ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.xlsx', '.csv'];
const CATEGORIES = ['quotation', 'purchase_order', 'sales_order', 'invoice', 'test_certificate', 'weighment', 'transport', 'insurance', 'gst', 'pan', 'agreement', 'other'];

// Which Gulati capability lets a role touch documents of each owner type, and the table that proves
// the owner exists in the caller's org.
const owner = (model, cap) => ({ cap, exists: (orgId, id) => prisma[model].findFirst({ where: { id, org_id: orgId, deleted_at: null }, select: { id: true } }) });
const OWNERS = {
  party: owner('gxParty', 'parties'),
  lead: owner('gxLead', 'leads'),
  deal: owner('gxDeal', 'deals'),
  purchase: owner('gxPurchase', 'deals'),
  sale: owner('gxSale', 'deals'),
};

const dateField = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable());
const refNo = z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(120).nullable().optional());
const uploadSchema = z
  .object({
    owner_type: z.enum(Object.keys(OWNERS)),
    owner_id: z.string().uuid(),
    category: z.enum(CATEGORIES).default('other'),
    title: z.string().trim().min(1).max(200),
    ref_no: refNo,
    issue_date: dateField.optional(),
    expiry_date: dateField.optional(),
  })
  .refine((v) => !v.issue_date || !v.expiry_date || v.expiry_date >= v.issue_date, { message: 'Expiry must be on or after the issue date', path: ['expiry_date'] });
const updateSchema = z
  .object({ title: z.string().trim().min(1).max(200), category: z.enum(CATEGORIES), ref_no: refNo.nullable(), issue_date: dateField, expiry_date: dateField })
  .partial();
const listSchema = z.object({ owner_type: z.enum(Object.keys(OWNERS)), owner_id: z.string().uuid() });

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const capFor = (ownerType) => OWNERS[ownerType]?.cap;
const ownerExists = async (orgId, ownerType, ownerId) => Boolean(await OWNERS[ownerType].exists(orgId, ownerId));
const removeFile = (fileUrl) => fs.promises.unlink(path.join(env.uploadDir, path.basename(fileUrl))).catch(() => {});

const list = (orgId, { owner_type, owner_id }) =>
  prisma.gxDocument.findMany({ where: { org_id: orgId, owner_type, owner_id, deleted_at: null }, orderBy: [{ expiry_date: { sort: 'asc', nulls: 'last' } }, { created_at: 'desc' }] });

async function create(orgId, actorId, input, file) {
  const { issue_date, expiry_date, ...rest } = input;
  const doc = await prisma.gxDocument.create({
    data: { org_id: orgId, uploaded_by: actorId, ...rest, issue_date: toDate(issue_date), expiry_date: toDate(expiry_date), file_url: `/uploads/${file.filename}`, file_name: file.originalname, size_bytes: file.size },
  });
  await writeAudit(null, { orgId, actorId, entity: 'document', entityId: doc.id, action: 'create', after: { owner_type: doc.owner_type, owner_id: doc.owner_id, title: doc.title } });
  return { document: doc };
}

const find = (orgId, id) => prisma.gxDocument.findFirst({ where: { id, org_id: orgId, deleted_at: null } });

async function update(orgId, actorId, id, input) {
  const before = await find(orgId, id);
  if (!before) return { error: 'not_found' };
  const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
  const issue = input.issue_date !== undefined ? input.issue_date : day(before.issue_date);
  const expiry = input.expiry_date !== undefined ? input.expiry_date : day(before.expiry_date);
  if (issue && expiry && expiry < issue) return { error: 'bad_dates' };
  const { issue_date, expiry_date, ...rest } = input;
  const document = await prisma.gxDocument.update({
    where: { id },
    data: { ...rest, ...(issue_date !== undefined ? { issue_date: toDate(issue_date) } : {}), ...(expiry_date !== undefined ? { expiry_date: toDate(expiry_date) } : {}) },
  });
  await writeAudit(null, { orgId, actorId, entity: 'document', entityId: id, action: 'update', before: { title: before.title, category: before.category }, after: { title: document.title, category: document.category } });
  return { document };
}

async function remove(orgId, actorId, id) {
  const doc = await find(orgId, id);
  if (!doc) return { error: 'not_found' };
  await prisma.gxDocument.update({ where: { id }, data: { deleted_at: new Date() } });
  removeFile(doc.file_url);
  await writeAudit(null, { orgId, actorId, entity: 'document', entityId: id, action: 'delete', before: { owner_type: doc.owner_type, title: doc.title } });
  return { ok: true, owner_type: doc.owner_type };
}

module.exports = { ALLOWED_EXT, CATEGORIES, uploadSchema, updateSchema, listSchema, capFor, ownerExists, removeFile, list, find, create, update, remove };
