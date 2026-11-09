const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const env = require('../../config/env');
const { authenticate, authorizeGroupSuperadmin } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./groupTax.service');

// Group Dashboard > GST & TDS (docs/features/GROUP-TAX-TRACKING.md). Group superadmin only.
const router = express.Router();
router.use(authenticate, authorizeGroupSuperadmin);

const uuid = z.string().uuid();
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const text = (max) => z.string().trim().max(max);
const amount = z.coerce.number().positive().max(1e12);
const KINDS = Object.keys(service.KIND_LABEL);

const filters = z.object({ from: month.optional(), to: month.optional(), org_id: uuid.optional(), currency: z.enum(['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP']).optional() });
const gstQuery = filters.extend({ by: z.enum(['month', 'quarter']).default('month') });
const challanQuery = filters.extend({ kind: z.enum(KINDS).optional() });
const rename = (q) => ({ ...q, orgId: q.org_id });

const receiptSchema = z.object({ invoice_kind: z.enum(['client_invoice', 'group_invoice']), invoice_id: uuid, amount, received_on: day, reference: text(120).optional(), note: text(500).optional() });
const removeSchema = z.object({ reason: text(300).optional() });

// A challan arrives as a form (the challan file may come with it): `parties` is a JSON list of { kind, id, amount? }.
const partiesField = z.preprocess((v) => {
  if (v === undefined || v === '') return undefined;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return 'invalid'; }
}, z.array(z.object({ kind: z.enum(['employee', 'vendor']), id: uuid, amount: z.coerce.number().positive().max(1e12).optional() })).max(500).optional());
const optionalText = (max) => z.preprocess((v) => (v === '' || v === null ? undefined : v), text(max).optional());
const challanFields = z.object({
  kind: z.enum(KINDS),
  challan_number: optionalText(60),
  bsr_code: optionalText(20),
  bank: optionalText(80),
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
  covers_months: z.coerce.number().int().refine((n) => n === 1 || n === 3, 'A period is a month or a quarter').default(1),
  amount,
  paid_on: day,
  org_id: z.preprocess((v) => (v === '' ? undefined : v), uuid.optional()),
  note: optionalText(500),
  parties: partiesField,
});
const challanPatch = challanFields.partial().refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Change at least one field' });

const ALLOWED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
fs.mkdirSync(env.uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, env.uploadDir),
    filename: (req, file, cb) => cb(null, `challan-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (ALLOWED_EXT.includes(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('Unsupported file type'))),
}).single('file');
const takeFile = (req, res, next) => upload(req, res, (err) => (err ? fail(res, 422, err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large' : 'Upload the challan as a PDF or an image (PDF, PNG, JPG, WEBP)') : next()));

const MESSAGES = {
  invoice_not_found: [404, 'Invoice not found'],
  no_tds: [422, 'That invoice has no TDS recorded on it'],
  not_found: [404, 'Not found'],
  party_not_found: [422, 'One of the chosen employees / vendors is not part of this group'],
};
const problem = (res, result) => {
  if (result.error === 'over_tds') return fail(res, 422, `The refunds would add up to more than the TDS deducted on this invoice (${result.tds}; already received ${result.received})`);
  const [status, message] = MESSAGES[result.error] || [400, 'Bad request'];
  return fail(res, status, message);
};

router.get('/options', asyncHandler(async (req, res) => ok(res, await service.options(req.user.org_group_ids))));
router.get('/invoices', asyncHandler(async (req, res) => ok(res, await service.invoices(req.user.org_group_ids, rename(filters.parse(req.query))))));

router.get('/tds-receivable', asyncHandler(async (req, res) => ok(res, await service.tdsReceivable(req.user.org_group_ids, rename(filters.parse(req.query))))));
router.post('/tds-receipts', asyncHandler(async (req, res) => {
  const result = await service.addTdsReceipt(req.user.org_group_ids, req.user, receiptSchema.parse(req.body));
  return result.error ? problem(res, result) : created(res, result.receipt);
}));
router.delete('/tds-receipts/:id', asyncHandler(async (req, res) => {
  const result = await service.removeTdsReceipt(req.user.org_group_ids, req.user, uuid.parse(req.params.id), removeSchema.parse(req.body || {}).reason);
  return result.error ? problem(res, result) : ok(res, result);
}));

router.get('/gst', asyncHandler(async (req, res) => ok(res, await service.gst(req.user.org_group_ids, rename(gstQuery.parse(req.query))))));
router.get('/tds-payable', asyncHandler(async (req, res) => ok(res, await service.tdsPayable(req.user.org_group_ids, rename(filters.parse(req.query))))));

// Challans: every deposit made with the government (GST, TDS on salaries / vendors, advance tax, PF / ESI / PT, other).
router.get('/challans', asyncHandler(async (req, res) => ok(res, await service.challans(req.user.org_group_ids, rename(challanQuery.parse(req.query))))));
router.get('/parties', asyncHandler(async (req, res) => ok(res, await service.parties(req.user.org_group_ids, { orgId: req.query.org_id && uuid.parse(req.query.org_id) }))));
router.post('/challans', takeFile, asyncHandler(async (req, res) => {
  const result = await service.createChallan(req.user.org_group_ids, req.user, challanFields.parse(req.body), req.file);
  return result.error ? problem(res, result) : created(res, { id: result.challan.id });
}));
router.patch('/challans/:id', takeFile, asyncHandler(async (req, res) => {
  const result = await service.updateChallan(req.user.org_group_ids, req.user, uuid.parse(req.params.id), challanPatch.parse(req.body), req.file);
  return result.error ? problem(res, result) : ok(res, { id: result.challan.id });
}));
router.delete('/challans/:id', asyncHandler(async (req, res) => {
  const result = await service.removeChallan(req.user.org_group_ids, req.user, uuid.parse(req.params.id), removeSchema.parse(req.body || {}).reason);
  return result.error ? problem(res, result) : ok(res, result);
}));
router.get('/challans/:id/file', asyncHandler(async (req, res) => {
  const file = await service.challanFile(req.user.org_group_ids, uuid.parse(req.params.id));
  if (!file || !fs.existsSync(file.path)) return fail(res, 404, 'No challan file was uploaded for this entry');
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  return res.download(file.path, file.name);
}));

module.exports = router;
