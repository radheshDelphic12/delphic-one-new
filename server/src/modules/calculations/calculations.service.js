// One lock / version / change-detection system for every finance calculation
// (Billing & Sales per project, Salary, Resource Revenue, Vendor Payments,
// Financials) — instead of a separate freeze in each module.
//
//   draft ──review──▶ reviewed ──lock──▶ locked ──(source data changes)──▶ change_detected
//     ▲                                   │  ▲                                  │
//     └────────────── reopen ◀────────────┘  └──────── recalculate ◀────────────┘
//
// * lock writes version N: an immutable snapshot of the full computed result.
// * While locked, readers (payroll, invoices, Financials, Resource Revenue)
//   use that snapshot — never a live recompute.
// * A later change to attendance / leave / timesheets / salary in a locked
//   month does NOT touch the snapshot: notifySourceChange() records a
//   FinancialCalculationChange (what changed, who, when, the locked amount and
//   the new potential amount) and flips the status to change_detected.
// * Only an authorised admin moves the figures: `recalculate` writes version
//   N+1 (and accepts the open changes), `reopen` puts the month back to live
//   so it can be reviewed and locked again, and a change can be dismissed.
// Every action is written to AuditLog as well.

const prisma = require('../../config/db');
const logger = require('../../config/logger');
const { userNames } = require('../../lib/vertical');
const billingEngine = require('./engines/billing.engine');
const salaryEngine = require('./engines/salary.engine');
const vendorEngine = require('./engines/vendorPayment.engine');
const resourceEngine = require('./engines/resourceRevenue.engine');
const financialsEngine = require('./engines/financials.engine');
const { round2, monthBounds, todayIst, ymd } = require('./period');

const KINDS = {
  billing: { label: 'Billing & Sales', scoped: true },
  salary: { label: 'Salary', scoped: false },
  resource_revenue: { label: 'Resource Revenue', scoped: false },
  vendor_payment: { label: 'Vendor Payments', scoped: false },
  financials: { label: 'Financials', scoped: false },
};

// Which locked calculations a change to each kind of operational data can
// affect. Financials aggregates everything, so it is affected by all of them.
const SOURCE_KINDS = {
  // Check-in / check-out is presence only — pay comes from approved
  // timesheet hours — so an attendance change never moves a locked figure.
  attendance: [],
  leave: ['salary', 'resource_revenue', 'financials'],
  salary_structure: ['salary', 'resource_revenue', 'financials'],
  // Entries and overtime decisions: billing, and (since salary is approved
  // timesheet hours + approved OT) salary too.
  timesheet: ['billing', 'salary', 'resource_revenue', 'vendor_payment', 'financials'],
  // Effective-dated Resource → Project allocation (cost shares, contractor pay).
  allocation: ['resource_revenue', 'vendor_payment', 'financials'],
};

const LIVE_STATUSES = ['draft', 'reviewed', 'reopened'];
const FROZEN_STATUSES = ['locked', 'change_detected'];

