const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { authenticate, authorize, authorizeGroupSuperadmin } = require('../../middleware/auth');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const env = require('../../config/env');
const { ALLOWED_EXT } = require('../documents/documents.validation');
const service = require('./cash.service');
const reports = require('./cash.reports');
const v = require('./cash.validation');
const hooks = require('./cash.hooks');
const invoices = require('../groupInvoices/invoices.service');
const invoicePdf = require('../groupInvoices/invoices.pdf');
const iv = require('../groupInvoices/invoices.validation');

// Group cash API. Everything that changes or shows a whole bank account is for the group superadmin only
// (/api/v1/group-cash); a workspace admin gets a read-only view of the wallets their own workspace owns (/api/v1/wallets).

const ERRORS = {
  not_found: [404, 'Not found'],
  entity_not_found: [422, 'That legal entity is not in this group'],
  workspace_not_found: [422, 'That company is not in this group'],
  owner_not_found: [422, 'That owner is not in this group'],
  account_not_found: [404, 'Bank account not found'],
  account_inactive: [409, 'That bank account is not active'],
  duplicate_entity: [409, 'A legal entity with this name already exists'],
  one_owner: [422, 'A wallet has exactly one owner: a company or a legal entity'],
  wallet_inactive: [409, 'That wallet is not active'],
  balance_not_zero: [409, 'The balance is not zero: move the money to another wallet first'],
  unallocated_locked: [409, 'The Unallocated wallet cannot be renamed to another purpose or switched off'],
  same_wallet: [422, 'Pick two different wallets'],
  currency_mismatch: [422, 'Wallets of different currencies cannot be transferred between yet'],
  entity_inactive: [409, 'That legal entity is switched off'],
  entity_has_accounts: [409, 'This legal entity still has active bank accounts: switch those off first (move their money out)'],
  prefix_required: [422, 'Give the legal entity an invoice prefix first (Setup > Legal entities)'],
  entity_gstin_required: [422, "Add the legal entity's GSTIN first (Setup > Legal entities)"],
  entity_state_required: [422, "Add the legal entity's GST state code first (Setup > Legal entities)"],
  place_of_supply_required: [422, "Enter the buyer's state code (place of supply)"],
  hsn_required: [422, 'Every line of a GST invoice needs an HSN / SAC code'],
  bank_details_required: [422, 'A USD export invoice needs bank and SWIFT details (on the bank account or on the invoice)'],
  wallet_not_in_entity: [422, "The receiving wallet must be in one of this legal entity's bank accounts"],
  wallet_currency: [422, 'The receiving wallet is not in the currency of this invoice (GST and non-GST: INR, export: USD)'],
  already_cancelled: [409, 'This invoice is already cancelled'],
  has_payments: [409, 'Remove the payments first, then cancel the invoice'],
  cancelled: [409, 'A cancelled invoice takes no payments'],
  date_outside_series: [422, 'The invoice date must stay in the same financial year as its number (April to March)'],
  has_payments_locked: [409, 'Payments are recorded on this invoice: its currency and receiving wallet cannot change'],
  total_below_paid: [422, 'The new total is less than what has already been received on this invoice'],
  overpayment: [422, 'That is more than what is still due on this invoice'],
};
const result = (res, r, status = 200) => {
  if (r.error) { const m = ERRORS[r.error] || [400, 'Bad request']; return fail(res, m[0], m[1]); }
  return ok(res, r, {}, status);
};

fs.mkdirSync(env.uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, env.uploadDir),
    filename: (req, file, cb) => cb(null, `wallet-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (ALLOWED_EXT.includes(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('Unsupported file type'))),
}).single('file');
const takeFile = (req, res, next) => upload(req, res, (err) => (err ? fail(res, 422, err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large' : 'That file type is not allowed') : next()));

/** Sends a wallet's entries as JSON, CSV or PDF. */
async function sendEntries(res, data, format) {
  if (!data) return fail(res, 404, 'Wallet not found');
  const name = `${data.wallet.name}`.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'wallet';
  if (format === 'csv') {
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"`, 'Cache-Control': 'private, no-store' });
    return res.send(reports.entriesCsv(data));
  }
  if (format === 'pdf') {
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}.pdf"`, 'Cache-Control': 'private, no-store' });
    return res.send(await reports.entriesPdf(data));
  }
  return ok(res, data);
}

