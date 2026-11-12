// Recycle bin. A delete a person makes in the app (a request, never a seed / script / background job) is archived first: the
// whole row goes into `deleted_records`, then the row is removed as before. Nothing else in the code has to change, so every
// calculation, list and report keeps working on the live table, while the deleted data is no longer lost: a superadmin
// restores it from Settings > Deleted records (modules/admin/recycleBin.service.js), which puts the row back with its old id.
//
// Left out on purpose: models that already soft delete (they never reach a hard delete), and rows that are only a derived copy
// or a replace-the-list helper (daily revenue, permission grants, attendee / interviewer lists, counters, lock toggles ...),
// which the app rebuilds on its own and which would only add noise.
//
// Known limit: rows removed by the database itself through a cascade (a child of the deleted record) are not archived on their
// own; restoring the parent brings back the parent only.
const orgContext = require('../lib/orgContext');

const SKIP = new Set([
  'DeletedRecord', 'ChangeLog', 'AuditLog', 'Notification', 'NotificationPreference',
  'DailyProjectRevenue', 'PermissionGrant', 'InvoiceCounter',
  'AccountMeetingAttendee', 'ClientMeetingAttendee', 'InterviewRoundInterviewer', 'InterviewRoundSkillRating',
  'TimesheetLock', 'TimesheetMonthLock', 'GroupTaskDone', 'GroupCompanyDay', 'TeamMembershipPeriod', 'EmployeeCalendar',
]);
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const MAX_ROWS = 2000;

function labelOf(row) {
  return row.project_name || row.name || row.title || row.invoice_number || row.employee_code || row.email || row.description || row.label || row.reason || null;
}

// JSON that survives a round trip: Date -> ISO string, Decimal -> string, BigInt -> string.
function plain(row) {
  return JSON.parse(JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? String(v) : v)));
}

async function rowsAbout(prisma, params) {
  const delegate = prisma[lowerFirst(params.model)];
  if (!delegate) return [];
  const where = params.args?.where || {};
  try {
    if (params.action === 'deleteMany') return await delegate.findMany({ where, take: MAX_ROWS });
    const one = await delegate.findFirst({ where });
    return one ? [one] : [];
  } catch (_err) {
    try {
      const one = await delegate.findUnique({ where }); // a compound unique key is not valid in findFirst
      return one ? [one] : [];
    } catch (_err2) {
      return [];
    }
  }
}

function attach(prisma) {
  if (process.env.RECYCLE_BIN === 'off') return; // ops kill switch
  prisma.$use(async (params, next) => {
    if (params.action !== 'delete' && params.action !== 'deleteMany') return next(params);
    if (SKIP.has(params.model)) return next(params);
    const store = orgContext.getStore();
    if (!store || store.system || store.skip_recycle || !store.user_id) return next(params);

    let rows = [];
    try { rows = await rowsAbout(prisma, params); } catch (_err) { rows = []; }

    // Archive first, so a crash between the two steps can never lose the row; if the delete itself fails the copy is withdrawn.
    let archived = [];
    if (rows.length) {
      try {
        archived = await Promise.all(rows.map((row) => prisma.deletedRecord.create({
          data: {
            org_id: row.org_id || store.org_id || null,
            model: params.model,
            row_id: row.id ? String(row.id) : null,
            label: labelOf(row),
            data: plain(row),
            reason: store.reason || null,
            deleted_by: store.user_id,
            deleted_by_name: store.user_name || null,
          },
          select: { id: true },
        })));
      } catch (_err) {
        archived = []; // a problem archiving must never block the delete itself
      }
    }

    let result;
    try {
      result = await next(params);
    } catch (err) {
      if (archived.length) await prisma.deletedRecord.deleteMany({ where: { id: { in: archived.map((a) => a.id) } } }).catch(() => {});
      throw err;
    }
    return result;
  });
}

module.exports = { attach, SKIP };
