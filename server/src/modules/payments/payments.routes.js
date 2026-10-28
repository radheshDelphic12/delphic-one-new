const express = require('express');
const { z } = require('zod');
const prisma = require('../../config/db');
const { authenticate, authorizeGroupSuperadmin, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const payments = require('./payments.service');
const { trackAccess } = require('./payments.access');
const cashCalc = require('../cashPosition/cash.calc');

// One way to link a payment of ANY company's own module (rent, deal payments, salaries, funding, invoices ...) to the central Book
// Keeping: after the module has saved the payment the screen asks "track in a wallet?" and calls this with the record it just saved.
// The module's own record is never touched (the wall in between); only a payment record, and a wallet entry when asked, is added here.
const router = express.Router();
router.use(authenticate, requireOrgMembership);

const kindSchema = z.enum(Object.keys(payments.TRACK_KINDS));
const trackSchema = payments.paymentInputSchema.extend({
  kind: kindSchema,
  reference_id: z.string().uuid(),
  amount: z.preprocess((v) => (typeof v === 'number' ? String(v) : v), z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimals')),
  currency: z.enum(['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP']).default('INR'),
  party: z.string().trim().max(200).nullish(),
  category: z.string().trim().max(120).nullish(),
});

router.post('/track', trackAccess, asyncHandler(async (req, res) => {
  const body = trackSchema.parse(req.body || {});
  const input = await payments.withSavedRate(req.user.org_id, body.currency, body);
  const prepared = await payments.prepare({
    orgId: req.user.org_id, user: req.user, input, fixedAmount: body.amount,
    record: { kind: body.kind, id: body.reference_id, currency: body.currency, pending: cashCalc.D(body.amount), party: body.party || null, category: body.category || null },
  });
  if (prepared.error) { const m = payments.PAYMENT_ERRORS[prepared.error] || [400, 'Bad request']; return fail(res, m[0], m[1]); }
  const payment = await prisma.$transaction((tx) => prepared.commit(tx));
  return created(res, payments.serialize(payment, null));
}));

router.get('/track', trackAccess, asyncHandler(async (req, res) => {
  const q = z.object({ kind: kindSchema, reference_id: z.string().uuid() }).parse(req.query);
  return ok(res, await payments.list(req.user.org_id, q.kind, q.reference_id, { includeUndone: true }));
}));

// Edited by the group admin only: the old payment stays in the history as undone, the corrected one replaces it (wallet entry too).
router.patch('/track/:id', authorizeGroupSuperadmin, requireOrgMembership, asyncHandler(async (req, res) => {
  const input = payments.paymentInputSchema.extend({ reason: z.string().trim().max(500).optional() }).parse(req.body || {});
  const old = await prisma.paymentRecord.findFirst({ where: { id: req.params.id, org_id: req.user.org_id } });
  if (!old || !payments.TRACK_KINDS[old.kind]) return fail(res, 404, 'Payment not found');
  const amount = input.amount || cashCalc.money(old.amount);
  const entry = old.wallet_transaction_id ? await prisma.walletTransaction.findUnique({ where: { id: old.wallet_transaction_id } }) : null;
  const body = await payments.withSavedRate(req.user.org_id, old.currency, { ...input, amount });
  const done = await payments.replace({
    orgId: req.user.org_id, user: req.user, kind: old.kind, referenceId: old.reference_id, paymentId: old.id, input: body, fixedAmount: amount, reason: input.reason,
    record: { kind: old.kind, id: old.reference_id, currency: old.currency, pending: cashCalc.D(amount), party: entry?.party || null, category: entry?.category || null },
  });
  if (done.error) { const m = payments.PAYMENT_ERRORS[done.error] || [400, 'Bad request']; return fail(res, m[0], m[1]); }
  return ok(res, payments.serialize(done.payment, null));
}));

// Undone by the group admin only, with a reason (the wallet entry goes).
router.delete('/track/:id', authorizeGroupSuperadmin, requireOrgMembership, asyncHandler(async (req, res) => {
  const { reason } = payments.undoSchema.parse(req.body || {});
  const row = await prisma.paymentRecord.findFirst({ where: { id: req.params.id, org_id: req.user.org_id } });
  if (!row || !payments.TRACK_KINDS[row.kind]) return fail(res, 404, 'Payment not found');
  const result = await prisma.$transaction((tx) => payments.undoWithin(tx, { orgId: req.user.org_id, user: req.user, kind: row.kind, referenceId: row.reference_id, paymentId: row.id, reason }));
  if (result.error) { const m = payments.PAYMENT_ERRORS[result.error] || [400, 'Bad request']; return fail(res, m[0], m[1]); }
  return ok(res, { undone: true });
}));

module.exports = router;
