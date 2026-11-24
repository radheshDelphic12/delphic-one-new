const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { z } = require('zod');
const { authenticate, requireOrgMembership } = require('../../middleware/auth');
const { can, canAny, decide } = require('../../lib/permissions');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./vendorPortal.service');

const ERRORS = {
  bad_login: [401, 'Wrong email or password'],
  not_found: [404, 'Not found'],
  requirement_not_available: [404, 'This requirement is not open for your company any more'],
  cv_required: [422, 'Attach the candidate\'s CV (a file) or paste a link to it'],
  bad_cv_type: [422, 'The CV must be a PDF or Word file'],
  bad_invoice_type: [422, 'Upload the invoice as a PDF, picture, Word or Excel file'],
  file_required: [422, 'Choose the invoice file'],
  file_too_large: [422, 'The file is too large (10 MB at most)'],
  duplicate: [409, 'You already put this candidate forward for this requirement'],
  not_pending: [409, 'This candidate has already been decided'],
  email_taken: [409, 'That email already has a vendor portal login'],
  reason_required: [422, 'Give a reason'],
  bad_reset_link: [400, 'This reset link is not valid any more. Ask for a new one'],
};
const problem = (res, r) => { const [status, message] = ERRORS[r.error] || [400, 'Bad request']; return fail(res, status, message); };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 11 * 1024 * 1024, files: 1 } });
const uuid = z.string().uuid();
const sendFile = (res, f) => {
  if (!f || !fs.existsSync(f.path)) return fail(res, 404, 'File not found');
  res.set('Cache-Control', 'private, no-store'); res.set('X-Content-Type-Options', 'nosniff');
  res.attachment(f.name);
  return res.sendFile(f.path, { dotfiles: 'deny' });
};

// ===========================================================================================================================
// The vendor's own side: /api/v1/vendor-portal. Its own sign-in and token; a company login is never accepted here.
const portal = express.Router();

