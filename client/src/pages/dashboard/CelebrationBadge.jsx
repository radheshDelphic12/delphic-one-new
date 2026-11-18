import { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';

/**
 * The greeting card's corner label on the person's own birthday / work anniversary: "Happy Birthday 💐💐 from Delphic Team".
 * It shows only on that day and only on that person's own dashboard (nothing for anyone else), and both lines show if the two fall on
 * the same day. The team name is the first word of the company the person is working in ("Zephyr Infrastructure" -> "Zephyr Team").
 * Reads the same /orgs/announcements data as the Announcements card, so it needs no server change.
 */
export default function CelebrationBadge({ className = '' }) {
  const { user } = useAuth();
  const [mine, setMine] = useState({ birthday: false, anniversary: false });

  useEffect(() => {
    let live = true;
    apiClient.get('/orgs/announcements', { params: { days: 1 } })
      .then(({ data: body }) => {
        if (!live) return;
        const today = (rows) => (rows || []).some((r) => r.is_me && r.days_away === 0);
        setMine({ birthday: today(body.data?.birthdays), anniversary: today(body.data?.anniversaries) });
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  if (!mine.birthday && !mine.anniversary) return null;
  const team = `${String(user?.active_org?.name || 'Delphic').trim().split(/\s+/)[0]} Team`;
  const lines = [mine.birthday && 'Happy Birthday', mine.anniversary && 'Happy Anniversary'].filter(Boolean);
  return (
    <div className={`space-y-1.5 ${className}`} data-testid="celebration-badge">
      {lines.map((line) => (
        <p key={line} className="inline-block rounded-full border border-pink-100 bg-gradient-to-r from-pink-50 via-white to-amber-50 px-4 py-1.5 text-sm font-semibold text-tertiary-800 shadow-sm">
          {line} 💐💐 <span className="font-medium text-tertiary-500">from {team}</span>
        </p>
      ))}
    </div>
  );
}
