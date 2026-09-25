const asyncHandler = require('../../utils/asyncHandler');
const { ok, created, fail } = require('../../utils/response');
const service = require('./comments.service');
const { createSchema, listQuerySchema } = require('./comments.validation');

const ERROR_STATUS = {
  not_found: [404, 'Not found'],
  forbidden: [403, 'Not permitted'],
  bad_entity: [400, 'Invalid entity type'],
};

function mapError(res, error) {
  const [status, message] = ERROR_STATUS[error] || [400, 'Bad request'];
  return fail(res, status, message);
}

const list = asyncHandler(async (req, res) => {
  const query = listQuerySchema.parse(req.query);
  const result = await service.list(query, req.user);
  if (result.error) return mapError(res, result.error);
  return ok(res, result.comments);
});

const create = asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body);
  const result = await service.create(body, req.user);
  if (result.error) return mapError(res, result.error);
  return created(res, result.comment);
});

module.exports = { list, create };
