const express = require('express');
const { authenticate, requireOrgMembership, loadSuperadminFlag } = require('../../middleware/auth');
const requireModule = require('../../middleware/requireModule');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { fxAccess, fxAuthorize } = require('./access');
const core = require('./core.service');
const campaigns = require('./campaigns.service');
const entries = require('./entries.service');
const finance = require('./finance.service');
const people = require('./people.service');
const usersSvc = require('./users.service');
const account = require('./account.service');

const router = express.Router();
router.use(authenticate, requireOrgMembership, requireModule('foundation'), fxAccess);

const ERRORS = {
  not_found: [404, 'Record not found'],
  duplicate: [409, 'That name already exists'],
  category_not_found: [422, 'That category was not found'],
  manager_invalid: [422, 'The campaign manager must be an active person of the foundation'],
  planned_dates_invalid: [422, 'The planned end date must be on or after the start date'],
  actual_dates_invalid: [422, 'The actual completion date must be on or after the actual start date'],
  planned_exceeds_budget: [422, 'Planned investment cannot be more than the allocated budget'],
  status_dates_conflict: [422, 'That date does not fit the campaign status. Change the status first'],
  same_status: [409, 'The campaign already has that status'],
  bad_transition: [409, 'That change is not allowed from the current status'],
  admin_only_reopen: [403, 'Only an admin can reopen a completed or cancelled campaign'],
  reason_required: [422, 'A reason is required'],
  below_spent: [422, 'The new allocated budget is below what has already been spent. Only an admin can do that, with a reason'],
  no_change: [422, 'Nothing changed in the budget'],
  plan_duplicate_month: [422, 'A month appears twice in the plan'],
  plan_outside_window: [422, 'The plan has a month outside the campaign dates'],
  plan_exceeds_investment: [422, 'The monthly plan adds up to more than the planned investment'],
  has_entries: [409, 'This campaign has transactions. Cancel it instead of deleting it'],
  campaign_not_found: [422, 'Campaign not found'],
  campaign_closed: [409, 'That campaign is completed or cancelled. An admin can still record against a completed one'],
  campaign_not_open: [409, 'A draft campaign cannot have spending yet. Move it to Planned or Active first'],
  bad_status: [422, 'That status does not fit this kind of entry'],
  approval_required: [403, 'Only finance or an admin can approve, pay, reject or reverse spending'],
  transfer_has_no_campaign: [422, 'An internal transfer is not tied to a campaign'],
  programme_needs_campaign: [422, 'Programme spending needs a campaign. Mark it Operational or pick a campaign'],
  entry_final: [409, 'That entry is rejected, cancelled or reversed and can no longer be changed'],
  counted_locked: [403, 'Approved, paid or received money can only be changed by finance or an admin, with a reason'],
  over_budget: [409, 'This would take the campaign over its allocated budget. An admin can approve it with a reason'],
  override_reason_required: [422, 'This is over the allocated budget. Enter the reason for the override'],
  period_closed: [409, 'That month is closed. An admin must reopen it first'],
  period_reason_required: [422, 'That month is closed. Enter a reason to edit it as admin'],
  future_month: [422, 'A month can only be closed once it has started'],
  already_closed: [409, 'That month is already closed'],
  not_closed: [409, 'That month is not closed'],
  bad_range: [422, 'Choose a valid month range (at most 10 years)'],
  unknown_report: [404, 'Unknown report'],
  admin_only_field: [403, 'Only an admin can change login access'],
  user_not_in_org: [422, 'That user is not a member of this company'],
  user_linked: [409, 'That user is already linked to another person'],
};
function failFor(res, result) {
  const mapped = ERRORS[result.error];
  if (!mapped) return fail(res, 500, 'Unexpected error');
  // Overspend and similar rules explain themselves with their numbers.
  if (result.detail) {
    res.status(mapped[0]).json({ success: false, message: mapped[1], code: result.error, detail: result.detail });
    return res;
  }
  return fail(res, mapped[0], mapped[1]);
}
const orgId = (req) => req.user.org_id;
const actor = (req) => req.user.id;
const isAdmin = (req) => req.fx.role === 'admin';
const has = (req, cap) => req.fx.caps.includes(cap);
// Reasons for admin overrides travel in the body or the query.
const ctxOf = (req) => ({
  isAdmin: isAdmin(req),
  canOverride: has(req, 'override'),
  canApprove: has(req, 'entriesApprove'),
  canEditCounted: has(req, 'entriesEdit'),
  reason: (req.body && req.body.reason) || req.query.reason || undefined,
});
const send = (key, status = 200) => (res, result) => (result.error ? failFor(res, result) : ok(res, result[key], result.warning ? { warning: result.warning } : {}, status));
const A = asyncHandler;
const can = fxAuthorize;

router.get('/me', A(async (req, res) => ok(res, await core.me(req))));

