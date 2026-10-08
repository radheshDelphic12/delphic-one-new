import { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';

/**
 * Project timesheet: what the team has already logged on a project today, for visibility only.
 * There is no daily or project-level hour limit - log the hours actually worked.
 */
export default function ProjectDayHint({ accountId, date, reloadKey = 0 }) {
  const [day, setDay] = useState(null);

  useEffect(() => {
    if (!accountId || !date) { setDay(null); return undefined; }
    let alive = true;
    apiClient.get('/timesheets/project-day', { params: { account_id: accountId, date } })
      .then(({ data }) => { if (alive) setDay(data.data); })
      .catch(() => { if (alive) setDay(null); });
    return () => { alive = false; };
  }, [accountId, date, reloadKey]);

  if (!day) return null;
  const who = day.people.filter((p) => p.logged > 0);
  return (
    <p className="text-xs text-tertiary-600">
      {day.logged}h logged on this project today{day.mine > 0 ? ` · you: ${day.mine}h` : ''}
      {who.length > 0 && <span className="ml-1 text-tertiary-400">· {who.map((p) => `${p.name} ${p.logged}h`).join(', ')}</span>}
    </p>
  );
}
