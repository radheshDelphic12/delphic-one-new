const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const env = require('../../config/env');
const { z } = require('zod');
const { authenticate, requireOrgMembership, loadSuperadminFlag } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./pm.service');

// Project Management: Delphic Global only (the master workspace). Every member sees the projects they belong to; an admin sees all.
// Who may change what is decided per record in the service (admin / project owner / project lead manage; members work their tickets).
fs.mkdirSync(env.uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, env.uploadDir),
    filename: (req, file, cb) => cb(null, `pm-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024 },
  fileFilter: (req, file, cb) => (service.ALLOWED_ATTACHMENT_EXT.includes(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('Unsupported file type'))),
});

const router = express.Router();
router.use(authenticate, requireOrgMembership, requireMasterWorkspace, loadSuperadminFlag);

const ERRORS = {
  not_found: [404, 'Not found'],
  forbidden: [403, 'Only an admin or the project lead can do that'],
  person_not_found: [404, 'That person is not an active member of this company'],
  duplicate_code: [409, 'A project with that code already exists'],
  duplicate_status: [409, 'A status with that key already exists'],
  last_done_status: [409, 'Keep at least one active "done" status while tickets use it'],
  assignee_not_in_project: [422, 'Only members of the project can be assigned. Add them to the project first'],
  contract_not_linked: [422, 'That contract is not linked to this project'],
  contract_not_found: [404, 'Contract not found'],
  no_manual_progress: [422, 'A Finance project has no progress figure of its own to update'],
  contract_already_linked: [409, 'That contract is already linked to a project'],
  status_not_found: [422, 'Unknown or switched-off status'],
  resolution_required: [422, 'Write the resolution before moving a ticket to a done status'],
  unknown_field: [422, 'That custom field does not exist (or is switched off) in this project'],
  bad_field_value: [422, 'A custom field value is not valid for its type'],
  field_required: [422, 'A required custom field is empty'],
  duplicate_field: [409, 'A field with that key already exists in this project'],
  options_required: [422, 'A pick-one field needs at least one option'],
  options_not_allowed: [422, 'Only pick-one fields have options'],
  bad_field_key: [422, 'Choose a longer field name'],
  expiry_in_past: [422, 'Choose an expiry date in the future'],
  expiry_too_far: [422, 'A shared link can last at most one year'],
  already_revoked: [409, 'Already revoked'],
};
const bad = (res, e) => { const [s, m] = ERRORS[e] || [400, 'Request failed']; return fail(res, s, m); };

function actorOf(req) {
  const access = req.user.access;
  const permissionMode = Boolean(access && access.mode === 'permissions');
  const adminLevel = permissionMode ? access.level !== 'employee' : req.user.role === 'admin';
  return { userId: req.user.id, name: req.user.name, membershipId: req.user.org_membership_id, isManager: Boolean(adminLevel || req.user.is_superadmin) };
}
const manager = (req, res, next) => (actorOf(req).isManager ? next() : fail(res, 403, 'Admin only'));
const run = (fn, okStatus = 200, key) => asyncHandler(async (req, res) => {
  const r = await fn(req, actorOf(req));
  if (r && r.error) return bad(res, r.error);
  if (r === null) return fail(res, 404, 'Not found');
  return ok(res, key ? r[key] : r, {}, okStatus);
});

const orgId = (req) => req.user.org_id;

// ---- lookups
router.get('/meta', asyncHandler(async (req, res) => ok(res, {
  project_statuses: service.PROJECT_STATUSES, ticket_types: service.TICKET_TYPES, priorities: service.PRIORITIES, categories: service.CATEGORIES,
  statuses: await service.listStatuses(orgId(req), { includeInactive: actorOf(req).isManager }), is_manager: actorOf(req).isManager,
})));
router.get('/people', run((req) => service.listPeople(orgId(req))));
router.get('/my-tickets', run((req, a) => service.myTickets(orgId(req), a)));
router.get('/contracts/linkable', manager, run((req) => service.listLinkableContracts(orgId(req))));

// ---- ticket statuses (admin-editable)
router.post('/statuses', manager, run((req) => service.createStatus(orgId(req), service.statusSchema.parse(req.body || {})), 201, 'status'));
router.patch('/statuses/:id', manager, run((req) => service.updateStatus(orgId(req), req.params.id, service.statusUpdateSchema.parse(req.body || {})), 200, 'status'));

// ---- projects
router.get('/projects', run((req, a) => service.listProjects(orgId(req), a, z.object({ status: z.enum(service.PROJECT_STATUSES).optional(), q: z.string().trim().max(120).optional(), linked: z.enum(['true', 'false']).optional(), mine: z.enum(['true', 'false']).optional() }).parse(req.query))));
router.post('/projects', manager, run((req, a) => service.createProject(orgId(req), a, service.projectCreateSchema.parse(req.body || {})), 201, 'project'));
router.get('/projects/:id', run((req, a) => service.getProject(orgId(req), req.params.id, a)));
router.patch('/projects/:id', run((req, a) => service.updateProject(orgId(req), req.params.id, a, service.projectUpdateSchema.parse(req.body || {})), 200, 'project'));
router.delete('/projects/:id', run((req, a) => service.deleteProject(orgId(req), req.params.id, a)));
router.post('/projects/:id/members', run((req, a) => service.setMembers(orgId(req), req.params.id, a, z.object({ add: z.array(z.string().uuid()).max(100).optional(), remove: z.array(z.string().uuid()).max(100).optional(), leads: z.array(z.string().uuid()).max(100).optional() }).parse(req.body || {})), 200, 'project'));

// ---- tickets
router.get('/projects/:id/tickets', run((req, a) => service.listTickets(orgId(req), req.params.id, a, service.ticketListQuerySchema.parse(req.query)), 200, 'tickets'));
// ---- custom fields of a project
router.post('/projects/:id/fields', run((req, a) => service.createField(orgId(req), req.params.id, a, service.fieldCreateSchema.parse(req.body || {})), 201, 'field'));
router.patch('/projects/:id/fields/:fieldId', run((req, a) => service.updateField(orgId(req), req.params.id, req.params.fieldId, a, service.fieldUpdateSchema.parse(req.body || {})), 200, 'field'));

// ---- sharing a project read-only with a client or vendor (the plain link token is shown once)
router.get('/projects/:id/shares', run((req, a) => service.listShares(orgId(req), req.params.id, a), 200, 'shares'));
router.post('/projects/:id/shares', run((req, a) => service.createShare(orgId(req), req.params.id, a, service.shareSchema.parse(req.body || {})), 201));
router.delete('/projects/:id/shares/:shareId', run((req, a) => service.revokeShare(orgId(req), req.params.id, req.params.shareId, a), 200, 'share'));

router.post('/projects/:id/tickets', run((req, a) => service.createTicket(orgId(req), req.params.id, a, service.ticketCreateSchema.parse(req.body || {})), 201, 'ticket'));
router.get('/tickets/:id', run((req, a) => service.getTicket(orgId(req), req.params.id, a)));
router.patch('/tickets/:id', run((req, a) => service.updateTicket(orgId(req), req.params.id, a, service.ticketUpdateSchema.parse(req.body || {})), 200, 'ticket'));
router.delete('/tickets/:id', run((req, a) => service.deleteTicket(orgId(req), req.params.id, a)));
router.post('/tickets/:id/comments', run((req, a) => { const c = z.object({ body: z.string().trim().min(1).max(5000), is_public: z.boolean().optional() }).parse(req.body || {}); return service.addComment(orgId(req), req.params.id, a, c.body, c.is_public); }, 201, 'comment'));

// ---- attachments (downloads go through here, never a public file URL)
router.post('/tickets/:id/attachments', (req, res, next) => upload.single('file')(req, res, (err) => (err ? fail(res, 400, err.message) : next())),
  asyncHandler(async (req, res) => {
    if (!req.file) return fail(res, 400, 'Choose a file to attach');
    const r = await service.addAttachment(orgId(req), req.params.id, actorOf(req), req.file);
    if (r.error) return bad(res, r.error);
    return ok(res, r.attachment, {}, 201);
  }));
router.get('/attachments/:id/download', asyncHandler(async (req, res) => {
  const r = await service.attachmentFile(orgId(req), req.params.id, actorOf(req));
  if (r.error) return bad(res, r.error);
  return res.download(r.path, r.filename);
}));
router.delete('/attachments/:id', run((req, a) => service.deleteAttachment(orgId(req), req.params.id, a)));

// ---- contract links (added whenever required; tickets never depend on them)
router.post('/projects/:id/contracts', run((req, a) => service.linkContract(orgId(req), req.params.id, a, z.object({ contract_id: z.string().uuid(), is_primary: z.boolean().optional() }).parse(req.body || {})), 201, 'project'));
router.delete('/projects/:id/contracts/:contractId', run((req, a) => service.unlinkContract(orgId(req), req.params.id, a, req.params.contractId), 200, 'project'));
router.post('/projects/:id/contracts/:contractId/primary', run((req, a) => service.makePrimary(orgId(req), req.params.id, a, req.params.contractId), 200, 'project'));
router.post('/projects/:id/contracts/:contractId/copy-progress', manager, run((req, a) => service.copyProgressToContract(orgId(req), req.params.id, a, req.params.contractId), 200, 'project'));

module.exports = router;
