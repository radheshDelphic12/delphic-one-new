import { Briefcase, Coins, FileBarChart2, Handshake, LayoutDashboard, ListChecks, Target, TrendingUp, UserCog, Users, Wallet } from 'lucide-react';

/**
 * The Acconcy Finance product. `cap` is the Acconcy capability (server access.js) needed to see a section.
 */
export const ACCONCY_SECTIONS = [
  { key: 'leads', to: '/acconcy/leads', label: 'Leads', blurb: 'Business opportunities across the six services, from first contact to won.', icon: Target, cap: 'leads' },
  { key: 'deals', to: '/acconcy/deals', label: 'Deals', blurb: 'Engagements after a lead is won: revenue, expenses and profit per deal.', icon: Handshake, cap: 'deals' },
  { key: 'parties', to: '/acconcy/parties', label: 'Client / Vendor', blurb: 'One directory of clients and the vendors you work with.', icon: Users, cap: 'parties' },
  { key: 'finance', to: '/acconcy/finance', label: 'Revenue & Expenses', blurb: 'Revenue, expenses and the company P&L with every filter.', icon: FileBarChart2, cap: 'overview' },
  { key: 'investments', to: '/acconcy/investments', label: 'Investments', blurb: 'Gold, silver and venture holdings, with realised and unrealised gain.', icon: Coins, cap: 'investments' },
  { key: 'salaries', to: '/acconcy/salaries', label: 'Salaries', blurb: 'Monthly salary sheet for employees and contractors.', icon: Wallet, cap: 'salaries' },
  { key: 'reports', to: '/acconcy/reports', label: 'Reports', blurb: 'Lead, deal and investment reports with filters.', icon: FileBarChart2, cap: 'deals' },
  { key: 'tasks', to: '/acconcy/tasks', label: 'Tasks', blurb: 'Meetings, analysis, due diligence and follow-ups.', icon: ListChecks, cap: 'tasks' },
  { key: 'people', to: '/acconcy/people', label: 'Employee / Contractor', blurb: 'People roster, logins and access roles.', icon: UserCog, cap: 'people' },
  // Sits just above "Acconcy setup" in the sidebar.
  { key: 'financials', to: '/acconcy/financials', label: 'Financials & Valuation', blurb: 'P&L by month, service-wise reports, month close and company valuation.', icon: TrendingUp, cap: 'financials' },
];

export const ACCONCY_HOME = { to: '/acconcy', label: 'Dashboard', icon: LayoutDashboard, end: true };
export const ACCONCY_MY_WORK = { key: 'my-work', to: '/acconcy/my-work', label: 'My work', blurb: 'Your assigned leads, deals and tasks.', icon: Briefcase, cap: 'myWork' };

const has = (me, cap) => Boolean(me?.caps?.includes(cap));

/** Sidebar entries for an Acconcy role. Staff and contractors get "My work" first, then Tasks. */
export function acconcyNavFor(me) {
  if (!me) return [ACCONCY_HOME];
  const sections = ACCONCY_SECTIONS.filter((s) => has(me, s.cap) && !s.hideInNav);
  if (has(me, 'dashboard')) return [ACCONCY_HOME, ...sections];
  return [ACCONCY_MY_WORK, ...sections];
}
