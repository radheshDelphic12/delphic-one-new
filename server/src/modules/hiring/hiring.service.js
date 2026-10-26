const { z } = require('zod');
const prisma = require('../../config/db');
const { cleanTitle, normalizeEmployment } = require('../jobs/jobFields');

// Hiring for the companies other than Delphic Global (which hires through recruitment requirements): an admin posts jobs, they appear on
// the company's own page /<org-slug>/career/, and the applications that come in are kept, filtered and moved through a simple pipeline.

const STATUSES = ['draft', 'published', 'closed'];
const APPLICATION_STATUSES = ['new', 'shortlisted', 'interview', 'offered', 'hired', 'rejected'];

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const jobFields = {
  title: z.string().trim().min(2).max(200),
  department: text(120),
  location: text(200),
  employment_type: text(40),
  openings: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().int().min(1).max(10000).nullable().optional()),
  description: text(20000),
  status: z.enum(STATUSES),
};
const createJobSchema = z.object({ ...jobFields, status: jobFields.status.default('draft') });
const updateJobSchema = z.object(jobFields).partial();
const listApplicationsSchema = z.object({
  job_id: z.string().uuid().optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const updateApplicationSchema = z.object({ status: z.enum(APPLICATION_STATUSES).optional(), notes: text(4000) });

const n = (v) => (v == null ? null : Number(v));
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'job';

/** The Job ID prefix of a company: the first three letters of its slug ("zephyr-infra" -> "ZEP"). */
const prefixOf = (slug) => (String(slug || '').replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase().padEnd(3, 'X'));

async function loadOrg(orgId) {
  return prisma.org.findUnique({ where: { id: orgId }, select: { id: true, name: true, slug: true, is_master_workspace: true } });
}

async function nextCode(tx, org) {
  const row = await tx.nxCounter.upsert({ where: { org_id_key: { org_id: org.id, key: 'company_job' } }, create: { org_id: org.id, key: 'company_job', seq: 1 }, update: { seq: { increment: 1 } } });
  return `${prefixOf(org.slug)}-${String(row.seq).padStart(4, '0')}`;
}

async function uniqueSlug(tx, code, title) {
  const base = `${code.toLowerCase()}-${slugify(title)}`;
  let slug = base;
  for (let i = 2; await tx.companyJob.findUnique({ where: { slug }, select: { id: true } }); i += 1) slug = `${base}-${i}`;
  return slug;
}

function statusFields(status, before) {
  if (status === 'published') return { status, published_at: before?.published_at || new Date(), closed_at: null };
  if (status === 'closed') return { status, closed_at: new Date() };
  return { status };
}

function shapeJob(j, counts) {
  const c = counts?.get(j.id) || {};
  return {
    id: j.id, job_code: j.job_code, slug: j.slug, title: j.title, department: j.department, location: j.location, employment_type: j.employment_type, openings: j.openings,
    description: j.description, status: j.status, published_at: j.published_at, closed_at: j.closed_at, created_at: j.created_at, updated_at: j.updated_at,
    applications: c.total || 0, new_applications: c.new || 0, by_status: c.by || {},
  };
}

async function countsFor(orgId, ids) {
  const rows = ids.length ? await prisma.companyJobApplication.groupBy({ by: ['job_id', 'status'], where: { org_id: orgId, deleted_at: null, job_id: { in: ids } }, _count: { _all: true } }) : [];
  const m = new Map();
  for (const r of rows) {
    const e = m.get(r.job_id) || { total: 0, new: 0, by: {} };
    e.total += r._count._all;
    e.by[r.status] = r._count._all;
    if (r.status === 'new') e.new = r._count._all;
    m.set(r.job_id, e);
  }
  return m;
}

async function listJobs(orgId, { status } = {}) {
  const org = await loadOrg(orgId);
  if (!org) return { error: 'not_found' };
  if (org.is_master_workspace) return { error: 'master_workspace' };
  const rows = await prisma.companyJob.findMany({ where: { org_id: orgId, deleted_at: null, ...(status ? { status } : {}) }, orderBy: { created_at: 'desc' } });
  const counts = await countsFor(orgId, rows.map((r) => r.id));
  return { jobs: rows.map((r) => shapeJob(r, counts)), career_path: `/${org.slug}/career/`, org: { name: org.name, slug: org.slug } };
}

function cleanJobInput(input) {
  const out = { ...input };
  if (out.title) out.title = cleanTitle(out.title);
  if (out.employment_type !== undefined) {
    const norm = normalizeEmployment(out.employment_type);
    out.employment_kind = norm ? norm.kind : null;
    out.employment_type = norm ? norm.label : out.employment_type;
  }
  return out;
}

async function createJob(orgId, actorId, input) {
  const org = await loadOrg(orgId);
  if (!org) return { error: 'not_found' };
  if (org.is_master_workspace) return { error: 'master_workspace' };
  const data = cleanJobInput(input);
  const job = await prisma.$transaction(async (tx) => {
    const job_code = await nextCode(tx, org);
    const slug = await uniqueSlug(tx, job_code, data.title);
    return tx.companyJob.create({ data: { ...data, org_id: orgId, job_code, slug, created_by: actorId, ...statusFields(data.status || 'draft', null) } });
  });
  return { job: shapeJob(job) };
}

async function updateJob(orgId, id, input) {
  const before = await prisma.companyJob.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  const data = cleanJobInput(input);
  const job = await prisma.companyJob.update({ where: { id }, data: { ...data, ...(data.status && data.status !== before.status ? statusFields(data.status, before) : {}) } });
  return { job: shapeJob(job, await countsFor(orgId, [id])) };
}

async function removeJob(orgId, id) {
  const job = await prisma.companyJob.findFirst({ where: { id, org_id: orgId, deleted_at: null }, select: { id: true } });
  if (!job) return { error: 'not_found' };
  await prisma.companyJob.update({ where: { id }, data: { deleted_at: new Date(), status: 'closed' } });
  return { ok: true };
}

const shapeApplication = (a) => ({
  id: a.id, job_id: a.job_id, job: a.job ? { id: a.job.id, title: a.job.title, job_code: a.job.job_code } : null, name: a.name, email: a.email, phone: a.phone,
  experience_years: n(a.experience_years), cv_url: a.cv_url, linkedin_url: a.linkedin_url, message: a.message, channel: a.channel, referred_by: a.referred_by,
  answers: a.answers || {}, status: a.status, notes: a.notes, created_at: a.created_at, updated_at: a.updated_at,
});

function applicationWhere(orgId, q) {
  const range = {};
  if (q.from) range.gte = new Date(`${q.from}T00:00:00.000Z`);
  if (q.to) range.lte = new Date(`${q.to}T23:59:59.999Z`);
  return {
    org_id: orgId, deleted_at: null, ...(q.job_id ? { job_id: q.job_id } : {}), ...(q.status ? { status: q.status } : {}), ...(Object.keys(range).length ? { created_at: range } : {}),
    ...(q.q ? { OR: ['name', 'email', 'phone'].map((f) => ({ [f]: { contains: q.q, mode: 'insensitive' } })) } : {}),
  };
}

async function listApplications(orgId, q) {
  const where = applicationWhere(orgId, q);
  const [rows, total, byStatus] = await Promise.all([
    prisma.companyJobApplication.findMany({ where, include: { job: { select: { id: true, title: true, job_code: true } } }, orderBy: { created_at: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit }),
    prisma.companyJobApplication.count({ where }),
    prisma.companyJobApplication.groupBy({ by: ['status'], where: applicationWhere(orgId, { ...q, status: undefined }), _count: { _all: true } }),
  ]);
  return { applications: rows.map(shapeApplication), pagination: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) }, by_status: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])) };
}

