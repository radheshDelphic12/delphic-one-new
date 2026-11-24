const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const prisma = require('../../config/db');
const env = require('../../config/env');

// Vendor portal (docs/features/VENDOR-PORTAL.md). A vendor's people sign in on their own page with their own login (never a company user):
//  - they see only the requirements the team shared with their company (no client name, no budget);
//  - they put candidates forward; a person in charge approves (then a normal Profile is created, source "vendor") or rejects with a reason;
//  - they see their resources with the VENDOR rate only (never what we charge a client);
//  - they upload invoice files, which the team sees in Finance as "Uploaded by vendor". An upload never creates an invoice by itself.
// Portal data lives in its own tables (vendor_portal_*) and private folders, apart from anything the company's own users read.

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const secret = () => `${env.jwt.accessSecret}::vendor-portal`;
const root = () => path.resolve(env.uploadDir);
const cvDir = () => path.join(root(), 'vendor-cv');
const invoiceDir = () => path.join(root(), 'vendor-invoices');
const ensure = (d) => fs.mkdirSync(d, { recursive: true });
const num = (v) => (v == null ? null : Number(v));
const ext = (name) => (path.extname(String(name || '')).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8) || '.bin');
const CV_EXT = new Set(['.pdf', '.doc', '.docx']);
const INVOICE_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.xls', '.xlsx', '.doc', '.docx']);

// ---------------------------------------------------------------------------------------------------------------------------
// Sign in

const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

async function login(input) {
  const user = await prisma.vendorPortalUser.findUnique({ where: { email: input.email } });
  if (!user || !user.active || !(await bcrypt.compare(input.password, user.password_hash))) return { error: 'bad_login' };
  const account = await prisma.account.findFirst({ where: { id: user.vendor_account_id, type: 'vendor' }, select: { id: true, name: true } });
  if (!account) return { error: 'bad_login' };
  await prisma.vendorPortalUser.update({ where: { id: user.id }, data: { last_login_at: new Date() } });
  const token = jwt.sign({ vpu: user.id, kind: 'vendor-portal' }, secret(), { expiresIn: '12h' });
  return { token, user: shape(user, account) };
}

const shape = (u, account) => ({ id: u.id, name: u.name, email: u.email, vendor: account ? { id: account.id, name: account.name } : null });

/** Reads a portal token; returns the live portal user (active, vendor still exists) or null. */
async function userFromToken(token) {
  let payload;
  try { payload = jwt.verify(token, secret()); } catch { return null; }
  if (payload.kind !== 'vendor-portal') return null;
  const user = await prisma.vendorPortalUser.findUnique({ where: { id: payload.vpu } });
  if (!user || !user.active) return null;
  const account = await prisma.account.findFirst({ where: { id: user.vendor_account_id, type: 'vendor' }, select: { id: true, name: true } });
  if (!account) return null;
  return { ...user, vendor_name: account.name };
}

const me = (u) => ({ id: u.id, name: u.name, email: u.email, vendor: { id: u.vendor_account_id, name: u.vendor_name } });

// ---------------------------------------------------------------------------------------------------------------------------
// What the vendor sees

const reqShape = (r, mine) => ({
  id: r.id, title: r.title, designation: r.designation, description: r.description || r.job_description,
  skills: [...(r.primary_tech_stack || []), ...(r.secondary_tech_stack || [])],
  experience_min: num(r.experience_min), experience_max: num(r.experience_max),
  work_mode: r.work_mode, work_location: r.work_location, engagement_type: r.engagement_type,
  contract_duration_months: r.contract_duration_months, seats_total: r.seats_total, notice_period_max_days: r.notice_period_max_days,
  start_date_target: r.start_date_target ? r.start_date_target.toISOString().slice(0, 10) : null,
  submitted: mine, // deliberately no client name, budget or billing detail
});

