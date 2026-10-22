import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Banknote, CalendarClock, Clock, Users, Wallet } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import LeaveBalancesPanel from '../leave/LeaveBalancesPanel.jsx';
import AnnouncementsCard from './AnnouncementsCard.jsx';
import BenchCard from './BenchCard.jsx';

const QUICK_LINKS = [
  { to: '/people', label: 'People', description: 'Directory, org chart, and HR settings.', icon: Users, tint: 'bg-[#EFF6FF] text-[#2563EB]' },
  { to: '/attendance', label: 'Time & Attendance', description: 'Attendance, leave, and timesheets.', icon: Clock, tint: 'bg-[#ECFDF5] text-[#059669]' },
  { to: '/finance', label: 'Finance', description: 'Expenses, projects, and invoicing.', icon: Wallet, tint: 'bg-[#FFFBEB] text-[#D97706]' },
  { to: '/payroll', label: 'Payroll', description: 'Salary structures, runs, and payslips.', icon: Banknote, tint: 'bg-[#F5F3FF] text-[#7C3AED]' },
];

const TODAY_LABEL = { present: 'Present', absent: 'Absent', half_day: 'Half day', leave: 'On leave', holiday: 'Holiday', wfh: 'Working from home' };
const TODAY_TONE = { present: 'bg-green-50 text-green-700', absent: 'bg-red-50 text-red-700', half_day: 'bg-amber-50 text-amber-700', leave: 'bg-purple-50 text-purple-700', holiday: 'bg-cyan-50 text-cyan-700', wfh: 'bg-blue-50 text-blue-700' };
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

/** Today's attendance of the signed-in person, or null while it is not marked. */
function useTodayStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    const today = new Date().toLocaleDateString('en-CA');
    apiClient.get('/attendance/me', { params: { from: today, to: today } })
      .then(({ data }) => {
        const row = (data.data || []).find((r) => String(r.work_date || r.date).slice(0, 10) === today);
        const day = (data.calendar_days || []).find((d) => d.date === today);
        setStatus(row?.status || day?.kind || null);
      })
      .catch(() => setStatus(null));
  }, []);
  return status;
}

/** The refreshed home for everyone except the group superadmin: a greeting with today's status and quick links. */
function ModernDashboard() {
  const { user } = useAuth();
  const today = useTodayStatus();
  const first = String(user?.name || '').split(' ')[0];
  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-2xl border border-tertiary-100 bg-gradient-to-r from-primary-50 via-white to-white p-6 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">{user?.active_org?.name || 'Dashboard'}</p>
        <h1 className="mt-1 font-heading text-2xl font-semibold text-tertiary-900">{greeting()}{first ? `, ${first}` : ''}</h1>
        <p className="mt-1 text-sm text-tertiary-500">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-tertiary-100 bg-white px-3 py-1.5 text-sm shadow-sm">
            <CalendarClock className="h-4 w-4 text-tertiary-400" />
            <span className="text-tertiary-500">Today</span>
            {today ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TODAY_TONE[today] || 'bg-tertiary-100 text-tertiary-700'}`}>{TODAY_LABEL[today] || today}</span> : <span className="rounded-full bg-tertiary-100 px-2 py-0.5 text-xs font-semibold text-tertiary-600">Not marked yet</span>}
          </div>
          <Link to="/attendance" className="text-sm font-medium text-primary-700 hover:underline">View my attendance</Link>
        </div>
      </div>
      <div>
        <h2 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Quick links</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_LINKS.map(({ to, label, description, icon: Icon, tint }) => (
            <Link key={to} to={to} className="group flex flex-col justify-between rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-cardHover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
              <div>
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tint}`}><Icon className="h-5 w-5" /></span>
                <h3 className="mt-3 font-heading text-sm font-semibold text-tertiary-900">{label}</h3>
                <p className="mt-1 text-xs text-tertiary-500">{description}</p>
              </div>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary-700 group-hover:underline">Open <ArrowRight className="h-3.5 w-3.5" /></span>
            </Link>
          ))}
        </div>
      </div>
      {/* birthdays and work anniversaries of the next 14 days (hidden when there are none) */}
      <AnnouncementsCard />
    </div>
  );
}

/**
 * Landing page for a non-master-workspace company (every org except Delphic
 * Global). The recruitment funnel/KPI panels below this file are Delphic-only
 * (see DashboardPage's is_master_workspace branch) — this shows a welcome
 * panel plus quick links to the shared core-ERP modules every company keeps.
 */
export default function LightweightDashboard({ orgName, isAdmin = false }) {
  const { isGroupSuperadmin } = useAuth();
  if (!isGroupSuperadmin) return <ModernDashboard />;
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
      <AnnouncementsCard />
      {isAdmin && <BenchCard />}
      {isAdmin && <LeaveBalancesPanel compact />}
    </div>
  );
}
