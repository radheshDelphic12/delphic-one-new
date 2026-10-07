import { ROLE_COPY } from '../../pages/dashboard/dashboardWidgets.js';

const ZEPHYR_TITLES = {
  '/zephyr': ['Dashboard', 'Your business at a glance.'],
  '/zephyr/leads': ['Leads', 'Opportunities from first contact to won or lost.'],
  '/zephyr/parties': ['Client / Vendor', 'Clients, vendors and subcontractors in one directory.'],
  '/zephyr/projects': ['Projects', 'Own and client projects, milestones and work orders.'],
  '/zephyr/properties': ['Properties', 'Properties and units: investment, valuation, loans, tenants and sales.'],
  '/zephyr/rent': ['Rent', 'Monthly rent due, collected, pending and overdue.'],
  '/zephyr/tasks': ['Tasks', 'Operational tasks for employees and contractors.'],
  '/zephyr/overview': ['Revenue & Profit', 'Revenue, expense, salaries, profit and valuation.'],
  '/zephyr/people': ['Employee / Contractor', 'People roster, project assignments and monthly salary slips.'],
  '/zephyr/financials': ['Financials', 'Plan vs actual, month close and projections.'],
  '/zephyr/my-work': ['My work', 'Your assigned projects, profile and salary slips.'],
  '/zephyr/settings': ['Zephyr setup', 'Services, valuation, categories and the audit log.'],
};
const zephyrEntry = (pathname) => {
  if (/^\/zephyr\/projects\/[^/]+$/.test(pathname)) return ['Project', 'Milestones, vendor work orders and documents.'];
  if (/^\/zephyr\/properties\/[^/]+$/.test(pathname)) return ['Property', 'Units, tenants, rent, finance and timeline.'];
  return ZEPHYR_TITLES[pathname] || ZEPHYR_TITLES['/zephyr'];
};
const zephyrTitle = (pathname) => zephyrEntry(pathname)[0];
const zephyrSubtitle = (pathname) => zephyrEntry(pathname)[1];

const GULATI_TITLES = {
  '/gulati': ['Dashboard', 'Lead pipeline, active trading and company performance.'],
  '/gulati/leads': ['Leads', 'Client requirements from first contact to a won trading deal.'],
  '/gulati/parties': ['Client / Vendor', 'Clients and the vendors you source from.'],
  '/gulati/deals': ['Trading Deals', 'Purchases, sales, quantities, payments and profit.'],
  '/gulati/finance': ['Finance', 'P&L, trading-type reports, expenses and month close.'],
  '/gulati/financials': ['Financials', 'Revenue, profit and valuation, month on month.'],
  '/gulati/tasks': ['Tasks', 'Follow-ups, sourcing and delivery work.'],
  '/gulati/people': ['Employee / Contractor', 'People roster, logins and access roles.'],
  '/gulati/my-work': ['My work', 'Your assigned leads, deals and tasks.'],
  '/gulati/settings': ['Gulati setup', 'Trading types, units, categories, valuation and audit log.'],
};
const gulatiEntry = (pathname) => (/^\/gulati\/deals\/[^/]+/.test(pathname) ? ['Trading Deal', 'Purchases, sales, expenses and profit for one deal.'] : GULATI_TITLES[pathname] || GULATI_TITLES['/gulati']);

