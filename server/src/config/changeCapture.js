// Group-wide change log (Phase 3). One Prisma middleware sees every write of the records the owner cares about and stores
// who did it, when, in which company, and the exact old and new values in `change_logs`. A failure to log never fails the
// write itself. It only logs while a request (or a named background job) is running, so seeds, scripts and tests stay quiet.
//
// What is captured: create, update, delete, upsert (one row each, with the changed fields old -> new), soft delete and
// restore (an update that sets or clears deleted_at), and createMany / updateMany / deleteMany as one "bulk" row (a
// deleteMany lists up to 25 of the rows it removed). Known limit: a nested write inside another create/update (a child
// created through the parent's `create: {...}`) is not a separate call, so it is not logged on its own.
const orgContext = require('../lib/orgContext');

// Prisma model -> the entity type shown in the log. Add a model here to start logging it.
const TRACKED = {
  Account: 'account', // clients, vendors and projects (is_project)
  Requirement: 'requirement',
  Profile: 'profile',
  Submission: 'submission',
  InterviewRound: 'interview_round',
  JobApplicant: 'job_applicant',
  OrgMembership: 'employee',
  ExpenseClaim: 'expense_claim',
  ClientInvoice: 'invoice',
  PayrollRun: 'payroll_run',
  Payslip: 'payslip',
  SalaryStructure: 'salary_structure',
  LeaveRequest: 'leave_request',
  ProjectMemberAssignment: 'project_allocation',
  SelfProject: 'self_project', // an own-development project (Projects module)
  ProjectFinanceEntry: 'project_finance_entry',
  ProjectDocument: 'project_document',
  ProjectVendorInvoice: 'project_vendor_invoice',
  BillingRate: 'billing_rate',
  VendorPayment: 'vendor_payment',
  Team: 'team',
  Policy: 'policy',
  PermissionGrant: 'permission_grant', // who was given or lost which permission (Settings > Permissions)
  CustomRole: 'permission_set', // a permission set: its ticks and who holds it
};

// Models that carry deleted_at: reading them through the global filter hides deleted rows, so the "before" read must opt out.
const SOFT = new Set(['Account', 'Requirement', 'Profile', 'Submission', 'InterviewRound', 'JobApplicant', 'OrgMembership', 'ExpenseClaim', 'ClientInvoice']);
// Child records of a project: their history is part of the project's history (context_id = the project it belongs to).
// A billing project is an Account (account_id); an own-development project is a SelfProject (project_id).
const PROJECT_CHILD = { ProjectMemberAssignment: 'account_id', ProjectVendorInvoice: 'account_id', BillingRate: 'account_id', ProjectFinanceEntry: 'project_id', ProjectDocument: 'project_id' };

const WRITES = new Set(['create', 'update', 'delete', 'upsert', 'createMany', 'updateMany', 'deleteMany']);
const SECRET = /pass|secret|token|hash|otp|api_?key|account_number|aadhaar|pan_number|ifsc/i;
const MAX_JSON = 20000;
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