// --- settings, categories, audit, company ---
router.get('/settings', can('settings', 'campaigns'), A(async (req, res) => ok(res, await core.getSettings(orgId(req)))));
router.patch('/settings', can('settings'), A(async (req, res) => send('settings')(res, await core.updateSettings(orgId(req), actor(req), core.settingsSchema.parse(req.body)))));
router.get('/categories', can('campaigns', 'categories', 'settings'), A(async (req, res) => ok(res, await core.listCategories(orgId(req), core.SCOPES.includes(req.query.scope) ? req.query.scope : undefined))));
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
router.get('/people', can('people', 'campaignsEdit'), A(async (req, res) => ok(res, await people.list(orgId(req), people.listQuerySchema.parse(req.query)))));
router.post('/people', can('people'), A(async (req, res) => send('person', 201)(res, await people.create(orgId(req), actor(req), pctx(req), people.createPersonSchema.parse(req.body)))));
router.get('/people/:id', can('people'), A(async (req, res) => send('person')(res, await people.get(orgId(req), req.params.id))));
router.patch('/people/:id', can('people'), A(async (req, res) => send('person')(res, await people.update(orgId(req), actor(req), pctx(req), req.params.id, people.updatePersonSchema.parse(req.body)))));
router.delete('/people/:id', can('delete'), A(async (req, res) => { const r = await people.remove(orgId(req), actor(req), req.params.id); return r.error ? failFor(res, r) : ok(res, { id: req.params.id }); }));

// --- campaigns ---
router.get('/campaigns', can('campaigns'), A(async (req, res) => { const r = await campaigns.list(orgId(req), req.query); return ok(res, r.data, { pagination: r.pagination }); }));
router.post('/campaigns', can('campaignsEdit'), A(async (req, res) => send('campaign', 201)(res, await campaigns.create(orgId(req), actor(req), campaigns.createSchema.parse(req.body)))));
router.get('/campaigns/:id', can('campaigns'), A(async (req, res) => send('campaign')(res, await campaigns.getOne(orgId(req), req.params.id))));
router.patch('/campaigns/:id', can('campaignsEdit'), A(async (req, res) => send('campaign')(res, await campaigns.update(orgId(req), actor(req), req.params.id, campaigns.updateSchema.parse(req.body)))));
router.post('/campaigns/:id/status', can('campaignsEdit'), A(async (req, res) => send('campaign')(res, await campaigns.setStatus(orgId(req), actor(req), ctxOf(req), req.params.id, campaigns.statusSchema.parse(req.body)))));
router.post('/campaigns/:id/budget', can('budget'), A(async (req, res) => send('campaign')(res, await campaigns.reviseBudget(orgId(req), actor(req), ctxOf(req), req.params.id, campaigns.budgetSchema.parse(req.body)))));
router.put('/campaigns/:id/plan', can('plan'), A(async (req, res) => send('campaign')(res, await campaigns.setPlan(orgId(req), actor(req), req.params.id, campaigns.planSchema.parse(req.body)))));
router.delete('/campaigns/:id', can('delete'), A(async (req, res) => { const r = await campaigns.remove(orgId(req), actor(req), req.params.id); return r.error ? failFor(res, r) : ok(res, { id: req.params.id }); }));

// --- money in and out ---
router.get('/entries', can('entries'), A(async (req, res) => { const r = await entries.list(orgId(req), req.query); return ok(res, r.data, { pagination: r.pagination, summary: r.summary }); }));
router.post('/entries', can('entries'), A(async (req, res) => send('entry', 201)(res, await entries.create(orgId(req), actor(req), ctxOf(req), entries.createSchema.parse(req.body)))));
router.patch('/entries/:id', can('entries'), A(async (req, res) => send('entry')(res, await entries.update(orgId(req), actor(req), ctxOf(req), req.params.id, entries.updateSchema.parse(req.body)))));
router.post('/entries/:id/status', can('entries'), A(async (req, res) => send('entry')(res, await entries.setStatus(orgId(req), actor(req), ctxOf(req), req.params.id, entries.statusSchema.parse(req.body)))));
router.delete('/entries/:id', can('entries'), A(async (req, res) => { const r = await entries.remove(orgId(req), actor(req), ctxOf(req), req.params.id); return r.error ? failFor(res, r) : ok(res, { id: req.params.id }); }));

// --- dashboard, reports, financials, month close ---
router.get('/dashboard', can('dashboard', 'overview'), A(async (req, res) => ok(res, await finance.dashboard(orgId(req), req.query))));
router.get('/reports', can('reports'), A(async (req, res) => { const r = await finance.report(orgId(req), req.query); return r.error ? failFor(res, r) : ok(res, r); }));
router.get('/finance/valuation', can('financials', 'overview'), A(async (req, res) => { const r = await finance.valuationTrend(orgId(req), finance.trendSchema.parse(req.query)); return r.error ? failFor(res, r) : ok(res, r); }));
router.get('/finance/periods', can('financials'), A(async (req, res) => ok(res, await finance.periods(orgId(req)))));
router.post('/finance/periods/:month/close', can('closeMonth'), A(async (req, res) => send('period')(res, await finance.closeMonth(orgId(req), actor(req), req.params.month, finance.closeSchema.parse(req.body)))));
router.post('/finance/periods/:month/reopen', can('closeMonth'), A(async (req, res) => send('period')(res, await finance.reopenMonth(orgId(req), actor(req), req.params.month, finance.reopenSchema.parse(req.body)))));

module.exports = router;
