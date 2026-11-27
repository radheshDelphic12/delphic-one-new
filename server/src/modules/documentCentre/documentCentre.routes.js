const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { authenticate, requireOrgMembership } = require('../../middleware/auth');
const { can, canAny, decide } = require('../../lib/permissions');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./documentCentre.service');

// Document Centre. Which permission each route needs is in lib/access/routeRules.js (documents.view / upload / sign / manage).
const router = express.Router();
router.use(authenticate, requireOrgMembership);

// In a company still on the old roles these guards decide (admin only); on the permission model the central route table does.
const mayView = canAny(['documents.view', 'documents.sign'], 'admin');
const mayUpload = can('documents.upload', 'admin');
const maySign = can('documents.sign', 'admin');
const mayManage = can('documents.manage', 'admin');

const ERRORS = {
  not_found: [404, 'Not found'],
  forbidden: [403, 'You cannot open this'],
  requirement_exists: [409, 'That is already on the list'],
  bad_signature_image: [422, 'Use a PNG or JPEG picture of the signature'],
  signature_too_large: [422, 'The signature picture is too large (600 KB at most)'],
  file_required: [422, 'Choose the PDF to sign'],
  file_too_large: [422, 'The PDF is too large (15 MB at most). Compress it and try again'],
  not_a_pdf: [422, 'Only PDF documents can be signed here. Save the document as a PDF first'],
  unreadable_pdf: [422, 'This PDF could not be read (it may be password protected or damaged)'],
  storage_full: [507, 'Storage is almost full, so nothing can be uploaded right now. Ask an admin to clean up (Documents > Storage)'],
  signer_not_found: [404, 'The person you chose to sign is not part of this company'],
  entity_not_found: [404, 'The client, vendor or employee you tagged was not found'],
  not_the_signer: [403, 'Only the person asked to sign can sign or decline this'],
  not_pending: [409, 'This request is already done'],
  file_removed: [410, 'The original file was cleaned up to save space'],
  no_signature: [409, 'Add your signature first (Documents > Sign > My signature)'],
  no_stamp: [409, 'The company stamp is not set up yet (Documents > Sign documents > Company stamp)'],
  bad_page: [422, 'A signature is placed on a page that does not exist'],
  not_signed: [409, 'This document is not signed yet'],
  no_entity: [409, 'This request is not tagged to a client, vendor or employee'],
  already_attached: [409, 'The signed copy is already attached'],
};
const problem = (res, r) => { const [status, message] = ERRORS[r.error] || [400, 'Bad request']; return fail(res, status, message); };

// ---- what is on file -----------------------------------------------------------------------------------------------------
router.get('/overview', mayView, asyncHandler(async (req, res) => ok(res, await service.overview(req.user.org_id, service.overviewQuery.parse(req.query)))));
router.get('/requirements', mayView, asyncHandler(async (req, res) => ok(res, await service.listRequirements(req.user.org_id))));
router.post('/requirements', mayManage, asyncHandler(async (req, res) => {
  const r = await service.addRequirement(req.user.org_id, service.requirementSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : created(res, r.requirement);
}));
router.patch('/requirements/:id', mayManage, asyncHandler(async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body || {});
  const r = await service.renameRequirement(req.user.org_id, z.string().uuid().parse(req.params.id), name);
  return r.error ? problem(res, r) : ok(res, r.requirement);
}));
router.delete('/requirements/:id', mayManage, asyncHandler(async (req, res) => {
  const r = await service.removeRequirement(req.user.org_id, z.string().uuid().parse(req.params.id));
  return r.error ? problem(res, r) : ok(res, r);
}));

// ---- signatures ----------------------------------------------------------------------------------------------------------
router.get('/signatures/me', maySign, asyncHandler(async (req, res) => ok(res, await service.mySignature(req.user.org_id, req.user.id))));
router.put('/signatures/me', maySign, asyncHandler(async (req, res) => {
  const { image } = z.object({ image: z.string().max(900000) }).parse(req.body || {});
  const r = await service.setMySignature(req.user.org_id, req.user.id, image);
  return r.error ? problem(res, r) : ok(res, r);
}));
router.delete('/signatures/me', maySign, asyncHandler(async (req, res) => ok(res, await service.clearMySignature(req.user.org_id, req.user.id))));
router.get('/signers', mayView, asyncHandler(async (req, res) => ok(res, await service.listSigners(req.user.org_id))));

