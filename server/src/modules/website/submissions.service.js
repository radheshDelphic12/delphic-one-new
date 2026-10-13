const { z } = require('zod');
const prisma = require('../../config/db');
const { pageArgs, pagination, userNames } = require('../../lib/vertical');
const leadsService = require('../leads/leads.service');
const profilesService = require('../profiles/profiles.service');
const website = require('../../utils/websiteIntegration');
const client = require('./appsScriptClient');

// Website form submissions (contact / career / secure). Each form's sheet row
// gets a "Submission ID" from Apps Script; the sync pulls rows whose "Platform
// Status" is blank, stores them here, and writes the status back (Imported →
// Converted / Dismissed) so the sheet always shows what happened to a row.

const { FORMS } = client;
const STATUSES = ['new', 'converted', 'dismissed'];
const SHEET_STATUS = { new: 'Imported', converted: 'Converted', dismissed: 'Dismissed' };
const PAGE_SIZE = 200;
const MAX_PAGES = 10;
const LEAD_SOURCE = { contact: 'Website: contact form', secure: 'Website: Delphic Secure' };

const listQuerySchema = z.object({
  form_type: z.enum(FORMS).optional(),
  status: z.enum(STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const convertProfileSchema = z.object({
  total_experience_years: z.coerce.number().min(0).max(60),
  primary_skills: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
});
const toApplicantSchema = z.object({ requirement_id: z.string().uuid() });

const field = (payload, key) => String(payload?.[key] ?? '').trim();

function toRow(orgId, form, sheetRow) {
  const fields = sheetRow.fields || {};
  const ts = new Date(field(fields, 'Timestamp'));
  return {
    org_id: orgId,
    form_type: form,
    external_id: sheetRow.submissionId,
    sheet_row: Number.isInteger(sheetRow.row) ? sheetRow.row : null,
    payload: fields,
    name: field(fields, 'Name') || null,
    email: field(fields, 'Email') || null,
    submitted_at: Number.isNaN(ts.getTime()) ? null : ts,
  };
}

/** Writes Platform Status for these rows in one form's sheet; flags the ones that landed. */
async function markInSheet(form, rows) {
  if (!rows.length) return {};
  const result = await client.call(form, 'markSubmissions', {
    updates: rows.map((r) => ({ submissionId: r.external_id, status: SHEET_STATUS[r.status] })),
  });
  if (result.error) return result;
  const missing = new Set(result.data.missing || []);
  const landed = rows.filter((r) => !missing.has(r.external_id)).map((r) => r.id);
  if (landed.length) {
    await prisma.websiteSubmission.updateMany({ where: { id: { in: landed } }, data: { sheet_status_synced: true } });
  }
  return {};
}

/** Retries sheet status writes that failed earlier (e.g. a Converted mark during an outage). */
async function pushPendingStatuses(orgId, errors) {
  const pending = await prisma.websiteSubmission.findMany({
    where: { org_id: orgId, sheet_status_synced: false },
    select: { id: true, form_type: true, external_id: true, status: true },
    take: 500,
  });
  for (const form of FORMS) {
    const result = await markInSheet(form, pending.filter((r) => r.form_type === form));
    if (result.error) errors.push(result.message || result.error);
  }
}

/** Pulls every not-yet-imported row from the three form sheets. */
async function sync(orgId) {
  const summary = { imported: 0, routed: 0, by_form: {}, errors: [] };
  for (const form of FORMS) {
    summary.by_form[form] = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const listed = await client.call(form, 'listSubmissions', { limit: PAGE_SIZE });
      if (listed.error) {
        summary.errors.push(listed.message || listed.error);
        break;
      }
      const sheetRows = (listed.data.submissions || []).filter((r) => r.submissionId);
      if (sheetRows.length) {
        const created = await prisma.websiteSubmission.createMany({
          data: sheetRows.map((r) => toRow(orgId, form, r)),
          skipDuplicates: true,
        });
        summary.by_form[form] += created.count;
        summary.imported += created.count;
        if (form === 'career' && created.count) {
          summary.routed += await routeCareerApplications(sheetRows.map((r) => r.submissionId));
        }

        // Mark with each row's real status: a row seen before may already be converted.
        const stored = await prisma.websiteSubmission.findMany({
          where: { external_id: { in: sheetRows.map((r) => r.submissionId) } },
          select: { id: true, external_id: true, status: true },
        });
        const marked = await markInSheet(form, stored);
        // Without the mark the next page would return the same rows: stop here, the next run retries.
        if (marked.error) {
          summary.errors.push(marked.message || marked.error);
          break;
        }
      }
      if (!listed.data.hasMore) break;
    }
  }
  await pushPendingStatuses(orgId, summary.errors);
  return summary;
}

function serialize(row, users) {
  return { ...row, handled_by_user: row.handled_by ? users?.get(row.handled_by) || null : null };
}

async function list(orgId, { form_type, status, search, page, limit }) {
  const where = {
    org_id: orgId,
    ...(form_type ? { form_type } : {}),
    ...(status ? { status } : {}),
    ...(search
      ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] }
      : {}),
  };
  const [rows, total, counts] = await Promise.all([
    prisma.websiteSubmission.findMany({ where, orderBy: [{ submitted_at: 'desc' }, { created_at: 'desc' }], ...pageArgs({ page, limit }) }),
    prisma.websiteSubmission.count({ where }),
    prisma.websiteSubmission.groupBy({ by: ['form_type', 'status'], where: { org_id: orgId }, _count: { id: true } }),
  ]);
  const users = await userNames(rows.map((r) => r.handled_by));
  return {
    data: rows.map((r) => serialize(r, users)),
    pagination: pagination(page, limit, total),
    counts: counts.map((c) => ({ form_type: c.form_type, status: c.status, count: c._count.id })),
  };
}

