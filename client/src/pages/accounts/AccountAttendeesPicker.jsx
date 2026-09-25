import { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';

/**
 * Checkbox list of every active user, for picking who's attending (or attended)
 * an account meeting. Deliberately not role-restricted — the attendee list can
 * be anyone (sales, BDA, recruiter, admin), not just sales, so the "meetings
 * attended" reports can reflect who actually showed up.
 *
 * Args:
 *   open: Only fetches the roster while the parent drawer is open.
 *   value: Selected user ids (array).
 *   onChange: Called with the next selected id array.
 *   label: Field label (default "Attendees").
 */
export default function AccountAttendeesPicker({ open, value, onChange, label = 'Attendees' }) {
  const [people, setPeople] = useState([]);

  useEffect(() => {
    if (!open) return;
    apiClient
      .get('/users/directory', { params: { active: 'true' } })
      .then(({ data }) => setPeople(data.data || []))
      .catch(() => setPeople([]));
  }, [open]);

  function toggle(userId) {
    onChange(value.includes(userId) ? value.filter((id) => id !== userId) : [...value, userId]);
  }

  return (
    <div className="block text-xs font-medium text-tertiary-600">
      {label}
      <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border border-tertiary-200 p-2">
        {people.length === 0 && <p className="text-xs text-tertiary-400">No users found.</p>}
        {people.map((person) => (
          <label key={person.id} className="flex items-center gap-2 text-sm font-normal text-tertiary-700">
            <input type="checkbox" checked={value.includes(person.id)} onChange={() => toggle(person.id)} />
            {person.name}
            <span className="text-xs capitalize text-tertiary-400">· {person.role}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
