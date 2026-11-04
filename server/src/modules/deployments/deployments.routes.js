const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { authenticate, requireOrgMembership } = require('../../middleware/auth');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const env = require('../../config/env');
const { ALLOWED_EXT } = require('../documents/documents.validation');
const service = require('./deployments.service');

// Two doors into the same service:
//   groupRouter  (mounted under /super-dashboard/group/deployments, group admins): everything.
//   router       (/api/v1/deployments, any signed-in person): their own deployments, onsite logs, expenses, the approval steps that name them,
//                and the Finance queue for people who hold Finance work.

const ERRORS = {
  not_found: [404, 'Deployment not found'],
  company_not_found: [422, 'That company is not in this group'],
  project_not_found: [422, 'That project is not in this group'],
  client_not_found: [422, 'That client is not in this group'],
  bad_dates: [422, 'The end date must be on or after the start date'],
  closed: [409, 'This deployment is closed or cancelled'],
  use_extension: [409, 'Use "Extend" to move the end date; an extension goes through approval'],
  started: [409, 'The deployment has started: its start date cannot change'],
  only_draft: [409, 'Only a draft can be deleted; cancel the deployment instead'],
  not_draft: [409, 'Only a draft can be submitted'],
  people_required: [422, 'Add at least one person before submitting'],
  budget_required: [422, 'Add an estimated budget before submitting (or submit it as an emergency)'],
  emergency_off: [403, 'Emergency deployment is switched off in the approval settings'],
  emergency_reason: [422, 'Give the reason for the emergency'],
  not_approved: [409, 'The deployment must be approved before it starts (an emergency one may start while approval is pending)'],
  not_active: [409, 'The deployment is not running'],
  extend_later: [422, 'The new end date must be after the current end date'],
  extension_pending: [409, 'An extension is already waiting for approval'],
  person_not_found: [404, 'That person is not on the deployment'],
  travel_not_found: [404, 'Travel arrangement not found'],
  request_not_found: [404, 'Approval request not found'],
  request_done: [409, 'That request is already decided'],
  not_your_step: [403, 'The next approval step is not yours'],
  comment_required: [422, 'Please give a reason'],
  not_open_for_expenses: [409, 'Expenses can be submitted once the deployment is approved or running'],
  forbidden: [403, 'You are not part of this deployment'],
  expense_not_found: [404, 'Expense not found'],
  expense_state: [409, 'That expense is not in a state that allows this'],
  overrun_pending: [409, 'This expense is over the approved budget: its approval is still pending'],
  recover_too_much: [422, 'That is more than the client still owes for this expense'],
  future_log: [422, 'You cannot log a day that has not come yet'],
  before_start: [422, 'That day is before you joined the deployment'],
  not_on_deployment: [403, 'You are not on this deployment'],
  code_clash: [409, 'Could not number the deployment, please try again'],
};
const result = (res, r, status = 200) => {
  if (r && r.error) { const m = ERRORS[r.error] || [400, 'Bad request']; return fail(res, m[0], m[1]); }
  return ok(res, r, {}, status);
};