// ------------------------------------------------------------------------------------------------ group superadmin
const group = express.Router();
group.use(authenticate, authorizeGroupSuperadmin);
const A = asyncHandler;
const gids = (req) => req.user.org_group_ids;

group.get('/position', A(async (req, res) => ok(res, await service.position(gids(req), v.positionQuery.parse(req.query)))));
group.get('/options', A(async (req, res) => ok(res, await service.options(gids(req)))));

group.get('/entities', A(async (req, res) => ok(res, await service.listEntities(gids(req)))));
group.post('/entities/seed-defaults', A(async (req, res) => ok(res, await service.seedDefaultEntities(gids(req), req.user.id), {}, 201)));
group.post('/entities', A(async (req, res) => result(res, await service.createEntity(gids(req), req.user.id, v.entityBody.parse(req.body)), 201)));
group.patch('/entities/:id', A(async (req, res) => result(res, await service.updateEntity(gids(req), req.user.id, req.params.id, v.entityBody.partial().parse(req.body)))));

group.post('/accounts', A(async (req, res) => result(res, await service.createAccount(gids(req), req.user.id, v.accountBody.parse(req.body)), 201)));
group.patch('/accounts/:id', A(async (req, res) => result(res, await service.updateAccount(gids(req), req.user.id, req.params.id, v.accountUpdate.parse(req.body)))));

group.post('/wallets', A(async (req, res) => result(res, await service.createWallet(gids(req), req.user.id, v.walletBody.parse(req.body)), 201)));
group.patch('/wallets/:id', A(async (req, res) => result(res, await service.updateWallet(gids(req), req.user.id, req.params.id, v.walletUpdate.parse(req.body)))));
group.get('/wallets/:id/entries', A(async (req, res) => {
  const q = v.entriesQuery.parse(req.query);
  return sendEntries(res, await service.walletEntries(gids(req), req.params.id, q), q.format);
}));
group.post('/wallets/:id/transactions', takeFile, A(async (req, res) => {
  const drop = () => { if (req.file) fs.rmSync(req.file.path, { force: true }); };
  let r;
  try {
    const body = v.txBody.parse(req.body);
    const attachment = req.file ? { url: `/uploads/${req.file.filename}`, name: path.basename(req.file.originalname).slice(0, 150) } : null;
    r = await service.createTransaction(gids(req), req.user.id, req.params.id, body, attachment);
  } catch (err) { drop(); throw err; }
  if (r.error) drop();
  return result(res, r, 201);
}));
group.patch('/transactions/:id', A(async (req, res) => result(res, await service.updateTransaction(gids(req), req.user.id, req.params.id, v.txUpdate.parse(req.body)))));
group.delete('/transactions/:id', A(async (req, res) => result(res, await service.removeTransaction(gids(req), req.user.id, req.params.id))));

group.post('/transfers', A(async (req, res) => result(res, await service.createTransfer(gids(req), req.user.id, v.transferBody.parse(req.body)), 201)));
group.patch('/transfers/:id', A(async (req, res) => result(res, await service.updateTransfer(gids(req), req.user.id, req.params.id, v.transferUpdate.parse(req.body)))));
group.delete('/transfers/:id', A(async (req, res) => result(res, await service.removeTransfer(gids(req), req.user.id, req.params.id))));

group.get('/receipts', A(async (req, res) => {
  const q = v.receiptsQuery.parse(req.query);
  const data = await service.receipts(gids(req), q);
  if (q.format === 'csv') {
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="receipts.csv"', 'Cache-Control': 'private, no-store' });
    return res.send(reports.receiptsCsv(data));
  }
  return ok(res, data);
}));

