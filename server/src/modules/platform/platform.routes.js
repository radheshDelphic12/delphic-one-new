const express = require('express');
const { z } = require('zod');
const { authenticate } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./platform.service');
const credits = require('./credits.service');
const entitlements = require('./entitlements.service');
const switches = require('./switches.service');
const audit = require('./audit.service');
const prisma = require('../../config/db');

// Platform administration for the SaaS product. Only people on the platform-admin list get in: a company admin or a group super admin is refused,
// because the platform is a separate job from running a company.
async function requirePlatformAdmin(req, res, next) {
  try {
    if (!(await service.isPlatformAdmin(req.user))) return fail(res, 403, 'Platform administrators only');
    return next();
  } catch (err) {
    return next(err);
  }
}

const router = express.Router();
router.use(authenticate, requirePlatformAdmin);

const ERRORS = {
  not_found: [404, 'Not found'],
  user_not_found: [404, 'No user with that email'],
  already_admin: [409, 'Already a platform administrator'],
  bad_code: [422, 'A module code is 3 to 8 capital letters'],
  code_taken: [409, 'That module code is already used'],
  cycle: [422, 'A module cannot need itself, directly or through other modules'],
  duplicate: [422, 'The same module is listed twice'],
  unknown_module: [422, 'A listed module does not exist'],
  customer_not_found: [404, 'Customer not found'],
  slot_not_found: [404, 'Slot not found'],
  module_not_found: [404, 'Module not found'],
  over_trial_users: [409, 'A trial has no more user slots'],
  admin_slot: [409, 'The admin slot cannot be moved'],
  too_soon: [409, 'This slot was moved recently'],
  below_zero: [422, 'Credit days cannot go below 0'],
  bad_days: [422, 'Days must be a whole number other than 0'],
  counter_off: [409, 'The daily counter is not switched on (SAAS_COUNTER_ENABLED)'],
};
const problem = (res, r) => { const [status, message] = ERRORS[r.error] || [400, 'Bad request']; return fail(res, status, message); };
const result = (res, r, data = {}) => (r.error ? problem(res, r) : ok(res, data));

const code = z.string().regex(/^[A-Z]{3,8}$/);
const money = z.number().min(0).max(10000000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

router.get('/me', asyncHandler(async (req, res) => ok(res, { platform_admin: true })));

// admins
router.get('/admins', asyncHandler(async (req, res) => ok(res, await service.listAdmins())));
router.post('/admins', asyncHandler(async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  const r = await service.addAdmin(email, req.user.id);
  return r.error ? problem(res, r) : created(res, { id: r.admin.id });
}));
router.delete('/admins/:id', asyncHandler(async (req, res) => result(res, await service.removeAdmin(z.string().uuid().parse(req.params.id), req.user.id))));

// catalogue
router.get('/modules', asyncHandler(async (req, res) => ok(res, await service.listModules())));
router.post('/modules', asyncHandler(async (req, res) => {
  const body = z.object({ code, name: z.string().min(2).max(120), description: z.string().max(1000).optional(), price_30d: money.optional(), is_basic: z.boolean().optional(), coming_soon: z.boolean().optional() }).parse(req.body);
  const r = await service.createModule(body, req.user.id);
  return r.error ? problem(res, r) : created(res, { code: body.code });
}));
router.patch('/modules/:code', asyncHandler(async (req, res) => {
  const patch = z.object({ name: z.string().min(2).max(120).optional(), description: z.string().max(1000).nullable().optional(), coming_soon: z.boolean().optional(), active: z.boolean().optional(), sort_order: z.number().int().optional(), is_basic: z.boolean().optional() }).parse(req.body);
  return result(res, await service.updateModule(code.parse(req.params.code), patch, req.user.id));
}));
router.put('/modules/:code/dependencies', asyncHandler(async (req, res) => {
  const { needs } = z.object({ needs: z.array(z.object({ code, group: z.number().int().min(1).max(10).optional() })).max(20) }).parse(req.body);
  return result(res, await service.setDependencies(code.parse(req.params.code), needs, req.user.id));
}));
router.post('/modules/prerequisites', asyncHandler(async (req, res) => {
  const { codes } = z.object({ codes: z.array(code).max(40) }).parse(req.body);
  return ok(res, await service.withPrerequisites(codes));
}));

