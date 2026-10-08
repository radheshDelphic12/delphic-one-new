import { CalendarOff } from 'lucide-react';

/**
 * Shown when the chosen date is an approved leave day (full day: logging is
 * disabled) or an approved half-day leave (only `work_capacity` hours can be
 * logged) - see useLeaveDay.
 */
export default function LeaveDayNotice({ leave, what = 'attendance, timesheet and project hours' }) {
  if (!leave?.is_leave_day && !leave?.is_half_day_leave) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-warning-200 bg-warning-50 px-3 py-2.5 text-sm text-warning-700">
      <CalendarOff className="mt-0.5 h-4 w-4 shrink-0" />
      {leave.is_half_day_leave ? (
        <p>
          You&apos;re on approved <b>{leave.leave_type}</b> half-day leave on this date - at most <b>{leave.work_capacity}h</b> can be logged for work (leave + work cannot exceed the day).
        </p>
      ) : (
        <p>
          You&apos;re on approved <b>{leave.leave_type}</b> leave on this date - {what} are disabled for leave days.
        </p>
      )}
    </div>
  );
}
