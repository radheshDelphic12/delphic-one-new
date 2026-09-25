const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./vendorCommissions.service');
const { createCommissionSchema, decideCommissionSchema, listCommissionsQuerySchema } = require('./vendorCommissions.validation');

// Recruitment-sourcing vendor commission ledger — Delphic Global only (the
// only workspace that recruits). Deliberately separate from the shared
// VendorPayment model (server/prisma/schema.prisma) used by every company's
// own contractor AP: see docs/progress/TODO.md for why those stay distinct.
const router = express.Router();
router.use(authenticate, requireOrgMembership, requireMasterWorkspace, authorize('admin'));

const ERRORS = {
  submission_not_found: [404, 'Submission not found'],
  submission_not_closed: [422, 'The submission must be closed before a commission can be raised'],
  not_vendor_sourced: [422, 'This candidate was not sourced from a vendor'],
  already_exists: [409, 'A commission already exists for this submission'],
  not_found: [404, 'Not found'],
  already_decided: [409, 'Already decided'],
  not_approved: [422, 'Must be approved first'],
};

function failFor(res, error) {
  const mapped = ERRORS[error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}

router.get(
  '/eligible-submissions',
  asyncHandler(async (req, res) => ok(res, await service.listEligibleSubmissions(req.user.org_id)))
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createCommissionSchema.parse(req.body);
    const result = await service.createCommission(req.user.org_id, req.user.id, body);
    if (result.error) return failFor(res, result.error);
    return created(res, result.commission);
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = listCommissionsQuerySchema.parse(req.query);
    const result = await service.listCommissions(req.user.org_id, query);
    return ok(res, result.data, { pagination: result.pagination });
  })
);

router.post(
  '/:id/decision',
  asyncHandler(async (req, res) => {
    const body = decideCommissionSchema.parse(req.body);
    const result = await service.decideCommission(req.user.org_id, req.params.id, req.user.id, body);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.commission);
  })
);

router.post(
  '/:id/pay',
  asyncHandler(async (req, res) => {
    const result = await service.markCommissionPaid(req.user.org_id, req.params.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.commission);
  })
);

module.exports = router;
