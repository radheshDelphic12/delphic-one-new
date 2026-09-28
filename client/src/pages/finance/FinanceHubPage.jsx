import { useSearchParams } from 'react-router-dom';
import { FolderKanban, Receipt, TrendingUp, Users2 } from 'lucide-react';
import { useAuth } from '../../lib/authContext.jsx';
import ExpensesTab from './ExpensesTab.jsx';
import ProjectsTab from './ProjectsTab.jsx';
import GroupChargesTab from './GroupChargesTab.jsx';
import ProjectPnlTab from './ProjectPnlTab.jsx';

const BASE_TABS = [{ key: 'expenses', label: 'Expenses', icon: Receipt }];
const ADMIN_TABS = [
  { key: 'projects', label: 'Projects', icon: FolderKanban },
  // Monthly profit per project: billing - internal salary - vendor contractors.
  { key: 'project-pnl', label: 'Project P&L', icon: TrendingUp },
  { key: 'group-charges', label: 'Group Charges', icon: Users2 },
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
      {section === 'project-pnl' && isAdmin && <ProjectPnlTab />}
      {section === 'group-charges' && isAdmin && <GroupChargesTab />}
    </div>
  );
}