async function updateApplication(orgId, id, input) {
  const row = await prisma.companyJobApplication.findFirst({ where: { id, org_id: orgId, deleted_at: null }, select: { id: true } });
  if (!row) return { error: 'not_found' };
  const a = await prisma.companyJobApplication.update({ where: { id }, data: input, include: { job: { select: { id: true, title: true, job_code: true } } } });
  return { application: shapeApplication(a) };
}

async function exportRows(orgId, q) {
  const rows = await prisma.companyJobApplication.findMany({ where: applicationWhere(orgId, q), include: { job: { select: { title: true, job_code: true } } }, orderBy: { created_at: 'desc' }, take: 5000 });
  return rows.map((a) => {
    const x = a.answers || {};
    return {
      'Applied on': a.created_at.toISOString().slice(0, 10), 'Job ID': a.job?.job_code || '', Job: a.job?.title || '', Name: a.name, Email: a.email, Phone: a.phone || '', 'Experience (yrs)': n(a.experience_years) ?? '',
      Status: a.status, 'Joiner status': x.joiner_status || '', 'Notice (days)': x.notice_period_days ?? '', 'Current CTC (LPA)': x.current_ctc_lpa ?? '', 'Expected CTC (LPA)': x.expected_ctc_lpa ?? '',
      'Work mode': x.work_mode || '', 'LinkedIn': a.linkedin_url || '', CV: a.cv_url || '', Source: a.channel || '', 'Referred by': a.referred_by || '', Message: a.message || '', Notes: a.notes || '',
    };
  });
}

// The public apply form of a company's own job. The same checks as Delphic's form ran before this (name, phone, experience, Drive CV link ...).
async function recordApplication(posting, d, screening) {
  const email = d.email.toLowerCase();
  const dup = await prisma.companyJobApplication.findFirst({ where: { job_id: posting.id, deleted_at: null, email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
  if (dup) return { error: 'already_applied' };
  const answerKeys = Object.keys(screening.fields).filter((k) => !['cv_url', 'linkedin_url'].includes(k));
  const answers = Object.fromEntries(answerKeys.map((k) => [k, d[k]]).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const known = ['linkedin', 'website', 'whatsapp', 'referral', 'naukri'];
  await prisma.companyJobApplication.create({
    data: {
      org_id: posting.org_id, job_id: posting.id, name: d.name, email, phone: d.phone, experience_years: d.experience_years ?? null, cv_url: d.cv_url || null, linkedin_url: d.linkedin_url || null,
      message: d.message || null, channel: d.channel ? (known.includes(d.channel) ? d.channel : 'other') : 'website', referred_by: d.referred_by || d.ref || null, answers,
    },
  });
  return { ok: true, job_code: posting.job_code, title: posting.title };
}

module.exports = {
  STATUSES, APPLICATION_STATUSES, createJobSchema, updateJobSchema, listApplicationsSchema, updateApplicationSchema,
  listJobs, createJob, updateJob, removeJob, listApplications, updateApplication, exportRows, recordApplication, prefixOf,
};
