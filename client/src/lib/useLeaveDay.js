import { useEffect, useState } from 'react';
import apiClient from './apiClient.js';

const NOT_LEAVE = { is_leave_day: false, leave_type: null };

/**
 * Whether the signed-in employee has an approved full-day leave on `date`
 * (YYYY-MM-DD) — the same rule the server enforces on attendance and
 * timesheet writes, so the UI can disable those controls up front.
 */
export function useLeaveDay(date) {
  const [state, setState] = useState(NOT_LEAVE);

  useEffect(() => {
    if (!date) return undefined;
    let alive = true;
    apiClient
      .get('/leave/day-status', { params: { date } })
      .then(({ data }) => { if (alive) setState(data.data || NOT_LEAVE); })
      .catch(() => { if (alive) setState(NOT_LEAVE); });
    return () => { alive = false; };
  }, [date]);

  return state;
}
