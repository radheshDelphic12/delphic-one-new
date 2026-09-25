const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./tasks.service');
const {
  createTaskSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
  listTasksQuerySchema,
  listMineQuerySchema,
} = require('./tasks.validation');

// Admin/Superadmin task assignment — a lead assigns work on a project/module
// to an employee; it shows up under "Assigned Items" on that employee's own
// timesheet (see client/src/pages/time/ItTimesheetPage.jsx), and logging
// against it is still an ordinary timesheets/entries POST.
const router = express.Router();
router.use(authenticate, requireOrgMembership);

const ERRORS = {
  account_not_found: [404, 'Project not found'],
  assignee_not_found: [404, 'Assignee not found in this org'],
  not_found: [404, 'Task not found'],
  forbidden: [403, "You can only update your own task's status"],
};

function failFor(res, error) {
  const mapped = ERRORS[error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}

router.post(
  '/',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = createTaskSchema.parse(req.body);
    const result = await service.createTask(req.user.org_id, req.user.id, body);
    if (result.error) return failFor(res, result.error);
    return created(res, result.task);
  })
);

router.get(
  '/',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const query = listTasksQuerySchema.parse(req.query);
    const result = await service.listTasks(req.user.org_id, query);
    return ok(res, result.data, { pagination: result.pagination });
  })
);

router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const query = listMineQuerySchema.parse(req.query);
    const rows = await service.listMyTasks(req.user.org_membership_id, query);
    return ok(res, rows);
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const isAdmin = req.user.role === 'admin';
    const body = isAdmin ? updateTaskSchema.parse(req.body) : updateTaskStatusSchema.parse(req.body);
    const result = await service.updateTask(req.user.org_id, req.params.id, req.user, body);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.task);
  })
);

module.exports = router;