/** Page title shown in the app header for the active route. */
export function headerTitleForPath(pathname, user) {
  if (pathname === '/') return user?.name ? `${user.name}'s Dashboard` : 'Dashboard';
  if (pathname.startsWith('/zephyr')) return zephyrTitle(pathname);
  if (pathname.startsWith('/gulati')) return gulatiEntry(pathname)[0];
  if (pathname.startsWith('/pipeline')) return 'Pipeline';
  if (pathname.startsWith('/accounts')) return 'Clients & vendors';
  if (pathname.startsWith('/requirements')) return 'Requirements';
  if (pathname.startsWith('/profiles')) return 'Candidates';
  if (pathname.startsWith('/submissions')) return 'Submissions';
  if (pathname.startsWith('/calendar')) return 'Calendar';
  if (pathname.startsWith('/notifications')) return 'Notifications';
  if (pathname.startsWith('/settings')) return 'Settings';
  if (pathname.startsWith('/reports')) return 'Reports';
  if (pathname.startsWith('/group-overview')) return 'Group Overview';
  if (pathname.startsWith('/finance')) return 'Finance';
  if (pathname.startsWith('/payroll')) return 'Payroll';
  if (pathname.startsWith('/analytics')) return 'Live Analytics';
  if (pathname.startsWith('/financials')) return 'Company Financials';
  if (pathname.startsWith('/trading')) return 'Trading';
  if (pathname.startsWith('/leads')) return 'Leads';
  if (pathname.startsWith('/contracts')) return 'Contracts';
  if (/^\/projects\/[^/]+$/.test(pathname)) return 'Project';
  if (pathname.startsWith('/projects')) return 'Self Projects';
  if (/^\/people\/[^/]+$/.test(pathname)) return 'Employee profile';
  if (pathname.startsWith('/people')) return 'People';
  if (pathname.startsWith('/attendance')) return 'Time & Attendance';
  return user?.active_org?.name || 'Workspace';
}

/** Subtitle shown directly under the header title on the same canvas background. */
export function headerSubtitleForPath(pathname, user) {
  if (pathname.startsWith('/zephyr')) return zephyrSubtitle(pathname);
  if (pathname.startsWith('/gulati')) return gulatiEntry(pathname)[1];
  if (pathname === '/') return ROLE_COPY[user?.role || 'admin']?.subtitle || ROLE_COPY.admin.subtitle;
  if (/^\/pipeline\/[^/]+/.test(pathname)) {
    return 'Requirements as rows, candidates by stage. Drag or use stage buttons.';
  }
  if (pathname.startsWith('/pipeline')) {
    return 'Your role pipeline - leads, jobs, or candidates by stage.';
  }
  if (pathname.startsWith('/accounts')) return 'Track lead ownership, meetings, and account stage.';
  if (pathname.startsWith('/requirements')) return 'Open jobs, seats, and recruiter assignments.';
  if (pathname.startsWith('/profiles')) return 'Profiles with skills, CTC, and resume attachments.';
  if (pathname.startsWith('/submissions')) return 'Candidates put forward for jobs, by pipeline stage.';
  if (pathname.startsWith('/calendar')) return 'Your scheduled and upcoming interviews - month grid or agenda.';
  if (pathname.startsWith('/notifications')) return 'Assignments, interviews, and stage changes across your work.';
  if (pathname.startsWith('/settings')) return 'Your profile, password, notifications, and account history.';
  if (pathname.startsWith('/reports')) return 'Pick filters and export Excel or PDF.';
  if (pathname.startsWith('/group-overview')) {
    return 'Group-wide valuation, revenue vs. expense, and drill-down into any subsidiary.';
  }
  if (pathname.startsWith('/finance')) return 'Expenses, vendor payments, billing rates, accounting, group charges, and CA/audit access.';
  if (pathname.startsWith('/payroll')) return 'Salary structures, payroll runs, and payslips.';
  if (pathname.startsWith('/analytics')) return 'Real-time billing, resource revenue, salary, expenses, and vendor amounts. Click any row to open the record.';
  if (pathname.startsWith('/financials')) return 'Finalized financials by category, with revenue, profit and valuation trends month on month.';
  if (pathname.startsWith('/trading')) return 'Suppliers, consumers, goods, rate cards, and current transactions.';
  if (pathname.startsWith('/leads')) return 'Lead pipeline, categorised by self project, client project, or other.';
  if (pathname.startsWith('/contracts')) return 'Construction and recurring-revenue contracts, with monthly expected revenue.';
  if (/^\/projects\/[^/]+$/.test(pathname)) return 'Finance, legal and site documents, and contracts for this project.';
  if (pathname.startsWith('/projects')) return 'Self projects: finance, legal and site documents, and contracts.';
  if (/^\/people\/[^/]+$/.test(pathname)) return 'Employee directory, organization details, and reporting context.';
  if (pathname.startsWith('/people')) {
    return 'Directory, org chart, users, and HR settings in one place.';
  }
  if (pathname.startsWith('/attendance')) return 'Attendance, leave, and timesheets in one place.';
  return '';
}
