import { useEffect, useMemo, useRef } from 'react';
import { CalendarX, RefreshCw } from 'lucide-react';
import { eventAppearance, eventPrimaryLabel, eventTypeLabel } from '../../lib/interviewRounds.js';
import EventHoverCard from './EventHoverCard.jsx';
import useDelayedHoverCard from './useDelayedHoverCard.js';
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  HOUR_HEIGHT,
  formatTime,
  groupEventsByDay,
  hourLabels,
  layoutDayEvents,
  minutesFromGridStart,
  ymd,
} from './monthGrid.js';

const GRID_HOURS = DAY_END_HOUR - DAY_START_HOUR;
const GRID_HEIGHT = GRID_HOURS * HOUR_HEIGHT;
/** Visual gap between stacked / side-by-side time blocks. */
const BLOCK_GAP_Y = 2;
const BLOCK_GAP_X = 3;
/** Below this, show one compact line instead of name + meta. */
const COMPACT_HEIGHT = 34;

function NowLine({ dayDate }) {
  const now = new Date();
  if (ymd(now) !== ymd(dayDate)) return null;
  const mins = minutesFromGridStart(now);
  if (mins < 0 || mins > GRID_HOURS * 60) return null;
  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-20 flex items-center"
      style={{ top: (mins / 60) * HOUR_HEIGHT }}
    >
      <span className="h-2.5 w-2.5 shrink-0 -translate-x-1 rounded-full bg-danger-500" />
      <span className="h-[2px] w-full bg-danger-500" />
    </div>
  );
}

function TimeBlock({ event, col, colCount, onSelect, onFeedback }) {
  const look = eventAppearance(event);
  const typeLabel = eventTypeLabel(event);
  const { anchorRef, anchorRect, openSoon, closeSoon, closeNow, keepOpen } = useDelayedHoverCard();
  const mins = minutesFromGridStart(event.scheduled_at);
  const duration = Math.max(event.duration_minutes || 30, 15);
  const top = Math.max(0, (mins / 60) * HOUR_HEIGHT);
  const height = Math.max(Math.min((duration / 60) * HOUR_HEIGHT, GRID_HEIGHT - top) - BLOCK_GAP_Y, 16);
  const widthPct = 100 / colCount;
  const leftPct = col * widthPct;
  const timeLabel = formatTime(event.scheduled_at);
  const nameLabel = eventPrimaryLabel(event);
  const isCompact = height < COMPACT_HEIGHT;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => {
          closeNow();
          onSelect(event);
        }}
        onMouseEnter={openSoon}
        onMouseLeave={closeSoon}
        onFocus={openSoon}
        onBlur={closeNow}
        title={`${timeLabel} · ${nameLabel} · ${typeLabel}`}
        className={`absolute z-10 overflow-hidden rounded-md px-1.5 text-left shadow-soft transition hover:brightness-95 ${
          isCompact ? 'py-0' : 'py-0.5'
        } ${look.block}`}
        style={{
          top,
          height,
          left: `calc(${leftPct}% + ${BLOCK_GAP_X}px)`,
          width: `calc(${widthPct}% - ${BLOCK_GAP_X * 2}px)`,
        }}
      >
        <div className={`flex min-h-0 gap-1 ${isCompact ? 'h-full items-center' : 'items-start'}`}>
          {look.key === 'cancelled' && <CalendarX className="h-3 w-3 shrink-0" />}
          {look.key === 'rescheduled' && <RefreshCw className="h-3 w-3 shrink-0" />}
          {isCompact ? (
            <p className={`min-w-0 truncate text-[11px] font-semibold leading-none ${look.isStruck ? 'line-through' : ''}`}>
              {timeLabel} · {nameLabel}
            </p>
          ) : (
            <div className="min-w-0 flex-1">
              <p className={`truncate text-[11px] font-semibold leading-[1.2] ${look.isStruck ? 'line-through' : ''}`}>
                {nameLabel}
              </p>
              <p className={`truncate text-[10px] leading-[1.2] opacity-90 ${look.isStruck ? 'line-through' : ''}`}>
                {timeLabel} · {typeLabel}
              </p>
            </div>
          )}
        </div>
      </button>

      {anchorRect && (
        <EventHoverCard
          event={event}
          anchorRect={anchorRect}
          onMouseEnter={keepOpen}
          onMouseLeave={closeSoon}
          onOpenDetail={() => {
            closeNow();
            onSelect(event);
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

/**
 * Teams-like timed grid for week (multiple day columns) or day (one column).
 */
export default function CalendarTimeGrid({ days, events, onSelectEvent, onFeedback }) {
  const scrollRef = useRef(null);
  const byDay = useMemo(() => groupEventsByDay(events), [events]);
  const hours = useMemo(() => hourLabels(), []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dayKeys = new Set(days.map((d) => ymd(d.date)));
    const inView = events.filter(
      (e) => e.scheduled_at && dayKeys.has(ymd(new Date(e.scheduled_at)))
    );
    const anchorMins = inView.length
      ? Math.min(...inView.map((e) => minutesFromGridStart(new Date(e.scheduled_at))))
      : minutesFromGridStart(new Date());
    el.scrollTop = Math.max(0, (anchorMins / 60) * HOUR_HEIGHT - 60);
  }, [days, events]);

  return (
    <div className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
      <div className="grid border-b border-tertiary-100 bg-tertiary-50/80" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
        <div className="border-r border-tertiary-100" />
        {days.map((day) => (
          <div
            key={ymd(day.date)}
            className={`border-r border-tertiary-100 px-2 py-2 text-center last:border-r-0 ${day.isToday ? 'bg-primary-50' : ''}`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-tertiary-500">
              {day.date.toLocaleDateString('en-US', { weekday: 'short' })}
            </p>
            <p
              className={`mx-auto mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                day.isToday ? 'bg-primary-600 text-white' : 'text-tertiary-800'
              }`}
            >
              {day.date.getDate()}
            </p>
          </div>
        ))}
      </div>

      <div ref={scrollRef} className="max-h-[min(70vh,720px)] overflow-auto">
        <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="relative border-r border-tertiary-100" style={{ height: GRID_HEIGHT }}>
            {hours.slice(0, -1).map((h, i) => (
              <div
                key={h.hour}
                className={`absolute right-1 text-[10px] font-medium text-tertiary-400 ${
                  i === 0 ? '' : '-translate-y-1/2'
                }`}
                style={{ top: (h.hour - DAY_START_HOUR) * HOUR_HEIGHT }}
              >
                {h.label}
              </div>
            ))}
          </div>

          {days.map((day) => {
            const key = ymd(day.date);
            const laid = layoutDayEvents(byDay.get(key) || []);
            return (
              <div
                key={key}
                className={`relative border-r border-tertiary-100 last:border-r-0 ${day.isToday ? 'bg-primary-50/30' : ''}`}
                style={{ height: GRID_HEIGHT }}
              >
                {hours.slice(0, -1).map((h) => (
                  <div
                    key={h.hour}
                    className="absolute inset-x-0 border-t border-tertiary-100"
                    style={{ top: (h.hour - DAY_START_HOUR) * HOUR_HEIGHT }}
                  />
                ))}
                <NowLine dayDate={day.date} />
                {laid.map(({ event, col, colCount }) => (
                  <TimeBlock
                    key={event.id}
                    event={event}
                    col={col}
                    colCount={colCount}
                    onSelect={onSelectEvent}
                    onFeedback={onFeedback}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
