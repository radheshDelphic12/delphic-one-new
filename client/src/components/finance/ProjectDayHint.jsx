import { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';

/**
 * Client / project timesheet: how much of a project's day is already logged
 * ("14 of 16 h logged · 2 h left"), so people on the same project don't conflict
 * or over-log. Capacity = what the project's allocated people can bill that day.
 */
export default function ProjectDayHint({ accountId, date, reloadKey = 0, requested = 0 }) {
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
  if (!day.capped) {
    return <p className="text-xs text-tertiary-500">{day.logged}h already logged on this project today · no daily limit (nobody is allocated yet)</p>;
  }
  const personal = day.my_limit !== null && day.my_limit !== undefined;
  const over = requested > 0 && (requested > day.remaining + 1e-9 || (personal && requested > day.my_remaining + 1e-9));
  return (
    <p className={`text-xs ${over ? 'font-medium text-danger-700' : day.remaining === 0 ? 'text-warning-700' : 'text-tertiary-600'}`}>
      {day.logged}h of {day.capacity}h logged on this project today · {day.remaining}h left
      {personal ? ` · you: ${day.mine}h of your ${day.my_limit}h (${day.my_remaining}h left)` : day.mine > 0 ? ` · you: ${day.mine}h` : ''}
      {over ? ` — ${requested}h is more than you can add` : ''}
      {day.people.some((p) => p.logged > 0) && (
        <span className="ml-1 text-tertiary-400">· {day.people.filter((p) => p.logged > 0).map((p) => `${p.name} ${p.logged}h`).join(', ')}</span>
      )}
    </p>
  );
}
