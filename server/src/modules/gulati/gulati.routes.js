const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const env = require('../../config/env');
const { authenticate, requireOrgMembership, loadSuperadminFlag } = require('../../middleware/auth');
const requireModule = require('../../middleware/requireModule');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { gxAccess, gxAuthorize } = require('./access');
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

const router = express.Router();
router.use(authenticate, requireOrgMembership, requireModule('gulati'), gxAccess);

const ERRORS = {
  not_found: [404, 'Record not found'],
  duplicate: [409, 'That name already exists'],
  duplicate_name: [409, 'A client or vendor with that name already exists'],
  manual_value_required: [422, 'A manual valuation needs a value'],
  bad_range: [422, 'Choose a valid month range (at most 10 years)'],
  party_not_found: [422, 'Client not found'],
  vendor_not_found: [422, 'Vendor not found'],
  deal_not_found: [422, 'Deal not found'],
  owner_invalid: [422, 'The owner must be an admin or a Gulati manager'],
  lead_closed: [409, 'This lead is closed; an admin can reopen or edit it'],
  not_closed: [409, 'The lead is not closed'],
  same_stage: [409, 'The lead is already in that stage'],
  lost_reason_required: [422, 'A reason is required to drop a lead'],
  lead_not_won: [409, 'Only a won lead can be converted to a trading deal'],
  already_converted: [409, 'This lead has already been converted to a deal'],
  deal_closed: [409, 'A completed or cancelled deal is locked; an admin can edit it'],
  same_status: [409, 'The deal already has that status'],
  reason_required: [422, 'A reason is required'],
  period_closed: [409, 'That month is closed. An admin must reopen it first'],
  period_reason_required: [422, 'That month is closed. Enter a reason to edit it as admin'],
  over_supplied: [422, 'That would supply more than the ordered quantity'],
  override_reason_required: [422, 'Enter a reason to override this limit'],
  over_paid: [422, 'That payment is more than the amount outstanding'],
  future_date: [422, 'The payment date cannot be in the future'],
  admin_only_field: [403, 'Only an admin can change login access'],
  user_not_in_org: [422, 'That user is not a member of this company'],
  user_linked: [409, 'That user is already linked to another person'],
  own_status_only: [403, 'You can only update the status of your own tasks'],
  future_month: [422, 'A month can only be closed once it has started'],
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
const isAdmin = (req) => req.gx.role === 'admin';
// Admin overrides (closed month, locked deal, quantity limits) carry a reason in the body or query.
const ctxOf = (req) => ({ isAdmin: isAdmin(req), reason: (req.body && req.body.reason) || req.query.reason || undefined });
const scopeOf = (req) => (['staff', 'contractor'].includes(req.gx.role) ? { personId: req.gx.person_id } : {});
const send = (key, status = 200) => (res, result) => (result.error ? failFor(res, result) : ok(res, result[key], {}, status));
const A = asyncHandler;
const can = gxAuthorize;

router.get('/me', A(async (req, res) => ok(res, await core.me(req))));

// --- settings, masters (admin edits; readers need the matching capability) ---
router.get('/settings', can('settings'), A(async (req, res) => ok(res, await core.getSettings(orgId(req)))));
router.patch('/settings', can('settings'), A(async (req, res) => send('settings')(res, await core.updateSettings(orgId(req), actor(req), core.settingsSchema.parse(req.body)))));

router.get('/categories', can('ledger', 'settings'), A(async (req, res) => ok(res, await core.listCategories(orgId(req), ['revenue', 'expense'].includes(req.query.kind) ? req.query.kind : undefined))));
router.post('/categories', can('settings'), A(async (req, res) => send('category', 201)(res, await core.createCategory(orgId(req), actor(req), core.categoryCreateSchema.parse(req.body)))));
router.patch('/categories/:id', can('settings'), A(async (req, res) => send('category')(res, await core.updateCategory(orgId(req), actor(req), req.params.id, core.categoryUpdateSchema.parse(req.body)))));
router.delete('/categories/:id', can('settings'), A(async (req, res) => { const r = await core.deleteCategory(orgId(req), actor(req), req.params.id); return r.error ? failFor(res, r) : ok(res, { id: req.params.id }); }));

// units and trading types are read by anyone who fills a lead / deal form
router.get('/units', A(async (req, res) => ok(res, await core.listUnits(orgId(req)))));
router.post('/units', can('settings'), A(async (req, res) => send('unit', 201)(res, await core.createUnit(orgId(req), actor(req), core.unitCreateSchema.parse(req.body)))));
router.patch('/units/:id', can('settings'), A(async (req, res) => send('unit')(res, await core.updateUnit(orgId(req), actor(req), req.params.id, core.unitUpdateSchema.parse(req.body)))));
router.delete('/units/:id', can('settings'), A(async (req, res) => { const r = await core.deleteUnit(orgId(req), actor(req), req.params.id); return r.error ? failFor(res, r) : ok(res, { id: req.params.id }); }));
router.get('/trading-types', A(async (req, res) => ok(res, await core.listTypes(orgId(req)))));
router.post('/trading-types', can('settings'), A(async (req, res) => send('type', 201)(res, await core.createType(orgId(req), actor(req), core.typeCreateSchema.parse(req.body)))));
router.patch('/trading-types/:key', can('settings'), A(async (req, res) => send('type')(res, await core.updateType(orgId(req), actor(req), req.params.key, core.typeUpdateSchema.parse(req.body)))));

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
router.get('/people', can('people', 'leads', 'deals', 'tasksAll'), A(async (req, res) => ok(res, await people.list(orgId(req), people.listQuerySchema.parse(req.query)))));
router.get('/owners', can('leads'), A(async (req, res) => ok(res, await people.listOwners(orgId(req)))));
router.post('/people', can('people'), A(async (req, res) => send('person', 201)(res, await people.create(orgId(req), actor(req), pctx(req), people.createPersonSchema.parse(req.body)))));
router.get('/people/:id', can('people'), A(async (req, res) => send('person')(res, await people.get(orgId(req), req.params.id))));
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
router.get('/leads/summary', can('leads'), A(async (req, res) => ok(res, await leads.summary(orgId(req)))));
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

// --- trading deals ---
const dealId = (req) => req.params.id;
router.get('/deals', can('deals'), A(async (req, res) => ok(res, await deals.list(orgId(req), deals.listQuerySchema.parse(req.query)))));
router.post('/deals', can('dealsEdit'), A(async (req, res) => send('deal', 201)(res, await deals.create(orgId(req), actor(req), deals.createDealSchema.parse(req.body)))));
router.get('/deals/:id', can('deals'), A(async (req, res) => send('deal')(res, await deals.get(orgId(req), dealId(req)))));
router.patch('/deals/:id', can('dealsEdit'), A(async (req, res) => send('deal')(res, await deals.update(orgId(req), actor(req), ctxOf(req), dealId(req), deals.updateDealSchema.parse(req.body)))));
router.delete('/deals/:id', can('delete'), A(async (req, res) => { const r = await deals.remove(orgId(req), actor(req), dealId(req)); return r.error ? failFor(res, r) : ok(res, { id: dealId(req) }); }));
router.post('/deals/:id/status', can('dealsEdit'), A(async (req, res) => send('deal')(res, await deals.changeStatus(orgId(req), actor(req), ctxOf(req), dealId(req), deals.statusSchema.parse(req.body)))));

const idOk = (res, r, extra) => (r.error ? failFor(res, r) : ok(res, extra || { id: r.id }, {}, 200));
router.post('/deals/:id/purchases', can('dealsEdit'), A(async (req, res) => { const r = await deals.createPurchase(orgId(req), actor(req), ctxOf(req), dealId(req), deals.purchaseCreateSchema.parse(req.body)); return r.error ? failFor(res, r) : created(res, { id: r.id }); }));
router.patch('/deals/:id/purchases/:lid', can('dealsEdit'), A(async (req, res) => idOk(res, await deals.updatePurchase(orgId(req), actor(req), ctxOf(req), dealId(req), req.params.lid, deals.purchaseUpdateSchema.parse(req.body)))));
router.delete('/deals/:id/purchases/:lid', can('dealsEdit'), A(async (req, res) => idOk(res, await deals.removePurchase(orgId(req), actor(req), ctxOf(req), dealId(req), req.params.lid), { ok: true })));
router.post('/deals/:id/sales', can('dealsEdit'), A(async (req, res) => { const r = await deals.createSale(orgId(req), actor(req), ctxOf(req), dealId(req), deals.saleCreateSchema.parse(req.body)); return r.error ? failFor(res, r) : created(res, { id: r.id }); }));
router.patch('/deals/:id/sales/:lid', can('dealsEdit'), A(async (req, res) => idOk(res, await deals.updateSale(orgId(req), actor(req), ctxOf(req), dealId(req), req.params.lid, deals.saleUpdateSchema.parse(req.body)))));
router.delete('/deals/:id/sales/:lid', can('dealsEdit'), A(async (req, res) => idOk(res, await deals.removeSale(orgId(req), actor(req), ctxOf(req), dealId(req), req.params.lid), { ok: true })));

router.post('/deals/:id/purchases/:lid/payments', can('payments'), A(async (req, res) => { const r = await deals.addVendorPayment(orgId(req), actor(req), ctxOf(req), dealId(req), req.params.lid, deals.paymentSchema.parse(req.body)); return r.error ? failFor(res, r) : created(res, { id: r.id }); }));
router.post('/deals/:id/sales/:lid/payments', can('payments'), A(async (req, res) => { const r = await deals.addClientPayment(orgId(req), actor(req), ctxOf(req), dealId(req), req.params.lid, deals.paymentSchema.parse(req.body)); return r.error ? failFor(res, r) : created(res, { id: r.id }); }));
router.patch('/deals/:id/payments/:pid', can('payments'), A(async (req, res) => idOk(res, await deals.updatePayment(orgId(req), actor(req), ctxOf(req), dealId(req), req.params.pid, deals.paymentUpdateSchema.parse(req.body)))));
router.delete('/deals/:id/payments/:pid', can('payments'), A(async (req, res) => idOk(res, await deals.removePayment(orgId(req), actor(req), ctxOf(req), dealId(req), req.params.pid), { ok: true })));

// --- expenses and company ledger ---
router.get('/ledger', can('ledger'), A(async (req, res) => { const r = await ledger.list(orgId(req), ledger.listQuerySchema.parse(req.query)); return ok(res, r.data, { totals: r.totals }); }));
router.post('/ledger', can('ledger'), A(async (req, res) => { const r = await ledger.create(orgId(req), actor(req), ctxOf(req), ledger.createEntrySchema.parse(req.body)); return r.error ? failFor(res, r) : created(res, { id: r.id }); }));
router.patch('/ledger/:id', can('ledger'), A(async (req, res) => idOk(res, await ledger.update(orgId(req), actor(req), ctxOf(req), req.params.id, ledger.updateEntrySchema.parse(req.body)))));
router.delete('/ledger/:id', can('ledger'), A(async (req, res) => idOk(res, await ledger.remove(orgId(req), actor(req), ctxOf(req), req.params.id), { ok: true })));

// --- tasks ---
router.get('/tasks', can('tasks'), A(async (req, res) => ok(res, await tasks.list(orgId(req), tasks.listQuerySchema.parse(req.query), scopeOf(req)))));
router.post('/tasks', can('tasksAll'), A(async (req, res) => send('task', 201)(res, await tasks.create(orgId(req), actor(req), tasks.createTaskSchema.parse(req.body)))));
router.get('/tasks/:id', can('tasks'), A(async (req, res) => send('task')(res, await tasks.get(orgId(req), req.params.id, scopeOf(req)))));
router.patch('/tasks/:id', can('tasks'), A(async (req, res) => send('task')(res, await tasks.update(orgId(req), actor(req), req.params.id, tasks.updateTaskSchema.parse(req.body), scopeOf(req)))));
router.delete('/tasks/:id', can('tasksAll'), A(async (req, res) => { const r = await tasks.remove(orgId(req), actor(req), req.params.id); return r.error ? failFor(res, r) : ok(res, { id: req.params.id }); }));

// The signed-in person's assigned leads, deals and tasks (employees and contractors).
router.get('/my-work', can('myWork'), A(async (req, res) => {
  const personId = req.gx.person_id;
  if (!personId) return ok(res, { leads: [], deals: [], tasks: [] });
  const scope = { personId };
  const [l, d, t] = await Promise.all([
    leads.list(orgId(req), leads.listQuerySchema.parse({ stage: 'open' }), scope),
    deals.list(orgId(req), deals.listQuerySchema.parse({ status: 'active' }), scope),
    tasks.list(orgId(req), tasks.listQuerySchema.parse({ status: 'open' }), scope),
  ]);
  // Operational view: no money figures for employees or contractors.
  const strip = (x) => ({ ...x, summary: x.summary ? { quantities: x.summary.quantities, duration_days: x.summary.duration_days, delayed: x.summary.delayed } : undefined, expected_purchase_amount: undefined, expected_sale_amount: undefined });
  return ok(res, { leads: l.map((x) => ({ ...x, expected_purchase_amount: undefined, expected_sale_amount: undefined, expected_margin: undefined })), deals: d.map(strip), tasks: t });
}));

// --- finance ---
const fparse = (req) => finance.filterSchema.parse(req.query);
router.get('/dashboard', can('dashboard'), A(async (req, res) => ok(res, await finance.dashboard(orgId(req), req.gx.caps))));
router.get('/finance/overview', can('overview'), A(async (req, res) => ok(res, await finance.overview(orgId(req), fparse(req), req.gx.caps))));
router.get('/finance/pnl', can('overview'), A(async (req, res) => ok(res, await finance.pnl(orgId(req), fparse(req)))));
router.get('/finance/trading-report', can('overview'), A(async (req, res) => ok(res, await finance.tradingReport(orgId(req), fparse(req)))));
router.get('/finance/valuation', can('valuation'), A(async (req, res) => { const r = await finance.valuationTrend(orgId(req), finance.trendSchema.parse(req.query)); return r.error ? failFor(res, r) : ok(res, r); }));
router.put('/finance/asset-values', can('valuation'), A(async (req, res) => send('asset')(res, await finance.setAssetValue(orgId(req), actor(req), finance.assetSchema.parse(req.body)))));
router.delete('/finance/asset-values/:month', can('valuation'), A(async (req, res) => send('month')(res, await finance.deleteAssetValue(orgId(req), actor(req), finance.assetSchema.shape.month.parse(req.params.month)))));
router.get('/finance/periods', can('financials'), A(async (req, res) => ok(res, await finance.periods(orgId(req)))));
router.post('/finance/periods/:month/close', can('closeMonth'), A(async (req, res) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(req.params.month)) return fail(res, 422, 'Use YYYY-MM');
  return send('period')(res, await finance.closeMonth(orgId(req), actor(req), req.params.month, finance.closeSchema.parse(req.body || {})));
}));
router.post('/finance/periods/:month/reopen', can('closeMonth'), A(async (req, res) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(req.params.month)) return fail(res, 422, 'Use YYYY-MM');
  return send('period')(res, await finance.reopenMonth(orgId(req), actor(req), req.params.month, finance.reopenSchema.parse(req.body)));
}));

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
  if (!req.gx.caps.includes(documents.capFor(query.owner_type))) return fail(res, 403, 'Insufficient Gulati role');
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
    if (!req.gx.caps.includes(documents.capFor(parsed.data.owner_type))) return bail(403, 'Insufficient Gulati role');
    if (!(await documents.ownerExists(orgId(req), parsed.data.owner_type, parsed.data.owner_id))) return bail(404, 'Record not found');
    return created(res, (await documents.create(orgId(req), actor(req), parsed.data, file)).document);
  })
);
const docGuard = async (req, res) => {
  const doc = await documents.find(orgId(req), req.params.id);
  if (!doc) { fail(res, 404, 'Document not found'); return null; }
  if (!req.gx.caps.includes(documents.capFor(doc.owner_type))) { fail(res, 403, 'Insufficient Gulati role'); return null; }
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