// price books
router.get('/price-books', asyncHandler(async (req, res) => ok(res, await service.listBooks())));
router.post('/price-books', asyncHandler(async (req, res) => {
  const body = z.object({ name: z.string().min(2).max(120), effective_from: day, admin_price: money.optional(), notes: z.string().max(1000).optional(), copy_from: z.string().uuid().optional() }).parse(req.body);
  const book = await service.createBook(body, req.user.id);
  return created(res, { id: book.id });
}));
router.patch('/price-books/:id', asyncHandler(async (req, res) => {
  const patch = z.object({ name: z.string().min(2).max(120).optional(), effective_from: day.optional(), admin_price: money.optional(), notes: z.string().max(1000).nullable().optional(), prices: z.record(code, money).optional() }).parse(req.body);
  return result(res, await service.updateBook(z.string().uuid().parse(req.params.id), patch, req.user.id));
}));

// settings (trial days, trial users, grace days, ...)
router.get('/settings', asyncHandler(async (req, res) => ok(res, await service.listSettings())));
router.patch('/settings/:key', asyncHandler(async (req, res) => {
  const { value } = z.object({ value: z.number().min(0).max(100000) }).parse(req.body);
  return result(res, await service.updateSetting(z.string().max(60).parse(req.params.key), value, req.user.id));
}));

// customers, slots and credit days
router.get('/customers', asyncHandler(async (req, res) => {
  const rows = await prisma.saasCustomer.findMany({ orderBy: { created_at: 'desc' }, include: { slots: { select: { id: true } } } });
  return ok(res, rows.map((c) => ({ id: c.id, name: c.name, status: c.status, org_id: c.org_id, org_group_id: c.org_group_id, trial_ends_on: c.trial_ends_on, max_users: c.max_users, slots: c.slots.length })));
}));
router.get('/customers/:id', asyncHandler(async (req, res) => {
  const c = await prisma.saasCustomer.findUnique({ where: { id: z.string().uuid().parse(req.params.id) }, include: { slots: { include: { credits: true }, orderBy: { created_at: 'asc' } } } });
  return c ? ok(res, c) : problem(res, { error: 'customer_not_found' });
}));
router.post('/customers/:id/slots', asyncHandler(async (req, res) => {
  const body = z.object({ email: z.string().email().optional(), label: z.string().max(80).optional() }).parse(req.body || {});
  const r = await credits.createSlot(z.string().uuid().parse(req.params.id), body);
  return r.error ? problem(res, r) : created(res, { id: r.slot.id });
}));
router.post('/slots/:id/credits', asyncHandler(async (req, res) => {
  const body = z.object({ code, days: z.number().int().min(-3650).max(3650), reason: z.string().max(120).optional() }).parse(req.body);
  const r = await credits.addCredit({ slotId: z.string().uuid().parse(req.params.id), code: body.code, days: body.days, reason: body.reason || 'top-up', actorId: req.user.id });
  return r.error ? problem(res, r) : ok(res, r);
}));
router.post('/slots/:id/move', asyncHandler(async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  const r = await credits.moveSlot(z.string().uuid().parse(req.params.id), email, req.user.id);
  return r.error ? problem(res, r) : ok(res, r);
}));
router.post('/slots/:id/status', asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.enum(['active', 'paused']) }).parse(req.body);
  return result(res, await credits.setSlotStatus(z.string().uuid().parse(req.params.id), status));
}));
// Run the daily counter by hand (a catch-up). Only when the counter is switched on.
router.post('/counter/run', asyncHandler(async (req, res) => ((await switches.isOn('counter')) ? ok(res, await credits.runDailyCounter()) : problem(res, { error: 'counter_off' }))));

// the three switches: current state, and turning one on or off (a confirm flag is required, every change is audited)
router.get('/switches', asyncHandler(async (req, res) => ok(res, await switches.state())));
router.put('/switches/:name', asyncHandler(async (req, res) => {
  const { on } = z.object({ on: z.boolean(), confirm: z.literal(true) }).parse(req.body);
  return result(res, await switches.setSwitch(z.enum(Object.keys(switches.SWITCHES)).parse(req.params.name), on, req.user.id));
}));

// who changed what
router.get('/audit', asyncHandler(async (req, res) => ok(res, await audit.list(z.object({ entity: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(500).optional() }).parse(req.query)))));
// What a person would be allowed to use (works whether or not enforcement is on): for checking a customer's setup before switching it on.
router.get('/entitlements', asyncHandler(async (req, res) => {
  const q = z.object({ user_id: z.string().uuid(), org_id: z.string().uuid() }).parse(req.query);
  const user = await prisma.user.findUnique({ where: { id: q.user_id }, select: { id: true, email: true } });
  return ok(res, { enforcing: await entitlements.enforcing(), ...(user ? await entitlements.entitlementsFor(user, q.org_id) : { applies: false }) });
}));

module.exports = router;
