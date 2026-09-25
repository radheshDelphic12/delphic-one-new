import { CalendarX, RefreshCw } from 'lucide-react';
import { eventAppearance, eventPrimaryLabel, isClientMeeting } from '../../lib/interviewRounds.js';
import { formatTime } from './monthGrid.js';
import EventHoverCard from './EventHoverCard.jsx';
import useDelayedHoverCard from './useDelayedHoverCard.js';

/**
 * Compact month-grid event pill. Status color fill + left accent bar;
 * cancelled / rescheduled are muted with strikethrough.
 */
export default function EventPill({ event, onClick, onFeedback }) {
  const look = eventAppearance(event);
  const { anchorRef, anchorRect, openSoon, closeSoon, closeNow, keepOpen } = useDelayedHoverCard();

  const timeLabel = formatTime(event.scheduled_at);
  const nameLabel = eventPrimaryLabel(event);
  const meeting = isClientMeeting(event);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => {
          closeNow();
          onClick();
        }}
        onMouseEnter={openSoon}
        onMouseLeave={closeSoon}
        onFocus={openSoon}
        onBlur={closeNow}
        title={`${timeLabel} · ${nameLabel}`}
        className={`group flex w-full items-stretch overflow-hidden rounded-md border text-left shadow-soft transition hover:-translate-y-px hover:shadow-card ${look.pill}`}
      >
        <span className={`w-1 shrink-0 self-stretch ${look.pillBar}`} aria-hidden="true" />
        <span className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1">
          {look.key === 'cancelled' && <CalendarX className="h-3 w-3 shrink-0 opacity-70" />}
          {look.key === 'rescheduled' && <RefreshCw className="h-3 w-3 shrink-0 opacity-70" />}
          <span
            className={`shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide ${
              meeting
                ? `${look.pillBar} bg-opacity-20 text-tertiary-800`
                : (event.audience || 'internal') === 'external'
                  ? 'bg-violet-500/20 text-violet-800'
                  : 'bg-sky-500/20 text-sky-800'
            }`}
          >
            {meeting ? 'Mtg' : (event.audience || 'internal') === 'external' ? 'Ext' : 'Int'}
          </span>
          <span className={`shrink-0 text-[10px] font-semibold tabular-nums tracking-tight ${look.isStruck ? 'line-through opacity-70' : ''}`}>
            {timeLabel}
          </span>
          <span className={`min-w-0 truncate text-[11px] font-medium leading-tight ${look.isStruck ? 'line-through opacity-70' : ''}`}>
            {nameLabel}
          </span>
        </span>
      </button>

      {anchorRect && (
        <EventHoverCard
          event={event}
          anchorRect={anchorRect}
          onMouseEnter={keepOpen}
          onMouseLeave={closeSoon}
          onOpenDetail={() => {
            closeNow();
            onClick();
          }}
          onFeedback={(ev) => {
            closeNow();
            onFeedback?.(ev);
          }}
        />
      )}
    </>
  );
}
