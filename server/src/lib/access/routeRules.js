/**
 * Which permission each API route needs once a company is on the permission model.
 *
 * One table for every route, checked by lib/access/guard.js on every request (not only in the screens). The first rule whose
 * pattern matches wins. A rule's `need` is:
 *   'open'            any signed-in member (their own records, or a shared lookup; the service still limits what is returned)
 *   'admin'           the company Admin or the Super Admin only
 *   'basic.<item>'    a default basic access item (an Admin can take one away from a person)
 *   '<module>.<act>'  that permission, at any scope (own / team / all are applied inside the service, as before)
 *   [a, b]            any one of them
 * A rule may also split by method: { GET: need, POST: need, ..., '*': need }.
 *
 * Anything no rule matches needs 'admin': a route added later is closed until it gets a rule here (a test lists every route).
 */
const mutating = (need) => ({ GET: 'open', '*': need });

const RULES = [
  // ---- Sign-in, health, self-service and shared lookups
  [/^\/(auth|client-errors|health|public)(\/|$)/, 'open'],
  [/^\/users\/(me|directory)(\/|$)/, 'open'],
  [/^\/notifications(\/|$)/, 'open'],
  [/^\/access(\/|$)/, 'open'], // the module decides (who may read or change what) per endpoint
  [/^\/roles\/catalog$/, 'open'],
  [/^\/roles(\/|$)/, 'admin'],
  [/^\/dashboard(\/|$)/, 'basic.home'],
  [/^\/(comments|documents)(\/|$)/, 'open'], // limited to the record's own people by lib/entityAccess
  [/^\/interviews(\/|$)/, 'basic.calendar'],
  [/^\/tasks\/mine$/, 'open'],
  [/^\/tasks\/[^/]+$/, 'open'],
  [/^\/tasks(\/|$)/, 'admin'],

  // ---- Users, invites
  [/^\/users(\/|$)/, { GET: 'users.view', POST: 'users.create', '*': 'users.update' }],
  [/^\/invites\/outbox$/, 'users.view'],
  [/^\/invites(\/|$)/, 'users.create'],

  // ---- People
  [/^\/orgs\/me(\/|$)/, 'open'],
  [/^\/orgs\/announcements$/, 'basic.home'],
  [/^\/orgs\/locations(\/|$)/, { GET: 'basic.offices', '*': 'hr_settings.update' }],
  [/^\/orgs\/memberships\/[^/]+\/details$/, { GET: 'people.view', '*': 'people.update' }],
  [/^\/orgs\/memberships\/[^/]+\/reporting$/, 'open'],
  [/^\/orgs\/memberships\/[^/]+\/joining-date$/, 'people.update'],
  [/^\/orgs\/memberships\/[^/]+$/, { GET: 'basic.people_directory', DELETE: 'people.delete', '*': 'people.update' }],
  [/^\/orgs\/memberships$/, 'basic.people_directory'],
  [/^\/orgs\/bench$/, 'people.view'],
  [/^\/orgs(\/|$)/, 'admin'],
  [/^\/org-chart(\/|$)/, 'basic.org_chart'],
  [/^\/departments(\/|$)/, mutating('hr_settings.update')],
  [/^\/designations(\/|$)/, mutating('hr_settings.update')],
  [/^\/teams(\/|$)/, mutating('hr_settings.update')],
  [/^\/policies(\/|$)/, { GET: 'basic.policies', '*': 'hr_settings.update' }],
  [/^\/internal-jobs(\/|$)/, 'basic.internal_jobs'],
  [/^\/assets(\/|$)/, { GET: 'assets.view', POST: 'assets.create', DELETE: 'assets.delete', '*': 'assets.update' }],
  [/^\/allocations(\/|$)/, { GET: 'allocations.view', '*': 'allocations.manage' }],

  // ---- Time and attendance
  [/^\/calendars\/me$/, 'open'],
  [/^\/calendars\/[^/]+\/holidays(\/export)?$/, { GET: 'open', '*': 'holidays.update' }],
  [/^\/calendars\/projects\/client-options$/, 'project_calendar.update'],
  [/^\/calendars\/projects(\/|$)/, { GET: 'open', '*': 'project_calendar.update' }], // assigned projects only, unless they hold Project calendar
  [/^\/calendars\/(assignments|members)\/[^/]+$/, 'holidays.view'],
  [/^\/calendars\/[^/]+\/employees$/, 'holidays.view'],
  [/^\/calendars\/?$/, { GET: 'open', '*': 'holidays.update' }],
  [/^\/calendars(\/|$)/, 'holidays.update'],

  [/^\/attendance\/(me|shifts)$/, { GET: 'open', '*': 'hr_settings.update' }],
  [/^\/attendance\/regularization-requests\/mine$/, 'open'],
  [/^\/attendance\/regularization-requests\/[^/]+\/decision$/, 'regularization.approve'],
  [/^\/attendance\/regularization-requests$/, { GET: 'regularization.view', '*': 'open' }],
  [/^\/attendance\/?$/, 'attendance.view'],
  [/^\/attendance(\/|$)/, 'attendance.update'],
  [/^\/attendance-dashboard\/offices$/, { GET: 'open', '*': 'hr_settings.update' }],
  // Their own record, or their reports': the service limits it. Holding the Attendance dashboard permission widens it to everyone (see modulesOf).
  [/^\/attendance-dashboard(\/|$)/, 'open'],

  [/^\/leave\/(types|day-status|balances\/me|requests\/me)$/, { GET: 'open', '*': 'leave.update' }],
  [/^\/leave\/requests$/, { GET: ['leave.view', 'leave.approve'], '*': 'open' }],
  [/^\/leave\/requests\/[^/]+\/cancel$/, 'open'],
  [/^\/leave\/requests(\/|$)/, 'leave.approve'],
  [/^\/leave\/balances\/overview$/, ['leave.view', 'leave.update']],
  [/^\/leave(\/|$)/, { GET: ['leave.view', 'leave.update'], '*': 'leave.update' }],

  [/^\/timesheets\/locks(\/|$)/, 'timesheets.lock'],
  [/^\/timesheets\/entries\/admin(\/|$)/, 'timesheets.update'],
  [/^\/timesheets\/entries\/[^/]+\/admin$/, 'timesheets.update'],
  [/^\/timesheets\/overtime-tickets\/(admin|employee-projects)$/, 'overtime.update'],
  [/^\/timesheets\/overtime-tickets\/[^/]+\/admin$/, 'overtime.update'],
  [/^\/timesheets\/overtime-tickets\/[^/]+$/, { DELETE: 'overtime.update', '*': 'open' }],
  [/^\/timesheets\/(entries|overview)$/, { GET: 'timesheets.view', '*': 'open' }], // POST /entries logs the caller's own hours
  [/^\/timesheets\/regularization-tickets$/, ['timesheets.view', 'regularization.view']],
  [/^\/timesheets\/approval-policy$/, { GET: 'open', '*': 'timesheets.approve' }],
  [/^\/timesheets(\/|$)/, 'open'], // own entries, manager approvals, OT tickets, regularization: limited to own / reports by the service

  // ---- Finance
  [/^\/payroll\/(payslips\/me|salary-structures\/me)$/, 'basic.payslips'],
  [/^\/payroll\/payslips\/[^/]+$/, 'open'], // the service returns only the caller's own payslip unless they hold payroll.view (see payroll.routes)
  [/^\/payroll\/increment-reminders(\/|$)/, 'increments.receive'],
  [/^\/payroll\/runs(\/[^/]+\/(process|refresh))?$/, { GET: 'payroll.view', '*': 'payroll.approve' }],
  [/^\/payroll(\/|$)/, { GET: 'payroll.view', POST: 'payroll.create', '*': 'payroll.update' }],
  [/^\/billing(\/|$)/, { GET: 'billing.view', POST: 'billing.create', DELETE: 'billing.delete', '*': 'billing.update' }],
  [/^\/profitability\/me$/, 'open'],
  [/^\/profitability(\/|$)/, 'analytics.view'],
  [/^\/analytics(\/|$)/, { GET: 'analytics.view', '*': 'analytics.update' }],
  [/^\/financials(\/|$)/, { GET: 'financials.view', POST: 'financials.create', DELETE: 'financials.delete', '*': 'financials.update' }],
  [/^\/calculations(\/|$)/, { GET: ['analytics.view', 'financials.view', 'finance.view'], '*': ['analytics.update', 'financials.update'] }],
  [/^\/expenses\/claims\/approvals$/, 'open'],
  [/^\/expenses\/claims\/[^/]+\/reimburse$/, 'finance.approve'],
  [/^\/expenses\/claims\/[^/]+\/decision$/, 'open'], // the claim's approvers decide; the service checks
  [/^\/expenses\/claims\/me$/, 'basic.expenses'],
  [/^\/expenses\/claims\/[^/]+$/, 'basic.expenses'], // change or withdraw their own claim
  [/^\/expenses\/claims$/, { GET: 'finance.view', '*': 'basic.expenses' }],
  [/^\/expenses\/vendor-payments\/[^/]+\/(decision|pay)$/, 'finance.approve'],
  [/^\/expenses(\/|$)/, { GET: 'finance.view', POST: 'finance.create', '*': 'finance.update' }],
  [/^\/vendor-commissions\/[^/]+\/(decision|pay)$/, 'finance.approve'],
  [/^\/(vendor-commissions|accounting|external-access|wallets)(\/|$)/, { GET: 'finance.view', POST: 'finance.create', DELETE: 'finance.delete', '*': 'finance.update' }],
  [/^\/finance-categories(\/|$)/, mutating('finance.update')],
  [/^\/(trading|contracts|projects)(\/|$)/, { GET: 'business.view', POST: 'business.create', DELETE: 'business.delete', '*': 'business.update' }],
  [/^\/(group-cash|super-dashboard|hiring)(\/|$)/, 'admin'],
  // Tracking a company payment in a wallet (POST /payments/track): open here, and the route itself lets in the Admin, the group admin,
  // people holding a finance / billing / payroll permission, and a company workspace's admin / manager / finance role (payments.routes.js).
  [/^\/payments(\/|$)/, 'open'],

  // ---- Reports
  [/^\/reports\/hr(\/|$)/, ['reports.hr']],
  [/^\/reports\/export$/, 'reports.export'],
  [/^\/reports(\/|$)/, 'reports.view'],

  // ---- Recruitment
  [/^\/pipeline(\/|$)/, 'pipeline.view'],
  [/^\/accounts(\/|$)/, { GET: 'accounts.view', '*': ['accounts.create', 'accounts.update', 'meetings.schedule', 'vendors.onboard'] }],
  [/^\/leads(\/|$)/, { GET: 'accounts.view', '*': ['accounts.create', 'accounts.update'] }],
  [/^\/requirements(\/|$)/, { GET: ['requirements.view', 'pipeline.view', 'submissions.create'], '*': ['requirements.create', 'requirements.update', 'requirements.delete'] }],
  [/^\/seats(\/|$)/, ['submissions.update', 'requirements.update']],
  [/^\/assessments(\/|$)/, { GET: ['requirements.view', 'pipeline.view', 'submissions.create'], '*': ['requirements.update', 'submissions.create'] }],
  [/^\/interview-templates(\/|$)/, { GET: ['requirements.view', 'pipeline.view', 'submissions.create'], '*': ['requirements.update'] }],
  [/^\/profiles(\/|$)/, { GET: ['profiles.view', 'submissions.create', 'submissions.view', 'pipeline.view'], '*': ['profiles.create', 'profiles.update', 'profiles.delete', 'submissions.create'] }],
  [/^\/submissions(\/|$)/, { GET: ['submissions.view', 'pipeline.view', 'rejected.view', 'profiles.view'], '*': ['submissions.create', 'submissions.update', 'meetings.schedule'] }],
  [/^\/interview-rounds(\/|$)/, ['submissions.update', 'meetings.schedule']],
  [/^\/applicants(\/|$)/, { GET: ['applicants.view', 'pipeline.view'], '*': 'applicants.update' }],
  [/^\/website(\/|$)/, { GET: 'website.view', '*': 'website.update' }],
  [/^\/vendor-email(\/|$)/, 'email.send'], // one permission: Email > Send emails (no implicit allowance via vendors.onboard / accounts.update)

  // ---- Administration
  [/^\/admin\/(deleted|audit)$/, 'deleted_records.view'],
  [/^\/admin\/[^/]+\/[^/]+\/restore$/, 'deleted_records.restore'],
  [/^\/admin\/[^/]+\/[^/]+\/unlock$/, ['accounts.update', 'requirements.update']],
  [/^\/admin(\/|$)/, 'admin'],
  [/^\/change-log\/entity$/, 'logs.view'],
  [/^\/change-log(\/|$)/, 'admin'],
];

// Each company workspace (Zephyr, Gulati Industries, ...) has its own roles inside it; they are not governed by this table.
const WORKSPACE = /^\/(zephyr|gulati|acconcy|foundation|zklyrera|valterra|novarex)(\/|$)/;

/** The permission a request needs: 'open' | 'admin' | a key | an array of keys. */
function needFor(method, path) {
  if (WORKSPACE.test(path)) return 'open';
  for (const [pattern, need] of RULES) {
    if (!pattern.test(path)) continue;
    if (typeof need === 'object' && !Array.isArray(need)) return need[method] || need['*'] || 'admin';
    return need;
  }
  return 'admin';
}

/** The rule that decides a route, or null when none matches (the route then needs the Admin). For the coverage test. */
function matchRule(method, path) {
  if (WORKSPACE.test(path)) return 'workspace';
  return RULES.find(([pattern]) => pattern.test(path)) || null;
}

module.exports = { RULES, needFor, matchRule };