async function portalRequirements(u) {
  const shares = await prisma.vendorRequirementShare.findMany({ where: { org_id: u.org_id, vendor_account_id: u.vendor_account_id }, select: { requirement_id: true } });
  if (!shares.length) return [];
  const rows = await prisma.requirement.findMany({ where: { id: { in: shares.map((s) => s.requirement_id) }, status: { in: ['open', 'in_progress'] } }, orderBy: { created_at: 'desc' } });
  const counts = await prisma.vendorSubmission.groupBy({ by: ['requirement_id'], where: { vendor_account_id: u.vendor_account_id, requirement_id: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
  const byReq = new Map(counts.map((c) => [c.requirement_id, c._count._all]));
  return rows.map((r) => reqShape(r, byReq.get(r.id) || 0));
}

const decimalOpt = z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().min(0).max(1e10).optional());
const intOpt = z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().min(0).max(1000).optional());
const strOpt = (n) => z.preprocess((v) => (v == null || String(v).trim() === '' ? undefined : String(v).trim()), z.string().max(n).optional());
const submissionSchema = z.object({
  requirement_id: z.string().uuid(),
  candidate_name: z.string().trim().min(1, 'Candidate name is required').max(120),
  email: z.preprocess((v) => (v == null || String(v).trim() === '' ? undefined : String(v).trim().toLowerCase()), z.string().email('Enter a valid email').optional()),
  phone: strOpt(30), current_company: strOpt(120), current_location: strOpt(120),
  total_experience_years: z.preprocess((v) => Number(v), z.number().min(0, 'Enter the total experience').max(60)),
  relevant_experience_years: decimalOpt,
  skills: z.preprocess((v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean), z.array(z.string().max(60)).max(40)),
  current_ctc: decimalOpt, expected_ctc: decimalOpt, notice_period_days: intOpt, vendor_rate: decimalOpt,
  vendor_rate_currency: z.enum(['INR', 'USD', 'AED', 'EUR', 'GBP']).default('INR'),
  linkedin_url: strOpt(300), cv_url: strOpt(500), notes: strOpt(2000),
});

const subShape = (s, extra = {}) => ({
  id: s.id, requirement_id: s.requirement_id, candidate_name: s.candidate_name, email: s.email, phone: s.phone,
  current_company: s.current_company, current_location: s.current_location,
  total_experience_years: num(s.total_experience_years), relevant_experience_years: num(s.relevant_experience_years),
  skills: s.skills, current_ctc: num(s.current_ctc), expected_ctc: num(s.expected_ctc), notice_period_days: s.notice_period_days,
  vendor_rate: num(s.vendor_rate), vendor_rate_currency: s.vendor_rate_currency, linkedin_url: s.linkedin_url,
  cv_url: s.cv_url, has_cv_file: Boolean(s.cv_file_path), cv_file_name: s.cv_file_name, notes: s.notes,
  status: s.status, decision_note: s.decision_note, decided_at: s.decided_at, created_at: s.created_at, profile_id: s.profile_id || null, ...extra,
});

async function createSubmission(u, input, file) {
  const shared = await prisma.vendorRequirementShare.findFirst({ where: { org_id: u.org_id, vendor_account_id: u.vendor_account_id, requirement_id: input.requirement_id } });
  const req = shared ? await prisma.requirement.findFirst({ where: { id: input.requirement_id, status: { in: ['open', 'in_progress'] } }, select: { id: true } }) : null;
  if (!req) return { error: 'requirement_not_available' };
  if (!file && !input.cv_url) return { error: 'cv_required' };
  if (file && (!CV_EXT.has(ext(file.originalname)) || file.size > MAX_FILE_BYTES)) return { error: file.size > MAX_FILE_BYTES ? 'file_too_large' : 'bad_cv_type' };
  const dup = await prisma.vendorSubmission.findFirst({
    where: {
      requirement_id: input.requirement_id, vendor_account_id: u.vendor_account_id, status: { in: ['pending_review', 'approved'] },
      OR: [...(input.email ? [{ email: { equals: input.email, mode: 'insensitive' } }] : []), ...(input.phone ? [{ phone: input.phone }] : [])],
    },
  });
  if (dup) return { error: 'duplicate' };
  let stored = null;
  if (file) {
    ensure(cvDir());
    stored = `${crypto.randomUUID()}${ext(file.originalname)}`;
    fs.writeFileSync(path.join(cvDir(), stored), file.buffer);
  }
  const { requirement_id, ...rest } = input;
  const row = await prisma.vendorSubmission.create({
    data: { ...rest, org_id: u.org_id, requirement_id, vendor_account_id: u.vendor_account_id, portal_user_id: u.id, cv_file_path: stored, cv_file_name: file ? String(file.originalname).slice(0, 200) : null },
  });
  return { submission: subShape(row) };
}

async function portalSubmissions(u) {
  const rows = await prisma.vendorSubmission.findMany({ where: { vendor_account_id: u.vendor_account_id }, orderBy: { created_at: 'desc' }, take: 300 });
  const reqs = await prisma.requirement.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.requirement_id))] } }, select: { id: true, title: true } });
  const title = new Map(reqs.map((r) => [r.id, r.title]));
  return rows.map((r) => subShape(r, { requirement_title: title.get(r.requirement_id) || 'Requirement' }));
}

