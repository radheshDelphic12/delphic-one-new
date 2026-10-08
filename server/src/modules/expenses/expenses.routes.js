const express = require('express');
const { authenticate, authorize, loadSuperadminFlag, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./expenses.service');
const {
  createClaimSchema,
  updateClaimSchema,
  decideClaimSchema,
  listMyClaimsQuerySchema,
  listClaimsQuerySchema,
  createVendorPaymentSchema,
  decideVendorPaymentSchema,
  listVendorPaymentsQuerySchema,
} = require('./expenses.validation');

const router = express.Router();
router.use(authenticate, requireOrgMembership);

const ERRORS = {
  location_not_found: [404, 'Location not found'],
  not_found: [404, 'Not found'],
  already_decided: [409, 'Already decided'],
  not_approved: [422, 'Must be approved first'],
  financial_locked: [423, 'This month is financially locked - reopen the financial lock (Live Analytics > Financials) before changing its invoices or payments'],
  not_editable: [409, 'Only a pending claim can be edited — this one has already been decided'],
  category_not_found: [404, 'Expense category not found (or deactivated)'],
  membership_not_found: [404, 'Employee not found in this company'],
  description_required: [422, 'Describe the expense when the category is Other'],
  not_deletable: [409, 'Only a pending claim can be deleted — this one has already been decided'],
  not_your_step: [403, 'This claim is waiting on another approver'],
  own_claim: [403, "You can't approve your own claim"],
};

function failFor(res, error) {
  const mapped = ERRORS[error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}

// --- Expense claims — attach a receipt via POST /documents
//     ({ entity_type: 'expense_claim', entity_id: <claim id> }), the
//     existing generic documents module needs no change for this. ---

router.post(
  '/claims',
  asyncHandler(async (req, res) => {
    const { org_membership_id, ...body } = createClaimSchema.parse(req.body);
    // Only an admin files for someone else; everyone else always for themselves.
    const target = req.user.role === 'admin' && org_membership_id ? org_membership_id : req.user.org_membership_id;
    const actor = { userId: req.user.id, orgMembershipId: req.user.org_membership_id };
    const result = await service.createClaim(req.user.org_id, target, body, actor);
    if (result.error) return failFor(res, result.error);
    return created(res, result.claim);
  })
);

// A pending claim: its owner or an admin. Any status (approved, reimbursed…):
// a superadmin, to correct the record.
router.patch(
  '/claims/:id',
  loadSuperadminFlag,
  asyncHandler(async (req, res) => {
    const body = updateClaimSchema.parse(req.body);
    const actor = { role: req.user.role, orgMembershipId: req.user.org_membership_id, isSuperadmin: req.user.is_superadmin };
    const result = await service.updateClaim(req.user.org_id, req.params.id, actor, body);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.claim);
  })
);

// Removes a claim raised by mistake: its owner or an admin while it is still
// pending; a superadmin whatever its status.
router.delete(
  '/claims/:id',
  loadSuperadminFlag,
  asyncHandler(async (req, res) => {
    const actor = { role: req.user.role, orgMembershipId: req.user.org_membership_id, isSuperadmin: Boolean(req.user.is_superadmin) };
    const result = await service.deleteClaim(req.user.org_id, req.params.id, actor);
    if (result.error) return failFor(res, result.error);
    return ok(res, { deleted: true });
  })
);

router.get(
  '/claims/me',
  asyncHandler(async (req, res) => {
    const query = listMyClaimsQuerySchema.parse(req.query);
    const result = await service.listMyClaims(req.user.org_id, req.user.org_membership_id, query, req.user.id);
    return ok(res, result.data, { pagination: result.pagination });
  })
);

router.get(
  '/claims',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const query = listClaimsQuerySchema.parse(req.query);
    const result = await service.listClaims(req.user.org_id, query);
    return ok(res, result.data, { pagination: result.pagination });
  })
);

// Claims waiting on the caller's step of Manager -> HR -> Finance.
router.get(
  '/claims/approvals',
  asyncHandler(async (req, res) => {
    const { data, scope } = await service.listApprovals(req.user.org_id, req.user);
    return ok(res, data, { scope });
  })
);

// One step of the chain — the claimant's manager, HR, Finance, or an admin.
router.post(
  '/claims/:id/decision',
  asyncHandler(async (req, res) => {
    const body = decideClaimSchema.parse(req.body);
    const result = await service.decideClaim(req.user.org_id, req.params.id, req.user, body);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.claim);
  })
);

router.post(
  '/claims/:id/reimburse',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.reimburseClaim(req.user.org_id, req.params.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.claim);
  })
);

// --- Vendor payments — money going out for services; admin-only. Attach
//     an invoice via POST /documents ({ entity_type: 'vendor_payment' }). ---

router.post(
  '/vendor-payments',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = createVendorPaymentSchema.parse(req.body);
    const result = await service.createVendorPayment(req.user.org_id, req.user.id, body);
    return created(res, result.payment);
  })
);

router.get(
  '/vendor-payments',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const query = listVendorPaymentsQuerySchema.parse(req.query);
    const rows = await service.listVendorPayments(req.user.org_id, query);
    return ok(res, rows);
  })
);

router.get(
  '/vendor-payments/:id',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.getVendorPayment(req.user.org_id, req.params.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.payment);
  })
);

router.post(
  '/vendor-payments/:id/decision',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = decideVendorPaymentSchema.parse(req.body);
    const result = await service.decideVendorPayment(req.user.org_id, req.params.id, req.user.id, body);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.payment);
  })
);

router.post(
  '/vendor-payments/:id/pay',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.markVendorPaymentPaid(req.user.org_id, req.params.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.payment);
  })
);

module.exports = router;
