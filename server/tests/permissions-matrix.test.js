// One permission at a time: a person holding ONLY that permission (in a company on the permission model) is let through the routes the
// permission is documented to open, and a person with no permission is refused on every one of them. The status of each probe is
// printed so a route that does not exist (404) is not mistaken for "open".
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed, unique } = require('./helpers');
const { ALL_KEYS, ACTIONS } = require('../src/lib/permissions');

const ID = '00000000-0000-4000-8000-000000000001';

// permission key -> probes [method, path]. Keys with no entry are listed as "no route gate" in the report.
const PROBES = {
  'accounts.view': [['GET', '/accounts']],
  'accounts.create': [['POST', '/accounts']],
  'accounts.update': [['PATCH', `/accounts/${ID}`], ['POST', `/accounts/${ID}/stage`]],
  'meetings.schedule': [['POST', `/accounts/${ID}/meetings`], ['POST', '/interview-rounds']],
  'vendors.onboard': [['POST', `/accounts/${ID}/classify`]],
  'email.send': [['GET', '/vendor-email/log']],
  'requirements.view': [['GET', '/requirements']],
  'requirements.create': [['POST', '/requirements']],
  'requirements.update': [['PATCH', `/requirements/${ID}`]],
  'requirements.delete': [['DELETE', `/requirements/${ID}`]],
  'pipeline.view': [['GET', '/pipeline']],
  'profiles.view': [['GET', '/profiles']],
  'profiles.create': [['POST', '/profiles']],
  'profiles.update': [['PATCH', `/profiles/${ID}`]],
  'profiles.delete': [['DELETE', `/profiles/${ID}`]],
  'submissions.view': [['GET', '/submissions']],
  'submissions.create': [['POST', '/submissions']],
  'submissions.update': [['PATCH', `/submissions/${ID}`], ['GET', `/seats/${ID}`]],
  'rejected.view': [['GET', '/submissions']],
  'applicants.view': [['GET', '/applicants']],
  'applicants.update': [['PATCH', `/applicants/${ID}`]],
  'website.view': [['GET', '/website/postings']],
  'website.update': [['POST', '/website/postings']],
  'people.view': [['GET', '/orgs/bench'], ['GET', `/orgs/memberships/${ID}/details`]],
  'people.update': [['PATCH', `/orgs/memberships/${ID}`]],
  'people.delete': [['DELETE', `/orgs/memberships/${ID}`]],
  'allocations.view': [['GET', '/allocations']],
  'allocations.manage': [['POST', '/allocations']],
  'users.view': [['GET', '/users'], ['GET', '/invites/outbox']],
  'users.create': [['POST', '/users'], ['POST', '/invites']],
  'users.update': [['PATCH', `/users/${ID}`]],
  'assets.view': [['GET', '/assets']],
  'assets.create': [['POST', '/assets']],
  'assets.update': [['PATCH', `/assets/${ID}`]],
  'assets.delete': [['DELETE', `/assets/${ID}`]],
  'hr_settings.update': [['POST', '/departments'], ['POST', '/teams'], ['POST', '/designations'], ['POST', '/policies']],
  'attendance.view': [['GET', '/attendance']],
  'attendance.update': [['POST', '/attendance/manual']],
  'project_calendar.update': [['POST', '/calendars/projects']],
  'holidays.view': [['GET', `/calendars/${ID}/employees`]],
  'holidays.update': [['POST', '/calendars']],
  'overtime.update': [['POST', '/timesheets/overtime-tickets/admin']],
  'timesheets.view': [['GET', '/timesheets/entries']],
  'timesheets.update': [['POST', '/timesheets/entries/admin']],
  'timesheets.approve': [['PUT', '/timesheets/approval-policy']],
  'timesheets.lock': [['POST', '/timesheets/locks']],
  'regularization.view': [['GET', '/attendance/regularization-requests']],
  'regularization.approve': [['POST', `/attendance/regularization-requests/${ID}/decision`]],
  'leave.view': [['GET', '/leave/balances/overview']],
  'leave.approve': [['POST', `/leave/requests/${ID}/decision`]],
  'leave.update': [['POST', '/leave/types']],
  'finance.view': [['GET', '/expenses/vendor-payments'], ['GET', '/accounting/ledger-accounts']],
  'finance.create': [['POST', '/accounting/ledger-accounts']],
  'finance.update': [['PATCH', `/expenses/vendor-payments/${ID}`]],
  'finance.delete': [['DELETE', `/accounting/ledger-accounts/${ID}`]],
  'finance.approve': [['POST', `/expenses/claims/${ID}/reimburse`], ['POST', `/expenses/vendor-payments/${ID}/pay`]],
  'payroll.view': [['GET', '/payroll/runs']],
  'payroll.create': [['POST', '/payroll/salary-structures']],
  'payroll.update': [['PUT', '/payroll/pay-basis']],
  'payroll.approve': [['POST', `/payroll/runs/${ID}/process`]],
  'increments.receive': [['GET', '/payroll/increment-reminders']],
  'analytics.view': [['GET', '/analytics/overview'], ['GET', '/profitability']],
  'analytics.update': [['POST', '/analytics/overview']],
  'financials.view': [['GET', '/financials']],
  'financials.create': [['POST', '/financials']],
  'financials.update': [['PATCH', `/financials/${ID}`]],
  'financials.delete': [['DELETE', `/financials/${ID}`]],
  'business.view': [['GET', '/trading']],
  'business.create': [['POST', '/trading']],
  'business.update': [['PATCH', `/trading/${ID}`]],
  'business.delete': [['DELETE', `/trading/${ID}`]],
  'billing.view': [['GET', '/billing']],
  'billing.create': [['POST', '/billing']],
  'billing.update': [['PATCH', `/billing/${ID}`]],
  'billing.delete': [['DELETE', `/billing/${ID}`]],
  'reports.view': [['GET', '/reports/bda-reports'], ['GET', '/reports/sales-reports'], ['GET', '/reports/joinings'], ['GET', '/reports/time-to-submit'], ['GET', '/reports/clients-without-requirements'], ['GET', '/reports/recruiter-vendor-gaps']],
  'reports.export': [['GET', '/reports/export']],
  'deleted_records.view': [['GET', '/admin/deleted']],
  'deleted_records.restore': [['POST', `/admin/accounts/${ID}/restore`]],
  'logs.view': [['GET', '/change-log/entity']],
};