async function withdrawSubmission(u, id) {
  const row = await prisma.vendorSubmission.findFirst({ where: { id, vendor_account_id: u.vendor_account_id } });
  if (!row) return { error: 'not_found' };
  if (row.status !== 'pending_review') return { error: 'not_pending' };
  await prisma.vendorSubmission.update({ where: { id }, data: { status: 'withdrawn' } });
  return { ok: true };
}

/** A vendor sees its own resources and ONLY the vendor rate (what we pay it), never what a client is billed. */
async function portalResources(u) {
  const rows = await prisma.orgMembership.findMany({
    where: { org_id: u.org_id, vendor_account_id: u.vendor_account_id, worker_type: 'contractor' },
    select: { id: true, employment_status: true, vendor_rate: true, vendor_rate_currency: true, person: { select: { name: true } }, designation: { select: { name: true } } },
    orderBy: { person: { name: 'asc' } },
  });
  return rows.map((m) => ({ id: m.id, name: m.person.name, designation: m.designation?.name || null, status: m.employment_status, vendor_rate: num(m.vendor_rate), currency: m.vendor_rate_currency || 'INR' }));
}

const invoiceSchema = z.object({
  period_month: z.preprocess((v) => Number(v), z.number().int().min(1).max(12)),
  period_year: z.preprocess((v) => Number(v), z.number().int().min(2020).max(2100)),
  invoice_number: strOpt(60), amount: decimalOpt,
  currency: z.enum(['INR', 'USD', 'AED', 'EUR', 'GBP']).default('INR'),
  invoice_date: strOpt(10), notes: strOpt(1000),
});

const invShape = (i, extra = {}) => ({
  id: i.id, vendor_account_id: i.vendor_account_id, period_month: i.period_month, period_year: i.period_year, invoice_number: i.invoice_number,
  invoice_date: i.invoice_date ? i.invoice_date.toISOString().slice(0, 10) : null, amount: num(i.amount), currency: i.currency, notes: i.notes,
  file_name: i.file_name, file_size: i.file_size, status: i.status, review_note: i.review_note, reviewed_at: i.reviewed_at, created_at: i.created_at, ...extra,
});

async function createInvoice(u, input, file) {
  if (!file) return { error: 'file_required' };
  if (!INVOICE_EXT.has(ext(file.originalname))) return { error: 'bad_invoice_type' };
  if (file.size > MAX_FILE_BYTES) return { error: 'file_too_large' };
  ensure(invoiceDir());
  const stored = `${crypto.randomUUID()}${ext(file.originalname)}`;
  fs.writeFileSync(path.join(invoiceDir(), stored), file.buffer);
  const row = await prisma.vendorPortalInvoice.create({
    data: {
      org_id: u.org_id, vendor_account_id: u.vendor_account_id, portal_user_id: u.id, period_month: input.period_month, period_year: input.period_year,
      invoice_number: input.invoice_number || null, amount: input.amount ?? null, currency: input.currency, notes: input.notes || null,
      invoice_date: input.invoice_date ? new Date(`${input.invoice_date}T00:00:00Z`) : null,
      file_path: stored, file_name: String(file.originalname).slice(0, 200), file_size: file.size,
    },
  });
  return { invoice: invShape(row) };
}

const portalInvoices = async (u) => (await prisma.vendorPortalInvoice.findMany({ where: { vendor_account_id: u.vendor_account_id }, orderBy: { created_at: 'desc' }, take: 200 })).map((i) => invShape(i));