// Plain JSON (Dates → ISO strings) — what a Json column stores, and exactly
// what a reader of the snapshot gets back later.
function toJson(value) {
  return value === null || value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function scopeKeyFor(kind, scopeKey) {
  return KINDS[kind]?.scoped ? scopeKey : 'org';
}

function periodOpenBlocker({ period_month, period_year }, now = new Date()) {
  const { end } = monthBounds(period_month, period_year);
  return todayIst(now) <= end ? { code: 'period_open', message: 'The month has not ended yet.' } : null;
}

// --- Reading a component: locked snapshot, or live ------------------------

async function findCalc(orgId, kind, scopeKey, { period_month, period_year }, db = prisma) {
  return db.financialCalculation.findUnique({
    where: { org_id_kind_scope_key_period_year_period_month: { org_id: orgId, kind, scope_key: scopeKeyFor(kind, scopeKey), period_year, period_month } },
  });
}

async function latestVersion(calc, db = prisma) {
  if (!calc || !calc.current_version) return null;
  return db.financialCalculationVersion.findUnique({ where: { calculation_id_version: { calculation_id: calc.id, version: calc.current_version } } });
}

// The locked version of a component, or null when it isn't locked.
async function lockedVersion(orgId, kind, scopeKey, period) {
  const calc = await findCalc(orgId, kind, scopeKey, period);
  if (!calc || !FROZEN_STATUSES.includes(calc.status)) return null;
  const version = await latestVersion(calc);
  return version ? { version: version.version, snapshot: version.snapshot, amount: Number(version.amount), status: calc.status } : null;
}

// Resolves another component for an aggregate (Resource Revenue, Financials):
// its locked snapshot when locked, otherwise computed live.
async function resolveMonth(orgId, kind, scopeKey, period, account = null) {
  const locked = await lockedVersion(orgId, kind, scopeKey, period);
  if (locked) return { raw: locked.snapshot, locked: true, version: locked.version };
  const live = await computeLive(orgId, kind, scopeKey, period, { account });
  return live ? { raw: live.raw, locked: false, version: null } : null;
}

// Computes a component from the current operational data (full month).
async function computeLive(orgId, kind, scopeKey, period, { account = null, now = new Date() } = {}) {
  let raw;
  let amount;
  let currency = 'INR';
  let label = KINDS[kind].label;
  if (kind === 'billing') {
    raw = await billingEngine.computeProjectMonth(orgId, account || scopeKey, period, now);
    if (!raw) return null;
    amount = billingEngine.lockedAmount(raw);
    currency = raw.currency;
    label = `${raw.project.code ? `${raw.project.code} · ` : ''}${raw.project.name}`;
  } else if (kind === 'salary') {
    raw = await salaryEngine.computeSalary(orgId, { ...period });
    amount = raw.totals.net;
  } else if (kind === 'vendor_payment') {
    raw = await vendorEngine.computeVendorPayments(orgId, { ...period });
    amount = raw.totals.amount_inr;
  } else if (kind === 'resource_revenue') {
    raw = await resourceEngine.computeResourceRevenue(orgId, { ...period }, (acct) => resolveMonth(orgId, 'billing', acct.id, period, acct));
    amount = raw.totals.revenue;
  } else if (kind === 'financials') {
    raw = await financialsEngine.computeFinancialMonth(orgId, period, (k, s, p) => resolveMonth(orgId, k, s, p));
    amount = raw.totals.profit;
  } else {
    throw new Error(`unknown calculation kind ${kind}`);
  }
  const readiness = raw.readiness || { can_lock: true, blockers: [], warnings: [] };
  if (!KINDS[kind].scoped) {
    const open = periodOpenBlocker(period, now);
    if (open && !readiness.blockers.some((b) => b.code === 'period_open')) readiness.blockers = [...readiness.blockers, open];
  }
  readiness.can_lock = readiness.blockers.length === 0;
  return { raw: { ...raw, readiness }, amount: round2(amount), currency, label, readiness };
}

// --- State for the UI -----------------------------------------------------

function serializeVersion(v, names) {
  return {
    version: v.version,
    amount: Number(v.amount),
    currency: v.currency,
    reason: v.reason,
    created_at: v.created_at,
    created_by: v.created_by ? names.get(v.created_by) || { id: v.created_by } : null,
  };
}

function serializeChange(c, names) {
  return {
    id: c.id,
    source_type: c.source_type,
    source_id: c.source_id,
    org_membership_id: c.org_membership_id,
    account_id: c.account_id,
    date: c.date ? ymd(c.date) : null,
    description: c.description,
    old_value: c.old_value,
    new_value: c.new_value,
    previous_amount: c.previous_amount !== null ? Number(c.previous_amount) : null,
    potential_amount: c.potential_amount !== null ? Number(c.potential_amount) : null,
    difference: c.previous_amount !== null && c.potential_amount !== null ? round2(Number(c.potential_amount) - Number(c.previous_amount)) : null,
    changed_by: c.changed_by ? names.get(c.changed_by) || { id: c.changed_by } : null,
    detected_at: c.detected_at,
    status: c.status,
    resolved_by: c.resolved_by ? names.get(c.resolved_by) || { id: c.resolved_by } : null,
    resolved_at: c.resolved_at,
    resolved_version: c.resolved_version,
    resolution_note: c.resolution_note,
  };
}

async function serializeCalc(calc, { versions = [], changes = [] } = {}) {
  const ids = [calc.reviewed_by, calc.locked_by, calc.reopened_by, calc.created_by, ...versions.map((v) => v.created_by), ...changes.flatMap((c) => [c.changed_by, c.resolved_by])];
  const names = await userNames(ids);
  const person = (id) => (id ? names.get(id) || { id } : null);
  const latest = versions.find((v) => v.version === calc.current_version);
  return {
    id: calc.id,
    kind: calc.kind,
    kind_label: KINDS[calc.kind].label,
    scope_key: calc.scope_key,
    scope_label: calc.scope_label,
    period_month: calc.period_month,
    period_year: calc.period_year,
    status: calc.status,
    current_version: calc.current_version,
    locked_amount: latest ? Number(latest.amount) : null,
    currency: latest?.currency || 'INR',
    reviewed_by: person(calc.reviewed_by),
    reviewed_at: calc.reviewed_at,
    locked_by: person(calc.locked_by),
    locked_at: calc.locked_at,
    reopened_by: person(calc.reopened_by),
    reopened_at: calc.reopened_at,
    change_detected_at: calc.change_detected_at,
    updated_at: calc.updated_at,
    versions: versions.map((v) => serializeVersion(v, names)),
    changes: changes.map((c) => serializeChange(c, names)),
    open_changes: changes.filter((c) => c.status === 'open').length,
  };
}

function emptyState(kind, scopeKey, period) {
  return {
    id: null,
    kind,
    kind_label: KINDS[kind].label,
    scope_key: scopeKeyFor(kind, scopeKey),
    scope_label: null,
    ...period,
    status: 'draft',
    current_version: 0,
    locked_amount: null,
    currency: 'INR',
    versions: [],
    changes: [],
    open_changes: 0,
  };
}

// Full state of one calculation, plus (optionally) its live figures so the
// UI can show "locked ₹X · live now ₹Y" and the lock readiness.
async function getState(orgId, kind, scopeKey, period, { withLive = true } = {}) {
  const calc = await findCalc(orgId, kind, scopeKey, period);
  let state = emptyState(kind, scopeKey, period);
  if (calc) {
    const [versions, changes] = await Promise.all([
      prisma.financialCalculationVersion.findMany({ where: { calculation_id: calc.id }, orderBy: { version: 'desc' }, select: { version: true, amount: true, currency: true, reason: true, created_at: true, created_by: true } }),
      prisma.financialCalculationChange.findMany({ where: { calculation_id: calc.id }, orderBy: { detected_at: 'desc' } }),
    ]);
    state = await serializeCalc(calc, { versions, changes });
  }
  if (withLive) {
    const live = await computeLive(orgId, kind, scopeKey, period);
    if (!live) return { error: 'not_found' };
    state.scope_label = state.scope_label || live.label;
    state.live = { amount: live.amount, currency: live.currency, readiness: live.readiness };
  }
  return { state };
}

async function listCalculations(orgId, { period_month, period_year, kind, status } = {}) {
  const rows = await prisma.financialCalculation.findMany({
    where: {
      org_id: orgId,
      ...(period_month ? { period_month } : {}),
      ...(period_year ? { period_year } : {}),
      ...(kind ? { kind } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }, { kind: 'asc' }],
    include: {
      versions: { orderBy: { version: 'desc' }, select: { version: true, amount: true, currency: true, reason: true, created_at: true, created_by: true } },
      changes: { orderBy: { detected_at: 'desc' } },
    },
  });
  const out = [];
  for (const row of rows) out.push(await serializeCalc(row, { versions: row.versions, changes: row.changes }));
  return out;
}

// --- Actions --------------------------------------------------------------

async function audit(db, orgId, actorId, action, calc, reason, snapshot = {}) {
  await db.auditLog.create({
    data: { org_id: orgId, actor_id: actorId, action, entity_type: 'financial_calculation', entity_id: calc.id, reason: reason || action, snapshot: { kind: calc.kind, scope_key: calc.scope_key, period_month: calc.period_month, period_year: calc.period_year, ...snapshot } },
  });
}

async function ensureCalc(db, orgId, kind, scopeKey, period, userId, label) {
  const key = scopeKeyFor(kind, scopeKey);
  return db.financialCalculation.upsert({
    where: { org_id_kind_scope_key_period_year_period_month: { org_id: orgId, kind, scope_key: key, period_year: period.period_year, period_month: period.period_month } },
    create: { org_id: orgId, kind, scope_key: key, scope_label: label || null, ...period, created_by: userId },
    update: label ? { scope_label: label } : {},
  });
}

// Mark the live figures as reviewed (not final).
async function review(orgId, user, kind, scopeKey, period, { reason } = {}) {
  const existing = await findCalc(orgId, kind, scopeKey, period);
  if (existing && FROZEN_STATUSES.includes(existing.status)) return { error: 'already_locked' };
  const live = await computeLive(orgId, kind, scopeKey, period);
  if (!live) return { error: 'not_found' };
  const calc = await prisma.$transaction(async (tx) => {
    const row = await ensureCalc(tx, orgId, kind, scopeKey, period, user.id, live.label);
    const updated = await tx.financialCalculation.update({ where: { id: row.id }, data: { status: 'reviewed', reviewed_by: user.id, reviewed_at: new Date() } });
    await audit(tx, orgId, user.id, 'calculation_review', updated, reason, { live_amount: live.amount });
    return updated;
  });
  return getState(orgId, kind, calc.scope_key, period);
}

async function writeVersion(tx, calc, live, userId, reason) {
  const version = calc.current_version + 1;
  const row = await tx.financialCalculationVersion.create({
    data: { calculation_id: calc.id, version, amount: live.amount, currency: live.currency, snapshot: toJson(live.raw), reason: reason || null, created_by: userId },
  });
  await tx.financialCalculationChange.updateMany({
    where: { calculation_id: calc.id, status: 'open' },
    data: { status: 'accepted', resolved_by: userId, resolved_at: new Date(), resolved_version: version },
  });
  const updated = await tx.financialCalculation.update({
    where: { id: calc.id },
    data: { status: 'locked', current_version: version, locked_by: userId, locked_at: new Date(), change_detected_at: null, scope_label: live.label },
  });
  return { updated, version: row };
}

// Lock (finalize): the live figures become an immutable version.
async function lock(orgId, user, kind, scopeKey, period, { reason } = {}) {
  const existing = await findCalc(orgId, kind, scopeKey, period);
  if (existing && FROZEN_STATUSES.includes(existing.status)) return { error: existing.status === 'change_detected' ? 'change_detected' : 'already_locked' };
  const live = await computeLive(orgId, kind, scopeKey, period);
  if (!live) return { error: 'not_found' };
  if (!live.readiness.can_lock) return { error: 'not_ready', blockers: live.readiness.blockers };
  const { updated, version } = await prisma.$transaction(async (tx) => {
    const row = await ensureCalc(tx, orgId, kind, scopeKey, period, user.id, live.label);
    const result = await writeVersion(tx, row, live, user.id, reason);
    await audit(tx, orgId, user.id, 'calculation_lock', result.updated, reason, { version: result.version.version, amount: live.amount });
    return result;
  });
  await afterLock(orgId, user, updated, version, live);
  return getState(orgId, kind, updated.scope_key, period);
}

// Explicit recalculation of a locked month after a reviewed change: a NEW
// version; the previous ones stay as they were.
async function recalculate(orgId, user, kind, scopeKey, period, { reason } = {}) {
  const existing = await findCalc(orgId, kind, scopeKey, period);
  if (!existing || !FROZEN_STATUSES.includes(existing.status)) return { error: 'not_locked' };
  const live = await computeLive(orgId, kind, scopeKey, period);
  if (!live) return { error: 'not_found' };
  if (!live.readiness.can_lock) return { error: 'not_ready', blockers: live.readiness.blockers };
  const previous = await latestVersion(existing);
  const { updated, version } = await prisma.$transaction(async (tx) => {
    const result = await writeVersion(tx, existing, live, user.id, reason);
    await audit(tx, orgId, user.id, 'calculation_recalculate', result.updated, reason, {
      version: result.version.version,
      previous_amount: previous ? Number(previous.amount) : null,
      amount: live.amount,
    });
    return result;
  });
  await afterLock(orgId, user, updated, version, live);
  return getState(orgId, kind, updated.scope_key, period);
}

// Back to live so the month can be corrected, reviewed and locked again.
// Versions already written are kept.
async function reopen(orgId, user, kind, scopeKey, period, { reason } = {}) {
  const existing = await findCalc(orgId, kind, scopeKey, period);
  if (!existing || !FROZEN_STATUSES.includes(existing.status)) return { error: 'not_locked' };
  if (kind === 'billing') {
    const invoice = await prisma.clientInvoice.findFirst({ where: { org_id: orgId, client_account_id: existing.scope_key, period_month: period.period_month, period_year: period.period_year, status: { in: ['sent', 'paid'] } } });
    if (invoice) return { error: 'invoice_sent' };
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.financialCalculation.update({ where: { id: existing.id }, data: { status: 'reopened', reopened_by: user.id, reopened_at: new Date() } });
    await audit(tx, orgId, user.id, 'calculation_reopen', updated, reason, { version: existing.current_version });
  });
  return getState(orgId, kind, existing.scope_key, period);
}

