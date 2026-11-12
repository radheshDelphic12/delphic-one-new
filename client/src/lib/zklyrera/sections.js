import { ArrowLeftRight, Banknote, CalendarRange, FileBarChart2, Landmark, LayoutDashboard, Receipt, TrendingUp, UserCog, Wallet } from 'lucide-react';

/** The Zklyrera Spirits product. `cap` is the capability (server access.js) needed to see a section. */
export const ZKLYRERA_SECTIONS = [
  { key: 'investments', to: '/zklyrera/investments', label: 'Investments', blurb: 'Capital placed, principal returned and earnings, investment by investment.', icon: Landmark, cap: 'investments' },
  { key: 'income', to: '/zklyrera/income', label: 'Income & Returns', blurb: 'Investment earnings, principal recovered and other income received.', icon: Banknote, cap: 'entries' },
  { key: 'expenses', to: '/zklyrera/expenses', label: 'Expenses', blurb: 'Operating and other business expenses by category.', icon: Receipt, cap: 'entries' },
  { key: 'salaries', to: '/zklyrera/salaries', label: 'Salaries', blurb: 'Salary paid and payable, by employee.', icon: Wallet, cap: 'payroll' },
  { key: 'reports', to: '/zklyrera/reports', label: 'Monthly Reports', blurb: 'The monthly financial report and every other report, with export.', icon: FileBarChart2, cap: 'reports' },
  { key: 'projections', to: '/zklyrera/projections', label: 'Projections', blurb: 'Plan future months and compare with the actuals.', icon: CalendarRange, cap: 'projections' },
  { key: 'transactions', to: '/zklyrera/transactions', label: 'Transactions', blurb: 'Every movement of money in one searchable register.', icon: ArrowLeftRight, cap: 'entries' },
  { key: 'financials', to: '/zklyrera/financials', label: 'Financials', blurb: 'Income, expenses and capital by month, with month close.', icon: TrendingUp, cap: 'financials' },
  { key: 'people', to: '/zklyrera/people', label: 'Employee / Contractor', blurb: 'People roster, logins and access roles.', icon: UserCog, cap: 'people' },
];

export const ZKLYRERA_HOME = { to: '/zklyrera', label: 'Overview', icon: LayoutDashboard, end: true };

const has = (me, cap) => Boolean(me?.caps?.includes(cap));

/** Sidebar entries for a Zklyrera role. */
export function zklyreraNavFor(me) {
  if (!me) return [ZKLYRERA_HOME];
  const sections = ZKLYRERA_SECTIONS.filter((s) => has(me, s.cap));
  return has(me, 'dashboard') ? [ZKLYRERA_HOME, ...sections] : sections;
}
