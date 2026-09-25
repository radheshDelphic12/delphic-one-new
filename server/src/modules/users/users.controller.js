const asyncHandler = require('../../utils/asyncHandler');
const { ok, created, fail } = require('../../utils/response');
const usersService = require('./users.service');
const { listQuerySchema, directoryQuerySchema, createSchema, updateSchema } = require('./users.validation');

const ERROR_STATUS = {
  email_taken: [409, 'Email already in use'],
  department_not_found: [404, 'Department not found in the active organization'],
  not_found: [404, 'User not found'],
  forbidden_superadmin_field: [403, 'Only a superadmin can grant superadmin'],
  forbidden_password: [403, "Only a superadmin can set another user's password"],
  forbidden_edit_superadmin: [403, 'Only a superadmin can edit a superadmin'],
  last_superadmin: [409, 'Cannot remove the last superadmin'],
};

const me = asyncHandler(async (req, res) => {
  const user = await usersService.getById(req.user.org_id, req.user.id);
  return ok(res, user);
});

const myActivity = asyncHandler(async (req, res) => {
  const rows = await usersService.listActivity(req.user.id, req.user.org_id, { limit: req.query.limit });
  return ok(res, rows);
});

const list = asyncHandler(async (req, res) => {
  const query = listQuerySchema.parse(req.query);
  // Sales may list users only to pick recruiters for assignment (RD-106). Keep scope narrow.
  // BDA needs the full roster to pick an account owner/POC, so no role clamp for them.
  if (req.user.role === 'sales') query.role = 'recruiter';
  const { rows, pagination } = await usersService.list(req.user.org_id, query);
  return ok(res, rows, { pagination });
});

const directory = asyncHandler(async (req, res) => {
  const query = directoryQuerySchema.parse(req.query);
  const rows = await usersService.listDirectory(req.user.org_id, query);
  return ok(res, rows);
});

const getOne = asyncHandler(async (req, res) => {
  const user = await usersService.getById(req.user.org_id, req.params.id);
  if (!user) return fail(res, 404, 'User not found');
  return ok(res, user);
});

const create = asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body);
  const result = await usersService.create(req.user.org_id, body);
  if (result.error) {
    const [status, message] = ERROR_STATUS[result.error];
    return fail(res, status, message);
  }
  return created(res, result.user);
});

const update = asyncHandler(async (req, res) => {
  const body = updateSchema.parse(req.body);
  const result = await usersService.update(req.user.org_id, req.params.id, body, req.user);
  if (result.error) {
    const [status, message] = ERROR_STATUS[result.error];
    return fail(res, status, message);
  }
  return ok(res, result.user);
});

module.exports = { me, myActivity, directory, list, getOne, create, update };
