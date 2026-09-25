const prisma = require('../../config/db');

async function createClaim(orgId, orgMembershipId, { location_id, category, amount, currency }) {
  const location = await prisma.location.findFirst({ where: { id: location_id, org_id: orgId } });
  if (!location) return { error: 'location_not_found' };

  const claim = await prisma.expenseClaim.create({
    data: { org_id: orgId, org_membership_id: orgMembershipId, location_id, category, amount, currency },
  });
  return { claim };
}

// Edit a submitted claim (location, category, amount, currency) while it is still
// pending. The owner edits their own; an admin can edit anyone's. Once a claim
// has been approved, rejected or reimbursed it is a record of a decision and is
// no longer editable. A claim someone else owns reads as not found.
async function updateClaim(orgId, claimId, actor, patch) {
  const claim = await prisma.expenseClaim.findFirst({ where: { id: claimId, org_id: orgId } });
  if (!claim) return { error: 'not_found' };
  if (actor.role !== 'admin' && claim.org_membership_id !== actor.orgMembershipId) return { error: 'not_found' };
  if (claim.status !== 'pending') return { error: 'not_editable', status: claim.status };

  if (patch.location_id) {
    const location = await prisma.location.findFirst({ where: { id: patch.location_id, org_id: orgId } });
    if (!location) return { error: 'location_not_found' };
  }
  const updated = await prisma.expenseClaim.update({
    where: { id: claimId },
    data: patch,
    include: { location: { select: { id: true, name: true } } },
  });
  return { claim: updated };
}

async function listMyClaims(orgId, orgMembershipId, { status, page, limit }) {
  const where = { org_id: orgId, org_membership_id: orgMembershipId, ...(status ? { status } : {}) };
  const [data, total] = await Promise.all([
    prisma.expenseClaim.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { location: { select: { id: true, name: true } } },
    }),
    prisma.expenseClaim.count({ where }),
  ]);
  return { data, pagination: { page, limit, total } };
}

async function listClaims(orgId, { org_membership_id, status, page, limit }) {
  const where = { org_id: orgId, ...(org_membership_id ? { org_membership_id } : {}), ...(status ? { status } : {}) };
  const [data, total] = await Promise.all([
    prisma.expenseClaim.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        location: { select: { id: true, name: true } },
        org_membership: { select: { id: true, person: { select: { id: true, name: true } } } },
      },
    }),
    prisma.expenseClaim.count({ where }),
  ]);
  return { data, pagination: { page, limit, total } };
}

async function decideClaim(orgId, claimId, adminUserId, { status, reason }) {
  const claim = await prisma.expenseClaim.findFirst({ where: { id: claimId, org_id: orgId } });
  if (!claim) return { error: 'not_found' };
  if (claim.status !== 'pending') return { error: 'already_decided' };

  const updated = await prisma.expenseClaim.update({
    where: { id: claimId },
    data: { status, decided_by: adminUserId, decided_at: new Date(), decision_reason: reason },
  });
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

module.exports = {
  createClaim,
  updateClaim,
  listMyClaims,
  listClaims,
  decideClaim,
  reimburseClaim,
  createVendorPayment,
  listVendorPayments,
  getVendorPayment,
  decideVendorPayment,
  markVendorPaymentPaid,
};
