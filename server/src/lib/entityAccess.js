/**
 * Parent-entity access checks for documents, comments, and history sub-routes.
 * Mirrors the ownership rules used on each entity's getOne handler.
 */

const prisma = require('../config/db');

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
  const sameOrg = !user.org_id || claim.org_id === user.org_id;
  const isOwner = Boolean(user.org_membership_id) && claim.org_membership_id === user.org_membership_id;
  if (!sameOrg || (user.role !== 'admin' && !isOwner)) return { error: 'not_found' };
  if (forWrite && claim.status !== 'pending') return { error: 'not_editable' };
  return { ok: true };
}

const CHECKERS = {
  account: canAccessAccount,
  requirement: canAccessRequirement,
  profile: canAccessProfile,
  submission: canAccessSubmission,
  expense_claim: canAccessExpenseClaim,
};

/**
 * Return { ok: true } or { error: 'not_found' | 'forbidden' | 'bad_entity' }.
 * forWrite is accepted for call-site clarity; account access is open for both read and write.
 * Expense-claim receipts are the exception: writes need the claim to still be pending.
 */
async function assertCanAccessEntity(user, entityType, entityId, opts = {}) {
  const checker = CHECKERS[entityType];
  if (!checker) return { error: 'bad_entity' };
  return checker(user, entityId, opts);
}

module.exports = {
  assertCanAccessEntity,
  canAccessAccount,
  canAccessRequirement,
  canAccessProfile,
  canAccessSubmission,
  canAccessExpenseClaim,
};
