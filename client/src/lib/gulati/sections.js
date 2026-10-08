import { Briefcase, FileBarChart2, Handshake, LayoutDashboard, ListChecks, Target, TrendingUp, UserCog, Users } from 'lucide-react';

/**
 * The Gulati product. `cap` is the Gulati capability (server access.js) needed to see a section.
 */
export const GULATI_SECTIONS = [
  { key: 'leads', to: '/gulati/leads', label: 'Leads', blurb: 'Client requirements from first contact to won, with the trading-type pipeline.', icon: Target, cap: 'leads' },
  { key: 'parties', to: '/gulati/parties', label: 'Client / Vendor', blurb: 'One directory of clients and the vendors you source from.', icon: Users, cap: 'parties' },
  { key: 'deals', to: '/gulati/deals', label: 'Trading Deals', blurb: 'Purchases, sales, quantities, payments and profit per deal.', icon: Handshake, cap: 'deals' },
  { key: 'finance', to: '/gulati/finance', label: 'Finance', blurb: 'P&L, trading-type reports, expenses and month close.', icon: FileBarChart2, cap: 'overview' },
  { key: 'tasks', to: '/gulati/tasks', label: 'Tasks', blurb: 'Follow-ups, sourcing and delivery work for employees and contractors.', icon: ListChecks, cap: 'tasks' },
  { key: 'people', to: '/gulati/people', label: 'Employee / Contractor', blurb: 'People roster, logins and access roles.', icon: UserCog, cap: 'people' },
  // Sits just above "Gulati setup" in the sidebar.
  { key: 'financials', to: '/gulati/financials', label: 'Financials', blurb: 'Revenue, profit and valuation, month on month.', icon: TrendingUp, cap: 'valuation' },
];

export const GULATI_HOME = { to: '/gulati', label: 'Dashboard', icon: LayoutDashboard, end: true };
export const GULATI_MY_WORK = { key: 'my-work', to: '/gulati/my-work', label: 'My work', blurb: 'Your assigned leads, deals and tasks.', icon: Briefcase, cap: 'myWork' };

const has = (me, cap) => Boolean(me?.caps?.includes(cap));

/** Sidebar entries for a Gulati role. Staff and contractors get "My work" first, then Tasks. */
export function gulatiNavFor(me) {
  if (!me) return [GULATI_HOME];
  const sections = GULATI_SECTIONS.filter((s) => has(me, s.cap));
  if (has(me, 'dashboard')) return [GULATI_HOME, ...sections];
  return [GULATI_MY_WORK, ...sections];
}
