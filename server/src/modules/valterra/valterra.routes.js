const express = require('express');
const { authenticate, requireOrgMembership, loadSuperadminFlag } = require('../../middleware/auth');
const requireModule = require('../../middleware/requireModule');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { vtAccess, vtAuthorize } = require('./access');
const core = require('./core.service');
const investments = require('./investments.service');
const entries = require('./entries.service');
const projections = require('./projections.service');
const finance = require('./finance.service');
const people = require('./people.service');
const sites = require('./sites.service');
const usersSvc = require('./users.service');
const account = require('./account.service');

const router = express.Router();
router.use(authenticate, requireOrgMembership, requireModule('valterra'), vtAccess);

const ERRORS = {
  not_found: [404, 'Record not found'],
  duplicate: [409, 'That name already exists'],
  category_not_found: [422, 'That category was not found, or it belongs to a different kind of record'],
  site_not_found: [422, 'That mining site was not found in this company'],
  site_closed: [422, 'That mining site is closed and takes no new records. Reopen it first'],
  site_not_for_transfer: [422, 'A transfer cannot belong to a mining site'],
  closure_before_start: [422, 'The expected closure date must be on or after the start date'],
  expected_before_investment: [422, 'The expected return date must be on or after the investment date'],
  amount_below_returned: [422, 'The investment amount cannot be less than the principal already returned'],
  has_returns: [409, 'This investment has returns recorded. Cancel it only when no return exists, or reverse the returns first'],
  investment_not_active: [409, 'Returns can only be recorded against an active investment'],
  return_before_investment: [422, 'A return cannot be dated before the investment'],
  principal_exceeds: [422, 'The principal returned cannot be more than the outstanding principal'],
  empty_return: [422, 'Enter the principal returned, the earnings, or both'],
  person_only_salary: [422, 'Only a salary entry can be linked to an employee'],
  person_not_found: [422, 'That employee was not found'],
  investment_only_income: [422, 'Only an income entry can be linked to an investment'],
  investment_not_found: [422, 'That investment was not found'],
  investment_only_investment_line: [422, 'Only an investment line of a projection can be linked to an investment'],
  class_only_expense: [422, 'Operating / other applies to expenses only'],
  due_before_entry: [422, 'The due date must be on or after the entry date'],
  bad_status: [422, 'That payment status does not fit here'],
  entry_final: [409, 'A cancelled entry can only be changed by an admin'],
  payroll_forbidden: [403, 'Salary information is restricted to finance and admin'],
  period_closed: [409, 'That month is closed. An admin must reopen it first'],
  period_reason_required: [422, 'That month is closed. Enter a reason to edit it as admin'],
  future_month: [422, 'A month can only be closed once it has started'],
  already_closed: [409, 'That month is already closed'],
  not_closed: [409, 'That month is not closed'],
  bad_range: [422, 'Choose a valid range (at most 10 years of months)'],
  unknown_report: [404, 'Unknown report'],
  admin_only_field: [403, 'Only an admin can change login access'],
  user_not_in_org: [422, 'That user is not a member of this company'],
  user_linked: [409, 'That user is already linked to another person'],
};
function failFor(res, result) {
  const mapped = ERRORS[result.error];
  if (!mapped) return fail(res, 500, 'Unexpected error');
  if (result.detail) {
    res.status(mapped[0]).json({ success: false, message: mapped[1], code: result.error, detail: result.detail });
    return res;
  }
  return fail(res, mapped[0], mapped[1]);
}
const orgId = (req) => req.user.org_id;
const actor = (req) => req.user.id;
const isAdmin = (req) => req.vt.role === 'admin';
const has = (req, cap) => req.vt.caps.includes(cap);
const ctxOf = (req) => ({ isAdmin: isAdmin(req), payroll: has(req, 'payroll'), reason: (req.body && req.body.reason) || req.query.reason || undefined });
const send = (key, status = 200) => (res, result) => (result.error ? failFor(res, result) : ok(res, key ? result[key] : result, {}, status));
const A = asyncHandler;
const can = vtAuthorize;

router.get('/me', A(async (req, res) => ok(res, await core.me(req))));

