const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const env = require('../../config/env');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const requireModule = require('../../middleware/requireModule');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./projects.service');

fs.mkdirSync(env.uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, env.uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    service.ALLOWED_DOC_EXT.includes(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('Unsupported file type')),
});

const router = express.Router();
router.use(authenticate, requireOrgMembership, requireModule('projects'), authorize('admin'));

const notFound = (res) => fail(res, 404, 'Project not found');

router.get('/summary', asyncHandler(async (req, res) => ok(res, await service.portfolioSummary(req.user.org_id))));

// Legal / site document register across every self project (expired first).
router.get('/documents/register', asyncHandler(async (req, res) => ok(res, await service.documentRegister(req.user.org_id, { category: req.query.category }))));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await service.listProjects(req.user.org_id, service.listProjectsQuerySchema.parse(req.query));
    return ok(res, result.data, { pagination: result.pagination });
  })
);
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const result = await service.createProject(req.user.org_id, req.user.id, service.createProjectSchema.parse(req.body));
    return created(res, result.project);
  })
);
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await service.getProject(req.user.org_id, req.params.id);
    return result.error ? notFound(res) : ok(res, result);
  })
);
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await service.updateProject(req.user.org_id, req.params.id, service.updateProjectSchema.parse(req.body));
    return result.error ? notFound(res) : ok(res, result.project);
  })
);

router.get(
  '/:id/finance',
  asyncHandler(async (req, res) => {
    const result = await service.listFinanceEntries(req.user.org_id, req.params.id, service.financeQuerySchema.parse(req.query));
    return result.error ? notFound(res) : ok(res, result);
  })
);
router.post(
  '/:id/finance',
  asyncHandler(async (req, res) => {
    const result = await service.addFinanceEntry(req.user.org_id, req.user.id, req.params.id, service.financeEntrySchema.parse(req.body));
    return result.error ? notFound(res) : created(res, result.entry);
  })
);
router.delete(
  '/:id/finance/:entryId',
  asyncHandler(async (req, res) => {
    const result = await service.deleteFinanceEntry(req.user.org_id, req.params.id, req.params.entryId);
    return result.error ? fail(res, 404, 'Entry not found') : ok(res, { deleted: true });
  })
);

// multipart: fields category/title/reference_no/issued_on/expires_on/notes + optional `file`.
router.post(
  '/:id/documents',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const meta = service.documentMetaSchema.parse(req.body);
    const result = await service.addDocument(req.user.org_id, req.user.id, req.params.id, meta, req.file);
    if (result.error) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return notFound(res);
    }
    return created(res, result.document);
  })
);
router.delete(
  '/:id/documents/:docId',
  asyncHandler(async (req, res) => {
    const result = await service.removeDocument(req.user.org_id, req.params.id, req.params.docId);
    return result.error ? fail(res, 404, 'Document not found') : ok(res, { deleted: true });
  })
);

module.exports = router;
