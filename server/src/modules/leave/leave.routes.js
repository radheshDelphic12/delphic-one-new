const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./leave.service');
const {
  createLeaveTypeSchema,
  updateLeaveTypeSchema,
  createLeaveRequestSchema,
  adminLeaveRequestSchema,
  decisionSchema,
  balanceQuerySchema,
  listRequestsQuerySchema,
  dayStatusQuerySchema,
  balancesOverviewQuerySchema,
  setEntitlementSchema,
  revokeSchema,
} = require('./leave.validation');

// Admin or a Leave Manager (a member the admin has made responsible for processing leave requests).
function authorizeLeaveManager(req, res, next) {
  if (!req.user) return fail(res, 401, 'Not authenticated');
  if (req.user.role === 'admin') return next();
  return service.isLeaveManager(req.user.org_id, req.user.org_membership_id).then((yes) => (yes ? next() : fail(res, 403, 'Insufficient role')), next);
}

const router = express.Router();
router.use(authenticate, requireOrgMembership);

// Powers the "you're on leave" banners + disabled buttons in attendance and
// timesheet screens — same rule the server enforces on those writes.
router.get(
  '/day-status',
  asyncHandler(async (req, res) => {
    const { date } = dayStatusQuerySchema.parse(req.query);
    const leave = await service.leaveDayFor(req.user.org_id, req.user.org_membership_id, date);
    // A half-day leave leaves part of the day to work: `work_capacity` is that many hours.
    const half = leave ? null : await service.workCapacityFor(req.user.org_id, req.user.org_membership_id, date);
    return ok(res, {
      date: date.toISOString().slice(0, 10),
      is_leave_day: Boolean(leave),
      leave_type: leave?.leave_type || half?.leave_type || null,
      is_half_day_leave: Boolean(half),
      work_capacity: half ? half.capacity : null,
    });
  })
);

router.get(
  '/types',
  asyncHandler(async (req, res) => {
    const rows = await service.listTypes(req.user.org_id);
    return ok(res, rows);
  })
);

router.get(
  '/balances/me',
  asyncHandler(async (req, res) => {
    const { year } = balanceQuerySchema.parse(req.query);
    const rows = await service.listMyBalances(req.user.org_id, req.user.org_membership_id, year);
    return ok(res, rows);
  })
);

// Admin: every employee's live CL/EL/SL/UL counters (Jan 1 -> today) — feeds the
// admin dashboard panel and the Leave → Balances screen.
router.get(
  '/balances/overview',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const query = balancesOverviewQuerySchema.parse(req.query);
    return ok(res, await service.balancesOverview(req.user.org_id, query));
  })
);

// Admin: set (or clear, with null) one employee's entitlement for a leave type/year.
router.put(
  '/balances/:membershipId',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = setEntitlementSchema.parse(req.body);
    const result = await service.setEntitlement(req.user.org_id, { ...body, org_membership_id: req.params.membershipId });
    if (result.error === 'membership_not_found') return fail(res, 404, 'Employee not found in this organization');
    if (result.error === 'leave_type_not_found') return fail(res, 404, 'Leave type not found');
    return ok(res, result.balance);
  })
);

router.post(
  '/types',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = createLeaveTypeSchema.parse(req.body);
    const result = await service.createType(req.user.org_id, body);
    if (result.error === 'name_taken') return fail(res, 409, 'Leave type name already in use');
    return created(res, result.leaveType);
  })
);

router.patch(
  '/types/:id',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { reason, ...patch } = updateLeaveTypeSchema.parse(req.body);
    const result = await service.updateType(req.user.org_id, req.user, req.params.id, { ...patch, reason });
    if (result.error === 'not_found') return fail(res, 404, 'Leave type not found');
    if (result.error === 'name_taken') return fail(res, 409, 'Leave type name already in use');
    return ok(res, result.leaveType);
  })
);

// Leave Managers (admin sets who).
router.get('/managers', authorize('admin'), asyncHandler(async (req, res) => ok(res, await service.listLeaveManagers(req.user.org_id))));
router.put(
  '/managers/:membershipId',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const value = req.body && typeof req.body.is_leave_manager === 'boolean' ? req.body.is_leave_manager : null;
    if (value === null) return fail(res, 422, 'is_leave_manager (true / false) is required');
    const result = await service.setLeaveManager(req.user.org_id, req.user, req.params.membershipId, value);
    if (result.error) return fail(res, 404, 'Employee not found in this company');
    return ok(res, result);
  })
);

