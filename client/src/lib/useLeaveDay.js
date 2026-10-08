import { useEffect, useState } from 'react';
import apiClient from './apiClient.js';

const NOT_LEAVE = { is_leave_day: false, is_half_day_leave: false, work_capacity: null, leave_type: null };

/**
 * Whether the signed-in employee has approved leave on `date` (YYYY-MM-DD):
 * a full day (`is_leave_day`) or a half day (`is_half_day_leave`, with the
 * hours still free for work in `work_capacity`) — the same rule the server enforces on attendance and
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
