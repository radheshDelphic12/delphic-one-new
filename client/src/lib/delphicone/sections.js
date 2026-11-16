import { Building2, FileText, LayoutDashboard, Target } from 'lucide-react';

/** The Delphic One workspace. `cap` is the capability (server delphicone.routes.js) needed to see a section. */
export const DELPHIC_ONE_SECTIONS = [
  { key: 'customers', to: '/delphic-one/customers', label: 'Customers', icon: Building2, cap: 'customers' },
  { key: 'leads', to: '/delphic-one/leads', label: 'Leads', icon: Target, cap: 'leads' },
  { key: 'invoices', to: '/delphic-one/invoices', label: 'Invoices', icon: FileText, cap: 'invoices' },
];
export const DELPHIC_ONE_HOME = { to: '/delphic-one', label: 'Overview', icon: LayoutDashboard, end: true };

const has = (me, cap) => Boolean(me?.caps?.includes(cap));

/** Sidebar entries for a Delphic One role. */
export function delphicOneNavFor(me) {
  if (!me) return [DELPHIC_ONE_HOME];
  const sections = DELPHIC_ONE_SECTIONS.filter((s) => has(me, s.cap));
  return has(me, 'dashboard') ? [DELPHIC_ONE_HOME, ...sections] : sections;
}

export const DELPHIC_ONE_TITLES = {
  '/delphic-one': ['Overview', 'Customers, leads and what is still to be collected, for Delphic One.'],
  '/delphic-one/customers': ['Customers', 'Companies using Delphic One: plan, users, recurring revenue and what they owe.'],
  '/delphic-one/leads': ['Leads', 'Early-access requests and prospects, from first call to customer.'],
  '/delphic-one/invoices': ['Invoices', 'Subscription invoices, payments received and overdue follow-ups.'],
};