// Why a request was refused - shared by self-apply, admin-apply and approval.
function failRequest(res, result, who = 'You') {
  if (result.error === 'leave_type_not_found') return fail(res, 404, 'Leave type not found');
  if (result.error === 'membership_not_found') return fail(res, 404, 'Employee not found in this organization');
  if (result.error === 'membership_left') return fail(res, 422, 'That employee has left the organization');
  if (result.error === 'timesheet_conflict' || result.error === 'half_day_hours_exceeded') return fail(res, 409, service.conflictMessage(result));
  const self = who === 'You';
  if (result.error === 'overlaps_existing') return fail(res, 409, self ? 'You already have a pending or approved leave request covering some of those dates' : 'The employee already has a pending or approved leave request covering some of those dates');
  if (result.error === 'present_on_date') return fail(res, 409, self ? `You were marked present on ${result.date} — leave can't be applied for a day you attended` : `The employee was marked present on ${result.date} — leave can't be applied for a day attended`);
  if (result.error === 'no_working_days') return fail(res, 422, self ? 'Those dates are all weekends or holidays on your calendar — there are no working days to take leave for' : 'Those dates are all weekends or holidays on the employee calendar — there are no working days to take leave for');
  if (result.error === 'type_not_applicable') return fail(res, 422, 'That leave type is not applicable - pick another type');
  if (result.error === 'insufficient_balance') return fail(res, 422, `Not enough leave balance — ${result.needed} day(s) requested, ${Math.max(result.remaining, 0)} remaining`);
  return null;
}

// Admin: apply leave for an employee (or for themselves - omit org_membership_id).
router.post(
  '/requests/admin',
  authorizeLeaveManager,
  asyncHandler(async (req, res) => {
    const body = adminLeaveRequestSchema.parse(req.body);
    const result = await service.createRequestForEmployee(req.user.org_id, { org_membership_id: req.user.org_membership_id, user_id: req.user.id }, body);
    if (result.error) return failRequest(res, result, 'The employee');
    return created(res, result.request, result.overflow ? { overflow: result.overflow } : undefined);
  })
);

router.post(
  '/requests',
  asyncHandler(async (req, res) => {
    const body = createLeaveRequestSchema.parse(req.body);
    const result = await service.createRequest(req.user.org_id, req.user.org_membership_id, body);
    if (result.error) return failRequest(res, result);
    return created(res, result.request, result.overflow ? { overflow: result.overflow } : undefined);
  })
);

router.get(
  '/requests/me',
  asyncHandler(async (req, res) => {
    const query = listRequestsQuerySchema.omit({ org_membership_id: true, from: true, to: true }).parse(req.query);
    const result = await service.listMine(req.user.org_id, req.user.org_membership_id, query);
    return ok(res, result.data, { pagination: result.pagination });
  })
);

router.get(
  '/requests',
  authorizeLeaveManager,
  asyncHandler(async (req, res) => {
    const query = listRequestsQuerySchema.parse(req.query);
    const result = await service.listTeam(req.user.org_id, query);
    return ok(res, result.data, { pagination: result.pagination });
  })
);

router.post(
  '/requests/:id/decision',
  authorizeLeaveManager,
  asyncHandler(async (req, res) => {
    const body = decisionSchema.parse(req.body);
    const result = await service.decide(req.user.org_id, req.params.id, req.user.org_membership_id, body, req.user.id);
    if (result.error === 'not_found') return fail(res, 404, 'Leave request not found');
    if (result.error === 'not_pending') return fail(res, 409, 'Leave request is not pending');
    if (result.error) return failRequest(res, result, 'The employee');
    return ok(res, result.request, result.overflow ? { overflow: result.overflow } : undefined);
  })
);

router.post(
  '/requests/:id/mark-unpaid',
  authorizeLeaveManager,
  asyncHandler(async (req, res) => {
    const body = revokeSchema.parse(req.body || {});
    const result = await service.markApprovedUnpaid(req.user.org_id, req.params.id, req.user.org_membership_id, body, req.user.id);
    if (result.error === 'not_found') return fail(res, 404, 'Leave request not found');
    if (result.error === 'not_approved') return fail(res, 409, 'Only an approved leave can be marked unpaid');
    if (result.error === 'already_unpaid') return fail(res, 409, 'That leave is already unpaid');
    if (result.error === 'no_unpaid_type') return fail(res, 422, 'This company has no Unpaid Leave type');
    return ok(res, result.request);
  })
);

router.post(
  '/requests/:id/revoke',
  authorizeLeaveManager,
  asyncHandler(async (req, res) => {
    const body = revokeSchema.parse(req.body || {});
    const result = await service.revoke(req.user.org_id, req.params.id, req.user.org_membership_id, body, req.user.id);
    if (result.error === 'not_found') return fail(res, 404, 'Leave request not found');
    if (result.error === 'not_revocable') return fail(res, 409, 'Only pending or approved leave can be withdrawn');
    return ok(res, result.request);
  })
);

router.post(
  '/requests/:id/cancel',
  asyncHandler(async (req, res) => {
    const result = await service.cancel(req.user.org_id, req.user.org_membership_id, req.params.id);
    if (result.error === 'not_found') return fail(res, 404, 'Leave request not found');
    if (result.error === 'not_pending') return fail(res, 409, 'Leave request is not pending');
    return ok(res, result.request);
  })
);

module.exports = router;
