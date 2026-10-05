const express = require('express');
const { z } = require('zod');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./calculations.service');
const live = require('./live.service');
const records = require('./records.service');
const lockAudit = require('./lockAudit.service');
const financeViews = require('./financeViews.service');

// Finance calculation locking / versioning. Locking, recalculating, reopening
// and dismissing a detected change are financial decisions: admin only.
const router = express.Router();
router.use(authenticate, requireOrgMembership, authorize('admin'));

const kind = z.enum(['billing', 'salary', 'resource_revenue', 'vendor_payment', 'financials', 'salary_employee', 'vendor_bill', 'expense']);
const uuid = z.string().uuid();
// The record each scoped kind locks: a project / employee / vendor id, or an
// expense record ("claim:<id>" / "charge:<id>").
const SCOPE_RULES = {
  billing: (v) => uuid.safeParse(v).success,
  salary_employee: (v) => uuid.safeParse(v).success,
  vendor_bill: (v) => uuid.safeParse(v).success,
  expense: (v) => /^(claim|charge):[0-9a-f-]{36}$/i.test(v || ''),
};
const period = {
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
};
const targetSchema = z
  .object({ kind, scope_key: z.string().min(1).max(64).optional(), ...period })
  .refine((v) => !SCOPE_RULES[v.kind] || SCOPE_RULES[v.kind](v.scope_key), { message: 'scope_key must identify the record (project, employee, vendor or expense) for this kind', path: ['scope_key'] });
