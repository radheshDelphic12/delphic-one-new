import { Banknote, FileBarChart2, Flag, LayoutDashboard, Shapes, TrendingUp, UserCog } from 'lucide-react';

/** The Gulati Foundation product. `cap` is the Foundation capability (server access.js) needed to see a section. */
export const FOUNDATION_SECTIONS = [
  { key: 'campaigns', to: '/foundation/campaigns', label: 'Campaigns', blurb: 'Every campaign: location, dates, budget, spending and projection.', icon: Flag, cap: 'campaigns' },
  { key: 'funds', to: '/foundation/funds', label: 'Funds & Expenses', blurb: 'Investments, expenses, donations and transfers, with approvals.', icon: Banknote, cap: 'entries' },
  { key: 'initiatives', to: '/foundation/initiatives', label: 'Initiatives & Categories', blurb: 'Child care, education, healthcare ... and the categories of spending and funding.', icon: Shapes, cap: 'campaigns' },
  { key: 'reports', to: '/foundation/reports', label: 'Reports', blurb: 'Budgets, spending, funding and projection reports with filters and export.', icon: FileBarChart2, cap: 'reports' },
  { key: 'financials', to: '/foundation/financials', label: 'Financials', blurb: 'Income, expenses and fund balance by month, with month close.', icon: TrendingUp, cap: 'financials' },
  { key: 'people', to: '/foundation/people', label: 'Employee / Contractor', blurb: 'People roster, logins and access roles.', icon: UserCog, cap: 'people' },
];

export const FOUNDATION_HOME = { to: '/foundation', label: 'Dashboard', icon: LayoutDashboard, end: true };

const has = (me, cap) => Boolean(me?.caps?.includes(cap));

/** Sidebar entries for a Foundation role. */
export function foundationNavFor(me) {
  if (!me) return [FOUNDATION_HOME];
  const sections = FOUNDATION_SECTIONS.filter((s) => has(me, s.cap));
  return has(me, 'dashboard') ? [FOUNDATION_HOME, ...sections] : sections;
}
