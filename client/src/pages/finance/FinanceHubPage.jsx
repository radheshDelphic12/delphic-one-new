import { useSearchParams } from 'react-router-dom';
import { CalendarRange, FolderKanban, Receipt, SlidersHorizontal, Tags, Truck, Users2 } from 'lucide-react';
import { useAuth } from '../../lib/authContext.jsx';
import ExpensesTab from './ExpensesTab.jsx';
import ProjectsTab from './ProjectsTab.jsx';
import GroupChargesTab from './GroupChargesTab.jsx';
import MonthProjectsTab from './MonthProjectsTab.jsx';
import BillingSetupTab from './BillingSetupTab.jsx';
import VendorInvoicesTab from './VendorInvoicesTab.jsx';
// Project P&L is hidden for now (client brief 2026-10-01: its cost rules —
// partial-month salary on a last working day, actual project cost — are not
// settled). ProjectPnlTab.jsx and its API stay; to bring it back, re-import it
// and add { key: 'project-pnl', label: 'Project P&L', icon: TrendingUp }.
import FinanceCategoriesTab from './FinanceCategoriesTab.jsx';

const BASE_TABS = [{ key: 'expenses', label: 'Expenses', icon: Receipt }];
const ADMIN_TABS = [
  { key: 'projects', label: 'Projects', icon: FolderKanban },
  // Month-wise: running projects -> timesheet -> billing -> invoice -> payment -> financial status, plus the Sales / Salary exports.
  { key: 'month-view', label: 'Month View', icon: CalendarRange },
  // Per-resource billing rates and the client billing status rules (PL / NPL / comp off / FH / SH ...).
  { key: 'billing-setup', label: 'Billing Setup', icon: SlidersHorizontal },
  // Vendor invoices: TDS, adjustment, sent / unsent, paid / unpaid, trace, Excel export.
  { key: 'vendor-invoices', label: 'Vendor Invoices', icon: Truck },
  { key: 'group-charges', label: 'Group Charges', icon: Users2 },
  // Admin-managed Group Charge + Expense categories (next to Group Charges).
  { key: 'categories', label: 'Categories', icon: Tags },
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
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const tabs = isAdmin ? [...BASE_TABS, ...ADMIN_TABS] : BASE_TABS;
  const [params, setParams] = useSearchParams();
  const requested = params.get('section') || 'expenses';
  const section = tabs.some((t) => t.key === requested) ? requested : 'expenses';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-tertiary-200">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={section === key}
            className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${
              section === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500'
            }`}
            onClick={() => setParams({ section: key })}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
      {section === 'expenses' && <ExpensesTab />}
      {section === 'projects' && isAdmin && <ProjectsTab />}
      {section === 'month-view' && isAdmin && <MonthProjectsTab />}
      {section === 'billing-setup' && isAdmin && <BillingSetupTab />}
      {section === 'vendor-invoices' && isAdmin && <VendorInvoicesTab />}
      {section === 'group-charges' && isAdmin && <GroupChargesTab />}
      {section === 'categories' && isAdmin && <FinanceCategoriesTab />}
    </div>
  );
}
