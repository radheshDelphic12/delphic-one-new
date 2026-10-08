const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const env = require('../../config/env');
const { authenticate, requireOrgMembership, loadSuperadminFlag } = require('../../middleware/auth');
const requireModule = require('../../middleware/requireModule');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { axAccess, axAuthorize } = require('./access');
const core = require('./core.service');
const parties = require('./parties.service');
const documents = require('./documents.service');
const leads = require('./leads.service');
const deals = require('./deals.service');
const ledger = require('./ledger.service');
const tasks = require('./tasks.service');
const people = require('./people.service');
const usersSvc = require('./users.service');
const account = require('./account.service');
const finance = require('./finance.service');
const investments = require('./investments.service');
const salaries = require('./salaries.service');
const { SERVICE_TYPES } = require('./serviceTypes');

const router = express.Router();
router.use(authenticate, requireOrgMembership, requireModule('acconcy'), axAccess);

const ERRORS = {
  not_found: [404, 'Record not found'],
  duplicate: [409, 'That name already exists'],
  duplicate_name: [409, 'A client or vendor with that name already exists'],
  bad_range: [422, 'Choose a valid month range (at most 10 years)'],
  party_not_found: [422, 'Client not found'],
  vendor_not_found: [422, 'Vendor not found'],
  deal_not_found: [422, 'Deal not found'],
  owner_invalid: [422, 'The owner must be an admin or an Acconcy manager'],
  lead_closed: [409, 'This lead is closed; an admin can reopen or edit it'],
  not_closed: [409, 'That is not closed'],
  same_stage: [409, 'The lead is already in that stage'],
  lost_reason_required: [422, 'A reason is required to drop a lead'],
  lead_not_won: [409, 'Only a won lead can be converted to a deal'],
  already_converted: [409, 'This lead has already been converted to a deal'],
  deal_closed: [409, 'A completed or cancelled deal is locked; an admin can edit it'],
  same_status: [409, 'The deal already has that status'],
  reason_required: [422, 'A reason is required'],
  period_closed: [409, 'That month is closed. An admin must reopen it first'],
  period_reason_required: [422, 'That month is closed. Enter a reason to edit it as admin'],
  already_realised: [409, 'This investment is already fully realised'],
  auto_posted: [409, 'This entry was posted from an investment realisation; change it on the investment'],
  salary_locked: [409, 'Approved or paid salary rows can only be changed by an admin, with a reason'],
  bad_transition: [409, 'That salary row cannot move to that status'],
  admin_only_field: [403, 'Only an admin can change login access or salary'],
  user_not_in_org: [422, 'That user is not a member of this company'],
  user_linked: [409, 'That user is already linked to another person'],
  own_status_only: [403, 'You can only update the status of your own tasks'],
  future_month: [422, 'A month can only be used once it has started'],
  already_closed: [409, 'That month is already closed'],
  bad_dates: [422, 'The end date must be on or after the start date'],
};
function failFor(res, result) {
  if (result.error === 'invalid') return fail(res, 422, result.message || 'Invalid request');
  const mapped = ERRORS[result.error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}
const orgId = (req) => req.user.org_id;
const actor = (req) => req.user.id;
const isAdmin = (req) => req.ax.role === 'admin';
// Admin overrides (closed month, locked deal, quantity limits) carry a reason in the body or query.
const ctxOf = (req) => ({ isAdmin: isAdmin(req), reason: (req.body && req.body.reason) || req.query.reason || undefined });
const scopeOf = (req) => (['staff', 'contractor'].includes(req.ax.role) ? { personId: req.ax.person_id } : {});
const send = (key, status = 200) => (res, result) => (result.error ? failFor(res, result) : ok(res, result[key], {}, status));
const A = asyncHandler;
const can = axAuthorize;

router.get('/me', A(async (req, res) => ok(res, await core.me(req))));
router.get('/service-types', A(async (req, res) => ok(res, SERVICE_TYPES)));

// --- settings, masters (admin edits; readers need the matching capability) ---
router.get('/settings', can('settings'), A(async (req, res) => ok(res, await core.getSettings(orgId(req)))));
router.patch('/settings', can('settings'), A(async (req, res) => send('settings')(res, await core.updateSettings(orgId(req), actor(req), core.settingsSchema.parse(req.body)))));

router.get('/categories', can('ledger', 'settings', 'investments'), A(async (req, res) => ok(res, await core.listCategories(orgId(req), ['revenue', 'expense'].includes(req.query.kind) ? req.query.kind : undefined))));
router.post('/categories', can('settings'), A(async (req, res) => send('category', 201)(res, await core.createCategory(orgId(req), actor(req), core.categoryCreateSchema.parse(req.body)))));
router.patch('/categories/:id', can('settings'), A(async (req, res) => send('category')(res, await core.updateCategory(orgId(req), actor(req), req.params.id, core.categoryUpdateSchema.parse(req.body)))));
router.delete('/categories/:id', can('settings'), A(async (req, res) => { const r = await core.deleteCategory(orgId(req), actor(req), req.params.id); return r.error ? failFor(res, r) : ok(res, { id: req.params.id }); }));

router.get('/audit', can('audit'), A(async (req, res) => ok(res, await core.listAudit(orgId(req), { entity: req.query.entity, limit: req.query.limit }))));
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

// --- people ---
const pctx = (req) => ({ isAdmin: isAdmin(req) });
// Pickers (assignee / contractor / owner) are readable by everyone who can fill a lead, deal or task form.
// Pay figures are visible only to roles that handle salaries.
const hidePay = (req, p) => (req.ax.caps.includes('salaries') ? p : { ...p, monthly_salary: undefined });
router.get('/people', can('people', 'leads', 'deals', 'tasksAll', 'salaries'), A(async (req, res) => ok(res, (await people.list(orgId(req), people.listQuerySchema.parse(req.query))).map((p) => hidePay(req, p)))));
router.get('/owners', can('leads'), A(async (req, res) => ok(res, await people.listOwners(orgId(req)))));
router.post('/people', can('people'), A(async (req, res) => send('person', 201)(res, await people.create(orgId(req), actor(req), pctx(req), people.createPersonSchema.parse(req.body)))));
router.get('/people/:id', can('people'), A(async (req, res) => { const r = await people.get(orgId(req), req.params.id); return r.error ? failFor(res, r) : ok(res, hidePay(req, r.person)); }));
router.patch('/people/:id', can('people'), A(async (req, res) => send('person')(res, await people.update(orgId(req), actor(req), pctx(req), req.params.id, people.updatePersonSchema.parse(req.body)))));
router.delete('/people/:id', can('delete'), A(async (req, res) => { const r = await people.remove(orgId(req), actor(req), req.params.id); return r.error ? failFor(res, r) : ok(res, { id: req.params.id }); }));

// --- clients / vendors ---
router.get('/parties', can('parties', 'leads', 'deals'), A(async (req, res) => {
  const r = await parties.list(orgId(req), parties.listQuerySchema.parse(req.query));
  return ok(res, r.data, { pagination: r.pagination, summary: r.summary });
}));
router.post('/parties/import', can('parties'), A(async (req, res) => ok(res, await parties.importRows(orgId(req), actor(req), parties.importSchema.parse(req.body).rows))));
router.post('/parties', can('parties'), A(async (req, res) => send('party', 201)(res, await parties.create(orgId(req), actor(req), parties.createPartySchema.parse(req.body)))));
router.get('/parties/:id', can('parties', 'leads', 'deals'), A(async (req, res) => send('party')(res, await parties.get(orgId(req), req.params.id))));
router.get('/parties/:id/statement', can('parties'), A(async (req, res) => { const r = await parties.statement(orgId(req), req.params.id); return r.error ? failFor(res, r) : ok(res, r); }));
router.patch('/parties/:id', can('parties'), A(async (req, res) => send('party')(res, await parties.update(orgId(req), actor(req), req.params.id, parties.updatePartySchema.parse(req.body)))));
router.delete('/parties/:id', can('delete'), A(async (req, res) => { const r = await parties.remove(orgId(req), actor(req), req.params.id); return r.error ? failFor(res, r) : ok(res, { id: req.params.id }); }));

// --- leads ---
router.get('/leads/summary', can('leads'), A(async (req, res) => ok(res, await leads.summary(orgId(req), leads.listQuerySchema.parse(req.query)))));
router.get('/leads/follow-ups', can('leads'), A(async (req, res) => ok(res, await leads.followUps(orgId(req)))));
router.get('/leads', can('leads'), A(async (req, res) => ok(res, await leads.list(orgId(req), leads.listQuerySchema.parse(req.query)))));
router.post('/leads', can('leads'), A(async (req, res) => send('lead', 201)(res, await leads.create(orgId(req), actor(req), leads.createLeadSchema.parse(req.body)))));
router.get('/leads/:id', can('leads'), A(async (req, res) => send('lead')(res, await leads.get(orgId(req), req.params.id))));
router.patch('/leads/:id', can('leads'), A(async (req, res) => send('lead')(res, await leads.update(orgId(req), actor(req), ctxOf(req), req.params.id, leads.updateLeadSchema.parse(req.body)))));
router.delete('/leads/:id', can('delete'), A(async (req, res) => { const r = await leads.remove(orgId(req), actor(req), req.params.id); return r.error ? failFor(res, r) : ok(res, { id: req.params.id }); }));
router.post('/leads/:id/stage', can('leads'), A(async (req, res) => send('lead')(res, await leads.changeStage(orgId(req), actor(req), req.params.id, leads.stageSchema.parse(req.body)))));
router.post('/leads/:id/reopen', can('override'), A(async (req, res) => send('lead')(res, await leads.reopen(orgId(req), actor(req), req.params.id, leads.reopenSchema.parse(req.body)))));
router.post('/leads/:id/convert', can('dealsEdit'), A(async (req, res) => send('deal', 201)(res, await deals.convertLead(orgId(req), actor(req), req.params.id, deals.convertSchema.parse(req.body || {})))));
router.get('/leads/:id/activities', can('leads'), A(async (req, res) => send('activities')(res, await leads.listActivities(orgId(req), req.params.id))));
router.post('/leads/:id/activities', can('leads'), A(async (req, res) => send('activity', 201)(res, await leads.addActivity(orgId(req), actor(req), ctxOf(req), req.params.id, leads.activitySchema.parse(req.body)))));
router.patch('/leads/:id/activities/:aid', can('leads'), A(async (req, res) => send('activity')(res, await leads.updateActivity(orgId(req), ctxOf(req), req.params.id, req.params.aid, leads.activityUpdateSchema.parse(req.body)))));
router.delete('/leads/:id/activities/:aid', can('leads'), A(async (req, res) => { const r = await leads.removeActivity(orgId(req), ctxOf(req), req.params.id, req.params.aid); return r.error ? failFor(res, r) : ok(res, { ok: true }); }));

// --- deals ---
const dealId = (req) => req.params.id;
router.get('/deals', can('deals'), A(async (req, res) => ok(res, await deals.list(orgId(req), deals.listQuerySchema.parse(req.query)))));
router.post('/deals', can('dealsEdit'), A(async (req, res) => send('deal', 201)(res, await deals.create(orgId(req), actor(req), deals.createDealSchema.parse(req.body)))));
router.get('/deals/:id', can('deals'), A(async (req, res) => send('deal')(res, await deals.get(orgId(req), dealId(req)))));
router.patch('/deals/:id', can('dealsEdit'), A(async (req, res) => send('deal')(res, await deals.update(orgId(req), actor(req), ctxOf(req), dealId(req), deals.updateDealSchema.parse(req.body)))));
router.delete('/deals/:id', can('delete'), A(async (req, res) => { const r = await deals.remove(orgId(req), actor(req), dealId(req)); return r.error ? failFor(res, r) : ok(res, { id: dealId(req) }); }));
router.post('/deals/:id/status', can('dealsEdit'), A(async (req, res) => send('deal')(res, await deals.changeStatus(orgId(req), actor(req), ctxOf(req), dealId(req), deals.statusSchema.parse(req.body)))));

const idOk = (res, r, extra) => (r.error ? failFor(res, r) : ok(res, extra || { id: r.id }, {}, 200));

// --- revenue and expenses (company ledger) ---
router.get('/ledger', can('ledger'), A(async (req, res) => { const r = await ledger.list(orgId(req), ledger.listQuerySchema.parse(req.query)); return ok(res, r.data, { totals: r.totals }); }));
router.post('/ledger', can('ledger'), A(async (req, res) => { const r = await ledger.create(orgId(req), actor(req), ctxOf(req), ledger.createEntrySchema.parse(req.body)); return r.error ? failFor(res, r) : created(res, { id: r.id }); }));
router.patch('/ledger/:id', can('ledger'), A(async (req, res) => idOk(res, await ledger.update(orgId(req), actor(req), ctxOf(req), req.params.id, ledger.updateEntrySchema.parse(req.body)))));
router.delete('/ledger/:id', can('ledger'), A(async (req, res) => idOk(res, await ledger.remove(orgId(req), actor(req), ctxOf(req), req.params.id), { ok: true })));

// --- investments and assets ---
router.get('/investments', can('investments'), A(async (req, res) => { const r = await investments.list(orgId(req), investments.listQuerySchema.parse(req.query)); return ok(res, r.data, { totals: r.totals, by_type: r.by_type }); }));
router.post('/investments', can('investments'), A(async (req, res) => send('investment', 201)(res, await investments.create(orgId(req), actor(req), ctxOf(req), investments.createInvestmentSchema.parse(req.body)))));
router.get('/investments/:id', can('investments'), A(async (req, res) => send('investment')(res, await investments.get(orgId(req), req.params.id))));
router.patch('/investments/:id', can('investments'), A(async (req, res) => send('investment')(res, await investments.update(orgId(req), actor(req), ctxOf(req), req.params.id, investments.updateInvestmentSchema.parse(req.body)))));
router.delete('/investments/:id', can('delete'), A(async (req, res) => idOk(res, await investments.remove(orgId(req), actor(req), ctxOf(req), req.params.id), { ok: true })));
router.post('/investments/:id/realise', can('investments'), A(async (req, res) => send('investment')(res, await investments.realise(orgId(req), actor(req), ctxOf(req), req.params.id, investments.realiseSchema.parse(req.body)))));
router.delete('/investments/:id/realisations/:rid', can('override'), A(async (req, res) => send('investment')(res, await investments.removeRealisation(orgId(req), actor(req), ctxOf(req), req.params.id, req.params.rid))));
router.get('/assets', can('investments', 'valuation'), A(async (req, res) => { const r = await investments.listAssets(orgId(req), investments.assetListSchema.parse(req.query)); return ok(res, r.data, { total_active: r.total_active }); }));
router.post('/assets', can('valuation'), A(async (req, res) => send('asset', 201)(res, await investments.createAsset(orgId(req), actor(req), ctxOf(req), investments.createAssetSchema.parse(req.body)))));
router.patch('/assets/:id', can('valuation'), A(async (req, res) => send('asset')(res, await investments.updateAsset(orgId(req), actor(req), ctxOf(req), req.params.id, investments.updateAssetSchema.parse(req.body)))));
router.delete('/assets/:id', can('valuation'), A(async (req, res) => idOk(res, await investments.removeAsset(orgId(req), actor(req), ctxOf(req), req.params.id), { ok: true })));

// --- salaries (existing roster; generated per month, approved, then paid) ---
router.get('/salaries', can('salaries'), A(async (req, res) => { const r = await salaries.list(orgId(req), salaries.listQuerySchema.parse(req.query)); return ok(res, r.data, { totals: r.totals }); }));
router.post('/salaries/generate', can('salaries'), A(async (req, res) => { const r = await salaries.generate(orgId(req), actor(req), ctxOf(req), salaries.generateSchema.parse(req.body)); return r.error ? failFor(res, r) : ok(res, r); }));
router.patch('/salaries/:id', can('salaries'), A(async (req, res) => send('salary')(res, await salaries.update(orgId(req), actor(req), ctxOf(req), req.params.id, salaries.updateSchema.parse(req.body)))));
router.post('/salaries/:id/approve', can('salaries'), A(async (req, res) => send('salary')(res, await salaries.setStatus(orgId(req), actor(req), ctxOf(req), req.params.id, 'approved'))));
router.post('/salaries/:id/unapprove', can('override'), A(async (req, res) => send('salary')(res, await salaries.setStatus(orgId(req), actor(req), ctxOf(req), req.params.id, 'draft', salaries.reasonSchema.parse(req.body)))));
router.post('/salaries/:id/pay', can('salaries'), A(async (req, res) => send('salary')(res, await salaries.setStatus(orgId(req), actor(req), ctxOf(req), req.params.id, 'paid', salaries.paySchema.parse(req.body || {})))));
router.delete('/salaries/:id', can('salaries'), A(async (req, res) => idOk(res, await salaries.remove(orgId(req), actor(req), ctxOf(req), req.params.id), { ok: true })));

// --- tasks ---
router.get('/tasks', can('tasks'), A(async (req, res) => ok(res, await tasks.list(orgId(req), tasks.listQuerySchema.parse(req.query), scopeOf(req)))));
router.post('/tasks', can('tasksAll'), A(async (req, res) => send('task', 201)(res, await tasks.create(orgId(req), actor(req), tasks.createTaskSchema.parse(req.body)))));
router.get('/tasks/:id', can('tasks'), A(async (req, res) => send('task')(res, await tasks.get(orgId(req), req.params.id, scopeOf(req)))));
router.patch('/tasks/:id', can('tasks'), A(async (req, res) => send('task')(res, await tasks.update(orgId(req), actor(req), req.params.id, tasks.updateTaskSchema.parse(req.body), scopeOf(req)))));
router.delete('/tasks/:id', can('tasksAll'), A(async (req, res) => { const r = await tasks.remove(orgId(req), actor(req), req.params.id); return r.error ? failFor(res, r) : ok(res, { id: req.params.id }); }));

// The signed-in person's assigned leads, deals and tasks (employees and contractors). No money figures.
router.get('/my-work', can('myWork'), A(async (req, res) => {
  const personId = req.ax.person_id;
  if (!personId) return ok(res, { leads: [], deals: [], tasks: [] });
  const scope = { personId };
  const [l, d, t] = await Promise.all([
    leads.list(orgId(req), leads.listQuerySchema.parse({ stage: 'open' }), scope),
    deals.list(orgId(req), deals.listQuerySchema.parse({ status: 'open' }), scope),
    tasks.list(orgId(req), tasks.listQuerySchema.parse({ status: 'open' }), scope),
  ]);
  const strip = (x) => ({ ...x, summary: x.summary ? { duration_days: x.summary.duration_days, delayed: x.summary.delayed } : undefined, deal_amount: undefined });
  return ok(res, { leads: l.map((x) => ({ ...x, expected_amount: undefined, expected_revenue: undefined, expected_profit: undefined })), deals: d.map(strip), tasks: t });
}));

// --- finance ---
const fparse = (req) => finance.filterSchema.parse(req.query);
router.get('/dashboard', can('dashboard'), A(async (req, res) => ok(res, await finance.dashboard(orgId(req), req.ax.caps, fparse(req)))));
router.get('/finance/overview', can('overview'), A(async (req, res) => ok(res, await finance.overview(orgId(req), fparse(req), req.ax.caps))));
router.get('/finance/pnl', can('overview'), A(async (req, res) => ok(res, await finance.pnl(orgId(req), fparse(req)))));
router.get('/finance/service-report', can('overview'), A(async (req, res) => ok(res, await finance.serviceReport(orgId(req), fparse(req)))));
router.get('/finance/investments', can('investments'), A(async (req, res) => ok(res, await finance.investmentReport(orgId(req), fparse(req)))));
router.get('/finance/valuation', can('valuation'), A(async (req, res) => { const r = await finance.valuationTrend(orgId(req), finance.trendSchema.parse(req.query)); return r.error ? failFor(res, r) : ok(res, r); }));
router.get('/finance/valuation/history', can('valuation'), A(async (req, res) => ok(res, await finance.valuationHistory(orgId(req)))));
router.post('/finance/valuation/record', can('valuation'), A(async (req, res) => send('valuation', 201)(res, await finance.recordValuation(orgId(req), actor(req), finance.recordSchema.parse(req.body)))));
router.get('/finance/periods', can('financials'), A(async (req, res) => ok(res, await finance.periods(orgId(req)))));
router.post('/finance/periods/:month/close', can('closeMonth'), A(async (req, res) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(req.params.month)) return fail(res, 422, 'Use YYYY-MM');
  return send('period')(res, await finance.closeMonth(orgId(req), actor(req), req.params.month, finance.closeSchema.parse(req.body || {})));
}));
router.post('/finance/periods/:month/reopen', can('closeMonth'), A(async (req, res) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(req.params.month)) return fail(res, 422, 'Use YYYY-MM');
  return send('period')(res, await finance.reopenMonth(orgId(req), actor(req), req.params.month, finance.reopenSchema.parse(req.body)));
}));