async function portalInvoiceFile(u, id) {
  const row = await prisma.vendorPortalInvoice.findFirst({ where: { id, vendor_account_id: u.vendor_account_id } });
  return row ? { path: path.join(invoiceDir(), path.basename(row.file_path)), name: row.file_name } : null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The company's side

const userSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(8, 'Use at least 8 characters').max(100),
});
const userPatchSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), active: z.boolean().optional(), password: z.string().min(8).max(100).optional() });

async function vendorAccount(orgId, id) {
  return prisma.account.findFirst({ where: { id, org_id: orgId, type: 'vendor' }, select: { id: true, name: true, owner_id: true } });
}

/** One vendor's portal card: its logins, and its resources with BOTH rates (the vendor's, and what we bill the client). */
async function vendorOverview(orgId, vendorId) {
  const account = await vendorAccount(orgId, vendorId);
  if (!account) return { error: 'not_found' };
  const users = await prisma.vendorPortalUser.findMany({ where: { org_id: orgId, vendor_account_id: vendorId }, orderBy: { created_at: 'asc' } });
  const members = await prisma.orgMembership.findMany({
    where: { org_id: orgId, vendor_account_id: vendorId, worker_type: 'contractor' },
    select: { id: true, employment_status: true, vendor_rate: true, vendor_rate_currency: true, person: { select: { name: true } } },
    orderBy: { person: { name: 'asc' } },
  });
  const billing = members.length ? await prisma.resourceBillingRate.findMany({ where: { org_id: orgId, org_membership_id: { in: members.map((m) => m.id) } }, orderBy: { effective_from: 'desc' } }) : [];
  const accounts = billing.length ? await prisma.account.findMany({ where: { id: { in: [...new Set(billing.map((b) => b.account_id))] } }, select: { id: true, name: true } }) : [];
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  const resources = members.map((m) => {
    const latest = new Map();
    for (const b of billing.filter((x) => x.org_membership_id === m.id)) if (!latest.has(b.account_id)) latest.set(b.account_id, b);
    return {
      id: m.id, name: m.person.name, status: m.employment_status, vendor_rate: num(m.vendor_rate), vendor_currency: m.vendor_rate_currency || 'INR',
      billing: [...latest.values()].map((b) => ({ client: accName.get(b.account_id) || 'Client', rate_type: b.rate_type, rate: num(b.rate), currency: b.currency })),
    };
  });
  return {
    vendor: { id: account.id, name: account.name },
    users: users.map((x) => ({ id: x.id, name: x.name, email: x.email, active: x.active, last_login_at: x.last_login_at })),
    resources,
  };
}

async function addUser(orgId, actorId, vendorId, input) {
  if (!(await vendorAccount(orgId, vendorId))) return { error: 'not_found' };
  const taken = await prisma.vendorPortalUser.findUnique({ where: { email: input.email } });
  if (taken) return { error: 'email_taken' };
  const row = await prisma.vendorPortalUser.create({ data: { org_id: orgId, vendor_account_id: vendorId, name: input.name, email: input.email, password_hash: await bcrypt.hash(input.password, 10), created_by: actorId } });
  return { user: { id: row.id, name: row.name, email: row.email, active: row.active } };
}

async function updateUser(orgId, userId, patch) {
  const row = await prisma.vendorPortalUser.findFirst({ where: { id: userId, org_id: orgId } });
  if (!row) return { error: 'not_found' };
  const data = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.active !== undefined) data.active = patch.active;
  if (patch.password) data.password_hash = await bcrypt.hash(patch.password, 10);
  const u = await prisma.vendorPortalUser.update({ where: { id: userId }, data });
  return { user: { id: u.id, name: u.name, email: u.email, active: u.active } };
}

/** Which vendors a requirement is shared with, and the vendors that could be added. */
async function requirementShares(orgId, requirementId) {
  const req = await prisma.requirement.findFirst({ where: { id: requirementId, account: { org_id: orgId } }, select: { id: true } });
  if (!req) return { error: 'not_found' };
  const [vendors, shares] = await Promise.all([
    prisma.account.findMany({ where: { org_id: orgId, type: 'vendor' }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 500 }),
    prisma.vendorRequirementShare.findMany({ where: { org_id: orgId, requirement_id: requirementId }, select: { vendor_account_id: true } }),
  ]);
  const on = new Set(shares.map((s) => s.vendor_account_id));
  return { vendors: vendors.map((v) => ({ id: v.id, name: v.name, shared: on.has(v.id) })) };
}

