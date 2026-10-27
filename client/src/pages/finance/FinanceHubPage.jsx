import HubTabs from '../../components/layout/HubTabs.jsx';
import { useSearchParams } from 'react-router-dom';
import { CalendarRange, FileText, FolderKanban, Receipt, SlidersHorizontal, Tags, Truck, Users2 } from 'lucide-react';
import { useAuth } from '../../lib/authContext.jsx';
import { allowed, isAdminUser } from '../../lib/access.js';
import ExpensesTab from './ExpensesTab.jsx';
import ProjectsTab from './ProjectsTab.jsx';
import GroupChargesTab from './GroupChargesTab.jsx';
import MonthProjectsTab from './MonthProjectsTab.jsx';
import BillingSetupTab from './BillingSetupTab.jsx';
import VendorInvoicesTab from './VendorInvoicesTab.jsx';
import InvoicingSection from './InvoicingSection.jsx';
// Project P&L is hidden for now (client brief 2026-10-01: its cost rules —
// partial-month salary on a last working day, actual project cost — are not
// settled). ProjectPnlTab.jsx and its API stay; to bring it back, re-import it
// and add { key: 'project-pnl', label: 'Project P&L', icon: TrendingUp }.
import FinanceCategoriesTab from './FinanceCategoriesTab.jsx';

const BASE_TABS = [{ key: 'expenses', label: 'Expenses', icon: Receipt, need: ['basic.expenses', 'finance.view'] }];
const ADMIN_TABS = [
  { key: 'projects', label: 'Projects', icon: FolderKanban, need: 'billing.view' },
  // Month-wise: running projects -> timesheet -> billing -> invoice -> payment -> financial status, plus the Sales / Salary exports.
  { key: 'month-view', label: 'Month View', icon: CalendarRange, need: ['analytics.view', 'financials.view', 'finance.view'] },
  // Every client invoice, month by month: paid / partly paid / unpaid, filters, totals, payments (the payment popup, wallet yes / no).
  { key: 'invoicing', label: 'Invoicing', icon: FileText, need: 'billing.view' },
  // Per-resource billing rates and the client billing status rules (PL / NPL / comp off / FH / SH ...).
  { key: 'billing-setup', label: 'Billing Setup', icon: SlidersHorizontal, need: 'billing.view' },
  // Vendor invoices: TDS, adjustment, sent / unsent, paid / unpaid, trace, Excel export.
  { key: 'vendor-invoices', label: 'Vendor Invoices', icon: Truck, need: 'billing.view' },
  { key: 'group-charges', label: 'Group Charges', icon: Users2, need: 'billing.view' },
  // Admin-managed Group Charge + Expense categories (next to Group Charges).
  { key: 'categories', label: 'Categories', icon: Tags, need: 'finance.view' },
];

/**
 * Finance hub: expenses, projects (the hub for running projects and contracts:
 * billing terms, client agreements, project team, invoicing) and intra-group
 * charges. Expense claims are self-serve for every role; the rest is
 * admin-only, matching the backend's own gating.
 *
 * Vendor Payments, External Access, Vendor Ledger and Accounting are switched
 * off for now — their tabs are gone from here and the API refuses them (see
 * server/src/middleware/financeScope.js). The tab components are still in the
 * codebase so turning them back on is a small change.
 */
export default function FinanceHubPage() {
  const { user, isGroupSuperadmin } = useAuth();
  // everyone except the group superadmin gets the refreshed look; the superadmin keeps the original one
  const modern = !isGroupSuperadmin;
  const isAdmin = isAdminUser(user);
  const tabs = [...BASE_TABS.filter((t) => allowed(user, t.need, true)), ...ADMIN_TABS.filter((t) => allowed(user, t.need, isAdmin))];
  const has = (key) => tabs.some((t) => t.key === key);
  const [params, setParams] = useSearchParams();
  const requested = params.get('section') || 'expenses';
  const section = tabs.some((t) => t.key === requested) ? requested : (tabs[0]?.key || 'expenses');

  return (
    <div className={`space-y-4 ${modern ? 'ta-modern' : ''}`}>
      <HubTabs tabs={tabs} value={section} onSelect={(key) => setParams({ section: key })} modern={modern} />
      {section === 'expenses' && has('expenses') && <ExpensesTab />}
      {section === 'projects' && has('projects') && <ProjectsTab />}
      {section === 'month-view' && has('month-view') && <MonthProjectsTab />}
      {section === 'invoicing' && has('invoicing') && <InvoicingSection />}
      {section === 'billing-setup' && has('billing-setup') && <BillingSetupTab />}
      {section === 'vendor-invoices' && has('vendor-invoices') && <VendorInvoicesTab />}
      {section === 'group-charges' && has('group-charges') && <GroupChargesTab />}
      {section === 'categories' && has('categories') && <FinanceCategoriesTab />}
    </div>
  );
}
