const prisma = require('../../config/db');
const { approverScope, canActOn, actionableWhere, nextStage } = require('../../lib/claimApprovers');

const CLAIM_INCLUDE = {
  location: { select: { id: true, name: true } },
  category_ref: { select: { id: true, name: true } },
  submitter: { select: { id: true, name: true } },
};

// "Other" — not one of the admin-managed categories; needs a description.
const isOther = (name) => String(name || '').trim().toLowerCase() === 'other';

// A picked category must be an active Expense category of this org; its name
// is kept on the claim too so the claim reads correctly if it's renamed.
async function resolveCategory(orgId, category_id) {
  return prisma.financeCategory.findFirst({ where: { id: category_id, org_id: orgId, kind: 'expense', is_active: true }, select: { id: true, name: true } });
}

// `actor` files the claim for `orgMembershipId`: themselves, or — an admin —
// any employee (recorded in submitted_by). It starts with the employee's
// manager, or with HR when they have none (Manager -> HR -> Finance).
async function createClaim(orgId, orgMembershipId, { location_id, category, category_id, expense_date, amount, currency, description }, actor = null) {
  const [location, member] = await Promise.all([
    prisma.location.findFirst({ where: { id: location_id, org_id: orgId } }),
    prisma.orgMembership.findFirst({ where: { id: orgMembershipId, org_id: orgId }, select: { id: true, manager_id: true } }),
  ]);
  if (!location) return { error: 'location_not_found' };
  if (!member) return { error: 'membership_not_found' };
  let name = category;
  if (category_id) {
    const picked = await resolveCategory(orgId, category_id);
    if (!picked) return { error: 'category_not_found' };
    name = picked.name;
  }
  if (isOther(name) && !String(description || '').trim()) return { error: 'description_required' };

  const onBehalf = actor && actor.orgMembershipId !== orgMembershipId;
  const claim = await prisma.expenseClaim.create({
    data: {
      org_id: orgId,
      org_membership_id: orgMembershipId,
      location_id,
      category: name,
      category_id: category_id || null,
      expense_date: expense_date || null,
      amount,
      currency,
      description: description?.trim() || null,
      submitted_by: onBehalf ? actor.userId : null,
      approval_stage: member.manager_id ? 'manager' : 'hr',
    },
    include: CLAIM_INCLUDE,
  });
  return { claim };
}

// Month / category / office / employee filters shared by both lists.
async function claimFilterWhere(orgId, { period_month, period_year, category_id, location_id, org_membership_id }) {
  const and = [];
  if (period_month && period_year) {
    const start = new Date(Date.UTC(period_year, period_month - 1, 1));
    const end = new Date(Date.UTC(period_year, period_month, 0));
    const endExclusive = new Date(Date.UTC(period_year, period_month, 1));
    and.push({ OR: [{ expense_date: { gte: start, lte: end } }, { expense_date: null, created_at: { gte: start, lt: endExclusive } }] });
  }
  if (category_id) {
    const cat = await prisma.financeCategory.findFirst({ where: { id: category_id, org_id: orgId }, select: { name: true } });
    and.push({ OR: [{ category_id }, ...(cat ? [{ category_id: null, category: { equals: cat.name, mode: 'insensitive' } }] : [])] });
  }
  if (location_id) and.push({ location_id });
  if (org_membership_id) and.push({ org_membership_id });
  return and.length ? { AND: and } : {};
}