function clean(value, depth = 0) {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && typeof value.toFixed === 'function') return String(value); // Decimal
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}...` : value;
  if (Array.isArray(value)) return depth > 3 ? '[...]' : value.slice(0, 50).map((v) => clean(v, depth + 1));
  if (typeof value === 'object') {
    if (depth > 3) return '{...}';
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET.test(k)) { out[k] = '[hidden]'; continue; }
      if (v !== undefined && typeof v !== 'function') out[k] = clean(v, depth + 1);
    }
    return out;
  }
  return value;
}

function bounded(obj) {
  if (obj === null || obj === undefined) return null;
  const c = clean(obj);
  return JSON.stringify(c).length > MAX_JSON ? { _truncated: true, keys: Object.keys(c || {}).slice(0, 60) } : c;
}

const same = (a, b) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));

function labelOf(row) {
  if (!row) return null;
  return row.project_name || row.name || row.title || row.invoice_number || row.employee_code || row.email || row.description || row.label || null;
}

function changedFields(before, after, data) {
  const keys = Object.keys(data || {}).filter((k) => k !== 'updated_at');
  return keys.filter((k) => !before || !after || !same(before[k], after[k]));
}

function pick(row, keys) {
  const out = {};
  for (const k of keys) out[k] = row ? row[k] : null;
  return out;
}

/** The row an update / delete / upsert is about to change, read with the soft-delete filter bypassed. */
async function readBefore(prisma, params) {
  const delegate = prisma[lowerFirst(params.model)];
  const where = params.args?.where;
  if (!delegate || !where) return null;
  try {
    if (SOFT.has(params.model)) return await delegate.findFirst({ where: { AND: [where], OR: [{ deleted_at: null }, { deleted_at: { not: null } }] } });
    return await delegate.findFirst({ where });
  } catch (_err) {
    try {
      return await delegate.findUnique({ where }); // a compound unique key is not valid in findFirst
    } catch (_err2) {
      return null;
    }
  }
}

function attach(prisma) {
  prisma.$use(async (params, next) => {
    const entity = TRACKED[params.model];
    if (!entity || !WRITES.has(params.action)) return next(params);
    const store = orgContext.getStore();
    if (!store || store.skip_change_log) return next(params);

    const bulk = params.action.endsWith('Many');
    let before = null;
    let beforeMany = null;
    try {
      if (['update', 'delete', 'upsert'].includes(params.action)) before = await readBefore(prisma, params);
      if (params.action === 'deleteMany') {
        const delegate = prisma[lowerFirst(params.model)];
        beforeMany = await delegate.findMany({ where: params.args?.where || {}, take: 25 }).catch(() => null);
      }
    } catch (_err) {
      before = null;
    }

    const result = await next(params);

    try {
      let action;
      let row = null;
      let oldValues = null;
      let newValues = null;
      let fields = [];
      if (bulk) {
        action = `bulk_${params.action.replace('Many', '')}`;
        oldValues = params.action === 'deleteMany' ? { where: params.args?.where || {}, rows: (beforeMany || []).map((r) => ({ id: r.id, label: labelOf(r) })) } : { where: params.args?.where || {} };
        newValues = { ...(params.action === 'updateMany' ? { data: params.args?.data } : {}), count: result?.count ?? null };
      } else if (params.action === 'create') {
        action = 'create';
        row = result;
        newValues = row;
      } else if (params.action === 'delete') {
        action = 'delete';
        row = before || result;
        oldValues = before || result;
      } else {
        // update / upsert
        const after = result;
        row = after;
        if (!before) {
          action = 'create';
          newValues = after;
        } else {
          const data = params.args?.data || params.args?.update || {};
          fields = changedFields(before, after, data);
          if (!fields.length) return result; // nothing really changed (only updated_at)
          action = fields.includes('deleted_at') ? (after.deleted_at ? 'soft_delete' : 'restore') : 'update';
          oldValues = pick(before, fields);
          newValues = pick(after, fields);
        }
      }
      const e = row || before;
      await prisma.changeLog.create({
        data: {
          org_id: e?.org_id || store.org_id || null,
          actor_id: store.user_id || null,
          actor_name: store.user_name || (store.system ? store.system_name || 'System' : null),
          action,
          entity_type: entity,
          entity_id: e?.id ? String(e.id) : null,
          entity_label: labelOf(e),
          context_id: PROJECT_CHILD[params.model] ? e?.[PROJECT_CHILD[params.model]] || null : null,
          old_values: bounded(oldValues) ?? undefined,
          new_values: bounded(newValues) ?? undefined,
          changed_fields: fields,
        },
      });
    } catch (_err) {
      // the change is already saved; a log problem must never undo or fail it
    }
    return result;
  });
}

module.exports = { attach, TRACKED, labelOf };
