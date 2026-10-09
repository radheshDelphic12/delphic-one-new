const asyncHandler = require('../../utils/asyncHandler');
const { ok, created, fail } = require('../../utils/response');
const accountsService = require('./accounts.service');
const clientMeetings = require('./clientMeetings.service');
const {
  createSchema,
  updateSchema,
  stageSchema,
  stageOverrideSchema,
  meetingSchema,
  clientMeetingCreateSchema,
  clientMeetingUpdateSchema,
  classifySchema,
  listQuerySchema,
} = require('./accounts.validation');

const ERROR_STATUS = {
  not_found: [404, 'Not found'],
  locked: [403, 'Record is locked'],
  forbidden: [403, 'You do not own this record'],
  invalid_transition: [400, 'Invalid stage transition'],
  reason_required: [400, 'reason is required for this transition'],
  meeting_fields_required: [400, 'meeting_mode and meeting_date are required'],
  meeting_location_required: [400, 'meeting_location is required for offline meetings'],
  already_classified: [400, 'Account type is already set'],
  forbidden_type_change: [403, 'Only an admin can change the account type'],
  forbidden_brought_by: [403, 'Only an admin can change "Brought by"'],
  user_not_found: [400, 'Selected owner was not found or is inactive'],
  not_active: [409, 'Meetings can only be tracked for active clients and vendors'],
  location_required: [400, 'location is required for offline meetings'],
  is_project: [409, 'This is a project, not a client account — manage it under Finance → Projects'],
};

const list = asyncHandler(async (req, res) => {
  const query = listQuerySchema.parse(req.query);
  const { rows, pagination } = await accountsService.list(query);
  return ok(res, rows, { pagination });
});

const listSpecializations = asyncHandler(async (req, res) => {
  const tags = await accountsService.listSpecializations();
  return ok(res, tags);
});

const getOne = asyncHandler(async (req, res) => {
  const account = await accountsService.getById(req.params.id);
  if (!account) return fail(res, 404, 'Not found');
  return ok(res, account);
});

const create = asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body);
  const account = await accountsService.create(body, req.user.id);
  return created(res, account);
});

const update = asyncHandler(async (req, res) => {
  const body = updateSchema.parse(req.body);
  const result = await accountsService.update(req.params.id, body, req.user);
  if (result.error) {
    const [status, message] = ERROR_STATUS[result.error];
    return fail(res, status, message);
  }
  return ok(res, result.account);
});

const changeStage = asyncHandler(async (req, res) => {
  const body = stageSchema.parse(req.body);
  const result = await accountsService.changeStage(req.params.id, body, req.user);
  if (result.error) {
    const [status, message] = ERROR_STATUS[result.error];
    return fail(res, status, message);
  }
  return ok(res, result.account, { stage_history: result.history });
});

const changeStageOverride = asyncHandler(async (req, res) => {
  const body = stageOverrideSchema.parse(req.body);
  const result = await accountsService.changeStageOverride(req.params.id, body, req.user);
  if (result.error) {
    const [status, message] = ERROR_STATUS[result.error];
    return fail(res, status, message);
  }
  return ok(res, result.account, { stage_history: result.history });
});

const updateMeeting = asyncHandler(async (req, res) => {
  const body = meetingSchema.parse(req.body);
  const result = await accountsService.updateMeeting(req.params.id, body, req.user);
  if (result.error) {
    const [status, message] = ERROR_STATUS[result.error];
    return fail(res, status, message);
  }
  return ok(res, result.account, { stage_history: result.history });
});

function meetingResult(res, result, key = 'meeting', status = 200) {
  if (result.error) {
    const [code, message] = ERROR_STATUS[result.error];
    return fail(res, code, message);
  }
  return status === 201 ? created(res, result[key]) : ok(res, result[key]);
}

const listClientMeetings = asyncHandler(async (req, res) => {
  const result = await clientMeetings.list(req.params.id);
  return meetingResult(res, result, 'meetings');
});

const createClientMeeting = asyncHandler(async (req, res) => {
  const body = clientMeetingCreateSchema.parse(req.body);
  return meetingResult(res, await clientMeetings.create(req.params.id, body, req.user), 'meeting', 201);
});

const updateClientMeeting = asyncHandler(async (req, res) => {
  const body = clientMeetingUpdateSchema.parse(req.body);
  return meetingResult(res, await clientMeetings.update(req.params.id, req.params.meetingId, body, req.user));
});

const deleteClientMeeting = asyncHandler(async (req, res) => {
  const result = await clientMeetings.remove(req.params.id, req.params.meetingId, req.user);
  return meetingResult(res, result, 'id');
});

const classify = asyncHandler(async (req, res) => {
  const body = classifySchema.parse(req.body);
  const result = await accountsService.classifyLead(req.params.id, body, req.user);
  if (result.error) {
    const [status, message] = ERROR_STATUS[result.error];
    return fail(res, status, message);
  }
  return ok(res, result.account);
});

const history = asyncHandler(async (req, res) => {
  const account = await accountsService.getById(req.params.id);
  if (!account) return fail(res, 404, 'Not found');
  const rows = await accountsService.getHistory(req.params.id);
  return ok(res, rows);
});

module.exports = {
  list,
  listSpecializations,
  getOne,
  create,
  update,
  changeStage,
  changeStageOverride,
  updateMeeting,
  listClientMeetings,
  createClientMeeting,
  updateClientMeeting,
  deleteClientMeeting,
  classify,
  history,
};
