const asyncHandler = require('../../utils/asyncHandler');
const { ok, fail } = require('../../utils/response');
const service = require('./interviews.service');
const { listQuerySchema, feedbackSchema, cancelSchema } = require('./interviews.validation');

const ERROR_STATUS = {
  not_found: [404, 'Not found'],
  forbidden: [403, 'Not permitted'],
};

function mapError(res, error) {
  const [status, message] = ERROR_STATUS[error] || [400, 'Bad request'];
  return fail(res, status, message);
}

const list = asyncHandler(async (req, res) => {
  const query = listQuerySchema.parse(req.query);
  const events = await service.listForCalendar(req.user, query);
  return ok(res, events);
});

const submitFeedback = asyncHandler(async (req, res) => {
  const body = feedbackSchema.parse(req.body);
  const result = await service.submitFeedback(req.params.id, body, req.user);
  if (result.error) return mapError(res, result.error);
  return ok(res, result.round);
});

const cancel = asyncHandler(async (req, res) => {
  const body = cancelSchema.parse(req.body);
  const result = await service.cancelRound(req.params.id, body, req.user);
  if (result.error) return mapError(res, result.error);
  return ok(res, result.round);
});

module.exports = { list, submitFeedback, cancel };
