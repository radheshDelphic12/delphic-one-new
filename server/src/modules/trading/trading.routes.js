const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const requireModule = require('../../middleware/requireModule');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./trading.service');
const v = require('./trading.validation');

const router = express.Router();
router.use(authenticate, requireOrgMembership, requireModule('trading'), authorize('admin', 'sales', 'bda'));

const ERRORS = {
  not_found: [404, 'Not found'],
  partner_not_found: [404, 'Partner not found'],
  item_not_found: [404, 'Item not found'],
  item_exists: [409, 'An item with this name already exists'],
  onboarding_incomplete: [422, 'Complete every onboarding step before activating this partner'],
  partner_not_active: [422, 'Partner must be active to trade'],
  item_inactive: [422, 'Item is inactive'],
  no_rate: [422, 'No rate card entry covers this date. Add a rate or pass an explicit rate'],
  rate_exists_for_date: [409, 'A rate already starts on that date for this partner and item'],
  already_final: [409, 'Transaction is already completed or cancelled'],
};

function failFor(res, error) {
  const mapped = ERRORS[error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}

router.get('/summary', asyncHandler(async (req, res) => ok(res, await service.summary(req.user.org_id))));

router.get(
  '/partners',
  asyncHandler(async (req, res) => {
    const result = await service.listPartners(req.user.org_id, v.listPartnersQuerySchema.parse(req.query));
    return ok(res, result.data, { pagination: result.pagination });
  })
);
router.post(
  '/partners',
  asyncHandler(async (req, res) => {
    const result = await service.createPartner(req.user.org_id, req.user.id, v.createPartnerSchema.parse(req.body));
    return created(res, result.partner);
  })
);
router.get(
  '/partners/:id',
  asyncHandler(async (req, res) => {
    const result = await service.getPartner(req.user.org_id, req.params.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, result);
  })
);
router.patch(
  '/partners/:id',
  asyncHandler(async (req, res) => {
    const result = await service.updatePartner(req.user.org_id, req.params.id, v.updatePartnerSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return ok(res, result.partner);
  })
);

router.get(
  '/items',
  asyncHandler(async (req, res) =>
    ok(res, await service.listItems(req.user.org_id, { include_inactive: req.query.include_inactive === 'true' }))
  )
);
router.post(
  '/items',
  asyncHandler(async (req, res) => {
    const result = await service.createItem(req.user.org_id, v.createItemSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return created(res, result.item);
  })
);
router.patch(
  '/items/:id',
  asyncHandler(async (req, res) => {
    const result = await service.updateItem(req.user.org_id, req.params.id, v.updateItemSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return ok(res, result.item);
  })
);

router.get(
  '/rates',
  asyncHandler(async (req, res) => ok(res, await service.listRates(req.user.org_id, v.listRatesQuerySchema.parse(req.query))))
);
router.post(
  '/rates',
  asyncHandler(async (req, res) => {
    const result = await service.createRate(req.user.org_id, req.user.id, v.createRateSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return created(res, result.rate);
  })
);

router.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    const result = await service.listTransactions(req.user.org_id, v.listTxnQuerySchema.parse(req.query));
    return ok(res, result.data, { pagination: result.pagination });
  })
);
router.post(
  '/transactions',
  asyncHandler(async (req, res) => {
    const result = await service.createTransaction(req.user.org_id, req.user.id, v.createTxnSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return created(res, result.transaction);
  })
);
router.patch(
  '/transactions/:id',
  asyncHandler(async (req, res) => {
    const result = await service.updateTransaction(req.user.org_id, req.params.id, v.updateTxnSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return ok(res, result.transaction);
  })
);

module.exports = router;
