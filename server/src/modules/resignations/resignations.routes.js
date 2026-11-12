const express = require('express');
const { can } = require('../../lib/permissions');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./resignations.service');
const { REASON_CATEGORIES, submitSchema, managerReviewSchema, approveSchema, rejectSchema, listQuerySchema, settingsSchema } = require('./resignations.validation');

const router = express.Router();
router.use(authenticate, requireOrgMembership);

const ERRORS = {
  disabled: [403, 'Resignation requests are switched off for this company'],
  membership_not_found: [404, 'Employee not found'],
  already_on_notice: [409, 'This person is already serving notice'],
  not_working: [422, 'Only a working employee can resign'],
  lwd_in_past: [422, 'The last working day cannot be in the past'],
  lwd_before_joining: [422, 'The last working day is before the joining date'],
  duplicate_open: [409, 'There is already an open resignation request'],
  not_found: [404, 'Request not found'],
  not_open: [409, 'This request is already closed'],
  not_manager: [403, 'Only the reporting manager or HR can record the retention call'],
  outcome_needs_meeting: [422, 'Mark the meeting as done before recording the outcome'],
  manager_pending: [409, "The reporting manager has not approved this yet (after the meeting). Ask the manager, or approve without the manager's step"],
  not_approved: [409, 'Approve the resignation first'],
  fnf_already_started: [409, 'The F&F process has already started'],
  lwd_before_notice: [422, 'The last working day cannot be before the notice date'],
  joined_after_exit: [422, 'The joining date is after the last working day'],
};
const failWith = (res, error) => {
  const [code, message] = ERRORS[error] || [422, 'Unexpected error'];
  return fail(res, code, message);
};
const send = (res, result, status = 200) => (result.error ? failWith(res, result.error) : ok(res, result.request, {}, status));

// --- Employee (open to any member; the service limits what they can touch) ---
router.get('/settings', asyncHandler(async (req, res) => ok(res, { ...(await service.getSettings(req.user.org_id)), reason_categories: REASON_CATEGORIES })));
router.put('/settings', authorize('admin'), asyncHandler(async (req, res) => ok(res, await service.updateSettings(req.user.org_id, settingsSchema.parse(req.body)))));
router.get('/mine', asyncHandler(async (req, res) => ok(res, await service.listMine(req.user.org_id, req.user.org_membership_id))));
router.get('/team', asyncHandler(async (req, res) => ok(res, await service.listTeam(req.user.org_id, req.user))));
router.post('/', asyncHandler(async (req, res) => {
  const result = await service.create(req.user.org_id, req.user, submitSchema.parse(req.body));
  return send(res, result, 201);
}));
router.post('/:id/withdraw', asyncHandler(async (req, res) => send(res, await service.withdraw(req.user.org_id, req.params.id, req.user))));

// --- Reporting manager (or HR on their behalf) ---
router.put('/:id/manager-review', asyncHandler(async (req, res) => {
  const result = await service.managerReview(req.user.org_id, req.params.id, req.user, managerReviewSchema.parse(req.body));
  return send(res, result);
}));

// --- HR ---
router.get('/', can('people.update', 'admin'), asyncHandler(async (req, res) => {
  const { status } = listQuerySchema.parse(req.query);
  const { items, pending } = await service.listAll(req.user.org_id, { status });
  return ok(res, items, { pending });
}));
router.post('/:id/approve', can('people.update', 'admin'), asyncHandler(async (req, res) => send(res, await service.approve(req.user.org_id, req.params.id, req.user, approveSchema.parse(req.body)))));
router.post('/:id/reject', can('people.update', 'admin'), asyncHandler(async (req, res) => send(res, await service.reject(req.user.org_id, req.params.id, req.user, rejectSchema.parse(req.body)))));
router.post('/:id/start-fnf', can('people.update', 'admin'), asyncHandler(async (req, res) => send(res, await service.startFnf(req.user.org_id, req.params.id, req.user))));

module.exports = router;
