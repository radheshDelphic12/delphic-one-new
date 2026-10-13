import { Flame, Timer } from 'lucide-react';

/** "1d 4h" / "3h 20m" / "12m" from a minute count. */
export function formatTatRemaining(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m >= 1440) return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
}

/** The "Super Active" / "Expiring soon" tag of a requirement whose TAT is running; nothing otherwise. */
export default function TatTag({ tat, withTime = true }) {
  if (!tat?.tag) return null;
  const hot = tat.state === 'active';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${hot ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}
      title={`TAT ${tat.hours ?? ''}h, ends ${tat.ends_at ? new Date(tat.ends_at).toLocaleString() : ''}`}
    >
      {hot ? <Flame className="h-3 w-3" aria-hidden="true" /> : <Timer className="h-3 w-3" aria-hidden="true" />}
      {tat.tag}
      {withTime && <span className="font-normal opacity-80">· {formatTatRemaining(tat.remaining_minutes)} left</span>}
    </span>
  );
}
