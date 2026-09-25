/**
 * Pure calendar helpers. Native Date only. Weeks are Monday-start.
 */

export const HOUR_HEIGHT = 72;
// Full 24h so an interview at any hour (incl. early morning) lands at its true
// position; the time grid scrolls to the day's earliest event on mount.
export const DAY_START_HOUR = 0;
export const DAY_END_HOUR = 24;

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function sameDay(a, b) {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
  );
}

export function firstOfMonth(d) {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), 1);
}

export function addMonths(d, n) {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth() + n, 1);
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday-based weekday index (Mon=0 … Sun=6). */
function mondayIndex(date) {
  return (date.getDay() + 6) % 7;
}

/** Monday 00:00 of the week containing `d`. */
export function startOfWeek(d) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - mondayIndex(x));
  return x;
}

/** Seven Mon-Sun dates for the week containing `anchor`. */
export function buildWeekDays(anchor) {
  const start = startOfWeek(anchor);
  const today = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    return { date, isToday: sameDay(date, today) };
  });
}

/** 6×7 matrix of { date, inMonth, isToday } starting on the Monday on/before the 1st. */
export function buildMonthMatrix(anchor) {
  const first = firstOfMonth(anchor);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - mondayIndex(first));
  const today = new Date();

  const weeks = [];
  const cursor = new Date(gridStart);
  for (let w = 0; w < 6; w += 1) {
    const row = [];
    for (let d = 0; d < 7; d += 1) {
      row.push({
        date: new Date(cursor),
        inMonth: cursor.getMonth() === first.getMonth(),
        isToday: sameDay(cursor, today),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(row);
  }
  return weeks;
}

export function ymd(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Map<yyyy-mm-dd, event[]> with each day's events sorted by start time. */
export function groupEventsByDay(events) {
  const map = new Map();
  for (const ev of events || []) {
    if (!ev.scheduled_at) continue;
    const key = ymd(ev.scheduled_at);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(ev);
  }
  for (const list of map.values()) {
    list.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  }
  return map;
}

export function formatTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export function formatTimeRange(start, durationMin) {
  if (!start) return '';
  const s = formatTime(start);
  if (!durationMin) return s;
  const end = new Date(new Date(start).getTime() + durationMin * 60000);
  return `${s} - ${formatTime(end)}`;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function monthLabel(anchor) {
  return new Date(anchor).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function weekLabel(anchor) {
  const days = buildWeekDays(anchor);
  const a = days[0].date;
  const b = days[6].date;
  const sameMonth = a.getMonth() === b.getMonth();
  if (sameMonth) {
    return `${a.toLocaleDateString('en-US', { month: 'long' })} ${a.getDate()} - ${b.getDate()}, ${a.getFullYear()}`;
  }
  return `${a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${b.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

export function dayLabel(anchor) {
  return new Date(anchor).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function hourLabels(startHour = DAY_START_HOUR, endHour = DAY_END_HOUR) {
  const labels = [];
  for (let h = startHour; h <= endHour; h += 1) {
    const d = new Date();
    d.setHours(h, 0, 0, 0);
    labels.push({
      hour: h,
      label: d.toLocaleTimeString('en-US', { hour: 'numeric' }),
    });
  }
  return labels;
}

/** Minutes from day-grid start for positioning a timed event. */
export function minutesFromGridStart(date, startHour = DAY_START_HOUR) {
  const d = new Date(date);
  return d.getHours() * 60 + d.getMinutes() - startHour * 60;
}

/**
 * Pack overlapping events into columns (Teams-like side-by-side blocks).
 *
 * Events are split into clusters of transitively-overlapping items; every event
 * in a cluster shares the same `colCount` (the cluster's column count) so no two
 * blocks can render on top of each other. Returns [{ event, col, colCount }].
 */
export function layoutDayEvents(events) {
  const items = [...(events || [])]
    .filter((e) => e.scheduled_at)
    .map((e) => {
      const start = new Date(e.scheduled_at).getTime();
      const duration = Math.max(e.duration_minutes || 30, 15);
      return { event: e, start, end: start + duration * 60000, col: 0, colCount: 1 };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const result = [];
  let cluster = [];
  let clusterEnd = -Infinity; // latest end within the open cluster
  let columnEnds = []; // per-column: end time of the last event placed there

  const flush = () => {
    const colCount = Math.max(columnEnds.length, 1);
    for (const item of cluster) {
      result.push({ event: item.event, col: item.col, colCount });
    }
    cluster = [];
    columnEnds = [];
    clusterEnd = -Infinity;
  };

  for (const item of items) {
    if (item.start >= clusterEnd) flush(); // no overlap with the open cluster

    let col = columnEnds.findIndex((endAt) => endAt <= item.start);
    if (col === -1) {
      col = columnEnds.length;
      columnEnds.push(item.end);
    } else {
      columnEnds[col] = item.end;
    }
    item.col = col;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();

  return result;
}
