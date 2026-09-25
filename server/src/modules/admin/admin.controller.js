const asyncHandler = require('../../utils/asyncHandler');
const { ok, fail } = require('../../utils/response');
const service = require('./admin.service');
const {
  unlockParamsSchema,
  unlockBodySchema,
  softDeleteParamsSchema,
  softDeleteBodySchema,
  restoreBodySchema,
  listDeletedQuerySchema,
} = require('./admin.validation');

const ERROR_STATUS = {
  invalid_entity_type: [422, 'Invalid entity_type'],
  not_found: [404, 'Not found'],
  not_locked: [400, 'Record is not locked'],
  forbidden: [403, 'Not permitted'],
  bad_password: [401, 'Password incorrect'],
  already_deleted: [409, 'Record is already deleted'],
  not_deleted: [409, 'Record is not deleted'],
};

const unlock = asyncHandler(async (req, res) => {
  const params = unlockParamsSchema.parse(req.params);
  const body = unlockBodySchema.parse(req.body);
  const result = await service.unlock(params.entity_type, params.entity_id, body.reason, req.user);
  if (result.error) {
    const [status, message] = ERROR_STATUS[result.error];
    return fail(res, status, message);
  }
  return ok(res, result.unlock, { message: 'Record unlocked' });
});

const softDelete = asyncHandler(async (req, res) => {
  const params = softDeleteParamsSchema.parse(req.params);
  const body = softDeleteBodySchema.parse(req.body);
  const result = await service.softDelete(params.entity_type, params.entity_id, body.password, body.reason, req.user);
  if (result.error) {
    const [status, message] = ERROR_STATUS[result.error];
    return fail(res, status, message);
  }
  return ok(res, result.result, { message: 'Record deleted' });
});

const restore = asyncHandler(async (req, res) => {
  const params = softDeleteParamsSchema.parse(req.params);
  const body = restoreBodySchema.parse(req.body);
  const result = await service.restore(params.entity_type, params.entity_id, body.reason, req.user);
  if (result.error) {
    const [status, message] = ERROR_STATUS[result.error];
    return fail(res, status, message);
  }
  return ok(res, result.result, { message: 'Record restored' });
});

const listDeleted = asyncHandler(async (req, res) => {
  const query = listDeletedQuerySchema.parse(req.query);
  const rows = await service.listDeleted(query.entity_type);
  return ok(res, rows);
});

const listAudit = asyncHandler(async (req, res) => {
  const query = listDeletedQuerySchema.parse(req.query);
  const limit = Number(req.query.limit) || 100;
  const rows = await service.listAudit({ entityType: query.entity_type, limit });
  return ok(res, rows);
});

module.exports = { unlock, softDelete, restore, listDeleted, listAudit };