async function setRequirementShares(orgId, actorId, requirementId, vendorIds) {
  const req = await prisma.requirement.findFirst({ where: { id: requirementId, account: { org_id: orgId } }, select: { id: true } });
  if (!req) return { error: 'not_found' };
  const valid = (await prisma.account.findMany({ where: { org_id: orgId, type: 'vendor', id: { in: vendorIds } }, select: { id: true } })).map((a) => a.id);
  await prisma.$transaction([
    prisma.vendorRequirementShare.deleteMany({ where: { org_id: orgId, requirement_id: requirementId, vendor_account_id: { notIn: valid } } }),
    prisma.vendorRequirementShare.createMany({ data: valid.map((v) => ({ org_id: orgId, requirement_id: requirementId, vendor_account_id: v, shared_by: actorId })), skipDuplicates: true }),
  ]);
  return requirementShares(orgId, requirementId);
}

/** The inbox. `ownerUserId` limits it to vendors that person is in charge of (the point of contact) when they have no wider permission. */
async function adminSubmissions(orgId, { status, ownerUserId }) {
  const where = { org_id: orgId, ...(status ? { status } : {}) };
  if (ownerUserId) {
    const mine = await prisma.account.findMany({ where: { org_id: orgId, type: 'vendor', owner_id: ownerUserId }, select: { id: true } });
    where.vendor_account_id = { in: mine.map((a) => a.id) };
  }
  const rows = await prisma.vendorSubmission.findMany({ where, orderBy: { created_at: 'desc' }, take: 300 });
  const [vendors, reqs] = await Promise.all([
    prisma.account.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.vendor_account_id))] } }, select: { id: true, name: true } }),
    prisma.requirement.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.requirement_id))] } }, select: { id: true, title: true } }),
  ]);
  const vn = new Map(vendors.map((v) => [v.id, v.name])); const rt = new Map(reqs.map((r) => [r.id, r.title]));
  return rows.map((r) => subShape(r, { vendor_name: vn.get(r.vendor_account_id) || 'Vendor', requirement_title: rt.get(r.requirement_id) || 'Requirement' }));
}

async function pendingCount(orgId, ownerUserId) {
  const where = { org_id: orgId, status: 'pending_review' };
  if (ownerUserId) {
    const mine = await prisma.account.findMany({ where: { org_id: orgId, type: 'vendor', owner_id: ownerUserId }, select: { id: true } });
    where.vendor_account_id = { in: mine.map((a) => a.id) };
  }
  return prisma.vendorSubmission.count({ where });
}

/** Who is in charge of the vendor behind a submission (for the "point of contact may approve" rule). */
async function submissionOwner(orgId, id) {
  const s = await prisma.vendorSubmission.findFirst({ where: { id, org_id: orgId }, select: { vendor_account_id: true } });
  if (!s) return undefined;
  return (await prisma.account.findUnique({ where: { id: s.vendor_account_id }, select: { owner_id: true } }))?.owner_id || null;
}

const decisionSchema = z.object({ note: z.string().trim().max(500).optional() });

