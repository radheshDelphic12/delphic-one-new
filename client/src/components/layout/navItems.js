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
  Globe,
  MapPin,
  UserPlus,
  UserX,
  ClipboardList,
  KanbanSquare,
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
  { to: '/', label: 'Dashboard', end: true, icon: LayoutDashboard, hiddenForAdmin: true, need: 'basic.home' },
  { to: '/accounts', label: 'Accounts', icon: Building2, capability: 'viewPipeline', need: 'accounts.view', masterOnly: true },
  { to: '/pipeline', label: 'Pipeline', icon: Columns3, capability: 'viewPipeline', need: 'pipeline.view', masterOnly: true },
  { to: '/requirements', label: 'Requirements', icon: Briefcase, capability: 'viewPipeline', need: 'requirements.view', masterOnly: true },
  { to: '/hiring-setup', label: 'Hiring Setup', icon: ClipboardList, capability: 'viewPipeline', need: 'requirements.update', masterOnly: true },
  { to: '/profiles', label: 'Profiles', icon: Users, capability: 'viewProfiles', need: 'profiles.view', masterOnly: true },
  { to: '/submissions', label: 'Submissions', icon: Send, capability: 'viewPipeline', need: 'submissions.view', masterOnly: true },
  { to: '/rejected-candidates', label: 'Rejected', icon: UserX, capability: 'viewPipeline', need: 'rejected.view', masterOnly: true },
  // Sales, HR and Management departments only (see lib/departments.js).
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, meetingsCalendar: true, need: 'basic.calendar' },
  { to: '/offices', label: 'Offices', icon: MapPin, capability: 'viewPeople', groupSuperadminOnly: true },
  { to: '/internal-jobs', label: 'Internal Jobs', icon: UserPlus, masterOnly: true, need: 'basic.internal_jobs' },
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
  // Project Management (Delphic Global): projects with their own tickets; every member sees the projects they belong to.
  { to: '/pm', label: 'Project Management', icon: KanbanSquare, masterOnly: true },
  { to: '/reports', label: 'Reports', icon: BarChart3, capability: 'viewReports', masterOnly: true },
  { to: '/website', label: 'Website', icon: Globe, capability: 'manageWebsite', need: ['website.view', 'website.update'], masterOnly: true },
  { to: '/group-overview', label: 'Group Overview', icon: Network, groupSuperadminOnly: true },
  { to: '/settings', label: 'Settings', icon: Settings, need: 'basic.settings' },
];
