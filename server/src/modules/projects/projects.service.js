const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const prisma = require('../../config/db');
const env = require('../../config/env');
const { num, round2, pageArgs, pagination } = require('../../lib/vertical');

const CURRENCY = z.enum(['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP']);
const optStr = (max = 300) => z.string().trim().max(max).optional().nullable();
const optDate = z.coerce.date().optional().nullable();

const projectFields = {
  name: z.string().trim().min(1).max(200),
  project_type: optStr(120),
  location: optStr(300),
  investor_name: optStr(200),
  customer_deal_ref: optStr(200),
  lead_id: z.string().uuid().optional().nullable(),
  budget: z.coerce.number().min(0).optional().nullable(),
  currency: CURRENCY.default('INR'),
  start_date: optDate,
  end_date: optDate,
  notes: optStr(2000),
};
const createProjectSchema = z.object(projectFields).refine((v) => !v.start_date || !v.end_date || v.end_date >= v.start_date, {
  message: 'end_date must not be before start_date',
  path: ['end_date'],
});
const updateProjectSchema = z.object({ ...projectFields, status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']) }).partial();

const listProjectsQuerySchema = z.object({
  status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const financeEntrySchema = z.object({
  entry_type: z.enum(['revenue', 'expense', 'salary', 'other']),
  category: optStr(120),
  amount: z.coerce.number().positive(),
  currency: CURRENCY.default('INR'),
  entry_date: z.coerce.date(),
  description: optStr(500),
});
const financeQuerySchema = z.object({
  entry_type: z.enum(['revenue', 'expense', 'salary', 'other']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const DOC_CATEGORIES = ['legal', 'site', 'permit', 'approval', 'title', 'other'];
const documentMetaSchema = z.object({
  category: z.enum(DOC_CATEGORIES),
  title: z.string().trim().min(1).max(200),
  reference_no: optStr(120),
  issued_on: optDate,
  expires_on: optDate,
  notes: optStr(1000),
});

function computeDocStatus(doc, now = new Date()) {
  if (!doc.expires_on) return 'no_expiry';
  const expires = new Date(doc.expires_on);
  if (expires < now) return 'expired';
  return expires.getTime() - now.getTime() <= 30 * 24 * 60 * 60 * 1000 ? 'expiring_soon' : 'valid';
}

function serializeDoc(row) {
  return { ...row, status: computeDocStatus(row) };
}

function rollup(entries) {
  const totals = { revenue: 0, expense: 0, salary: 0, other: 0 };
  for (const e of entries) totals[e.entry_type] += Number(e.amount);
  const cost = totals.expense + totals.salary + totals.other;
  return {
    revenue: round2(totals.revenue),
    expense: round2(totals.expense),
    salary: round2(totals.salary),
    other: round2(totals.other),
    total_cost: round2(cost),
    net: round2(totals.revenue - cost),
  };
}

function serializeProject(row, entries = []) {
  const money = rollup(entries);
  const budget = num(row.budget);
  return {
    ...row,
    budget,
    ...money,
    budget_used_percent: budget ? Math.round((money.total_cost / budget) * 100) : null,
  };
}

async function findProject(orgId, id) {
  return prisma.selfProject.findFirst({ where: { id, org_id: orgId } });
}

async function createProject(orgId, userId, body) {
  const row = await prisma.selfProject.create({ data: { ...body, org_id: orgId, created_by: userId } });
  return { project: serializeProject(row) };
}

async function listProjects(orgId, { status, search, page, limit }) {
  const where = {
    org_id: orgId,
    ...(status ? { status } : {}),
    ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.selfProject.findMany({ where, orderBy: { created_at: 'desc' }, ...pageArgs({ page, limit }) }),
    prisma.selfProject.count({ where }),
  ]);
  const entries = await prisma.projectFinanceEntry.findMany({
    where: { org_id: orgId, project_id: { in: rows.map((r) => r.id) } },
    select: { project_id: true, entry_type: true, amount: true },
  });
  const byProject = new Map();
  for (const e of entries) byProject.set(e.project_id, [...(byProject.get(e.project_id) || []), e]);
  return { data: rows.map((r) => serializeProject(r, byProject.get(r.id) || [])), pagination: pagination(page, limit, total) };
}

async function getProject(orgId, id) {
  const row = await findProject(orgId, id);
  if (!row) return { error: 'not_found' };
  const [entries, documents, contracts] = await Promise.all([
    prisma.projectFinanceEntry.findMany({ where: { org_id: orgId, project_id: id }, orderBy: { entry_date: 'desc' } }),
    prisma.projectDocument.findMany({ where: { org_id: orgId, project_id: id }, orderBy: { created_at: 'desc' } }),
    prisma.contract.findMany({ where: { org_id: orgId, project_id: id }, orderBy: { created_at: 'desc' } }),
  ]);
  return {
    project: serializeProject(row, entries),
    finance_entries: entries.map((e) => ({ ...e, amount: num(e.amount) })),
    documents: documents.map(serializeDoc),
    contracts: contracts.map((c) => ({ ...c, value: num(c.value), billed_to_date: num(c.billed_to_date), recurring_amount: num(c.recurring_amount) })),
  };
}

async function updateProject(orgId, id, patch) {
  const existing = await findProject(orgId, id);
  if (!existing) return { error: 'not_found' };
  const row = await prisma.selfProject.update({ where: { id }, data: patch });
  return { project: serializeProject(row) };
}

// --- Finance entries (revenue / expense / salary / other per project) ---

async function addFinanceEntry(orgId, userId, projectId, body) {
  const project = await findProject(orgId, projectId);
  if (!project) return { error: 'not_found' };
  const row = await prisma.projectFinanceEntry.create({ data: { ...body, org_id: orgId, project_id: projectId, created_by: userId } });
  return { entry: { ...row, amount: num(row.amount) } };
}

async function listFinanceEntries(orgId, projectId, { entry_type, from, to }) {
  const project = await findProject(orgId, projectId);
  if (!project) return { error: 'not_found' };
  const rows = await prisma.projectFinanceEntry.findMany({
    where: {
      org_id: orgId,
      project_id: projectId,
      ...(entry_type ? { entry_type } : {}),
      ...(from || to ? { entry_date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    orderBy: { entry_date: 'desc' },
  });
  return { entries: rows.map((e) => ({ ...e, amount: num(e.amount) })), totals: rollup(rows) };
}

async function deleteFinanceEntry(orgId, projectId, entryId) {
  const entry = await prisma.projectFinanceEntry.findFirst({ where: { id: entryId, project_id: projectId, org_id: orgId } });
  if (!entry) return { error: 'not_found' };
  await prisma.projectFinanceEntry.delete({ where: { id: entryId } });
  return { ok: true };
}

// --- Legal / site documents for self projects ---

async function addDocument(orgId, userId, projectId, meta, file) {
  const project = await findProject(orgId, projectId);
  if (!project) return { error: 'not_found' };
  const row = await prisma.projectDocument.create({
    data: {
      ...meta,
      org_id: orgId,
      project_id: projectId,
      uploaded_by: userId,
      ...(file ? { file_url: `/uploads/${file.filename}`, file_type: file.mimetype, file_size_bytes: file.size } : {}),
    },
  });
  return { document: serializeDoc(row) };
}

async function removeDocument(orgId, projectId, docId) {
  const doc = await prisma.projectDocument.findFirst({ where: { id: docId, project_id: projectId, org_id: orgId } });
  if (!doc) return { error: 'not_found' };
  await prisma.projectDocument.delete({ where: { id: docId } });
  if (doc.file_url) fs.unlink(path.join(env.uploadDir, path.basename(doc.file_url)), () => {});
  return { ok: true };
}

// Org-wide compliance view: every legal/site document, with the ones
// expired or expiring soon surfaced first.
async function documentRegister(orgId, { category } = {}) {
  const rows = await prisma.projectDocument.findMany({
    where: { org_id: orgId, ...(category ? { category } : {}) },
    include: { project: { select: { id: true, name: true } } },
    orderBy: { created_at: 'desc' },
  });
  const docs = rows.map(serializeDoc);
  const rank = { expired: 0, expiring_soon: 1, valid: 2, no_expiry: 3 };
  docs.sort((a, b) => rank[a.status] - rank[b.status]);
  return {
    documents: docs,
    counts: {
      total: docs.length,
      expired: docs.filter((d) => d.status === 'expired').length,
      expiring_soon: docs.filter((d) => d.status === 'expiring_soon').length,
    },
  };
}

async function portfolioSummary(orgId) {
  const [projects, entries] = await Promise.all([
    prisma.selfProject.findMany({ where: { org_id: orgId }, select: { id: true, status: true, budget: true } }),
    prisma.projectFinanceEntry.findMany({ where: { org_id: orgId }, select: { entry_type: true, amount: true } }),
  ]);
  const byStatus = { planning: 0, active: 0, on_hold: 0, completed: 0, cancelled: 0 };
  for (const p of projects) byStatus[p.status] += 1;
  return {
    projects: projects.length,
    by_status: byStatus,
    total_budget: round2(projects.reduce((s, p) => s + Number(p.budget || 0), 0)),
    ...rollup(entries),
  };
}

module.exports = {
  ALLOWED_DOC_EXT: ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.xlsx', '.csv'],
  createProjectSchema,
  updateProjectSchema,
  listProjectsQuerySchema,
  financeEntrySchema,
  financeQuerySchema,
  documentMetaSchema,
  computeDocStatus,
  createProject,
  listProjects,
  getProject,
  updateProject,
  addFinanceEntry,
  listFinanceEntries,
  deleteFinanceEntry,
  addDocument,
  removeDocument,
  documentRegister,
  portfolioSummary,
};
