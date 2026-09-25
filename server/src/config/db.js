const { PrismaClient } = require('@prisma/client');
const env = require('./env');
const orgContext = require('../lib/orgContext');

const prisma = new PrismaClient({
  log: env.nodeEnv === 'development' ? ['warn', 'error'] : ['error'],
});

// --- Global soft-delete filter -------------------------------------------------
// The 5 models below carry `deleted_at` (see schema.prisma + the admin module).
// A superadmin "delete" only stamps that column; every ordinary read must skip
// stamped rows. There is no raw SQL anywhere in the codebase, so a single
// middleware covers all read paths (lists, counts, reports, dashboard, …).
//
// Escape hatch: pass an explicit `deleted_at` in the `where` (the admin service
// does this to load / restore deleted rows) and the middleware leaves it alone.
//
// Known limitation: `$use` does NOT rewrite nested relation reads, so a
// soft-deleted parent can still appear via an existing child's `include`. That
// is acceptable here — deleted records are duplicates / terminal, and the
// top-level lists + reports are what matter.
const SOFT_DELETE_MODELS = new Set(['Account', 'Requirement', 'Submission', 'Profile', 'InterviewRound']);
const READ_ACTIONS = new Set(['findFirst', 'findMany', 'count', 'aggregate', 'groupBy']);

function mentionsDeletedAt(where) {
  if (!where || typeof where !== 'object') return false;
  if ('deleted_at' in where) return true;
  for (const key of ['AND', 'OR', 'NOT']) {
    const branch = where[key];
    if (Array.isArray(branch) && branch.some(mentionsDeletedAt)) return true;
    if (branch && !Array.isArray(branch) && mentionsDeletedAt(branch)) return true;
  }
  return false;
}

prisma.$use(async (params, next) => {
  if (!SOFT_DELETE_MODELS.has(params.model)) return next(params);

  // findUnique can't take a non-unique filter — promote it so we can add ours.
  if (params.action === 'findUnique' || params.action === 'findUniqueOrThrow') {
    params.action = params.action === 'findUnique' ? 'findFirst' : 'findFirstOrThrow';
    params.args = params.args || {};
    if (!mentionsDeletedAt(params.args.where)) {
      params.args.where = { ...params.args.where, deleted_at: null };
    }
    return next(params);
  }

  if (READ_ACTIONS.has(params.action)) {
    params.args = params.args || {};
    if (!mentionsDeletedAt(params.args.where)) {
      params.args.where = { ...(params.args.where || {}), deleted_at: null };
    }
  }

  return next(params);
});

// --- Multi-company ERP: org_id auto-stamp on create (HLD §5, layer 1) ---
// Write-side only, deliberately not read-side yet: auto-filtering every
// read by org_id would change results for any caller who already has an
// org membership, and the recruitment domain's services were never audited
// against that (see the plan doc's reasoning for why the org_id -> NOT NULL
// flip is also still deferred). This half is pure upside with no such risk
// — it only fires when (a) the request has resolved org context AND (b) the
// caller didn't already set org_id explicitly, so every model that already
// sets it (calendars/attendance/leave services, the Phase 0 backfill
// script) is unaffected, and every caller with no org membership (still the
// common case — see resolveOrgContext in middleware/auth.js) is unaffected.
const ORG_SCOPED_ON_CREATE = new Set([
  'Account',
  'Requirement',
  'Profile',
  'Submission',
  'InterviewRound',
  'StageHistory',
  'Document',
  'Comment',
  'Notification',
  'NotificationPreference',
  'AuditLog',
  'Department',
  'Designation',
  'Calendar',
  'AttendanceRecord',
  'LeaveType',
  'LeaveRequest',
  'TimesheetEntry',
  'TimesheetLock',
  'SalaryStructure',
  'PayrollRun',
  'BillingRate',
  'ClientInvoice',
  'ExpenseClaim',
  'VendorPayment',
  'LedgerAccount',
  'LedgerEntry',
  'TaxRecord',
  'ExternalAccess',
  'TradingPartner',
  'TradeItem',
  'PartnerItemRate',
  'TradeTransaction',
  'Lead',
  'Contract',
  'SelfProject',
  'ProjectFinanceEntry',
  'ProjectDocument',
  'FinancialPlan',
  'ResourceMapping',
  'VendorCommission',
  'AssignedTask',
  'ProjectMemberAssignment',
  // Deliberately NOT 'GroupBillingCharge' — its org_id is the org being
  // charged, which is routinely a different org than the caller's own, so
  // auto-stamping the caller's org_id here would be actively wrong. The
  // service always sets it explicitly from the target org's own record.
]);

prisma.$use(async (params, next) => {
  if (ORG_SCOPED_ON_CREATE.has(params.model) && params.action === 'create') {
    const orgId = orgContext.getOrgId();
    if (orgId && params.args?.data && params.args.data.org_id === undefined) {
      params.args.data.org_id = orgId;
    }
  }
  return next(params);
});

module.exports = prisma;
