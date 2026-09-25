const asyncHandler = require('../../utils/asyncHandler');
const { ok, fail } = require('../../utils/response');
const authService = require('./auth.service');
const { loginSchema, refreshSchema, changePasswordSchema, switchOrgSchema, workspaceParamSchema } = require('./auth.validation');

const login = asyncHandler(async (req, res) => {
  const { email, password, org_slug } = loginSchema.parse(req.body);
  const result = await authService.login(email, password, org_slug);
  if (!result) return fail(res, 401, 'Invalid credentials');
  if (result.error === 'no_workspace_access') return fail(res, 403, 'Your account does not have access to that workspace');
  return ok(res, result);
});

// Public — feeds the sign-in screen's workspace picker with branding only.
const workspace = asyncHandler(async (req, res) => {
  const { slug } = workspaceParamSchema.parse(req.params);
  const org = await authService.lookupWorkspace(slug);
  if (!org) return fail(res, 404, 'Workspace not found');
  return ok(res, org);
});

const refresh = asyncHandler(async (req, res) => {
  const { refresh_token } = refreshSchema.parse(req.body);
  const result = await authService.refresh(refresh_token);
  if (!result) return fail(res, 401, 'Invalid or expired refresh token');
  return ok(res, result);
});

const changePassword = asyncHandler(async (req, res) => {
  const { current_password, new_password } = changePasswordSchema.parse(req.body);
  const result = await authService.changePassword(req.user.id, current_password, new_password);
  if (!result.ok) return fail(res, 400, 'Current password is incorrect');
  return ok(res, null, { message: 'Password changed' });
});

const switchOrg = asyncHandler(async (req, res) => {
  const { org_id } = switchOrgSchema.parse(req.body);
  const result = await authService.switchOrg(req.user.id, org_id);
  if (result.error === 'not_a_member') return fail(res, 403, 'Not a member of that org');
  if (result.error === 'not_found') return fail(res, 401, 'Invalid session');
  return ok(res, result);
});

module.exports = { login, refresh, changePassword, switchOrg, workspace };
