import { useCallback, useEffect, useState } from 'react';
import apiClient from './apiClient.js';
import { useAlerts } from './alerts/alertContext.jsx';
import { apiErrorMessage } from './alerts/apiErrorMessage.js';
import { useLeaveDay } from './useLeaveDay.js';

// Fired after a check-in/out so every mounted copy (header + Attendance page)
// shows the same state. detail = the updated attendance record.
export const ATTENDANCE_CHANGED = 'attendance:changed';

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Today's attendance for the signed-in member, plus check-in/out actions.
 *
 * Args:
 *   user: Auth user; IT staff get a "log your timesheet first" prompt on check-out.
 *   enabled: false skips loading (e.g. no org membership, so the API would 403).
 *
 * Returns:
 *   { today, leaveToday, busy, checkIn, requestCheckOut, confirmCheckOut, promptOpen, closePrompt }
 */
export function useTodayAttendance(user, enabled = true) {
  const { pushError } = useAlerts();
  const [today, setToday] = useState(null);
  const [busy, setBusy] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [date] = useState(() => isoDate(new Date()));
  // Approved leave = no check-in/out (the server enforces the same rule).
  const leaveToday = useLeaveDay(enabled ? date : null);
  const isIt = user?.department?.name?.toLowerCase() === 'it';

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    apiClient
      .get('/attendance/me', { params: { from: date, to: date, limit: 1 } })
      .then(({ data }) => { if (alive) setToday(data.data?.[0] || null); })
      .catch(() => { if (alive) setToday(null); });
    const onChanged = (event) => setToday(event.detail);
    window.addEventListener(ATTENDANCE_CHANGED, onChanged);
    return () => {
      alive = false;
      window.removeEventListener(ATTENDANCE_CHANGED, onChanged);
    };
  }, [enabled, date]);

  const act = useCallback(async (action) => {
    setBusy(true);
    try {
      const { data } = await apiClient.post(`/attendance/${action}`);
      window.dispatchEvent(new CustomEvent(ATTENDANCE_CHANGED, { detail: data.data }));
    } catch (err) {
      pushError(apiErrorMessage(err, `Failed to check ${action === 'check-in' ? 'in' : 'out'}`), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, [pushError]);

  return {
    today,
    leaveToday,
    busy,
    checkIn: () => act('check-in'),
    // IT staff are reminded to log their timesheet before checking out.
    requestCheckOut: () => (isIt ? setPromptOpen(true) : act('check-out')),
    confirmCheckOut: () => {
      setPromptOpen(false);
      act('check-out');
    },
    promptOpen,
    closePrompt: () => setPromptOpen(false),
  };
}
