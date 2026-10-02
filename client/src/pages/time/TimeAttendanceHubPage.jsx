import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlarmClockPlus, CalendarCheck, CalendarClock, CalendarDays, ClipboardCheck, LayoutDashboard, Lock, Users } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import AttendancePage from '../attendance/AttendancePage.jsx';
import LeavePage from '../leave/LeavePage.jsx';
import ApprovalsTab from './ApprovalsTab.jsx';
import MyHolidaysTab from './MyHolidaysTab.jsx';
import OvertimeTicketsTab from './OvertimeTicketsTab.jsx';
import TimesheetDashboard from './TimesheetDashboard.jsx';
import ProjectTeamTimesheet from './ProjectTeamTimesheet.jsx';
import TimesheetLocksTab from './TimesheetLocksTab.jsx';

const BASE_TABS = [
  { key: 'attendance', label: 'Attendance', icon: CalendarClock },
  { key: 'leave', label: 'Leave', icon: CalendarCheck },
  // Month view of every timesheet you may open, as a calendar (hours, attendance, leave, lock, approval per day).
  { key: 'dashboard', label: 'Timesheet Dashboard', icon: LayoutDashboard },
  // Hours logged by everyone on a project you are assigned to (visibility only, no cap).
  { key: 'project-team', label: 'Project Team', icon: Users },
  // Everyone's own holiday calendar(s): standard + per-project (client) calendars.
  { key: 'holidays', label: 'Holiday Calendar', icon: CalendarDays },
  // Overtime is a ticket the manager approves (people paid from attendance); managers and admins decide them here.
  { key: 'overtime', label: 'OT Tickets', icon: AlarmClockPlus },
];
// Admin: approval chain settings, per-employee month timesheet locks (bulk) and the lock audit trail.
const LOCKS_TAB = { key: 'locks', label: 'Timesheet Locks', icon: Lock };
// Reporting managers approve their direct reports' timesheets here (admins do it in Team Monitoring).
const APPROVALS_TAB = { key: 'approvals', label: 'Approvals', icon: ClipboardCheck };

/** Time & Attendance hub: Attendance + Leave + Timesheets (+ IT Timesheet — logging for IT staff, records view for admins — + Team Monitoring for admins) under one sidebar entry. */
export default function TimeAttendanceHubPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [isApprover, setIsApprover] = useState(false);
  useEffect(() => {
    apiClient.get('/timesheets/approvals/scope').then(({ data }) => setIsApprover(Boolean(data.data?.is_approver))).catch(() => setIsApprover(false));
  }, []);
  const TABS = [
    ...BASE_TABS,
    ...(isApprover && !isAdmin ? [APPROVALS_TAB] : []),
    ...(isAdmin ? [LOCKS_TAB] : []),
  ];
  const [params, setParams] = useSearchParams();
  const requested = params.get('section') || 'attendance';
  const section = TABS.some((t) => t.key === requested) ? requested : 'attendance';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-tertiary-200">
        {TABS.map(({ key, label, icon: Icon }) => (
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
      {section === 'attendance' && <AttendancePage />}
      {section === 'leave' && <LeavePage />}
      {section === 'dashboard' && <TimesheetDashboard />}
      {section === 'project-team' && <ProjectTeamTimesheet />}
      {section === 'holidays' && <MyHolidaysTab />}
      {section === 'overtime' && <OvertimeTicketsTab isAdmin={isAdmin} />}
      {section === 'approvals' && isApprover && <ApprovalsTab />}
      {section === 'locks' && isAdmin && <TimesheetLocksTab />}
    </div>
  );
}
