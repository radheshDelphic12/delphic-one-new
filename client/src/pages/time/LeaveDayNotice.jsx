import { CalendarOff } from 'lucide-react';

/**
 * Shown when the chosen date is an approved leave day (full or half). Project time can still be logged (a client may be billed for the
 * day); it goes for approval as usual and pay is not affected - see useLeaveDay. Attendance stays leave on those days.
 */
export default function LeaveDayNotice({ leave }) {
  if (!leave?.is_leave_day && !leave?.is_half_day_leave) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-warning-200 bg-warning-50 px-3 py-2.5 text-sm text-warning-700" data-testid="leave-day-notice">
      <CalendarOff className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        You&apos;re on approved <b>{leave.leave_type}</b> {leave.is_half_day_leave ? 'half-day ' : ''}leave on this date. You can still log project time for it (for example when the client is billed for the day); it goes for approval as usual and your leave and pay are not changed.
      </p>
    </div>
  );
}
