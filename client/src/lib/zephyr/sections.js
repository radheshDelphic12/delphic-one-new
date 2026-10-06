import { Banknote, Building2, FileBarChart2, HardHat, KeyRound, LayoutDashboard, LineChart, ListChecks, Target, UserCog, Users } from 'lucide-react';

/**
 * The whole Zephyr product: six sections plus a home. `cap` is the Zephyr
 * capability (server access.js) needed to see it; `phase` is the build phase
 * that delivers it - `built: false` sections show a "coming soon" page.
 */
export const ZEPHYR_SECTIONS = [
  { key: 'leads', to: '/zephyr/leads', label: 'Leads', blurb: 'Opportunities from first contact to won or lost.', icon: Target, cap: 'leads', phase: 'Z2', built: true },
  { key: 'parties', to: '/zephyr/parties', label: 'Client / Vendor', blurb: 'One directory of clients, vendors and subcontractors.', icon: Users, cap: 'parties', phase: 'Z1', built: true },
  { key: 'projects', to: '/zephyr/projects', label: 'Projects', blurb: 'Own and client projects: budget, milestones, work orders.', icon: HardHat, cap: 'projects', phase: 'Z3', built: true },
  { key: 'properties', to: '/zephyr/properties', label: 'Properties', blurb: 'Properties and units: investment, valuation, loans, tenants and sales.', icon: Building2, cap: 'properties', phase: 'R3', built: true },
  { key: 'rent', to: '/zephyr/rent', label: 'Rent', blurb: 'Monthly rent due, collected, pending and overdue; tenants and leases.', icon: KeyRound, cap: 'rent', phase: 'R4', built: true },
  { key: 'overview', to: '/zephyr/overview', label: 'Revenue & Profit', blurb: 'Revenue, expense, salaries, profit and valuation, live.', icon: FileBarChart2, cap: 'overview', phase: 'Z6', built: true },
  { key: 'people', to: '/zephyr/people', label: 'Employee / Contractor', blurb: 'People roster, assignments and monthly salary records.', icon: UserCog, cap: 'people', phase: 'Z4', built: true },
  { key: 'tasks', to: '/zephyr/tasks', label: 'Tasks', blurb: 'Visits, rent collection and follow-ups for employees and contractors.', icon: ListChecks, cap: 'tasks', phase: 'R8', built: true },
  { key: 'financials', to: '/zephyr/financials', label: 'Financials', blurb: 'Plan vs actual, month close, projections and statements.', icon: LineChart, cap: 'financials', phase: 'Z7', built: true },
];

export const ZEPHYR_HOME = { to: '/zephyr', label: 'Home', icon: LayoutDashboard, end: true };
export const ZEPHYR_MY_WORK = { key: 'my-work', to: '/zephyr/my-work', label: 'My work', blurb: 'Your assigned projects, profile and salary slips.', icon: Banknote, cap: 'myWork', phase: 'Z4', built: true };

/** Sidebar entries for a Zephyr role (the six sections it may see, or "My work" for staff). */
export function zephyrNavFor(me) {
  if (!me) return [ZEPHYR_HOME];
  const sections = ZEPHYR_SECTIONS.filter((s) => zxHas(me, s.cap));
  return [ZEPHYR_HOME, ...(me.role === 'staff' ? [ZEPHYR_MY_WORK, ...sections] : sections)];
}

function zxHas(me, cap) {
  return Boolean(me?.caps?.includes(cap));
}
