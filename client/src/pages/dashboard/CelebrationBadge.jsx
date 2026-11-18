import { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';

/**
 * The greeting card's corner label on the person's own birthday / work anniversary: a short professional note with the person's first name.
 * It shows only on that day and only on that person's own dashboard (nothing for anyone else), and both lines show if the two fall on
 * the same day.
 * Reads the same /orgs/announcements data as the Announcements card, so it needs no server change.
 */
export default function CelebrationBadge({ className = '' }) {
  const { user } = useAuth();
  const [mine, setMine] = useState({ birthday: false, anniversary: false, birthdayWishes: [], anniversaryWishes: [] });
  const [openKey, setOpenKey] = useState(null);

  useEffect(() => {
    let live = true;
    apiClient.get('/orgs/announcements', { params: { days: 1 } })
      .then(({ data: body }) => {
        if (!live) return;
        const row = (rows) => (rows || []).find((r) => r.is_me && r.days_away === 0);
        const b = row(body.data?.birthdays);
        const a = row(body.data?.anniversaries);
        setMine({ birthday: !!b, anniversary: !!a, birthdayWishes: b?.wishes || [], anniversaryWishes: a?.wishes || [] });
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  if (!mine.birthday && !mine.anniversary) return null;
  const company = String(user?.active_org?.name || 'Delphic').trim();
  const first = String(user?.name || '').trim().split(/\s+/)[0];
  const notes = [
    mine.birthday && {
      key: 'birthday',
      icon: '🎂',
      wishes: mine.birthdayWishes,
      title: `Happy Birthday, ${first || 'friend'}!`,
      body: `Wishing you a wonderful year ahead filled with good health, happiness and success. Thank you for being a valued part of ${company}.`,
    },
    mine.anniversary && {
      key: 'anniversary',
      icon: '🎉',
      wishes: mine.anniversaryWishes,
      title: `Happy Work Anniversary, ${first || 'friend'}!`,
      body: `Thank you for your dedication and contribution. We are proud to have you on the team and look forward to achieving more together.`,
    },
  ].filter(Boolean);
  return (
    <div className={`space-y-2 ${className}`} data-testid="celebration-badge">
      {notes.map((n) => (
        <div key={n.key} className="max-w-sm rounded-xl border border-amber-100 bg-gradient-to-br from-amber-50 via-white to-pink-50 px-4 py-3 text-left shadow-sm">
          <p className="flex items-center gap-2 text-sm font-semibold text-tertiary-900"><span aria-hidden="true" className="text-lg">{n.icon}</span>{n.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-tertiary-600">{n.body}</p>
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 rounded-full border border-primary-200 bg-white px-3 py-1 text-xs font-semibold text-primary-700 transition hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
            onClick={() => setOpenKey(openKey === n.key ? null : n.key)}
            aria-expanded={openKey === n.key}
          >
            {openKey === n.key ? 'Hide comments' : 'View comments'}
          </button>
          {openKey === n.key && (
            <ul className="mt-2 space-y-2 border-t border-amber-100 pt-2">
              {n.wishes.length === 0 && <li className="text-xs text-tertiary-500">No comments yet.</li>}
              {n.wishes.map((w, i) => (
                <li key={`${w.from_name}-${i}`} className="text-xs text-tertiary-700">
                  <span className="font-semibold text-tertiary-900">{w.from_name}</span>
                  {w.message && <span className="block text-tertiary-600">{w.message}</span>}
                  {w.gif_url && <img src={w.gif_url} alt="" className="mt-1 max-h-24 rounded-md" loading="lazy" />}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs font-medium text-tertiary-500">- Warm regards, Team {company}</p>
        </div>
      ))}
    </div>
  );
}