// --- settings, categories, audit, company ---
router.get('/settings', can('settings', 'dashboard'), A(async (req, res) => ok(res, await core.getSettings(orgId(req)))));
router.patch('/settings', can('settings'), A(async (req, res) => send('settings')(res, await core.updateSettings(orgId(req), actor(req), core.settingsSchema.parse(req.body)))));
router.get('/categories', can('dashboard', 'categories', 'settings', 'entries'), A(async (req, res) => ok(res, await core.listCategories(orgId(req), core.SCOPES.includes(req.query.scope) ? req.query.scope : undefined))));
router.post('/categories', can('categories'), A(async (req, res) => send('category', 201)(res, await core.createCategory(orgId(req), actor(req), core.categoryCreateSchema.parse(req.body)))));
router.patch('/categories/:id', can('categories'), A(async (req, res) => send('category')(res, await core.updateCategory(orgId(req), actor(req), req.params.id, core.categoryUpdateSchema.parse(req.body)))));
router.delete('/categories/:id', can('categories'), A(async (req, res) => { const r = await core.deleteCategory(orgId(req), actor(req), req.params.id); return r.error ? failFor(res, r) : ok(res, { id: req.params.id }); }));
router.get('/audit', can('audit'), A(async (req, res) => ok(res, await core.listAudit(orgId(req), { entity: req.query.entity, entity_id: req.query.entity_id, limit: req.query.limit }))));
router.get('/company', can('settings'), A(async (req, res) => ok(res, await account.getCompany(orgId(req)))));
router.patch('/company', can('settings'), A(async (req, res) => ok(res, (await account.updateCompany(orgId(req), actor(req), account.companySchema.parse(req.body))).org)));

// --- logins for this company (admin) ---
const USER_ERRORS = {
  not_found: [404, 'User not found'],
  email_taken: [409, 'That email is already in use'],
  forbidden_superadmin: [403, 'Only a superadmin can change a superadmin'],
  self_deactivate: [422, 'You cannot deactivate your own account'],
  last_admin: [422, 'This is the last active admin of the company'],
};
const uactor = (req) => ({ id: req.user.id, is_superadmin: Boolean(req.user.is_superadmin) });
const sendUser = (res, result, status = 200) => {
  if (!result.error) return ok(res, result.user, {}, status);
  const m = USER_ERRORS[result.error];
  return m ? fail(res, m[0], m[1]) : fail(res, 500, 'Unexpected error');
};
router.get('/users', can('users'), A(async (req, res) => ok(res, await usersSvc.list(orgId(req), usersSvc.listQuerySchema.parse(req.query)))));
router.post('/users', can('users'), A(async (req, res) => sendUser(res, await usersSvc.create(orgId(req), uactor(req), usersSvc.createUserSchema.parse(req.body)), 201)));
router.patch('/users/:id', can('users'), loadSuperadminFlag, A(async (req, res) => sendUser(res, await usersSvc.update(orgId(req), uactor(req), req.params.id, usersSvc.updateUserSchema.parse(req.body)))));
router.post('/users/:id/status', can('users'), loadSuperadminFlag, A(async (req, res) => sendUser(res, await usersSvc.setActive(orgId(req), uactor(req), req.params.id, usersSvc.statusSchema.parse(req.body)))));

// --- people (employees and contractors) ---
const pctx = (req) => ({ isAdmin: isAdmin(req) });
router.get('/people', can('people', 'payroll', 'entriesEdit'), A(async (req, res) => ok(res, await people.list(orgId(req), people.listQuerySchema.parse(req.query)))));
router.post('/people', can('people'), A(async (req, res) => send('person', 201)(res, await people.create(orgId(req), actor(req), pctx(req), people.createPersonSchema.parse(req.body)))));
router.get('/people/:id', can('people'), A(async (req, res) => send('person')(res, await people.get(orgId(req), req.params.id))));
router.patch('/people/:id', can('people'), A(async (req, res) => send('person')(res, await people.update(orgId(req), actor(req), pctx(req), req.params.id, people.updatePersonSchema.parse(req.body)))));
router.delete('/people/:id', can('delete'), A(async (req, res) => { const r = await people.remove(orgId(req), actor(req), req.params.id); return r.error ? failFor(res, r) : ok(res, { id: req.params.id }); }));

// --- mining sites ---
router.get('/sites', can('sites', 'dashboard'), A(async (req, res) => ok(res, await sites.list(orgId(req), req.query))));
router.post('/sites', can('sitesEdit'), A(async (req, res) => send('site', 201)(res, await sites.create(orgId(req), actor(req), sites.createSchema.parse(req.body)))));
router.get('/sites/:id', can('sites'), A(async (req, res) => send('site')(res, await sites.get(orgId(req), req.params.id))));
router.patch('/sites/:id', can('sitesEdit'), A(async (req, res) => send('site')(res, await sites.update(orgId(req), actor(req), req.params.id, sites.updateSchema.parse(req.body)))));
router.get('/sites/:id/dashboard', can('sites', 'dashboard'), A(async (req, res) => send('dashboard')(res, await sites.summary(orgId(req), req.params.id, req.query, ctxOf(req)))));

