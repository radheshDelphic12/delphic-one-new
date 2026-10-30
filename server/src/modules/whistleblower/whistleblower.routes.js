const express = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const env = require('../../config/env');
const { authenticate, requireOrgMembership } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./whistleblower.service');
const v = require('./whistleblower.validation');

// Whistleblower: Delphic Global (the master workspace) for now. The reporter's routes are open to every signed-in member (the module
// itself must be switched on by an admin); who sees which case is decided in the service from the handlers set per category.
fs.mkdirSync(env.uploadDir, { recursive: true });
const FILE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv'];
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, env.uploadDir),
    filename: (req, file, cb) => cb(null, `wb-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: Math.min(env.maxUploadMb, 10) * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => (FILE_EXT.includes(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('Attach an image, PDF, Word, Excel or text file'))),
});
const files = upload.array('files', 5);

const ERRORS = {
  disabled: [403, 'Speak Up is not switched on for this company yet. An admin can enable it in Speak Up settings'],
  forbidden: [403, 'You do not have access to do that'],
  not_found: [404, 'Not found'],
  category_not_found: [404, 'Pick one of the categories'],
  office_not_found: [404, 'Office not found'],
  department_not_found: [404, 'Department not found'],
  anonymous_off: [403, 'Anonymous complaints are switched off. Raise it as a confidential complaint'],
  bad_people: [422, 'One of the people you picked is not in this company'],
  bad_handlers: [422, 'Pick people who are in this company'],
  involved_handler: [422, 'That person is named as involved in this complaint, so they cannot handle it'],
  resolution_required: [422, 'Write what was found or done (the resolution) before closing the complaint'],
};
const failFor = (res, code) => fail(res, ...(ERRORS[code] || [400, code]));
const result = (res, r, status = 200) => (r.error ? failFor(res, r.error) : status === 201 ? created(res, r) : ok(res, r));

const router = express.Router();
router.use(authenticate, requireOrgMembership, requireMasterWorkspace);

// ----- everyone: raise and follow my own concerns -----
router.get('/meta', asyncHandler(async (req, res) => ok(res, await service.meta(req.user))));
router.get('/summary', asyncHandler(async (req, res) => ok(res, await service.summary(req.user))));
router.get('/mine', asyncHandler(async (req, res) => ok(res, await service.myCases(req.user))));
router.get('/mine/:id', asyncHandler(async (req, res) => result(res, await service.myCase(req.user, req.params.id))));
router.post('/mine/:id/messages', files, asyncHandler(async (req, res) => result(res, await service.replyMine(req.user, req.params.id, v.messageBody.pick({ body: true }).parse(req.body).body, req.files))));

router.post('/cases', files, asyncHandler(async (req, res) => result(res, await service.createCase(req.user, v.createCaseBody.parse(req.body), req.files), 201)));

// ----- handlers and admins -----
router.get('/cases', asyncHandler(async (req, res) => ok(res, await service.listCases(req.user, v.listQuery.parse(req.query)))));
router.get('/cases/:id', asyncHandler(async (req, res) => result(res, await service.getCase(req.user, req.params.id))));
router.post('/cases/:id/messages', files, asyncHandler(async (req, res) => result(res, await service.handlerMessage(req.user, req.params.id, v.messageBody.parse(req.body), req.files))));
router.patch('/cases/:id', asyncHandler(async (req, res) => result(res, await service.updateCase(req.user, req.params.id, v.patchCaseBody.parse(req.body)))));

router.get(
  '/attachments/:id',
  asyncHandler(async (req, res) => {
    const found = await service.attachmentFile(req.user, req.params.id);
    if (found.error) return failFor(res, found.error);
    res.setHeader('Content-Type', found.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(found.name)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(found.file);
  })
);

// ----- settings (the admin, or whoever holds Whistleblower > manage) -----
router.get('/settings', asyncHandler(async (req, res) => ok(res, await service.getSettings(req.user.org_id))));
router.put('/settings', asyncHandler(async (req, res) => result(res, await service.updateSettings(req.user, v.settingsBody.parse(req.body)))));
router.get('/categories', asyncHandler(async (req, res) => result(res, await service.listCategories(req.user))));
router.post('/categories', asyncHandler(async (req, res) => result(res, await service.createCategory(req.user, v.categoryCreate.parse(req.body)), 201)));
router.patch('/categories/:id', asyncHandler(async (req, res) => result(res, await service.updateCategory(req.user, req.params.id, v.categoryUpdate.parse(req.body)))));

// ----- an anonymous reporter follows their concern with the tracking code: no login, so nothing ties the request to a person -----
const publicRouter = express.Router();
if (env.nodeEnv !== 'test') publicRouter.use('/whistleblower', rateLimit({ windowMs: 60 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false }));
publicRouter.post('/whistleblower/track', asyncHandler(async (req, res) => result(res, await service.trackAnonymous(v.anonymousTrackBody.parse(req.body)))));
publicRouter.post('/whistleblower/reply', files, asyncHandler(async (req, res) => result(res, await service.replyAnonymous(v.anonymousReplyBody.parse(req.body), req.files))));

module.exports = { router, publicRouter };
