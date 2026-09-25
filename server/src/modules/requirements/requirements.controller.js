const asyncHandler = require('../../utils/asyncHandler');
const { ok, created, fail } = require('../../utils/response');
const service = require('./requirements.service');
const {
  createSchema,
  updateSchema,
  statusSchema,
  statusOverrideSchema,
  assignSchema,
  unassignSchema,
  seatCreateSchema,
  seatStageSchema,
  listQuerySchema,
} = require('./requirements.validation');

const ERROR_STATUS = {
  not_found: [404, 'Not found'],
  locked: [403, 'Record is locked'],
  forbidden: [403, 'You do not own this record'],
  invalid_transition: [400, 'Invalid status transition'],
  reason_required: [400, 'reason is required for this transition'],
  seats_not_closed: [400, 'All seats must be closed before closing the requirement'],
  invalid_account: [400, 'account_id must reference an active client'],
  user_not_found: [404, 'User not found'],
  forbidden_owner_change: [403, 'Only an admin can change the sales owner'],
  invalid_owner_role: [400, 'Sales owner must be a sales, BDA, or admin user'],
  role_mismatch: [400, 'Target user role does not match role_on_req'],
  already_assigned: [400, 'User already actively assigned with this role'],
  joined_at_required: [400, 'joined_at is required when closing a seat'],
};

function mapError(res, error) {
  const [status, message] = ERROR_STATUS[error] || [400, 'Bad request'];
  return fail(res, status, message);
}

const list = asyncHandler(async (req, res) => {
  const query = listQuerySchema.parse(req.query);
  if (req.user.role === 'recruiter') query.recruiter_id = req.user.id;
  if (req.user.role === 'sales') query.sales_owner_id = req.user.id;
  const { rows, pagination } = await service.list(query);
  return ok(res, rows, { pagination });
});

function assertCanViewRequirement(user, requirement) {
  if (user.role === 'admin') return null;
  if (user.role === 'sales' && requirement.sales_owner?.id !== user.id) {
    return 'You do not own this record';
  }
  if (user.role === 'recruiter') {
    const assigned = (requirement.assigned_recruiters || []).some((row) => row.id === user.id);
    if (!assigned) return 'You do not own this record';
  }
  return null;
}

const getOne = asyncHandler(async (req, res) => {
  const requirement = await service.getById(req.params.id);
  if (!requirement) return fail(res, 404, 'Not found');
  const denied = assertCanViewRequirement(req.user, requirement);
  if (denied) return fail(res, 403, denied);
  return ok(res, requirement);
});

const create = asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body);
  const result = await service.create(body, req.user.id, req.user);
  if (result.error) return mapError(res, result.error);
  return created(res, result.requirement);
});

const update = asyncHandler(async (req, res) => {
  const body = updateSchema.parse(req.body);
  const result = await service.update(req.params.id, body, req.user);
  if (result.error) return mapError(res, result.error);
  return ok(res, result.requirement);
});

const changeStatus = asyncHandler(async (req, res) => {
  const body = statusSchema.parse(req.body);
  const result = await service.changeStatus(req.params.id, body, req.user);
  if (result.error) return mapError(res, result.error);
  return ok(res, result.requirement);
});

const changeStatusOverride = asyncHandler(async (req, res) => {
  const body = statusOverrideSchema.parse(req.body);
  const result = await service.changeStatusOverride(req.params.id, body, req.user);
  if (result.error) return mapError(res, result.error);
  return ok(res, result.requirement);
});

const assign = asyncHandler(async (req, res) => {
  const body = assignSchema.parse(req.body);
  const result = await service.assign(req.params.id, body, req.user);
  if (result.error) return mapError(res, result.error);
  return created(res, result.assignment);
});

const unassign = asyncHandler(async (req, res) => {
  const body = unassignSchema.parse(req.body);
  const result = await service.unassign(req.params.id, body.assignment_id, req.user);
  if (result.error) return mapError(res, result.error);
  return ok(res, null, { message: 'Unassigned successfully' });
});

const assignments = asyncHandler(async (req, res) => {
  const requirement = await service.getById(req.params.id);
  if (!requirement) return fail(res, 404, 'Not found');
  const denied = assertCanViewRequirement(req.user, requirement);
  if (denied) return fail(res, 403, denied);
  const rows = await service.getAssignments(req.params.id);
  return ok(res, rows);
});

const history = asyncHandler(async (req, res) => {
  const requirement = await service.getById(req.params.id);
  if (!requirement) return fail(res, 404, 'Not found');
  const denied = assertCanViewRequirement(req.user, requirement);
  if (denied) return fail(res, 403, denied);
  const rows = await service.getHistory(req.params.id);
  return ok(res, rows);
});

const getSeats = asyncHandler(async (req, res) => {
  const requirement = await service.getById(req.params.id);
  if (!requirement) return fail(res, 404, 'Not found');
  const denied = assertCanViewRequirement(req.user, requirement);
  if (denied) return fail(res, 403, denied);
  const rows = await service.getSeats(req.params.id);
  return ok(res, rows);
});

const addSeat = asyncHandler(async (req, res) => {
  const body = seatCreateSchema.parse(req.body);
  const result = await service.addSeat(req.params.id, body, req.user);
  if (result.error) return mapError(res, result.error);
  return created(res, result.seat);
});

const changeSeatStatus = asyncHandler(async (req, res) => {
  const body = seatStageSchema.parse(req.body);
  const result = await service.changeSeatStatus(req.params.id, body, req.user.id);
  if (result.error) return mapError(res, result.error);
  return ok(res, result.seat);
});

module.exports = {
  list,
  getOne,
  create,
  update,
  changeStatus,
  changeStatusOverride,
  assign,
  unassign,
  assignments,
  history,
  getSeats,
  addSeat,
  changeSeatStatus,
};
