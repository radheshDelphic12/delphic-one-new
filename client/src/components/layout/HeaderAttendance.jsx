import { CheckCircle2, LogIn, LogOut } from 'lucide-react';
import { useTodayAttendance } from '../../lib/useTodayAttendance.js';
import CheckoutPrompt from '../../pages/attendance/CheckoutPrompt.jsx';

function formatTime(value) {
  return value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
}

/** Today's check-in / check-out, always visible in the app header. */
export default function HeaderAttendance({ user }) {
  const { today, leaveToday, busy, checkIn, requestCheckOut, confirmCheckOut, promptOpen, closePrompt } = useTodayAttendance(user);

  let content;
  if (leaveToday.is_leave_day) {
    content = <span className="px-2 text-sm text-tertiary-500">On leave today</span>;
  } else if (!today?.check_in_at) {
    content = (
      <button type="button" className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm" onClick={checkIn} disabled={busy}>
        <LogIn className="h-4 w-4" aria-hidden="true" /> Check in
      </button>
    );
  } else if (!today.check_out_at) {
    content = (
      <>
        <span className="hidden px-1 text-sm text-tertiary-500 sm:inline">In since {formatTime(today.check_in_at)}</span>
        <button type="button" className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm" onClick={requestCheckOut} disabled={busy}>
          <LogOut className="h-4 w-4" aria-hidden="true" /> Check out
        </button>
      </>
    );
  } else {
    content = (
      <span className="inline-flex items-center gap-1.5 px-2 text-sm text-tertiary-600" title="Today's attendance is complete">
        <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />
        <span className="hidden sm:inline">Done {formatTime(today.check_in_at)}–{formatTime(today.check_out_at)}</span>
      </span>
    );
  }

  return (
    <>
      <div className="flex items-center gap-1.5">{content}</div>
      <CheckoutPrompt open={promptOpen} onClose={closePrompt} onConfirm={confirmCheckOut} />
    </>
  );
}