const actionSchema = targetSchema.and(z.object({ reason: z.string().trim().max(500).optional() }));
const listSchema = z.object({
  kind: kind.optional(),
  status: z.enum(['draft', 'reviewed', 'locked', 'change_detected', 'reopened']).optional(),
  period_month: period.period_month.optional(),
  period_year: period.period_year.optional(),
});
const invoiceSchema = z.object({
  account_id: z.string().uuid(),
  ...period,
  invoice_number: z.string().trim().max(50).optional(),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const dismissSchema = z.object({ reason: z.string().trim().min(1).max(500) });

const ERRORS = {
  not_found: [404, 'Nothing to calculate for that selection'],
  already_locked: [409, 'This period is already locked — recalculate or reopen it instead'],
  change_detected: [409, 'A change was detected after locking — review it, then recalculate or dismiss it'],
  not_locked: [409, 'This period is not locked'],
  invoice_sent: [409, 'The invoice for this period has already been sent — it can no longer be changed'],
  invoice_number_taken: [409, 'Another invoice already uses that invoice number'],
  nothing_to_invoice: [422, 'Nothing to invoice for that month — the amount is zero'],
  no_billing_rate: [422, 'This project has no billing rate for that month'],
  not_supported: [422, 'Invoicing is not enabled for this project type yet (fixed price / recruitment)'],
  account_not_found: [404, 'Project not found'],
  before_agreement_start: [422, 'That month ends before the client agreement starts — nothing is billed before the Agreement Start Date'],
  after_agreement_end: [422, 'That month starts after the client agreement ended — nothing is billed after the Agreement End Date'],
  already_resolved: [409, 'That change has already been resolved'],
  financial_locked: [423, 'This month is financially locked - reopen the financial lock before changing its invoices'],
};

function failFor(res, result) {
  if (result.error === 'not_ready') {
    return fail(res, 422, `Not ready to lock: ${result.blockers.map((b) => b.message).join(' ')}`, { blockers: result.blockers });
  }
  const mapped = ERRORS[result.error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}

const period_ = (t) => ({ period_month: t.period_month, period_year: t.period_year });

router.get(
  '/',
  asyncHandler(async (req, res) => ok(res, await service.listCalculations(req.user.org_id, listSchema.parse(req.query))))
);

router.get(
  '/state',
  asyncHandler(async (req, res) => {
    const t = targetSchema.parse(req.query);
    const result = await service.getState(req.user.org_id, t.kind, t.scope_key, period_(t));
    return result.error ? failFor(res, result) : ok(res, result.state);
  })
);

for (const action of ['review', 'lock', 'recalculate', 'reopen']) {
  router.post(
    `/${action}`,
    asyncHandler(async (req, res) => {
      const t = actionSchema.parse(req.body);
      if (['recalculate', 'reopen'].includes(action) && !t.reason) return fail(res, 422, 'A reason is required');
      const result = await service[action](req.user.org_id, req.user, t.kind, t.scope_key, period_(t), { reason: t.reason });
      return result.error ? failFor(res, result) : ok(res, result.state);
    })
  );
}

// Bulk: lock / review / reopen / recalculate many records of one month in one call. Each record goes through the
// same checks as a single action and writes its own audit row (all sharing the bulk_id).
const bulkSchema = z.object({
  action: z.enum(['review', 'lock', 'reopen', 'recalculate']),
  items: z.array(z.object({ kind, scope_key: z.string().min(1).max(64).optional() })).min(1).max(200),
  ...period,
  reason: z.string().trim().max(500).optional(),
});
router.post(
  '/bulk',
  asyncHandler(async (req, res) => {
    const b = bulkSchema.parse(req.body);
    if (['recalculate', 'reopen'].includes(b.action) && !b.reason) return fail(res, 422, 'A reason is required');
    const bulkId = lockAudit.newBulkId();
    const results = [];
    for (const item of b.items) {
      if (SCOPE_RULES[item.kind] && !SCOPE_RULES[item.kind](item.scope_key)) { results.push({ ...item, ok: false, error: 'invalid_scope' }); continue; }
      const result = await service[b.action](req.user.org_id, req.user, item.kind, item.scope_key, { period_month: b.period_month, period_year: b.period_year }, { reason: b.reason, bulk_id: bulkId });
      results.push({ ...item, ok: !result.error, error: result.error || null, blockers: result.blockers || undefined });
    }
    return ok(res, { bulk_id: bulkId, action: b.action, done: results.filter((r) => r.ok).length, results });
  })
);

// Finance: the month-wise project view (active projects -> timesheet -> billing -> invoice -> payment -> financial status).
router.get(
  '/finance/month-projects',
  asyncHandler(async (req, res) => ok(res, await financeViews.monthProjects(req.user.org_id, z.object(period).parse(req.query))))
);

// Month-wise Excel exports. ?format=json returns the same rows for on-screen use.
const exportSchema = z.object({
  ...period,
  format: z.enum(['xlsx', 'json']).default('xlsx'),
  client_account_id: uuid.optional(),
  account_id: uuid.optional(),
  department_id: uuid.optional(),
  team_id: uuid.optional(),
  billing_type: z.enum(['all', 'monthly', 'hourly', 'mixed']).optional(),
  invoice_status: z.enum(['all', 'generated', 'not_generated', 'paid', 'unpaid', 'sent', 'unsent']).optional(),
});
async function sendWorkbook(res, buffer, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  return res.send(Buffer.from(buffer));
}
router.get(
  '/export/sales',
  asyncHandler(async (req, res) => {
    const q = exportSchema.parse(req.query);
    if (q.format === 'json') return ok(res, await financeViews.salesRows(req.user.org_id, q));
    return sendWorkbook(res, await financeViews.salesWorkbook(req.user.org_id, q), `sales-${q.period_year}-${String(q.period_month).padStart(2, '0')}`);
  })
);
router.get(
  '/export/vendor',
  asyncHandler(async (req, res) => {
    const q = exportSchema.parse(req.query);
    if (q.format === 'json') return ok(res, await financeViews.vendorRows(req.user.org_id, q));
    return sendWorkbook(res, await financeViews.vendorWorkbook(req.user.org_id, q), `vendor-${q.period_year}-${String(q.period_month).padStart(2, '0')}`);
  })
);
router.get(
  '/export/salary',
  asyncHandler(async (req, res) => {
    const q = exportSchema.parse(req.query);
    if (q.format === 'json') return ok(res, await financeViews.salaryRows(req.user.org_id, q));
    return sendWorkbook(res, await financeViews.salaryWorkbook(req.user.org_id, q), `salary-${q.period_year}-${String(q.period_month).padStart(2, '0')}`);
  })
);

// Lock audit trail across the three stages (timesheet, calculation, financial).
const lockAuditQuerySchema = z.object({
  stage: z.enum(['timesheet', 'calculation', 'financial']).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  org_membership_id: uuid.optional(),
  account_id: uuid.optional(),
  bulk_id: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
router.get(
  '/lock-audit',
  asyncHandler(async (req, res) => ok(res, await lockAudit.list(req.user.org_id, lockAuditQuerySchema.parse(req.query))))
);

router.post(
  '/changes/:id/dismiss',
  asyncHandler(async (req, res) => {
    const { reason } = dismissSchema.parse(req.body);
    const result = await service.dismissChange(req.user.org_id, req.user, req.params.id, { reason });
    return result.error ? failFor(res, result) : ok(res, result.state);
  })
);

// Locked Billing & Sales month -> draft client invoice (Finance → Projects → Invoicing).
router.post(
  '/billing/invoice',
  asyncHandler(async (req, res) => {
    const { account_id, invoice_number, invoice_date, ...p } = invoiceSchema.parse(req.body);
    const result = await service.generateInvoice(req.user.org_id, req.user, account_id, p, { invoice_number, invoice_date });
    return result.error ? failFor(res, result) : ok(res, result.invoice);
  })
);

// Live Analytics → Locked: every locked record (billing, salary, expense,
// vendor) with what it was locked from and its invoice.
const lockedQuerySchema = z.object({
  period_year: period.period_year.optional(),
  period_month: period.period_month.optional(),
  kind: kind.optional(),
});
router.get(
  '/locked',
  asyncHandler(async (req, res) => ok(res, await records.lockedList(req.user.org_id, lockedQuerySchema.parse(req.query))))
);

// Financials from records: locked only by default; unlocked / all add the
// live records that are not locked yet.
const financialRecordsSchema = live.summaryQuerySchema.extend({ state: z.enum(['locked', 'unlocked', 'all']).default('locked') });
router.get(
  '/financials/records',
  asyncHandler(async (req, res) => ok(res, await records.financialRecords(req.user.org_id, financialRecordsSchema.parse(req.query))))
);

// Financials: finalized months only, category-wise, with the update trail.
router.get(
  '/financials/summary',
  asyncHandler(async (req, res) => ok(res, await live.financialsSummary(req.user.org_id, live.summaryQuerySchema.parse(req.query))))
);

module.exports = router;
