const asyncHandler = require('../../utils/asyncHandler');
const { ok, created, fail } = require('../../utils/response');
const service = require('./documents.service');
const { createMetaSchema, listQuerySchema } = require('./documents.validation');

const ERROR_STATUS = {
  file_required: [422, 'file is required'],
  not_found: [404, 'Not found'],
  forbidden: [403, 'Not permitted'],
  membership_required: [403, 'Active organization membership required'],
  not_editable: [409, 'This expense claim has already been decided — its receipts can no longer be changed'],
  filters_required: [400, 'entity_type and entity_id are required'],
};

function mapError(res, error) {
  const [status, message] = ERROR_STATUS[error] || [400, 'Bad request'];
  return fail(res, status, message);
}

const list = asyncHandler(async (req, res) => {
  const query = listQuerySchema.parse(req.query);
  const result = await service.list(query, req.user);
  if (result.error) return mapError(res, result.error);
  return ok(res, result.documents);
});

const create = asyncHandler(async (req, res) => {
  const meta = createMetaSchema.parse(req.body);
  const result = await service.create({ ...meta, file: req.file }, req.user);
  if (result.error) return mapError(res, result.error);
  return created(res, result.document);
});

const remove = asyncHandler(async (req, res) => {
  const result = await service.remove(req.params.id, req.user);
  if (result.error) return mapError(res, result.error);
  return ok(res, null, { message: 'Document deleted' });
});

module.exports = { list, create, remove };