// Edit a submitted claim (location, category, amount, currency) while it is still
// pending. The owner edits their own; an admin can edit anyone's. Once a claim
// has been approved, rejected or reimbursed it is a record of a decision and is
// no longer editable. A claim someone else owns reads as not found.
async function updateClaim(orgId, claimId, actor, patch) {
  const claim = await prisma.expenseClaim.findFirst({ where: { id: claimId, org_id: orgId } });
  if (!claim) return { error: 'not_found' };
  if (actor.role !== 'admin' && claim.org_membership_id !== actor.orgMembershipId) return { error: 'not_found' };
  if (claim.status !== 'pending' && !actor.isSuperadmin) return { error: 'not_editable', status: claim.status };

  if (patch.location_id) {
    const location = await prisma.location.findFirst({ where: { id: patch.location_id, org_id: orgId } });
    if (!location) return { error: 'location_not_found' };
  }
  const data = { ...patch };
  if (patch.category_id) {
    const picked = await resolveCategory(orgId, patch.category_id);
    if (!picked) return { error: 'category_not_found' };
    data.category = picked.name;
  } else if (patch.category) {
    data.category_id = null;
  }
  if (patch.description !== undefined) data.description = patch.description?.trim() || null;
  const description = data.description !== undefined ? data.description : claim.description;
  if (isOther(data.category ?? claim.category) && !description) return { error: 'description_required' };
  const updated = await prisma.expenseClaim.update({
    where: { id: claimId },
    data,
    include: CLAIM_INCLUDE,
  });
  return { claim: updated };
}

async function listMyClaims(orgId, orgMembershipId, { status, page, limit, ...filters }) {
  const where = { org_id: orgId, org_membership_id: orgMembershipId, ...(status ? { status } : {}), ...(await claimFilterWhere(orgId, filters)) };
  const [data, total] = await Promise.all([
    prisma.expenseClaim.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: CLAIM_INCLUDE,
    }),
    prisma.expenseClaim.count({ where }),
  ]);
  return { data, pagination: { page, limit, total } };
}

async function listClaims(orgId, { status, page, limit, ...filters }) {
  const where = { org_id: orgId, ...(status ? { status } : {}), ...(await claimFilterWhere(orgId, filters)) };
  const [data, total] = await Promise.all([
    prisma.expenseClaim.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        ...CLAIM_INCLUDE,
        org_membership: { select: { id: true, person: { select: { id: true, name: true } } } },
      },
    }),
    prisma.expenseClaim.count({ where }),
  ]);
  return { data, pagination: { page, limit, total } };
}

// Pending claims waiting on this user's step (their reports' claims at the
// manager step; every claim at HR / Finance for those departments; all
// pending claims for an admin).
async function listApprovals(orgId, user) {
  const scope = await approverScope(user);
  const where = actionableWhere(scope);
  if (!where) return { data: [], scope };
  const data = await prisma.expenseClaim.findMany({
    where: { org_id: orgId, ...where },
    orderBy: { created_at: 'asc' },
    include: { ...CLAIM_INCLUDE, org_membership: { select: { id: true, person: { select: { id: true, name: true } } } } },
  });
  return { data, scope };
}

// One step of Manager -> HR -> Finance. Approving moves the claim to the next
// step; Finance's approval makes it approved (ready to reimburse). An admin's
// decision is final whatever the step (an override, flagged `admin` in the
// log). A rejection at any step ends it. Each step is logged in `approvals`.
async function decideClaim(orgId, claimId, user, { status, reason }) {
  const claim = await prisma.expenseClaim.findFirst({
    where: { id: claimId, org_id: orgId },
    include: { org_membership: { select: { manager_id: true } } },
  });
  if (!claim) return { error: 'not_found' };
  if (claim.status !== 'pending') return { error: 'already_decided' };
  const stage = claim.approval_stage || 'finance';
  const scope = await approverScope(user);
  if (!canActOn(scope, stage, claim.org_membership.manager_id)) return { error: 'not_your_step', stage };
  // Nobody approves their own claim — unless they're an admin.
  if (!scope.admin && claim.org_membership_id === user.org_membership_id) return { error: 'own_claim' };

  const actor = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true } });
  const now = new Date();
  const approvals = [...(Array.isArray(claim.approvals) ? claim.approvals : []), { stage, status, by: user.id, name: actor?.name || null, at: now.toISOString(), reason: reason || null, ...(scope.admin ? { admin: true } : {}) }];
  const next = status === 'approved' && !scope.admin ? nextStage(stage) : null;
  const data = next
    ? { approval_stage: next, approvals }
    : { status, approval_stage: null, approvals, decided_by: user.id, decided_at: now, decision_reason: reason };
  const updated = await prisma.expenseClaim.update({ where: { id: claimId }, data, include: CLAIM_INCLUDE });
  return { claim: updated };
}

