import { useMemo, useState } from 'react';
import Drawer from '../../components/ui/Drawer.jsx';
import { buildMonthMatrix, groupEventsByDay, ymd, WEEKDAYS } from './monthGrid.js';
import EventPill from './EventPill.jsx';

const MAX_PILLS = 3;

/**
 * CSS grid month view. Each day cell shows up to 3 event pills + "+N more"
 * (opens that day's list in a Drawer). Click a pill → onSelectEvent(event).
 */
export default function CalendarMonthView({ anchor, events, onSelectEvent, onFeedback }) {
  const weeks = useMemo(() => buildMonthMatrix(anchor), [anchor]);
  const byDay = useMemo(() => groupEventsByDay(events), [events]);
  const [dayDrawer, setDayDrawer] = useState(null); // { key, label, rows }

  return (
    <div className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
      <div className="grid grid-cols-7 border-b border-tertiary-100 bg-tertiary-50/70 text-[11px] font-semibold uppercase tracking-wide text-tertiary-500">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-center">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {weeks.flat().map((cell) => {
          const key = ymd(cell.date);
          const rows = byDay.get(key) || [];
          const shown = rows.slice(0, MAX_PILLS);
          const extra = rows.length - shown.length;
          return (
            <div
              key={key}
              className={`min-h-28 border-b border-r border-tertiary-100 p-1.5 ${
                cell.inMonth ? 'bg-white' : 'bg-tertiary-50/40'
              }`}
            >
              <div className="mb-1 flex justify-end">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    cell.isToday
                      ? 'bg-primary-600 font-semibold text-white'
                      : cell.inMonth
                        ? 'text-tertiary-600'
                        : 'text-tertiary-300'
                  }`}
                >
                  {cell.date.getDate()}
                </span>
              </div>
              <div className="space-y-1">
                {shown.map((ev) => (
                  <EventPill key={ev.id} event={ev} onClick={() => onSelectEvent(ev)} onFeedback={onFeedback} />
                ))}
                {extra > 0 && (
                  <button
                    type="button"
                    className="w-full rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-primary-700 hover:bg-primary-50"
                    onClick={() =>
                      setDayDrawer({
                        key,
                        label: cell.date.toLocaleDateString('en-US', {
                          weekday: 'long',
                          month: 'short',
                          day: 'numeric',
                        }),
                        rows,
                      })
                    }
                  >
                    +{extra} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Drawer open={Boolean(dayDrawer)} onClose={() => setDayDrawer(null)} tone="info" title={dayDrawer?.label || ''} size="sm">
        <ul className="divide-y divide-tertiary-100">
          {(dayDrawer?.rows || []).map((ev) => (
            <li key={ev.id}>
              <button
                type="button"
                className="w-full py-2 text-left"
                onClick={() => {
                  setDayDrawer(null);
                  onSelectEvent(ev);
                }}
              >
                <EventPill event={ev} onClick={() => {}} />
              </button>
            </li>
          ))}
        </ul>
      </Drawer>
    </div>
  );
}
