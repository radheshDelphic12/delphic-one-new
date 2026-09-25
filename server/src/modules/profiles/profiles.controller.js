const asyncHandler = require('../../utils/asyncHandler');
const { ok, created, fail } = require('../../utils/response');
const service = require('./profiles.service');
const { createSchema, updateSchema, listQuerySchema } = require('./profiles.validation');

const list = asyncHandler(async (req, res) => {
  const query = listQuerySchema.parse(req.query);
  const { rows, pagination } = await service.list(query);
  return ok(res, rows, { pagination });
});

const getOne = asyncHandler(async (req, res) => {
  const profile = await service.getById(req.params.id);
  if (!profile) return fail(res, 404, 'Not found');
  return ok(res, profile);
});

const create = asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body);
  const profile = await service.create(body, req.user.id);
  return created(res, profile);
});

const update = asyncHandler(async (req, res) => {
  const body = updateSchema.parse(req.body);
  const profile = await service.update(req.params.id, body);
  return ok(res, profile);
});

const submissions = asyncHandler(async (req, res) => {
  const rows = await service.getSubmissions(req.params.id);
  return ok(res, rows);
});

module.exports = { list, getOne, create, update, submissions };