/** Approve: only now a normal Profile is created (source vendor). A candidate already on file is reused, never duplicated. */
async function approve(orgId, actorId, id) {
  const s = await prisma.vendorSubmission.findFirst({ where: { id, org_id: orgId } });
  if (!s) return { error: 'not_found' };
  if (s.status !== 'pending_review') return { error: 'not_pending' };
  const email = s.email ? s.email.toLowerCase() : null;
  const existing = email ? await prisma.profile.findFirst({ where: { org_id: orgId, deleted_at: null, email: { equals: email, mode: 'insensitive' } }, select: { id: true } }) : null;
  const result = await prisma.$transaction(async (tx) => {
    let profileId = existing?.id || null;
    if (!profileId) {
      const p = await tx.profile.create({
        data: {
          org_id: orgId, name: s.candidate_name, email, phone: s.phone, current_location: s.current_location, current_company: s.current_company,
          total_experience_years: s.total_experience_years, relevant_experience_years: s.relevant_experience_years,
          primary_skills: s.skills, secondary_skills: [], certifications: [], domain_experience: [], preferred_locations: [],
          current_ctc: s.current_ctc, expected_ctc: s.expected_ctc, notice_period_days: s.notice_period_days,
          resume_url: s.cv_url, linkedin_url: s.linkedin_url, source: 'vendor', vendor_account_id: s.vendor_account_id, vendor_profile_id: s.id,
          added_by: actorId, recruiter_notes: `Put forward by the vendor through the vendor portal.${s.notes ? ` ${s.notes}` : ''}`,
        },
      });
      profileId = p.id;
      if (s.cv_file_path) {
        const src = path.join(cvDir(), path.basename(s.cv_file_path));
        if (fs.existsSync(src)) {
          ensure(root());
          const name = `${crypto.randomUUID()}${ext(s.cv_file_path)}`;
          fs.copyFileSync(src, path.join(root(), name));
          await tx.document.create({ data: { entity_type: 'profile', entity_id: profileId, label: s.cv_file_name || 'CV', file_url: `/uploads/${name}`, file_type: ext(name).slice(1), file_size_bytes: fs.statSync(path.join(root(), name)).size, uploaded_by: actorId, org_id: orgId, doc_type: 'CV' } });
        }
      }
    }
    await tx.vendorSubmission.update({ where: { id }, data: { status: 'approved', decided_by: actorId, decided_at: new Date(), profile_id: profileId } });
    return profileId;
  });
  return { profile_id: result, already_on_file: Boolean(existing) };
}

async function reject(orgId, actorId, id, note) {
  const s = await prisma.vendorSubmission.findFirst({ where: { id, org_id: orgId } });
  if (!s) return { error: 'not_found' };
  if (s.status !== 'pending_review') return { error: 'not_pending' };
  if (!note) return { error: 'reason_required' };
  await prisma.vendorSubmission.update({ where: { id }, data: { status: 'rejected', decided_by: actorId, decided_at: new Date(), decision_note: note } });
  return { ok: true };
}

async function submissionCv(orgId, id) {
  const s = await prisma.vendorSubmission.findFirst({ where: { id, org_id: orgId } });
  return s?.cv_file_path ? { path: path.join(cvDir(), path.basename(s.cv_file_path)), name: s.cv_file_name || 'cv' } : null;
}

/** Uploaded-by-vendor files for Finance. */
async function adminInvoices(orgId, { status }) {
  const rows = await prisma.vendorPortalInvoice.findMany({ where: { org_id: orgId, ...(status ? { status } : {}) }, orderBy: { created_at: 'desc' }, take: 300 });
  const vendors = await prisma.account.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.vendor_account_id))] } }, select: { id: true, name: true } });
  const vn = new Map(vendors.map((v) => [v.id, v.name]));
  return rows.map((r) => invShape(r, { vendor_name: vn.get(r.vendor_account_id) || 'Vendor', source: 'Uploaded by vendor' }));
}

const reviewSchema = z.object({ status: z.enum(['accepted', 'rejected']), note: z.string().trim().max(500).optional() });
async function reviewInvoice(orgId, actorId, id, input) {
  const row = await prisma.vendorPortalInvoice.findFirst({ where: { id, org_id: orgId } });
  if (!row) return { error: 'not_found' };
  if (input.status === 'rejected' && !input.note) return { error: 'reason_required' };
  const u = await prisma.vendorPortalInvoice.update({ where: { id }, data: { status: input.status, reviewed_by: actorId, reviewed_at: new Date(), review_note: input.note || null } });
  return { invoice: invShape(u) };
}

async function adminInvoiceFile(orgId, id) {
  const row = await prisma.vendorPortalInvoice.findFirst({ where: { id, org_id: orgId } });
  return row ? { path: path.join(invoiceDir(), path.basename(row.file_path)), name: row.file_name } : null;
}

module.exports = {
  loginSchema, login, userFromToken, me, portalRequirements, submissionSchema, createSubmission, portalSubmissions, withdrawSubmission,
  portalResources, invoiceSchema, createInvoice, portalInvoices, portalInvoiceFile,
  userSchema, userPatchSchema, vendorOverview, addUser, updateUser, requirementShares, setRequirementShares,
  adminSubmissions, pendingCount, submissionOwner, decisionSchema, approve, reject, submissionCv,
  adminInvoices, reviewSchema, reviewInvoice, adminInvoiceFile,
};