portal.post('/login', asyncHandler(async (req, res) => {
  const r = await service.login(service.loginSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : ok(res, r);
}));

portal.post('/forgot-password', asyncHandler(async (req, res) => {
  await service.forgotPassword(service.forgotSchema.parse(req.body || {}).email);
  return ok(res, { sent: true }); // the same answer whether or not the email has a login
}));
portal.post('/reset-password', asyncHandler(async (req, res) => {
  const r = await service.resetPassword(service.resetSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : ok(res, { reset: true });
}));

const portalAuth = asyncHandler(async (req, res, next) => {
  const header = String(req.headers.authorization || '');
  const user = header.startsWith('Bearer ') ? await service.userFromToken(header.slice(7)) : null;
  if (!user) return fail(res, 401, 'Please sign in again');
  req.vendorUser = user;
  return next();
});
portal.use(portalAuth);

portal.get('/me', (req, res) => ok(res, service.me(req.vendorUser)));
portal.get('/requirements', asyncHandler(async (req, res) => ok(res, await service.portalRequirements(req.vendorUser))));
portal.get('/submissions', asyncHandler(async (req, res) => ok(res, await service.portalSubmissions(req.vendorUser))));
portal.post('/submissions', upload.single('cv'), asyncHandler(async (req, res) => {
  const r = await service.createSubmission(req.vendorUser, service.submissionSchema.parse(req.body || {}), req.file);
  return r.error ? problem(res, r) : created(res, r.submission);
}));
portal.post('/submissions/:id/withdraw', asyncHandler(async (req, res) => {
  const r = await service.withdrawSubmission(req.vendorUser, uuid.parse(req.params.id));
  return r.error ? problem(res, r) : ok(res, { withdrawn: true });
}));
portal.get('/resources', asyncHandler(async (req, res) => ok(res, await service.portalResources(req.vendorUser))));
portal.get('/invoices', asyncHandler(async (req, res) => ok(res, await service.portalInvoices(req.vendorUser))));
portal.post('/invoices', upload.single('file'), asyncHandler(async (req, res) => {
  const r = await service.createInvoice(req.vendorUser, service.invoiceSchema.parse(req.body || {}), req.file);
  return r.error ? problem(res, r) : created(res, r.invoice);
}));
portal.get('/invoices/:id/file', asyncHandler(async (req, res) => sendFile(res, await service.portalInvoiceFile(req.vendorUser, uuid.parse(req.params.id)))));

// ===========================================================================================================================
// The company's side: /api/v1/vendor-portal-admin. Company login + permission (lib/access/routeRules.js).
const admin = express.Router();
admin.use(authenticate, requireOrgMembership);

const mayView = canAny(['vendor_portal.view', 'vendor_portal.manage', 'vendor_portal.review'], 'admin', 'sales');
const mayManage = can('vendor_portal.manage', 'admin');
const mayShare = can('vendor_portal.share', 'admin', 'sales');

/** May this person approve or reject for the vendor behind the submission: holders of the permission, or the vendor's point of contact. */
const permitted = (user, key) => { const d = decide(user, key); return d === null ? ['admin'].includes(user.role) : d; };
const mayReview = asyncHandler(async (req, res, next) => {
  if (permitted(req.user, 'vendor_portal.review')) return next();
  const owner = await service.submissionOwner(req.user.org_id, uuid.parse(req.params.id));
  if (owner && owner === req.user.id) return next();
  return fail(res, 403, 'Only the vendor\'s point of contact or someone with permission can decide this');
});

admin.get('/vendors/:id', mayView, asyncHandler(async (req, res) => {
  const r = await service.vendorOverview(req.user.org_id, uuid.parse(req.params.id));
  return r.error ? problem(res, r) : ok(res, r);
}));
admin.post('/vendors/:id/users', mayManage, asyncHandler(async (req, res) => {
  const r = await service.addUser(req.user.org_id, req.user.id, uuid.parse(req.params.id), service.userSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : created(res, r.user);
}));
admin.patch('/users/:id', mayManage, asyncHandler(async (req, res) => {
  const r = await service.updateUser(req.user.org_id, uuid.parse(req.params.id), service.userPatchSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : ok(res, r.user);
}));
admin.get('/requirements/:id/vendors', canAny(['vendor_portal.view', 'vendor_portal.share'], 'admin', 'sales'), asyncHandler(async (req, res) => {
  const r = await service.requirementShares(req.user.org_id, uuid.parse(req.params.id));
  return r.error ? problem(res, r) : ok(res, r.vendors);
}));
admin.put('/requirements/:id/vendors', mayShare, asyncHandler(async (req, res) => {
  const { vendor_ids } = z.object({ vendor_ids: z.array(uuid).max(500) }).parse(req.body || {});
  const r = await service.setRequirementShares(req.user.org_id, req.user.id, uuid.parse(req.params.id), vendor_ids);
  return r.error ? problem(res, r) : ok(res, r.vendors);
}));

// the inbox: with the permission everything, otherwise only the vendors this person is the point of contact of
const scopeOwner = (req) => (permitted(req.user, 'vendor_portal.review') || permitted(req.user, 'vendor_portal.view') ? null : req.user.id);
admin.get('/submissions', asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.enum(['pending_review', 'approved', 'rejected', 'withdrawn']).optional() }).parse(req.query);
  return ok(res, await service.adminSubmissions(req.user.org_id, { status, ownerUserId: scopeOwner(req) }));
}));
admin.get('/submissions/pending-count', asyncHandler(async (req, res) => ok(res, { count: await service.pendingCount(req.user.org_id, scopeOwner(req)) })));
admin.get('/submissions/:id/cv', mayReview, asyncHandler(async (req, res) => sendFile(res, await service.submissionCv(req.user.org_id, uuid.parse(req.params.id)))));
admin.post('/submissions/:id/approve', mayReview, asyncHandler(async (req, res) => {
  const r = await service.approve(req.user.org_id, req.user.id, uuid.parse(req.params.id));
  return r.error ? problem(res, r) : ok(res, r);
}));
admin.post('/submissions/:id/reject', mayReview, asyncHandler(async (req, res) => {
  const { note } = service.decisionSchema.parse(req.body || {});
  const r = await service.reject(req.user.org_id, req.user.id, uuid.parse(req.params.id), note);
  return r.error ? problem(res, r) : ok(res, { rejected: true });
}));

// invoice files the vendors uploaded (shown in Finance as "Uploaded by vendor")
admin.get('/invoices', mayView, asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.enum(['uploaded', 'accepted', 'rejected']).optional() }).parse(req.query);
  return ok(res, await service.adminInvoices(req.user.org_id, { status }));
}));
admin.get('/invoices/:id/file', mayView, asyncHandler(async (req, res) => sendFile(res, await service.adminInvoiceFile(req.user.org_id, uuid.parse(req.params.id)))));
admin.patch('/invoices/:id', mayManage, asyncHandler(async (req, res) => {
  const r = await service.reviewInvoice(req.user.org_id, req.user.id, uuid.parse(req.params.id), service.reviewSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : ok(res, r.invoice);
}));

module.exports = { portal, admin };