// --- investments and their returns ---
router.get('/investments', can('investments'), A(async (req, res) => { const r = await investments.list(orgId(req), req.query); return ok(res, r.data, { pagination: r.pagination, totals: r.totals }); }));
router.post('/investments', can('investmentsEdit'), A(async (req, res) => send('investment', 201)(res, await investments.create(orgId(req), actor(req), ctxOf(req), investments.createSchema.parse(req.body)))));
router.get('/investments/:id', can('investments'), A(async (req, res) => send('investment')(res, await investments.getOne(orgId(req), req.params.id))));
router.patch('/investments/:id', can('investmentsEdit'), A(async (req, res) => send('investment')(res, await investments.update(orgId(req), actor(req), ctxOf(req), req.params.id, investments.updateSchema.parse(req.body)))));
router.delete('/investments/:id', can('delete'), A(async (req, res) => { const r = await investments.remove(orgId(req), actor(req), ctxOf(req), req.params.id); return r.error ? failFor(res, r) : ok(res, { id: req.params.id }); }));
router.post('/investments/:id/returns', can('investmentsEdit'), A(async (req, res) => send('investment', 201)(res, await investments.addReturn(orgId(req), actor(req), ctxOf(req), req.params.id, investments.returnSchema.parse(req.body)))));
router.patch('/returns/:id', can('investmentsEdit'), A(async (req, res) => send('investment')(res, await investments.updateReturn(orgId(req), actor(req), ctxOf(req), req.params.id, investments.returnUpdateSchema.parse(req.body)))));
router.delete('/returns/:id', can('investmentsEdit'), A(async (req, res) => { const r = await investments.removeReturn(orgId(req), actor(req), ctxOf(req), req.params.id); return r.error ? failFor(res, r) : ok(res, { id: req.params.id }); }));

// --- income, expenses, salaries, transfers ---
router.get('/entries', can('entries'), A(async (req, res) => { const r = await entries.list(orgId(req), req.query, ctxOf(req)); return ok(res, r.data, { pagination: r.pagination, summary: r.summary }); }));
router.post('/entries', can('entriesEdit'), A(async (req, res) => send('entry', 201)(res, await entries.create(orgId(req), actor(req), ctxOf(req), entries.createSchema.parse(req.body)))));
router.patch('/entries/:id', can('entriesEdit'), A(async (req, res) => send('entry')(res, await entries.update(orgId(req), actor(req), ctxOf(req), req.params.id, entries.updateSchema.parse(req.body)))));
router.delete('/entries/:id', can('entriesEdit'), A(async (req, res) => { const r = await entries.remove(orgId(req), actor(req), ctxOf(req), req.params.id); return r.error ? failFor(res, r) : ok(res, { id: req.params.id }); }));

// --- projections (plans, never transactions) ---
router.get('/projections', can('projections'), A(async (req, res) => ok(res, await projections.list(orgId(req), req.query))));
router.get('/projections/compare', can('projections'), A(async (req, res) => send(null)(res, await finance.projectionCompare(orgId(req), req.query, ctxOf(req)))));
router.post('/projections', can('projectionsEdit'), A(async (req, res) => send('projection', 201)(res, await projections.create(orgId(req), actor(req), projections.createSchema.parse(req.body)))));
router.patch('/projections/:id', can('projectionsEdit'), A(async (req, res) => send('projection')(res, await projections.update(orgId(req), actor(req), req.params.id, projections.updateSchema.parse(req.body)))));
router.delete('/projections/:id', can('projectionsEdit'), A(async (req, res) => { const r = await projections.remove(orgId(req), actor(req), req.params.id); return r.error ? failFor(res, r) : ok(res, { id: req.params.id }); }));

// --- dashboard, monthly report, transactions, reports, financials, month close ---
router.get('/dashboard', can('dashboard'), A(async (req, res) => ok(res, await finance.dashboard(orgId(req), req.query, ctxOf(req)))));
router.get('/monthly-report', can('reports'), A(async (req, res) => send(null)(res, await finance.monthlyReport(orgId(req), req.query, ctxOf(req)))));
router.get('/transactions', can('entries', 'investments'), A(async (req, res) => { const r = await finance.transactions(orgId(req), req.query, ctxOf(req)); return ok(res, r.data, { pagination: r.pagination, summary: r.summary }); }));
router.get('/reports', can('reports'), A(async (req, res) => send(null)(res, await finance.report(orgId(req), req.query, ctxOf(req)))));
router.get('/finance/valuation', can('financials', 'dashboard'), A(async (req, res) => send(null)(res, await finance.valuationTrend(orgId(req), finance.trendSchema.parse(req.query)))));
router.get('/finance/periods', can('financials'), A(async (req, res) => ok(res, await finance.periods(orgId(req)))));
router.post('/finance/periods/:month/close', can('closeMonth'), A(async (req, res) => send('period')(res, await finance.closeMonth(orgId(req), actor(req), req.params.month, finance.closeSchema.parse(req.body)))));
router.post('/finance/periods/:month/reopen', can('closeMonth'), A(async (req, res) => send('period')(res, await finance.reopenMonth(orgId(req), actor(req), req.params.month, finance.reopenSchema.parse(req.body)))));

module.exports = router;
