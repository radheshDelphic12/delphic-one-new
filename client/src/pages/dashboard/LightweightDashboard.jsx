import { Link } from 'react-router-dom';
import { ArrowRight, Banknote, Clock, Users, Wallet } from 'lucide-react';
import LeaveBalancesPanel from '../leave/LeaveBalancesPanel.jsx';

const QUICK_LINKS = [
  { to: '/people', label: 'People', description: 'Directory, org chart, and HR settings.', icon: Users },
  { to: '/attendance', label: 'Time & Attendance', description: 'Attendance, leave, and timesheets.', icon: Clock },
  { to: '/finance', label: 'Finance', description: 'Expenses, projects, and invoicing.', icon: Wallet },
  { to: '/payroll', label: 'Payroll', description: 'Salary structures, runs, and payslips.', icon: Banknote },
];

/**
 * Landing page for a non-master-workspace company (every org except Delphic
 * Global). The recruitment funnel/KPI panels below this file are Delphic-only
 * (see DashboardPage's is_master_workspace branch) — this shows a welcome
 * panel plus quick links to the shared core-ERP modules every company keeps.
 */
export default function LightweightDashboard({ orgName, isAdmin = false }) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-tertiary-100 bg-white px-6 py-8 shadow-card">
        <h1 className="font-heading text-xl font-semibold text-tertiary-900">Welcome{orgName ? `, ${orgName}` : ''}</h1>
        <p className="mt-1 max-w-xl text-sm text-tertiary-500">
          Pick up where you left off in People, Attendance, Finance, or Payroll, or use the sidebar for anything this
          workspace has enabled.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK_LINKS.map(({ to, label, description, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="group flex flex-col justify-between rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card transition-shadow hover:shadow-cardHover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          >
            <div>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                <Icon className="h-4.5 w-4.5" />
              </span>
              <h2 className="mt-3 font-heading text-sm font-semibold text-tertiary-900">{label}</h2>
              <p className="mt-1 text-xs text-tertiary-500">{description}</p>
            </div>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary-700 group-hover:underline">
              Open <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        ))}
      </div>
      {isAdmin && <LeaveBalancesPanel compact />}
    </div>
  );
}