async function getOwned(orgId, id) {
  return prisma.websiteSubmission.findFirst({ where: { id, org_id: orgId } });
}

// userId null = done by the sync itself (no audit row: AuditLog needs a person).
async function finish(submission, userId, data, action, reason, { mark = true } = {}) {
  const row = await prisma.websiteSubmission.update({
    where: { id: submission.id },
    data: { ...data, handled_by: userId, handled_at: new Date(), sheet_status_synced: false },
  });
  if (userId) {
    await prisma.auditLog.create({
      data: {
        actor_id: userId,
        action,
        entity_type: 'website_submission',
        entity_id: row.id,
        reason,
        snapshot: { form_type: row.form_type, external_id: row.external_id, ...data },
        org_id: row.org_id,
      },
    });
  }
  // Best effort: a failed mark is retried by the next sync.
  if (mark) await markInSheet(row.form_type, [row]);
  return prisma.websiteSubmission.findUnique({ where: { id: row.id } });
}

function applicantPayload(submission, requirementId) {
  const p = submission.payload || {};
  const email = field(p, 'Email');
  const notes = [field(p, 'About'), field(p, 'Resume Link') && `Resume: ${field(p, 'Resume Link')}`].filter(Boolean).join('\n\n');
  return {
    requirement_id: requirementId,
    name: (field(p, 'Name') || 'Website applicant').slice(0, 200),
    email: z.string().email().safeParse(email).success ? email : null,
    phone: field(p, 'Phone').slice(0, 40) || null,
    notes: notes.slice(0, 2000) || null,
  };
}

/**
 * Sends new career applications straight to the applicant pool when the role they applied for is a job the platform
 * published and its requirement is in progress. Anything that doesn't match stays "new" for an admin to route.
 */
async function routeCareerApplications(externalIds) {
  const rows = await prisma.websiteSubmission.findMany({ where: { external_id: { in: externalIds }, form_type: 'career', status: 'new' } });
  if (!rows.length) return 0;
  const live = await prisma.websiteJobPosting.findMany({
    where: { status: 'published', requirement: { status: 'in_progress' } },
    select: { requirement_id: true, title: true },
  });
  const byTitle = new Map(live.map((p) => [p.title.trim().toLowerCase(), p.requirement_id]));
  let routed = 0;
  for (const row of rows) {
    const requirementId = byTitle.get(field(row.payload, 'Role').toLowerCase());
    if (!requirementId) continue;
    const result = await website.ingestWebsiteApplication(applicantPayload(row, requirementId));
    if (result.error) continue;
    await finish(row, null, { status: 'converted', converted_applicant_id: result.applicant.id }, null, null, { mark: false });
    routed += 1;
  }
  return routed;
}

