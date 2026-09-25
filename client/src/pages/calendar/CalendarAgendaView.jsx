import { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import EmptyState from '../../components/ui/EmptyState.jsx';
import EventCard from './EventCard.jsx';
import { ymd } from './monthGrid.js';

function dayHeading(value) {
  const d = new Date(value);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (ymd(d) === ymd(today)) return 'Today';
  if (ymd(d) === ymd(tomorrow)) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

/** Day-grouped list with sticky day sub-headers. */
export default function CalendarAgendaView({ events, onOpenDetail, onFeedback, onCancel }) {
  const groups = useMemo(() => {
    const map = new Map();
    for (const ev of [...(events || [])].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))) {
      if (!ev.scheduled_at) continue;
      const key = ymd(ev.scheduled_at);
      if (!map.has(key)) map.set(key, { heading: dayHeading(ev.scheduled_at), rows: [] });
      map.get(key).rows.push(ev);
    }
    return [...map.values()];
  }, [events]);

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No interviews in this range"
        description="Schedule one from a submission’s interview-rounds panel."
      />
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.heading} className="space-y-2">
          <div className="sticky top-0 z-10 -mx-1 bg-canvas/90 px-1 py-1 text-xs font-semibold uppercase tracking-wide text-tertiary-500 backdrop-blur">
            {group.heading}
          </div>
          {group.rows.map((ev) => (
            <EventCard
              key={ev.id}
              event={ev}
              onOpenDetail={onOpenDetail}
              onFeedback={onFeedback}
              onCancel={onCancel}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
