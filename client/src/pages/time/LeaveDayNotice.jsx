import { CalendarOff } from 'lucide-react';

/** Shown when the chosen date is an approved leave day — see useLeaveDay. */
export default function LeaveDayNotice({ leave, what = 'attendance, timesheet and project hours' }) {
  if (!leave?.is_leave_day) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-warning-200 bg-warning-50 px-3 py-2.5 text-sm text-warning-700">
      <CalendarOff className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        You&apos;re on approved <b>{leave.leave_type}</b> leave on this date — {what} are disabled for leave days.
      </p>
    </div>
  );
}