// ---- signing requests ----------------------------------------------------------------------------------------------------
fs.mkdirSync(service.signingDir(), { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { fs.mkdirSync(service.signingDir(), { recursive: true }); cb(null, service.signingDir()); },
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}-original.pdf`),
  }),
  limits: { fileSize: service.MAX_PDF_BYTES },
  fileFilter: (req, file, cb) => cb(null, path.extname(file.originalname || '').toLowerCase() === '.pdf'),
});
const removeUploaded = (file) => { if (file?.path) { try { fs.unlinkSync(file.path); } catch { /* already gone */ } } };

router.get('/sign-requests', mayView, asyncHandler(async (req, res) => {
  const q = z.object({ status: z.enum(['pending', 'signed', 'declined', 'cancelled']).optional(), scope: z.enum(['to_sign', 'mine', 'all']).default('mine') }).parse(req.query);
  return ok(res, await service.listRequests(req.user.org_id, req.user, { ...q, decide }));
}));
router.post('/sign-requests', mayUpload, (req, res, next) => upload.single('file')(req, res, (err) => {
  if (err) return fail(res, 422, err.code === 'LIMIT_FILE_SIZE' ? ERRORS.file_too_large[1] : 'Could not read the file');
  return next();
}), asyncHandler(async (req, res) => {
  let meta;
  try { meta = service.requestMeta.parse(req.body || {}); } catch (e) { removeUploaded(req.file); throw e; }
  const r = await service.createRequest(req.user.org_id, req.user, meta, req.file);
  if (r.error) { removeUploaded(req.file); return req.file || r.error !== 'file_required' ? problem(res, r) : fail(res, 422, 'Choose a PDF file (only PDF can be signed)'); }
  return created(res, r.request);
}));
router.get('/sign-requests/:id/original', mayView, asyncHandler(async (req, res) => {
  const r = await service.originalFile(req.user.org_id, req.user, z.string().uuid().parse(req.params.id), decide);
  if (r.error) return problem(res, r);
  res.set({ 'Cache-Control': 'private, no-store' });
  return res.download(r.path, r.name);
}));
router.get('/sign-requests/:id/signed', mayView, asyncHandler(async (req, res) => {
  const r = await service.signedFile(req.user.org_id, req.user, z.string().uuid().parse(req.params.id), decide);
  if (r.error) return problem(res, r);
  res.set({ 'Cache-Control': 'private, no-store' });
  return res.download(r.path, r.name);
}));
router.post('/sign-requests/:id/sign', maySign, asyncHandler(async (req, res) => {
  const r = await service.sign(req.user.org_id, req.user, z.string().uuid().parse(req.params.id), service.signBody.parse(req.body || {}));
  return r.error ? problem(res, r) : ok(res, r.request);
}));
router.post('/sign-requests/:id/decline', maySign, asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Say why').max(500) }).parse(req.body || {});
  const r = await service.decline(req.user.org_id, req.user, z.string().uuid().parse(req.params.id), reason);
  return r.error ? problem(res, r) : ok(res, r.request);
}));
router.post('/sign-requests/:id/cancel', mayUpload, asyncHandler(async (req, res) => {
  const r = await service.cancel(req.user.org_id, req.user, z.string().uuid().parse(req.params.id), decide);
  return r.error ? problem(res, r) : ok(res, r.request);
}));
router.post('/sign-requests/:id/attach', mayUpload, asyncHandler(async (req, res) => {
  const r = await service.attach(req.user.org_id, req.user, z.string().uuid().parse(req.params.id), decide);
  return r.error ? problem(res, r) : created(res, r.document);
}));

// ---- storage -------------------------------------------------------------------------------------------------------------
router.get('/storage', mayView, asyncHandler(async (req, res) => ok(res, await service.storageInfo(req.user.org_id, { fresh: req.query.fresh === '1' }))));
router.post('/cleanup', mayManage, asyncHandler(async (req, res) => {
  const { days } = z.object({ days: z.coerce.number().int().min(1).max(3650).default(30) }).parse(req.body || {});
  return ok(res, await service.cleanup(req.user.org_id, { days }));
}));

// ---- the company stamp: seen by whoever may view or sign, set or removed by whoever manages documents
router.get('/stamp', canAny(['documents.view', 'documents.sign'], 'admin'), asyncHandler(async (req, res) => ok(res, await service.companyStamp(req.user.org_id))));
router.put('/stamp', mayManage, asyncHandler(async (req, res) => {
  const { image } = z.object({ image: z.string().max(1_200_000) }).parse(req.body || {});
  const r = await service.setCompanyStamp(req.user.org_id, req.user.id, image);
  return r.error ? problem(res, r) : ok(res, r);
}));
router.patch('/stamp', mayManage, asyncHandler(async (req, res) => {
  const { on_invoices } = z.object({ on_invoices: z.boolean() }).parse(req.body || {});
  const r = await service.setStampOnInvoices(req.user.org_id, on_invoices);
  return r.error ? fail(res, 404, 'Upload the stamp first') : ok(res, r);
}));
router.delete('/stamp', mayManage, asyncHandler(async (req, res) => ok(res, await service.clearCompanyStamp(req.user.org_id))));

module.exports = router;