async function dismissChange(orgId, user, changeId, { reason } = {}) {
  const change = await prisma.financialCalculationChange.findFirst({ where: { id: changeId, calculation: { org_id: orgId } }, include: { calculation: true } });
  if (!change) return { error: 'not_found' };
  if (change.status !== 'open') return { error: 'already_resolved' };
  await prisma.$transaction(async (tx) => {
    await tx.financialCalculationChange.update({ where: { id: changeId }, data: { status: 'dismissed', resolved_by: user.id, resolved_at: new Date(), resolution_note: reason || null } });
    const stillOpen = await tx.financialCalculationChange.count({ where: { calculation_id: change.calculation_id, status: 'open' } });
    let calc = change.calculation;
    if (!stillOpen && calc.status === 'change_detected') calc = await tx.financialCalculation.update({ where: { id: calc.id }, data: { status: 'locked', change_detected_at: null } });
    await audit(tx, orgId, user.id, 'calculation_change_dismiss', calc, reason, { change_id: changeId });
  });
  const calc = change.calculation;
  return getState(orgId, calc.kind, calc.scope_key, { period_month: calc.period_month, period_year: calc.period_year });
}

// Side effects of a lock / recalculation.
async function afterLock(orgId, user, calc, version, live) {
  if (calc.kind !== 'vendor_payment') return;
  // Vendor payments appear in the Vendors section as pending payments, one per
  // vendor and month. A still-pending one is updated to the new version; one
  // already approved/paid is never rewritten — a difference becomes its own
  // pending adjustment, so the history stays intact.
  for (const v of live.raw.vendors || []) {
    if (!v.vendor || !v.amount_inr) continue;
    const existing = await prisma.vendorPayment.findMany({
      where: { org_id: orgId, vendor_account_id: v.vendor.id, period_month: calc.period_month, period_year: calc.period_year, calculation_version_id: { not: null } },
    });
    const pending = existing.find((p) => p.status === 'pending');
    const settled = round2(existing.filter((p) => ['approved', 'paid'].includes(p.status)).reduce((s, p) => s + Number(p.amount), 0));
    const due = round2(v.amount_inr - settled);
    if (pending) {
      await prisma.vendorPayment.update({ where: { id: pending.id }, data: { amount: due, calculation_version_id: version.id } });
    } else if (Math.abs(due) >= 0.01) {
      await prisma.vendorPayment.create({
        data: {
          org_id: orgId,
          vendor_name: settled ? `${v.vendor.name} (adjustment v${version.version})` : v.vendor.name,
          vendor_type: 'contractor',
          vendor_account_id: v.vendor.id,
          calculation_version_id: version.id,
          amount: due,
          currency: 'INR',
          period_month: calc.period_month,
          period_year: calc.period_year,
          created_by: user.id,
        },
      });
    }
  }
}

