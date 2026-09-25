const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./accounting.service');
const {
  createLedgerAccountSchema,
  listLedgerAccountsQuerySchema,
  postJournalEntrySchema,
  listLedgerEntriesQuerySchema,
  trialBalanceQuerySchema,
  profitAndLossQuerySchema,
  balanceSheetQuerySchema,
  createTaxRecordSchema,
  listTaxRecordsQuerySchema,
} = require('./accounting.validation');

const router = express.Router();
// Every route here is finance data — admin-only, no employee-facing routes
// like expenses' /claims/me, so authorize('admin') is safe router-wide.
router.use(authenticate, requireOrgMembership, authorize('admin'));

const ERRORS = {
  account_exists: [409, 'A ledger account with that name already exists'],
  account_not_found: [404, 'One or more ledger accounts were not found in this org'],
  insufficient_lines: [422, 'A journal entry needs at least two lines'],
  line_both_sides: [422, 'A line cannot have both a debit and a credit'],
  line_empty: [422, 'A line must have a debit or a credit'],
  unbalanced: [422, 'Debits and credits must balance'],
  not_found: [404, 'Not found'],
  not_pending: [409, 'Only a pending tax record can be filed'],
  not_filed: [409, 'Only a filed tax record can be marked paid'],
};

function failFor(res, error) {
  const mapped = ERRORS[error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}

router.post(
  '/ledger-accounts',
  asyncHandler(async (req, res) => {
    const body = createLedgerAccountSchema.parse(req.body);
    const result = await service.createLedgerAccount(req.user.org_id, body);
    if (result.error) return failFor(res, result.error);
    return created(res, result.account);
  })
);

router.get(
  '/ledger-accounts',
  asyncHandler(async (req, res) => {
    const query = listLedgerAccountsQuerySchema.parse(req.query);
    const rows = await service.listLedgerAccounts(req.user.org_id, query);
    return ok(res, rows);
  })
);

router.post(
  '/journal-entries',
  asyncHandler(async (req, res) => {
    const body = postJournalEntrySchema.parse(req.body);
    const result = await service.postJournalEntry(req.user.org_id, req.user.id, body);
    if (result.error) return failFor(res, result.error);
    return created(res, { entries: result.entries, transaction_id: result.transaction_id });
  })
);

router.get(
  '/ledger-entries',
  asyncHandler(async (req, res) => {
    const query = listLedgerEntriesQuerySchema.parse(req.query);
    const result = await service.listLedgerEntries(req.user.org_id, query);
    return ok(res, result.data, { pagination: result.pagination });
  })
);

router.get(
  '/reports/trial-balance',
  asyncHandler(async (req, res) => {
    const query = trialBalanceQuerySchema.parse(req.query);
    const result = await service.getTrialBalance(req.user.org_id, query);
    return ok(res, result);
  })
);

router.get(
  '/reports/profit-and-loss',
  asyncHandler(async (req, res) => {
    const query = profitAndLossQuerySchema.parse(req.query);
    const result = await service.getProfitAndLoss(req.user.org_id, query);
    return ok(res, result);
  })
);

router.get(
  '/reports/balance-sheet',
  asyncHandler(async (req, res) => {
    const query = balanceSheetQuerySchema.parse(req.query);
    const result = await service.getBalanceSheet(req.user.org_id, query);
    return ok(res, result);
  })
);

// --- Tax records — jurisdiction/kind kept free-text; regime scope is an
//     explicit open question (HLD §10), not guessed at with an enum. ---

router.post(
  '/tax-records',
  asyncHandler(async (req, res) => {
    const body = createTaxRecordSchema.parse(req.body);
    const result = await service.createTaxRecord(req.user.org_id, req.user.id, body);
    return created(res, result.record);
  })
);

router.get(
  '/tax-records',
  asyncHandler(async (req, res) => {
    const query = listTaxRecordsQuerySchema.parse(req.query);
    const result = await service.listTaxRecords(req.user.org_id, query);
    return ok(res, result.data, { pagination: result.pagination });
  })
);

router.post(
  '/tax-records/:id/file',
  asyncHandler(async (req, res) => {
    const result = await service.markTaxRecordFiled(req.user.org_id, req.params.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.record);
  })
);

router.post(
  '/tax-records/:id/pay',
  asyncHandler(async (req, res) => {
    const result = await service.markTaxRecordPaid(req.user.org_id, req.params.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.record);
  })
);

module.exports = router;
