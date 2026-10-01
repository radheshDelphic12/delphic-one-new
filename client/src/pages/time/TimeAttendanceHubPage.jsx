import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlarmClockPlus, CalendarCheck, CalendarClock, CalendarDays, ClipboardCheck, ListChecks, Radar, Timer } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import AttendancePage from '../attendance/AttendancePage.jsx';
import LeavePage from '../leave/LeavePage.jsx';
import TimesheetsPage from './TimesheetsPage.jsx';
import ItTimesheetPage from './ItTimesheetPage.jsx';
import ItTimesheetAdminView from './ItTimesheetAdminView.jsx';
import TeamMonitoringTab from './TeamMonitoringTab.jsx';
import ApprovalsTab from './ApprovalsTab.jsx';
import MyHolidaysTab from './MyHolidaysTab.jsx';
import OvertimeTicketsTab from './OvertimeTicketsTab.jsx';

const BASE_TABS = [
  { key: 'attendance', label: 'Attendance', icon: CalendarClock },
  { key: 'leave', label: 'Leave', icon: CalendarCheck },
  // Everyone's own holiday calendar(s): standard + per-project (client) calendars.
  { key: 'holidays', label: 'Holiday Calendar', icon: CalendarDays },
  // Overtime is a ticket the manager approves (people paid from attendance); managers and admins decide them here.
  { key: 'overtime', label: 'OT Tickets', icon: AlarmClockPlus },
];
// The ordinary popup-logging timesheet — for everyone EXCEPT IT-department
// staff, who use the multi-row grid below exclusively (no popup at all).
// Admins keep it as their own self-service, separate from Team Monitoring.
const TIMESHEETS_TAB = { key: 'timesheets', label: 'Timesheets', icon: Timer };
// IT staff fill their itemized daily log here (ItTimesheetPage); admins get
// the same tab as a records/management view of the whole IT department
// (ItTimesheetAdminView) — they never log into it themselves.
const IT_TAB = { key: 'it-timesheet', label: 'IT Timesheet', icon: ListChecks };
// Admin/Superadmin monitoring & task-assignment hub — see TeamMonitoringTab.
const MONITORING_TAB = { key: 'monitoring', label: 'Team Monitoring', icon: Radar };
// Reporting managers approve their direct reports' timesheets here (admins do it in Team Monitoring).
const APPROVALS_TAB = { key: 'approvals', label: 'Approvals', icon: ClipboardCheck };

/** Time & Attendance hub: Attendance + Leave + Timesheets (+ IT Timesheet — logging for IT staff, records view for admins — + Team Monitoring for admins) under one sidebar entry. */
export default function TimeAttendanceHubPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isItDept = user?.department?.name?.toLowerCase() === 'it';
  const isIt = isAdmin || isItDept;
  const [isApprover, setIsApprover] = useState(false);
  useEffect(() => {
    apiClient.get('/timesheets/approvals/scope').then(({ data }) => setIsApprover(Boolean(data.data?.is_approver))).catch(() => setIsApprover(false));
  }, []);
  // A pure IT employee (not admin) never sees the ordinary popup-based tab —
  // the multi-row grid is their only logging surface.
  const TABS = [
    ...BASE_TABS,
    ...(!isItDept || isAdmin ? [TIMESHEETS_TAB] : []),
    ...(isIt ? [IT_TAB] : []),
    ...(isApprover && !isAdmin ? [APPROVALS_TAB] : []),
    ...(isAdmin ? [MONITORING_TAB] : []),
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
      {section === 'holidays' && <MyHolidaysTab />}
      {section === 'overtime' && <OvertimeTicketsTab isAdmin={isAdmin} />}
      {section === 'timesheets' && (
        <div className="space-y-8">
          <TimesheetsPage />
          {/* Admins also get the records view of everyone outside IT — the
              people who log through this tab (IT has its own IT Timesheet tab). */}
          {isAdmin && (
            <section className="space-y-3 border-t border-tertiary-100 pt-6">
              <h2 className="font-heading text-base font-semibold text-tertiary-900">Team timesheets (non-IT)</h2>
              <ItTimesheetAdminView key="non-it" scope="non_it" />
            </section>
          )}
        </div>
      )}
      {section === 'it-timesheet' && isIt && (isAdmin ? <ItTimesheetAdminView /> : <ItTimesheetPage />)}
      {section === 'approvals' && isApprover && <ApprovalsTab />}
      {section === 'monitoring' && isAdmin && <TeamMonitoringTab />}
    </div>
  );
}