// Billing → Invoice: builds (or refreshes, while still a draft) the client
// invoice for a project month from its LOCKED Billing & Sales version. The
// invoice lands in Finance → Projects → Invoicing as a draft.
async function generateInvoice(orgId, user, accountId, period) {
  const calc = await findCalc(orgId, 'billing', accountId, period);
  if (!calc || !FROZEN_STATUSES.includes(calc.status)) return { error: 'not_locked' };
  if (calc.status === 'change_detected') return { error: 'change_detected' };
  const version = await latestVersion(calc);
  const raw = version.snapshot;
  const view = billingEngine.viewOf(raw, { include_overtime: raw.overtime.enabled });
  const line_items = view.resources.map((r) => ({
    org_membership_id: r.org_membership_id,
    resource: r.name,
    hours: r.regular_hours,
    overtime_hours: r.overtime_hours,
    base_amount: r.base_amount,
    overtime_amount: r.overtime_amount,
    revenue: r.amount,
  }));
  const data = {
    amount: Number(version.amount),
    currency: raw.currency,
    line_items: {
      project: raw.project,
      billing_type: raw.billing_type,
      rate: raw.rate,
      working_days: raw.working_days,
      overtime_enabled: raw.overtime.enabled,
      calculation_version: version.version,
      lines: line_items,
    },
    calculation_version_id: version.id,
  };
  const existing = await prisma.clientInvoice.findUnique({
    where: { client_account_id_period_month_period_year: { client_account_id: accountId, period_month: period.period_month, period_year: period.period_year } },
  });
  if (existing && existing.status !== 'draft') return { error: 'invoice_sent' };
  const invoice = existing
    ? await prisma.clientInvoice.update({ where: { id: existing.id }, data })
    : await prisma.clientInvoice.create({ data: { ...data, org_id: orgId, client_account_id: accountId, ...period, created_by: user.id } });
  await audit(prisma, orgId, user.id, 'calculation_invoice', calc, `Invoice ${existing ? 'refreshed' : 'generated'} from version ${version.version}`, { invoice_id: invoice.id, amount: Number(version.amount) });
  return { invoice };
}