// Only reachable from 'approved' — the money is actually paid out here,
// a separate step from the approve/reject decision.
async function reimburseClaim(orgId, claimId) {
  const claim = await prisma.expenseClaim.findFirst({ where: { id: claimId, org_id: orgId } });
  if (!claim) return { error: 'not_found' };
  if (claim.status !== 'approved') return { error: 'not_approved' };

  const updated = await prisma.expenseClaim.update({
    where: { id: claimId },
    data: { status: 'reimbursed', reimbursed_at: new Date() },
  });
  return { claim: updated };
}

async function createVendorPayment(orgId, createdByUserId, body) {
  const payment = await prisma.vendorPayment.create({
    data: { org_id: orgId, created_by: createdByUserId, ...body },
  });
  return { payment };
}

async function listVendorPayments(orgId, { status, vendor_type, period_month, period_year }) {
  return prisma.vendorPayment.findMany({
    where: {
      org_id: orgId,
      ...(status ? { status } : {}),
      ...(vendor_type ? { vendor_type } : {}),
      ...(period_month ? { period_month } : {}),
      ...(period_year ? { period_year } : {}),
    },
    orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }],
  });
}

async function getVendorPayment(orgId, paymentId) {
  const payment = await prisma.vendorPayment.findFirst({ where: { id: paymentId, org_id: orgId } });
  if (!payment) return { error: 'not_found' };
  return { payment };
}

async function decideVendorPayment(orgId, paymentId, adminUserId, { status, reason }) {
  const payment = await prisma.vendorPayment.findFirst({ where: { id: paymentId, org_id: orgId } });
  if (!payment) return { error: 'not_found' };
  if (payment.status !== 'pending') return { error: 'already_decided' };

  const updated = await prisma.vendorPayment.update({
    where: { id: paymentId },
    data: { status, decided_by: adminUserId, decided_at: new Date(), decision_reason: reason },
  });
  return { payment: updated };
}

// Only reachable from 'approved'.
async function markVendorPaymentPaid(orgId, paymentId) {
  const payment = await prisma.vendorPayment.findFirst({ where: { id: paymentId, org_id: orgId } });
  if (!payment) return { error: 'not_found' };
  if (payment.status !== 'approved') return { error: 'not_approved' };

  const updated = await prisma.vendorPayment.update({ where: { id: paymentId }, data: { status: 'paid', paid_at: new Date() } });
  return { payment: updated };
}

// Delete a claim raised by mistake, with its receipt records (the files stay
// on disk like any other deleted document's history would). The owner or an
// admin: while it is still pending. A superadmin: whatever its status.
async function deleteClaim(orgId, claimId, actor = { isSuperadmin: true }) {
  const claim = await prisma.expenseClaim.findFirst({ where: { id: claimId, org_id: orgId }, select: { id: true, status: true, org_membership_id: true } });
  if (!claim) return { error: 'not_found' };
  if (!actor.isSuperadmin) {
    if (actor.role !== 'admin' && claim.org_membership_id !== actor.orgMembershipId) return { error: 'not_found' };
    if (claim.status !== 'pending') return { error: 'not_deletable' };
  }
  await prisma.$transaction([
    prisma.document.deleteMany({ where: { entity_type: 'expense_claim', entity_id: claimId } }),
    prisma.expenseClaim.delete({ where: { id: claimId } }),
  ]);
  return { deleted: true };
}

module.exports = {
  createClaim,
  updateClaim,
  deleteClaim,
  listMyClaims,
  listClaims,
  listApprovals,
  decideClaim,
  reimburseClaim,
  createVendorPayment,
  listVendorPayments,
  getVendorPayment,
  decideVendorPayment,
  markVendorPaymentPaid,
};