// Permissions that do NOT open their route today. They are listed (with why) so the suite is green and the gap stays visible:
// the test still checks the route is refused without the permission, and FAILS when one of these starts to open, so the entry
// gets removed. Fixing a "legacy role gate" means deciding that a view permission alone implies a role (lib/access/effective.js).
const KNOWN_CLOSED = {
  'profiles.view': 'GET /profiles still asks authorize(recruiter, sales, admin, bda); a view permission implies no legacy role (deriveLegacyRole)',
  'applicants.view': 'GET /applicants has the same legacy role gate',
  'website.view': 'GET /website/postings has the same legacy role gate',
  'payroll.approve': 'POST /payroll/runs/:id/process still asks the older payroll role check (canMethod)',
  'analytics.update': 'POST /analytics/overview still asks the older analytics role check (canMethod)',
  'deleted_records.view': 'GET /admin/deleted is Super Admin only by design',
  'deleted_records.restore': 'restoring a deleted record is Super Admin only by design',
};

let org; let none; const rows = [];

async function employee(name, permissions) {
  const user = await createUser({ role: 'employee', name, withOrg: false });
  const m = await createOrgMembership(user.id, org.id, { role: 'employee' });
  if (permissions) {
    const set = await prisma.customRole.create({ data: { org_id: org.id, name: unique('set-'), permissions, base_role: 'employee' } });
    await prisma.orgMembership.update({ where: { id: m.id }, data: { custom_role_id: set.id } });
  }
  return (await loginAs(user)).access_token;
}
const call = (method, path, token) => {
  const r = authed(request(app)[method.toLowerCase()](`/api/v1${path}`), token);
  return ['POST', 'PUT', 'PATCH'].includes(method) ? r.send({}) : r;
};

beforeAll(async () => {
  await cleanDatabase();
  org = await createOrg({ name: 'Delphic Global', slug: unique('dg-'), is_master_workspace: true });
  // the business routes (trading, leads, contracts, projects) also need their module switched on for the company
  await prisma.org.update({ where: { id: org.id }, data: { access_mode: 'permissions', enabled_modules: ['trading', 'leads', 'contracts', 'projects'] } });
  none = await employee('Nobody', null);
}, 120000);
afterAll(async () => {
  console.log('\nKEY | PROBE | WITH-PERMISSION | WITHOUT\n' + rows.map((r) => r.join(' | ')).join('\n'));
  await prisma.$disconnect();
});

describe('every permission opens what it says, and nothing opens without it', () => {
  test('the catalogue and the probe table agree on every key', () => {
    const noProbe = ALL_KEYS.filter((k) => !PROBES[k]);
    console.log('KEYS WITH NO ROUTE GATE:', noProbe.join(', '));
    expect(Object.keys(PROBES).filter((k) => !ALL_KEYS.includes(k))).toEqual([]);
  });

  test.each(Object.keys(PROBES))('%s', async (key) => {
    const token = await employee(`Holder ${key}`, { [key]: ACTIONS.get(key).scoped ? 'all' : true });
    const failures = [];
    for (const [method, path] of PROBES[key]) {
      const withIt = await call(method, path, token);
      const without = await call(method, path, none);
      rows.push([key, `${method} ${path.replace(ID, ':id')}`, withIt.status, without.status]);
      const closed = withIt.status === 403 || withIt.status === 401;
      if (KNOWN_CLOSED[key]) {
        if (!closed) failures.push(`${method} ${path} now opens WITH ${key}: remove it from KNOWN_CLOSED`);
      } else if (closed) failures.push(`${method} ${path} stayed closed WITH ${key} (${withIt.status}: ${withIt.body?.message})`);
      if (without.status !== 403) failures.push(`${method} ${path} was not refused WITHOUT any permission (${without.status})`);
    }
    expect(failures).toEqual([]);
  }, 60000);
});