group.get('/reconciliations', A(async (req, res) => ok(res, await service.listReconciliations(gids(req), { bank_account_id: req.query.bank_account_id }))));
group.post('/reconciliations/preview', A(async (req, res) => result(res, await service.previewReconciliation(gids(req), v.reconciliationBody.parse(req.body)))));
group.post('/reconciliations', A(async (req, res) => result(res, await service.createReconciliation(gids(req), req.user.id, v.reconciliationBody.parse(req.body)), 201)));

// Go-live date: payments of records created on or after it must name the wallet they went through (Phase 2).
group.get('/settings', A(async (req, res) => ok(res, await hooks.getSetting(gids(req)[0]))));
group.put('/settings', A(async (req, res) => ok(res, await hooks.setGoLive(gids(req), req.user.id, v.settingsBody.parse(req.body).go_live_date))));

// Invoices issued by a legal entity (Phase 3).
group.get('/invoices', A(async (req, res) => ok(res, await invoices.list(gids(req), iv.listQuery.parse(req.query)))));
group.post('/invoices', A(async (req, res) => result(res, await invoices.create(gids(req), req.user.id, iv.invoiceBody.parse(req.body)), 201)));
group.get('/invoices/:id', A(async (req, res) => { const inv = await invoices.get(gids(req), req.params.id); return inv ? ok(res, inv) : fail(res, 404, 'Invoice not found'); }));
group.get('/invoices/:id/pdf', A(async (req, res) => {
  const inv = await invoices.get(gids(req), req.params.id);
  if (!inv) return fail(res, 404, 'Invoice not found');
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${inv.number.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf"`, 'Cache-Control': 'private, no-store' });
  return res.send(await invoicePdf.invoicePdf(inv));
}));
group.patch('/invoices/:id', A(async (req, res) => result(res, await invoices.update(gids(req), req.user.id, req.params.id, iv.invoiceBody.omit({ legal_entity_id: true }).parse(req.body)))));
group.patch('/invoices/:id/payments/:paymentId', A(async (req, res) => result(res, await invoices.updatePayment(gids(req), req.user.id, req.params.id, req.params.paymentId, iv.paymentBody.parse(req.body)))));
group.post('/invoices/:id/cancel', A(async (req, res) => result(res, await invoices.cancel(gids(req), req.user.id, req.params.id, iv.cancelBody.parse(req.body)))));
group.post('/invoices/:id/payments', A(async (req, res) => result(res, await invoices.addPayment(gids(req), req.user.id, req.params.id, iv.paymentBody.parse(req.body)), 201)));
group.delete('/invoices/:id/payments/:paymentId', A(async (req, res) => result(res, await invoices.removePayment(gids(req), req.user.id, req.params.id, req.params.paymentId))));

group.patch('/reconciliations/:id', A(async (req, res) => result(res, await service.updateReconciliation(gids(req), req.user.id, req.params.id, v.reconciliationUpdate.parse(req.body)))));
group.delete('/reconciliations/:id', A(async (req, res) => result(res, await service.removeReconciliation(gids(req), req.user.id, req.params.id))));
group.get('/setup', A(async (req, res) => ok(res, await service.setupLists(gids(req)))));

group.get('/audit', A(async (req, res) => ok(res, await service.listAudit(gids(req), v.auditQuery.parse(req.query)))));

// ------------------------------------------------------------------------------------------------ one workspace, read only
const company = express.Router();
company.use(authenticate, authorize('admin'));
company.get('/mine', A(async (req, res) => (req.user.org_id ? ok(res, await service.myWallets(req.user.org_id)) : fail(res, 403, 'Active organization membership required'))));
company.get('/mine/:id/entries', A(async (req, res) => {
  if (!req.user.org_id) return fail(res, 403, 'Active organization membership required');
  const q = v.entriesQuery.parse(req.query);
  return sendEntries(res, await service.myWalletEntries(req.user.org_id, req.params.id, q), q.format);
}));

module.exports = { group, company };