// --- Change detection -----------------------------------------------------

// Called after operational data changes. Never throws into the caller: a
// failure here is logged, the operational write has already happened.
async function notifySourceChange(orgId, change) {
  try {
    return await flagChange(orgId, change);
  } catch (err) {
    logger.error('calculation_change_detection_failed', { org_id: orgId, source_type: change?.source_type, err });
    return { flagged: 0 };
  }
}

const monthIndex = (year, month) => year * 12 + (month - 1);

// `date` for a one-day change; `from_date` (+ optional `to_date`, open-ended
// when omitted — e.g. a salary structure effective from a date) for a span.
async function flagChange(orgId, { source_type, source_id = null, date = null, from_date = null, to_date = null, org_membership_id = null, account_id = null, changed_by = null, description, old_value = null, new_value = null }) {
  const kinds = SOURCE_KINDS[source_type];
  const first = from_date || date;
  if (!kinds || !first) return { flagged: 0 };
  const start = new Date(first);
  const end = to_date ? new Date(to_date) : from_date ? null : new Date(date);
  const lo = monthIndex(start.getUTCFullYear(), start.getUTCMonth() + 1);
  const hi = end ? monthIndex(end.getUTCFullYear(), end.getUTCMonth() + 1) : Infinity;

  const calcs = (await prisma.financialCalculation.findMany({
    where: { org_id: orgId, kind: { in: kinds }, status: { in: FROZEN_STATUSES } },
  })).filter((c) => {
    const idx = monthIndex(c.period_year, c.period_month);
    return idx >= lo && idx <= hi;
  });
  if (!calcs.length) return { flagged: 0 };

  let isContractor = false;
  if (org_membership_id && calcs.some((c) => c.kind === 'vendor_payment')) {
    const m = await prisma.orgMembership.findUnique({ where: { id: org_membership_id }, select: { worker_type: true } });
    isContractor = m?.worker_type === 'contractor';
  }

  let flagged = 0;
  for (const calc of calcs) {
    if (calc.kind === 'billing' && calc.scope_key !== account_id) continue;
    if (calc.kind === 'vendor_payment' && !isContractor) continue;
    const period = { period_month: calc.period_month, period_year: calc.period_year };
    const version = await latestVersion(calc);
    let potential = null;
    try {
      potential = (await computeLive(orgId, calc.kind, calc.scope_key, period))?.amount ?? null;
    } catch (err) {
      logger.error('calculation_potential_amount_failed', { org_id: orgId, calculation_id: calc.id, err });
    }
    // The change's own day when it has one inside this month, else the month's first day.
    const inMonth = date && monthIndex(new Date(date).getUTCFullYear(), new Date(date).getUTCMonth() + 1) === monthIndex(calc.period_year, calc.period_month);
    const changeDate = inMonth ? new Date(date) : new Date(Date.UTC(calc.period_year, calc.period_month - 1, 1));
    await prisma.$transaction([
      prisma.financialCalculationChange.create({
        data: {
          calculation_id: calc.id,
          source_type,
          source_id: source_id ? String(source_id) : null,
          org_membership_id,
          account_id,
          date: changeDate,
          description,
          old_value: toJson(old_value),
          new_value: toJson(new_value),
          previous_amount: version ? version.amount : null,
          potential_amount: potential,
          changed_by,
        },
      }),
      prisma.financialCalculation.update({ where: { id: calc.id }, data: { status: 'change_detected', change_detected_at: new Date() } }),
    ]);
    flagged += 1;
  }
  return { flagged };
}

module.exports = {
  KINDS,
  SOURCE_KINDS,
  LIVE_STATUSES,
  FROZEN_STATUSES,
  computeLive,
  resolveMonth,
  lockedVersion,
  getState,
  listCalculations,
  review,
  lock,
  recalculate,
  reopen,
  dismissChange,
  generateInvoice,
  notifySourceChange,
};