const APPLICANT_ERRORS = { requirement_not_found: 'requirement_not_found', requirement_not_in_progress: 'requirement_not_in_progress', duplicate_applicant: 'duplicate_applicant' };

/** Admin routes one career application into a chosen in-progress requirement's applicant pool. */
async function toApplicant(orgId, userId, id, { requirement_id }) {
  const submission = await getOwned(orgId, id);
  if (!submission) return { error: 'not_found' };
  if (submission.form_type !== 'career') return { error: 'wrong_form' };
  if (submission.status !== 'new') return { error: 'already_handled' };
  const result = await website.ingestWebsiteApplication(applicantPayload(submission, requirement_id));
  if (result.error) return { error: APPLICANT_ERRORS[result.error] || result.error };
  const row = await finish(submission, userId, { status: 'converted', converted_applicant_id: result.applicant.id }, 'website_to_applicant', 'Sent website application to the applicant pool');
  return { submission: row, applicant: result.applicant };
}

async function convertToLead(orgId, userId, id) {
  const submission = await getOwned(orgId, id);
  if (!submission) return { error: 'not_found' };
  if (submission.form_type === 'career') return { error: 'wrong_form' };
  if (submission.status !== 'new') return { error: 'already_handled' };

  const p = submission.payload || {};
  const name = field(p, 'Name');
  const company = field(p, 'Company');
  const email = field(p, 'Email');
  const notes = [field(p, 'Message'), field(p, 'Team Members') && `Team members: ${field(p, 'Team Members')}`]
    .filter(Boolean)
    .join('\n\n');
  const parsed = leadsService.createLeadSchema.safeParse({
    name: (company || name || 'Website enquiry').slice(0, 200),
    contact_name: name ? name.slice(0, 200) : null,
    email: z.string().email().safeParse(email).success ? email : null,
    phone: field(p, 'Phone').slice(0, 40) || null,
    source: LEAD_SOURCE[submission.form_type],
    notes: notes.slice(0, 2000) || null,
  });
  if (!parsed.success) return { error: 'invalid', issues: parsed.error.issues };

  const { lead } = await leadsService.create(orgId, userId, parsed.data);
  const row = await finish(submission, userId, { status: 'converted', converted_lead_id: lead.id }, 'website_convert_lead', `Converted website ${submission.form_type} enquiry to a lead`);
  return { submission: row, lead };
}

async function convertToProfile(orgId, userId, id, body) {
  const submission = await getOwned(orgId, id);
  if (!submission) return { error: 'not_found' };
  if (submission.form_type !== 'career') return { error: 'wrong_form' };
  if (submission.status !== 'new') return { error: 'already_handled' };

  const p = submission.payload || {};
  const email = field(p, 'Email');
  // Someone already in the talent pool: link them rather than create a duplicate.
  const existing = email
    ? await prisma.profile.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, name: true } })
    : null;

  let profile = existing;
  if (!existing) {
    const role = field(p, 'Role');
    const notes = [role && `Applied via the website for: ${role}`, field(p, 'About')].filter(Boolean).join('\n\n');
    profile = await profilesService.create(
      {
        name: field(p, 'Name') || 'Website applicant',
        email: email || null,
        phone: field(p, 'Phone') || null,
        resume_url: field(p, 'Resume Link') || null,
        source: 'direct',
        total_experience_years: body.total_experience_years,
        primary_skills: body.primary_skills,
        recruiter_notes: notes || null,
        org_id: orgId,
      },
      userId
    );
  }

  const row = await finish(
    submission,
    userId,
    { status: 'converted', converted_profile_id: profile.id },
    'website_convert_profile',
    existing ? 'Linked website application to an existing candidate' : 'Converted website application to a candidate'
  );
  return { submission: row, profile: { id: profile.id, name: profile.name }, linked_existing: Boolean(existing) };
}

async function dismiss(orgId, userId, id) {
  const submission = await getOwned(orgId, id);
  if (!submission) return { error: 'not_found' };
  if (submission.status !== 'new') return { error: 'already_handled' };
  const row = await finish(submission, userId, { status: 'dismissed' }, 'website_dismiss', `Dismissed website ${submission.form_type} submission`);
  return { submission: row };
}

module.exports = {
  listQuerySchema,
  convertProfileSchema,
  toApplicantSchema,
  sync,
  list,
  convertToLead,
  convertToProfile,
  toApplicant,
  dismiss,
};
