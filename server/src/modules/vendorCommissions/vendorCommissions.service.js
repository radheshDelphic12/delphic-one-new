const prisma = require('../../config/db');

// Submissions a commission could be raised for: closed, sourced from a
// vendor, and not already carrying a commission row (the @@unique on
// submission_id also enforces this at the DB level — this is just so the
// create form offers a real picker instead of a free-text submission id).
async function listEligibleSubmissions(orgId) {
  return prisma.submission.findMany({
    where: { org_id: orgId, stage: 'closed', profile: { source: 'vendor', vendor_account_id: { not: null } }, vendor_commission: null },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      created_at: true,
      profile: { select: { id: true, name: true, vendor_account: { select: { id: true, name: true } } } },
      seat: { select: { requirement: { select: { id: true, title: true } } } },
    },
  });
}

// vendor_account_id is derived from the sourcing profile, never admin-entered —
// that is what makes the payout auditable back to the actual sourcing vendor.
async function createCommission(orgId, createdByUserId, { submission_id, amount, currency }) {
  const submission = await prisma.submission.findFirst({
    where: { id: submission_id, org_id: orgId },
    include: { profile: { select: { source: true, vendor_account_id: true } } },
  });
  if (!submission) return { error: 'submission_not_found' };
  if (submission.stage !== 'closed') return { error: 'submission_not_closed' };
  if (submission.profile.source !== 'vendor' || !submission.profile.vendor_account_id) return { error: 'not_vendor_sourced' };

  const existing = await prisma.vendorCommission.findUnique({ where: { submission_id } });
  if (existing) return { error: 'already_exists' };

  const commission = await prisma.vendorCommission.create({
    data: {
      org_id: orgId,
      vendor_account_id: submission.profile.vendor_account_id,
      submission_id,
      amount,
      currency,
      created_by: createdByUserId,
    },
  });
  return { commission };
}

async function listCommissions(orgId, { status, vendor_account_id, page, limit }) {
  const where = { org_id: orgId, ...(status ? { status } : {}), ...(vendor_account_id ? { vendor_account_id } : {}) };
  const [data, total] = await Promise.all([
    prisma.vendorCommission.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        vendor_account: { select: { id: true, name: true } },
        submission: { select: { id: true, profile: { select: { id: true, name: true } } } },
      },
    }),
    prisma.vendorCommission.count({ where }),
  ]);
  return { data, pagination: { page, limit, total } };
}

async function decideCommission(orgId, commissionId, adminUserId, { status, reason }) {
  const commission = await prisma.vendorCommission.findFirst({ where: { id: commissionId, org_id: orgId } });
  if (!commission) return { error: 'not_found' };
  if (commission.status !== 'pending') return { error: 'already_decided' };

  const updated = await prisma.vendorCommission.update({
    where: { id: commissionId },
    data: { status, decided_by: adminUserId, decided_at: new Date(), decision_reason: reason },
  });
  return { commission: updated };
}

// Only reachable from 'approved' — mirrors expenses/vendor-payments' own
// decide-then-pay split exactly. No payment automation this round.
async function markCommissionPaid(orgId, commissionId) {
  const commission = await prisma.vendorCommission.findFirst({ where: { id: commissionId, org_id: orgId } });
  if (!commission) return { error: 'not_found' };
  if (commission.status !== 'approved') return { error: 'not_approved' };

  const updated = await prisma.vendorCommission.update({ where: { id: commissionId }, data: { status: 'paid', paid_at: new Date() } });
  return { commission: updated };
}

module.exports = { listEligibleSubmissions, createCommission, listCommissions, decideCommission, markCommissionPaid };