fs.mkdirSync(env.uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, env.uploadDir),
    filename: (req, file, cb) => cb(null, `deployment-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (ALLOWED_EXT.includes(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('Unsupported file type'))),
}).single('file');
const takeFile = (req, res, next) => upload(req, res, (err) => (err ? fail(res, 422, err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large' : 'That file type is not allowed') : next()));
const billOf = (req) => (req.file ? { url: `/uploads/${req.file.filename}`, name: path.basename(req.file.originalname).slice(0, 150) } : null);

// ---------------------------------------------------------------------------------------------------------------- shared handlers
const A = asyncHandler;
/** Runs a finance step then returns the refreshed deployment. */
const afterExpense = (groupIds, fn) => async (req, res) => {
  const r = await fn(req);
  if (r.error) return result(res, r);
  return result(res, await service.get(groupIds(req), r.deployment_id));
};

// ---------------------------------------------------------------------------------------------------------------- group admins
const groupRouter = express.Router();
const gids = (req) => req.user.org_group_ids;
const adminCtx = (req) => ({ groupIds: gids(req), isGroupAdmin: true, canFinance: true });

groupRouter.get('/', A(async (req, res) => ok(res, { deployments: await service.listFor(gids(req), req.query) })));
groupRouter.get('/dashboard', A(async (req, res) => ok(res, await service.dashboard(gids(req)))));
groupRouter.get('/options', A(async (req, res) => ok(res, await service.options(gids(req)))));
groupRouter.get('/settings', A(async (req, res) => ok(res, await service.settingsOf(gids(req)[0]))));
groupRouter.put('/settings', A(async (req, res) => ok(res, (await service.updateSettings(gids(req), req.user.id, req.body)).settings)));
groupRouter.get('/approvals', A(async (req, res) => ok(res, { requests: await service.pendingFor(gids(req), req.user, adminCtx(req)) })));
groupRouter.get('/finance-queue', A(async (req, res) => ok(res, { expenses: await service.financeQueue(gids(req)) })));
groupRouter.post('/requests/:requestId/decide', A(async (req, res) => result(res, await service.decide(gids(req), req.user, adminCtx(req), req.params.requestId, req.body))));
groupRouter.post('/expenses/:expenseId/verify', A(afterExpense(gids, (req) => service.verifyExpense(gids(req), req.user, req.params.expenseId, req.body))));
groupRouter.post('/expenses/:expenseId/settle', A(afterExpense(gids, (req) => service.settleExpense(gids(req), req.user, req.params.expenseId, req.body))));
groupRouter.post('/expenses/:expenseId/recover', A(afterExpense(gids, (req) => service.recoverExpense(gids(req), req.user, req.params.expenseId, req.body))));
groupRouter.post('/', A(async (req, res) => result(res, await service.create(gids(req), req.user, req.body), 201)));
groupRouter.get('/:id', A(async (req, res) => result(res, await service.get(gids(req), req.params.id))));
groupRouter.patch('/:id', A(async (req, res) => result(res, await service.update(gids(req), req.user, req.params.id, req.body))));
groupRouter.delete('/:id', A(async (req, res) => result(res, await service.remove(gids(req), req.user, req.params.id))));
groupRouter.post('/:id/submit', A(async (req, res) => result(res, await service.submit(gids(req), req.user, req.params.id, req.body))));
groupRouter.post('/:id/start', A(async (req, res) => result(res, await service.start(gids(req), req.user, req.params.id))));
groupRouter.post('/:id/close', A(async (req, res) => result(res, await service.close(gids(req), req.user, req.params.id, req.body))));
groupRouter.post('/:id/cancel', A(async (req, res) => result(res, await service.cancel(gids(req), req.user, req.params.id, req.body))));
groupRouter.post('/:id/extend', A(async (req, res) => result(res, await service.extend(gids(req), req.user, req.params.id, req.body))));
groupRouter.post('/:id/allocation', A(async (req, res) => result(res, await service.changeAllocation(gids(req), req.user, req.params.id, req.body))));
groupRouter.patch('/:id/people/:personId', A(async (req, res) => result(res, await service.updatePerson(gids(req), req.user, req.params.id, req.params.personId, req.body))));
groupRouter.put('/:id/budget', A(async (req, res) => result(res, await service.setBudget(gids(req), req.user, req.params.id, req.body))));
groupRouter.post('/:id/travel', A(async (req, res) => result(res, await service.addTravel(gids(req), req.user, req.params.id, req.body), 201)));
groupRouter.patch('/:id/travel/:travelId', A(async (req, res) => result(res, await service.updateTravel(gids(req), req.user, req.params.id, req.params.travelId, req.body))));
groupRouter.delete('/:id/travel/:travelId', A(async (req, res) => result(res, await service.deleteTravel(gids(req), req.user, req.params.id, req.params.travelId))));
groupRouter.post('/:id/expenses', takeFile, A(async (req, res) => result(res, await service.submitExpense(gids(req), req.user, req.params.id, req.body, billOf(req), adminCtx(req)), 201)));
groupRouter.get('/:id/logs', A(async (req, res) => result(res, await service.logsOf(gids(req), req.params.id, req.query, req.user, adminCtx(req)))));
groupRouter.post('/:id/reviews', A(async (req, res) => result(res, await service.addReview(gids(req), req.user, req.params.id, req.body, adminCtx(req)), 201)));

// ---------------------------------------------------------------------------------------------------------------- everyone else
const router = express.Router();
router.use(authenticate, requireOrgMembership);
const withCtx = (handler) => A(async (req, res) => {
  const ctx = await service.ctxOf(req.user);
  if (!ctx.groupIds.length) return fail(res, 403, 'Active organization membership required');
  return handler(req, res, ctx);
});
const financeOnly = (handler) => withCtx((req, res, ctx) => (ctx.canFinance ? handler(req, res, ctx) : fail(res, 403, 'Only Finance can do this')));

router.get('/mine', withCtx(async (req, res, ctx) => ok(res, { deployments: await service.mine(ctx.groupIds, req.user) })));
router.get('/managed', withCtx(async (req, res, ctx) => ok(res, { deployments: await service.managed(ctx.groupIds, req.user) })));
router.get('/approvals', withCtx(async (req, res, ctx) => ok(res, { requests: await service.pendingFor(ctx.groupIds, req.user, ctx) })));
router.post('/requests/:requestId/decide', withCtx(async (req, res, ctx) => result(res, await service.decide(ctx.groupIds, req.user, ctx, req.params.requestId, req.body))));
router.get('/finance-queue', financeOnly(async (req, res, ctx) => ok(res, { expenses: await service.financeQueue(ctx.groupIds) })));
router.post('/expenses/:expenseId/verify', financeOnly(async (req, res, ctx) => { const r = await service.verifyExpense(ctx.groupIds, req.user, req.params.expenseId, req.body); return result(res, r.error ? r : { ok: true }); }));
router.post('/expenses/:expenseId/settle', financeOnly(async (req, res, ctx) => { const r = await service.settleExpense(ctx.groupIds, req.user, req.params.expenseId, req.body); return result(res, r.error ? r : { ok: true }); }));
router.post('/expenses/:expenseId/recover', financeOnly(async (req, res, ctx) => { const r = await service.recoverExpense(ctx.groupIds, req.user, req.params.expenseId, req.body); return result(res, r.error ? r : { ok: true }); }));
router.get('/:id/logs', withCtx(async (req, res, ctx) => result(res, await service.logsOf(ctx.groupIds, req.params.id, req.query, req.user, ctx))));
router.post('/:id/logs', withCtx(async (req, res, ctx) => result(res, await service.saveLog(ctx.groupIds, req.user, req.params.id, req.body), 201)));
router.post('/:id/expenses', takeFile, withCtx(async (req, res, ctx) => { const r = await service.submitExpense(ctx.groupIds, req.user, req.params.id, req.body, billOf(req), ctx); return result(res, r.error ? r : { ok: true }, 201); }));
router.post('/:id/reviews', withCtx(async (req, res, ctx) => { const r = await service.addReview(ctx.groupIds, req.user, req.params.id, req.body, ctx); return result(res, r.error ? r : { ok: true }, 201); }));

module.exports = { router, groupRouter };