// --- reports ---
router.get('/reports/leads', can('leads'), A(async (req, res) => ok(res, await finance.leadReport(orgId(req), leads.listQuerySchema.parse(req.query)))));
router.get('/reports/deals', can('deals'), A(async (req, res) => ok(res, await finance.dealReport(orgId(req), deals.listQuerySchema.parse(req.query)))));

// --- documents ---
fs.mkdirSync(env.uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, env.uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, documents.ALLOWED_EXT.includes(path.extname(file.originalname).toLowerCase())),
});
router.get('/documents', A(async (req, res) => {
  const query = documents.listSchema.parse(req.query);
  if (!req.ax.caps.includes(documents.capFor(query.owner_type))) return fail(res, 403, 'Insufficient Acconcy role');
  if (!(await documents.ownerExists(orgId(req), query.owner_type, query.owner_id))) return fail(res, 404, 'Record not found');
  return ok(res, await documents.list(orgId(req), query));
}));
router.post(
  '/documents',
  (req, res, next) =>
    upload.single('file')(req, res, (err) => {
      if (err) return fail(res, 422, err.code === 'LIMIT_FILE_SIZE' ? `File is larger than ${env.maxUploadMb} MB` : 'Could not read the upload');
      return next();
    }),
  A(async (req, res) => {
    const file = req.file;
    const bail = (status, message, errors) => {
      if (file) documents.removeFile(`/uploads/${file.filename}`);
      return fail(res, status, message, errors);
    };
    if (!file) return bail(422, 'Attach a PDF, Word, Excel, CSV or image file');
    const parsed = documents.uploadSchema.safeParse(req.body);
    if (!parsed.success) return bail(422, 'Validation failed', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    if (!req.ax.caps.includes(documents.capFor(parsed.data.owner_type))) return bail(403, 'Insufficient Acconcy role');
    if (!(await documents.ownerExists(orgId(req), parsed.data.owner_type, parsed.data.owner_id))) return bail(404, 'Record not found');
    return created(res, (await documents.create(orgId(req), actor(req), parsed.data, file)).document);
  })
);
const docGuard = async (req, res) => {
  const doc = await documents.find(orgId(req), req.params.id);
  if (!doc) { fail(res, 404, 'Document not found'); return null; }
  if (!req.ax.caps.includes(documents.capFor(doc.owner_type))) { fail(res, 403, 'Insufficient Acconcy role'); return null; }
  return doc;
};
router.patch('/documents/:id', A(async (req, res) => {
  if (!(await docGuard(req, res))) return undefined;
  const r = await documents.update(orgId(req), actor(req), req.params.id, documents.updateSchema.parse(req.body));
  return r.error ? failFor(res, r) : ok(res, r.document);
}));
router.delete('/documents/:id', A(async (req, res) => {
  if (!(await docGuard(req, res))) return undefined;
  await documents.remove(orgId(req), actor(req), req.params.id);
  return ok(res, { id: req.params.id });
}));

module.exports = router;
