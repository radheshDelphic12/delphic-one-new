/**
 * Parent-entity access checks for documents, comments, and history sub-routes.
 * Mirrors the ownership rules used on each entity's getOne handler.
 */

const prisma = require('../config/db');
const { isMasterWorkspace } = require('../middleware/requireMasterWorkspace');

// Recruitment records (accounts, requirements, profiles/CVs, submissions)
// live in the master workspace only. Their notes, files and history are
// reachable through routers that apply bare `authenticate` (documents,
// comments, /uploads), so the membership + master-workspace check the main
// recruitment routers get from requireMasterWorkspace is repeated here.
// Without it, an offboarded employee (no active membership -> no org_id)
// or a member of a subsidiary workspace could still read CVs.
const RECRUITMENT_ENTITIES = new Set(['account', 'requirement', 'profile', 'submission']);

async function hasRecruitmentAccess(user) {
  if (!user?.org_id || !user?.org_membership_id) return false;
  return isMasterWorkspace(user.org_id);
}

/**
 * Accounts are readable and writable team-wide for notes/files.
 * Account field edits and stage moves stay role-gated in accounts.service.
 */
async function canAccessAccount(user, accountId) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true },
  });
  if (!account) return { error: 'not_found' };
  return { ok: true };
}

async function canAccessRequirement(user, requirementId) {
  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    select: {
      id: true,
      sales_owner_id: true,
      assignments: {
        where: { role_on_req: 'recruiter', unassigned_at: null },
        select: { user_id: true },
      },
    },
  });
  if (!requirement) return { error: 'not_found' };
  if (user.role === 'admin') return { ok: true };
  if (user.role === 'sales' && requirement.sales_owner_id !== user.id) return { error: 'forbidden' };
  if (user.role === 'recruiter') {
    const assigned = requirement.assignments.some((row) => row.user_id === user.id);
    if (!assigned) return { error: 'forbidden' };
  }
  return { ok: true };
}

async function canAccessProfile(user, profileId) {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { id: true, added_by: true },
  });
  if (!profile) return { error: 'not_found' };
  // Profiles are shared across roles for staffing; any authenticated user may attach notes/files.
  return { ok: true };
}

async function canAccessSubmission(user, submissionId) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, submitted_by: true },
  });
  if (!submission) return { error: 'not_found' };
  if (user.role === 'admin') return { ok: true };
  if (user.role === 'recruiter' && submission.submitted_by !== user.id) return { error: 'forbidden' };
  return { ok: true };
}

// An expense claim's receipts: the claim's owner or an admin of the same org can
// see them; adding or removing one (forWrite) additionally needs the claim to
// still be pending — after a decision the receipts are part of the record.
async function canAccessExpenseClaim(user, claimId, { forWrite = false } = {}) {
  const claim = await prisma.expenseClaim.findUnique({
    where: { id: claimId },
    select: { id: true, org_id: true, org_membership_id: true, status: true },
  });
  if (!claim) return { error: 'not_found' };
  if (!user.org_id || !user.org_membership_id) return { error: 'membership_required' };
  const sameOrg = claim.org_id === user.org_id;
  const isOwner = Boolean(user.org_membership_id) && claim.org_membership_id === user.org_membership_id;
  if (!sameOrg || (user.role !== 'admin' && !isOwner)) return { error: 'not_found' };
  if (forWrite && claim.status !== 'pending') return { error: 'not_editable' };
  return { ok: true };
}

// A vendor invoice file on a project (Finance) — admins of the same org only.
async function canAccessProjectVendorInvoice(user, invoiceId) {
  const invoice = await prisma.projectVendorInvoice.findUnique({ where: { id: invoiceId }, select: { org_id: true } });
  if (!invoice) return { error: 'not_found' };
  if (!user.org_id || !user.org_membership_id) return { error: 'membership_required' };
  if (invoice.org_id !== user.org_id || user.role !== 'admin') return { error: 'not_found' };
  return { ok: true };
}

// An employee's own documents (ID proofs, letters …): an admin of the same
// org, or the employee themselves — for reading and uploading alike.
async function canAccessOrgMembership(user, membershipId) {
  const membership = await prisma.orgMembership.findUnique({ where: { id: membershipId }, select: { org_id: true } });
  if (!membership) return { error: 'not_found' };
  if (!user.org_id || !user.org_membership_id) return { error: 'membership_required' };
  if (membership.org_id !== user.org_id) return { error: 'not_found' };
  if (user.role !== 'admin' && membershipId !== user.org_membership_id) return { error: 'not_found' };
  return { ok: true };
}

const CHECKERS = {
  org_membership: canAccessOrgMembership,
  account: canAccessAccount,
  requirement: canAccessRequirement,
  profile: canAccessProfile,
  submission: canAccessSubmission,
  expense_claim: canAccessExpenseClaim,
  project_vendor_invoice: canAccessProjectVendorInvoice,
};

/**
 * Return { ok: true } or { error: 'not_found' | 'forbidden' | 'bad_entity' | 'membership_required' }.
 * membership_required: the caller has no active membership (recruitment
 * entities: in the master workspace) — always a hard 403, never ignorable.
 * forWrite is accepted for call-site clarity; account access is open for both read and write.
 * Expense-claim receipts are the exception: writes need the claim to still be pending.
 */
async function assertCanAccessEntity(user, entityType, entityId, opts = {}) {
  const checker = CHECKERS[entityType];
  if (!checker) return { error: 'bad_entity' };
  if (RECRUITMENT_ENTITIES.has(entityType) && !(await hasRecruitmentAccess(user))) return { error: 'membership_required' };
  return checker(user, entityId, opts);
}

module.exports = {
  assertCanAccessEntity,
  hasRecruitmentAccess,
  canAccessAccount,
  canAccessRequirement,
  canAccessProfile,
  canAccessSubmission,
  canAccessExpenseClaim,
};
