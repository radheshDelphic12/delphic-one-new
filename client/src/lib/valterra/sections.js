import { ArrowLeftRight, Banknote, CalendarRange, FileBarChart2, Landmark, LayoutDashboard, Mountain, Receipt, TrendingUp, UserCog, Wallet } from 'lucide-react';

/** The Valterra Resources product. `cap` is the capability (server access.js) needed to see a section. */
export const VALTERRA_SECTIONS = [
  { key: 'sites', to: '/valterra/sites', label: 'Mining Sites', blurb: 'Every site: location, mining type, material and its own financial picture.', icon: Mountain, cap: 'sites' },
  { key: 'investments', to: '/valterra/investments', label: 'Investments', blurb: 'Capital placed, principal returned and earnings, investment by investment.', icon: Landmark, cap: 'investments' },
  { key: 'income', to: '/valterra/income', label: 'Revenue & Returns', blurb: 'Mining revenue, investment earnings, principal recovered and other income received.', icon: Banknote, cap: 'entries' },
  { key: 'expenses', to: '/valterra/expenses', label: 'Expenses', blurb: 'Site operating costs and company overheads, by category.', icon: Receipt, cap: 'entries' },
  { key: 'salaries', to: '/valterra/salaries', label: 'Salaries', blurb: 'Salary and labour cost paid and payable, by employee and site.', icon: Wallet, cap: 'payroll' },
  { key: 'reports', to: '/valterra/reports', label: 'Monthly Reports', blurb: 'The monthly financial report and every other report, with export.', icon: FileBarChart2, cap: 'reports' },
  { key: 'projections', to: '/valterra/projections', label: 'Projections', blurb: 'Plan future months and compare with the actuals.', icon: CalendarRange, cap: 'projections' },
  { key: 'transactions', to: '/valterra/transactions', label: 'Transactions', blurb: 'Every movement of money in one searchable register.', icon: ArrowLeftRight, cap: 'entries' },
  { key: 'financials', to: '/valterra/financials', label: 'Financials', blurb: 'Income, expenses and capital by month, with month close.', icon: TrendingUp, cap: 'financials' },
  { key: 'people', to: '/valterra/people', label: 'Employee / Contractor', blurb: 'People roster, logins and access roles.', icon: UserCog, cap: 'people' },
];

export const VALTERRA_HOME = { to: '/valterra', label: 'Overview', icon: LayoutDashboard, end: true };

const has = (me, cap) => Boolean(me?.caps?.includes(cap));

/** Sidebar entries for a Valterra role. */
export function valterraNavFor(me) {
  if (!me) return [VALTERRA_HOME];
  const sections = VALTERRA_SECTIONS.filter((s) => has(me, s.cap));
  return has(me, 'dashboard') ? [VALTERRA_HOME, ...sections] : sections;
}
