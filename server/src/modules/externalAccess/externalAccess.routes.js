const express = require('express');
const { authenticate, authorize, requireOrgMembership, authenticateExternal, requireExternalScope } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./externalAccess.service');
const { grantAccessSchema, listGrantsQuerySchema } = require('./externalAccess.validation');
const accountingService = require('../accounting/accounting.service');
const {
  trialBalanceQuerySchema,
  profitAndLossQuerySchema,
  balanceSheetQuerySchema,
  listTaxRecordsQuerySchema,
} = require('../accounting/accounting.validation');

const router = express.Router();

const ERRORS = {
  not_found: [404, 'Not found'],
  already_revoked: [409, 'Already revoked'],
};

function failFor(res, error) {
  const mapped = ERRORS[error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}

// --- Admin management — grant/list/revoke, same JWT+org auth as every
//     other admin-only ERP module. ---

router.post(
  '/',
  authenticate,
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = grantAccessSchema.parse(req.body);
    const result = await service.grantAccess(req.user.org_id, req.user.id, body);
    // The plaintext token appears in this response body only — it is never
    // retrievable again once this request completes.
    return created(res, { grant: result.grant, token: result.token });
  })
);

router.get(
  '/',
  authenticate,
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const query = listGrantsQuerySchema.parse(req.query);
    const rows = await service.listGrants(req.user.org_id, query);
    return ok(res, rows);
  })
);

router.post(
  '/:id/revoke',
  authenticate,
  requireOrgMembership,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.revokeGrant(req.user.org_id, req.params.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.grant);
  })
);

// --- Guest portal — bearer-token auth (authenticateExternal), not JWT.
//     Read-only, scoped to whatever resources the grant names. Reuses the
//     accounting module's own report functions so the numbers a CA sees
//     here are computed identically to what an org admin sees. ---

router.get(
  '/guest/accounting/trial-balance',
  authenticateExternal,
  requireExternalScope('accounting'),
  asyncHandler(async (req, res) => {
    const query = trialBalanceQuerySchema.parse(req.query);
    const result = await accountingService.getTrialBalance(req.externalAccess.org_id, query);
    return ok(res, result);
  })
);

router.get(
  '/guest/accounting/profit-and-loss',
  authenticateExternal,
  requireExternalScope('accounting'),
  asyncHandler(async (req, res) => {
    const query = profitAndLossQuerySchema.parse(req.query);
    const result = await accountingService.getProfitAndLoss(req.externalAccess.org_id, query);
    return ok(res, result);
  })
);

router.get(
  '/guest/accounting/balance-sheet',
  authenticateExternal,
  requireExternalScope('accounting'),
  asyncHandler(async (req, res) => {
    const query = balanceSheetQuerySchema.parse(req.query);
    const result = await accountingService.getBalanceSheet(req.externalAccess.org_id, query);
    return ok(res, result);
  })
);

router.get(
  '/guest/accounting/tax-records',
  authenticateExternal,
  requireExternalScope('accounting'),
  asyncHandler(async (req, res) => {
    const query = listTaxRecordsQuerySchema.parse(req.query);
    const result = await accountingService.listTaxRecords(req.externalAccess.org_id, query);
    return ok(res, result.data, { pagination: result.pagination });
  })
);

module.exports = router;
