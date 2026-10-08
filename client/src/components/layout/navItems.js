import {
  LayoutDashboard,
  Building2,
  Columns3,
  Briefcase,
  Users,
  Send,
  BarChart3,
  CalendarDays,
  Clock,
  Wallet,
  Banknote,
  Network,
  Activity,
  LineChart,
  Handshake,
  Target,
  FileSignature,
  HardHat,
  Settings,
} from 'lucide-react';

/**
 * Sidebar nav items. Each item optionally requires a capability from permissions.js.
 * `groupSuperadminOnly` items are filtered separately in AppLayout (a per-user
 * flag, not a role capability — see permissions.js for why).
 *
 * Hubs (People, Time & Attendance, Finance) each land on a single page with
 * an internal tab strip rather than adding a sidebar entry per sub-resource —
 * keeps the sidebar from growing one row per new ERP module.
 */
export const NAV_ITEMS = [
  // Hidden for admins for now: the admin dashboard's figures are not correct
  // yet. The page and its APIs stay in the codebase (see App.jsx HomePage) —
  // drop `hiddenForAdmin` to bring it back.
  { to: '/', label: 'Dashboard', end: true, icon: LayoutDashboard, hiddenForAdmin: true },
  { to: '/accounts', label: 'Accounts', icon: Building2, capability: 'viewPipeline', masterOnly: true },
  { to: '/pipeline', label: 'Pipeline', icon: Columns3, capability: 'viewPipeline', masterOnly: true },
  { to: '/requirements', label: 'Requirements', icon: Briefcase, capability: 'viewPipeline', masterOnly: true },
  { to: '/profiles', label: 'Profiles', icon: Users, capability: 'viewProfiles', masterOnly: true },
  { to: '/submissions', label: 'Submissions', icon: Send, capability: 'viewPipeline', masterOnly: true },
  // Sales, HR and Management departments only (see lib/departments.js).
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, meetingsCalendar: true },
  { to: '/people', label: 'People', icon: Users, capability: 'viewPeople' },
  { to: '/attendance', label: 'Time & Attendance', icon: Clock, capability: 'viewAttendance' },
  { to: '/finance', label: 'Finance', icon: Wallet, capability: 'viewExpenses' },
  { to: '/payroll', label: 'Payroll', icon: Banknote, capability: 'viewPayroll' },
  { to: '/analytics', label: 'Live Analytics', icon: Activity, capability: 'viewAnalytics', masterOnly: true },
  { to: '/financials', label: 'Financials', icon: LineChart, capability: 'viewFinancials', masterOnly: true },
  { to: '/trading', label: 'Trading', icon: Handshake, capability: 'viewTrading', module: 'trading' },
  { to: '/leads', label: 'Leads', icon: Target, capability: 'viewLeads', module: 'leads' },
  { to: '/contracts', label: 'Contracts', icon: FileSignature, capability: 'viewContracts', module: 'contracts' },
  { to: '/projects', label: 'Self Projects', icon: HardHat, capability: 'viewProjects', module: 'projects' },
  { to: '/reports', label: 'Reports', icon: BarChart3, capability: 'viewReports', masterOnly: true },
  { to: '/group-overview', label: 'Group Overview', icon: Network, groupSuperadminOnly: true },
  { to: '/settings', label: 'Settings', icon: Settings },
];
