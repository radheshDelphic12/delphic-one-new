/**
 * Access under the permission model (Settings > Permissions). A company is either 'legacy' (the plain role decides, as before) or
 * 'permissions': the Super Admin and the company Admin see everything, everyone else sees the default basic access plus the
 * permission set and grants they hold. The server decides every request; this only keeps the menu, tabs and buttons in step with it.
 *
 * `user.access` comes from /users/me: { mode, level: 'super_admin' | 'admin' | 'employee', permissions, basic, set }.
 */
export const isPermissionMode = (user) => user?.access?.mode === 'permissions';

/** The Super Admin or the company Admin (in a company on permissions); in a company that has not moved, the old admin role. */
export function isAdminUser(user) {
  if (isPermissionMode(user)) return user.access.level !== 'employee';
  return user?.role === 'admin';
}

export const isSuperAdminLevel = (user) => user?.access?.level === 'super_admin' || Boolean(user?.is_group_superadmin);

/**
 * Does the person hold this permission (or basic item), or any one of several?
 * Only meaningful in a company on permissions; elsewhere it answers true so the caller's old rule decides.
 */
export function hasNeed(user, need) {
  const a = user?.access;
  if (!a || a.mode !== 'permissions') return true;
  if (a.level !== 'employee') return true;
  const keys = Array.isArray(need) ? need : [need];
  return keys.some((k) => (k.startsWith('basic.') ? (a.basic || []).includes(k) : Boolean(a.permissions?.[k])));
}

/** `need` in a company on permissions, the old rule (`legacy`) everywhere else. For tabs and buttons that were `isAdmin`. */
export const allowed = (user, need, legacy) => (isPermissionMode(user) ? hasNeed(user, need) : Boolean(legacy));

// The older capability names the screens and the menu use, and the permissions that now stand behind each (any one is enough).
export const CAPABILITY_NEEDS = {
  viewPeople: ['basic.people_directory', 'basic.org_chart', 'basic.policies', 'people.view', 'users.view', 'allocations.view', 'assets.view', 'hr_settings.view'],
  managePeople: ['people.update'],
  viewAttendance: ['basic.attendance'],
  manageAttendance: ['attendance.update', 'attendance.approve'],
  viewLeave: ['basic.leave'],
  manageLeave: ['leave.approve', 'leave.update'],
  manageHrSettings: ['hr_settings.update'],
  viewReports: ['reports.view'],
  exportReports: ['reports.export'],
  filterByDepartment: ['reports.view'],
  filterByIndividual: ['reports.view'],
  viewAllUsers: ['users.view'],
  manageUsers: ['users.create', 'users.update'],
  manageDepartments: ['hr_settings.update'],
  editAccount: ['accounts.update'],
  editBroughtBy: ['accounts.update'],
  editRequirement: ['requirements.update'],
  editProfile: ['profiles.update'],
  editSubmission: ['submissions.update'],
  unlockEntity: ['accounts.update', 'requirements.update'],
  unlockAccount: ['accounts.update'],
  viewProfiles: ['profiles.view'],
  createProfile: ['profiles.create'],
  assignRecruiters: ['requirements.update'],
  viewDashboardCharts: ['reports.view'],
  viewPipeline: ['pipeline.view', 'accounts.view', 'requirements.view', 'submissions.view', 'rejected.view'],
  viewLeadPipeline: ['pipeline.view'],
  viewJobPipeline: ['pipeline.view'],
  viewCandidatePipeline: ['pipeline.view'],
  viewRequirementMatrix: ['pipeline.view'],
  viewApplicants: ['applicants.view'],
  viewOrgChart: ['basic.org_chart'],
  viewTimesheets: ['basic.timesheet'],
  manageTimesheets: ['timesheets.update', 'timesheets.approve'],
  viewExpenses: ['basic.expenses', 'finance.view', 'billing.view', 'analytics.view'],
  manageExpenses: ['finance.update', 'finance.approve'],
  viewAccounting: ['finance.view'],
  manageAccounting: ['finance.update'],
  manageExternalAccess: ['finance.update'],
  viewPayroll: ['basic.payslips', 'payroll.view'],
  managePayroll: ['payroll.create', 'payroll.update', 'payroll.approve'],
  viewBillingRates: ['billing.view'],
  manageBillingRates: ['billing.update'],
  viewGroupCharges: ['billing.view'],
  manageGroupCharges: ['billing.update'],
  viewAnalytics: ['analytics.view'],
  viewFinancials: ['financials.view'],
  viewLeads: ['accounts.view'],
  viewTrading: ['business.view'],
  viewContracts: ['business.view'],
  viewProjects: ['business.view'],
  manageWebsite: ['website.view', 'website.update'],
  deleteRecords: ['deleted_records.view'],
};

/** A capability name (or a permission key) for a person on the permission model. Unknown names are closed. */
export function capabilityAllowed(user, capability) {
  if (!capability) return false;
  const a = user?.access;
  if (!a || a.mode !== 'permissions') return false;
  if (a.level !== 'employee') return true;
  const needs = CAPABILITY_NEEDS[capability] || (capability.includes('.') ? [capability] : null);
  return needs ? hasNeed(user, needs) : false;
}

/** The label shown for a person's level. */
export const LEVEL_LABEL = { super_admin: 'Super Admin', admin: 'Admin', employee: 'Employee' };

/** An admin-only control: in a company on permissions, the person holds `need`; elsewhere the old admin role decides. */
export const adminFor = (user, need) => (isPermissionMode(user) ? hasNeed(user, need) : user?.role === 'admin');

/**
 * The plain role the screens see. In a company on permissions the server derives a role for its own older gates (an HR lead carries
 * 'admin' there); the screens must not read that as "can do admin things", so only the Admin and the Super Admin keep 'admin' here.
 * Admin-looking controls go through adminFor() with the permission they need.
 */
export function uiRole(me) {
  if (me?.access?.mode === 'permissions' && me.access.level === 'employee' && me.role === 'admin') return 'employee';
  return me?.role;
}
