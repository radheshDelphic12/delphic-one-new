import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlarmClockPlus, CalendarCheck, CalendarClock, CalendarDays, ClipboardCheck, ClipboardList, CalendarRange, ListChecks, UserCheck, Lock, Users, FileClock } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import AttendancePage from '../attendance/AttendancePage.jsx';
import LeavePage from '../leave/LeavePage.jsx';
import ApprovalsTab from './ApprovalsTab.jsx';
import AttendanceDashboard from './AttendanceDashboard.jsx';
import ItTimesheetAdminView from './ItTimesheetAdminView.jsx';
import ItTimesheetPage from './ItTimesheetPage.jsx';
import MyHolidaysTab from './MyHolidaysTab.jsx';
import OvertimeTicketsTab from './OvertimeTicketsTab.jsx';
// Hidden on request – may be re-enabled later (see the 'dashboard' tab below).
// import TimesheetDashboard from './TimesheetDashboard.jsx';
import ProjectCalendarDashboard from './ProjectCalendarDashboard.jsx';
import ProjectTeamTimesheet from './ProjectTeamTimesheet.jsx';
import TimesheetLocksTab from './TimesheetLocksTab.jsx';
import RegularizationAdminTab from './RegularizationAdminTab.jsx';

const BASE_TABS = [
  { key: 'attendance', label: 'Attendance', icon: CalendarClock },
  { key: 'leave', label: 'Leave', icon: CalendarCheck },
  // Hidden on request – may be re-enabled later. Month view of every timesheet you may open, as a calendar (hours, attendance, leave, lock, approval per day).
  // { key: 'dashboard', label: 'Timesheet Dashboard', icon: LayoutDashboard },
  // Attendance only (no project hours): status, reporting office and office / home per day, plus leave balance.
  { key: 'attendance-dashboard', label: 'Attendance Dashboard', icon: UserCheck },
  // Every project as a month calendar: hours, tasks, leave, holidays.
  { key: 'project-calendar', label: 'Project Calendar', icon: CalendarRange },
  // Hours logged by everyone on a project you are assigned to (visibility only, no cap).
  { key: 'project-team', label: 'Project Team', icon: Users },
  // Everyone's own holiday calendar(s): standard + per-project (client) calendars.
  { key: 'holidays', label: 'Holiday Calendar', icon: CalendarDays },
  // Overtime is a ticket the manager approves (people paid from attendance); managers and admins decide them here.
  { key: 'overtime', label: 'OT Tickets', icon: AlarmClockPlus },
];
// IT staff log client project hours here. Non-IT logging is hidden until that flow is switched on.
const LOG_TAB = { key: 'log', label: 'Log time', icon: ListChecks };
// Admin: the client project timesheet (IT and contractors).
const PROJECT_TIMESHEETS_TAB = { key: 'project-timesheets', label: 'Project Timesheets', icon: ClipboardList };
// Admin: approval chain settings, per-employee month timesheet locks (bulk) and the lock audit trail.
const LOCKS_TAB = { key: 'locks', label: 'Attendance Locks', icon: Lock };
// Admin: every employee's attendance and project-timesheet correction requests, to approve or reject.
const REGULARIZATION_TAB = { key: 'regularization', label: 'Regularization', icon: FileClock };
// Reporting managers approve their direct reports' timesheets here. An admin gives the final approval on Project Timesheets.
const APPROVALS_TAB = { key: 'approvals', label: 'Approvals', icon: ClipboardCheck };

/** Time & Attendance hub: Attendance + Leave + Timesheets (+ IT Timesheet — logging for IT staff, records view for admins — + Team Monitoring for admins) under one sidebar entry. */
export default function TimeAttendanceHubPage() {
  const { user, isGroupSuperadmin } = useAuth();
  const isAdmin = user?.role === 'admin';
  // everyone except the group superadmin gets the refreshed look; the superadmin keeps the original one
  const modern = !isGroupSuperadmin;
  const isIt = user?.department?.name?.toLowerCase() === 'it';
  const [isApprover, setIsApprover] = useState(false);
  useEffect(() => {
    apiClient.get('/timesheets/approvals/scope').then(({ data }) => setIsApprover(Boolean(data.data?.is_approver))).catch(() => setIsApprover(false));
  }, []);
  const TABS = [
    ...BASE_TABS.slice(0, 2),
    ...(isIt ? [LOG_TAB] : []),
    ...BASE_TABS.slice(2),
    ...(isApprover && !isAdmin ? [APPROVALS_TAB] : []),
    ...(isAdmin ? [PROJECT_TIMESHEETS_TAB, LOCKS_TAB, REGULARIZATION_TAB] : []),
  ];
  const [params, setParams] = useSearchParams();
  const requested = params.get('section') || 'attendance';
  const section = TABS.some((t) => t.key === requested) ? requested : 'attendance';

  return (
    <div className={`space-y-4 ${modern ? 'ta-modern' : ''}`}>
      <div className={modern ? 'flex flex-wrap gap-1 rounded-2xl border border-tertiary-100 bg-white p-1.5 shadow-card' : 'flex flex-wrap gap-1 border-b border-tertiary-200'}>
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={section === key}
            className={modern
              ? `inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${section === key ? 'bg-primary-50 text-primary-700 shadow-sm ring-1 ring-primary-100' : 'text-tertiary-500 hover:bg-tertiary-50 hover:text-tertiary-800'}`
              : `inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${section === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500'}`}
            onClick={() => setParams({ section: key })}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
      {section === 'attendance' && <AttendancePage />}
      {section === 'leave' && <LeavePage />}
      {section === 'log' && isIt && (
        <div className="space-y-3">
          <p className="rounded-xl bg-primary-50 px-3 py-2 text-xs text-primary-800">Log hours against a project you are assigned to. These hours are for client billing. Your salary still comes from attendance.</p>
          <ItTimesheetPage />
        </div>
      )}
      {section === 'project-timesheets' && isAdmin && <ItTimesheetAdminView scope="it" />}
      {/* Hidden on request – may be re-enabled later. ?section=dashboard falls back to the default tab because the tab is not in TABS. */}
      {/* {section === 'dashboard' && <TimesheetDashboard />} */}
      {section === 'attendance-dashboard' && <AttendanceDashboard />}
      {section === 'project-calendar' && <ProjectCalendarDashboard />}
      {section === 'project-team' && <ProjectTeamTimesheet />}
      {section === 'holidays' && <MyHolidaysTab />}
      {section === 'overtime' && <OvertimeTicketsTab isAdmin={isAdmin} />}
      {section === 'approvals' && isApprover && <ApprovalsTab />}
      {section === 'locks' && isAdmin && <TimesheetLocksTab />}
      {section === 'regularization' && isAdmin && <RegularizationAdminTab />}
    </div>
  );
}
