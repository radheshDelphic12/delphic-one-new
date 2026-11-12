// Pure date rules for the group task list: when does a one-time or recurring task fall due. No database, no clock
// (callers pass dates), so the same rule drives the month list, the weekly table and the tests.
//
//   one_time   due_date
//   recurring  starts on start_date (never before it), stops after end_date, and repeats by `frequency` every `interval`:
//     daily      every N days
//     weekly     on the chosen ISO weekdays (1 = Monday ... 7 = Sunday), every N weeks counted from the start week
//     monthly    on day_of_month (default: the start date's day), every N months; 31 in a 30-day month = the last day
//     quarterly  as monthly, every N x 3 months
//     yearly     on the start date's month and day_of_month, every N years (29 Feb = 28 Feb in other years)

const DAY = 86400000;
const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

const ymd = (d) => d.toISOString().slice(0, 10);
const parse = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00.000Z`);
const dayOf = (v) => (v ? ymd(v instanceof Date ? v : parse(v)) : null);
const isoWeekday = (d) => ((d.getUTCDay() + 6) % 7) + 1; // Monday = 1 ... Sunday = 7
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
const monthIndex = (d) => d.getUTCFullYear() * 12 + d.getUTCMonth();
const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const mondayOf = (s) => ymd(new Date(parse(s).getTime() - (isoWeekday(parse(s)) - 1) * DAY));
const addDays = (s, n) => ymd(new Date(parse(s).getTime() + n * DAY));

/** Every due date of a task inside [from, to] (inclusive, YYYY-MM-DD), oldest first. Cancelled and paused tasks have none. */
function occurrencesBetween(task, from, to) {
  if (!task || task.status === 'cancelled' || task.status === 'paused') return [];
  if (task.kind === 'one_time') {
    const due = dayOf(task.due_date);
    return due && due >= from && due <= to ? [due] : [];
  }
  const start = dayOf(task.start_date);
  const freq = task.frequency;
  if (!start || !FREQUENCIES.includes(freq)) return [];
  const every = Math.max(1, Number(task.interval) || 1);
  const end = dayOf(task.end_date);
  const first = from > start ? from : start;
  const last = end && end < to ? end : to;
  if (first > last) return [];
  const out = [];

  if (freq === 'daily') {
    const offset = daysBetween(start, first);
    let d = addDays(first, (every - (offset % every)) % every);
    for (; d <= last; d = addDays(d, every)) out.push(d);
    return out;
  }

  if (freq === 'weekly') {
    const days = (task.weekdays?.length ? [...new Set(task.weekdays)] : [isoWeekday(parse(start))]).filter((n) => n >= 1 && n <= 7);
    const startWeek = mondayOf(start);
    for (let d = first; d <= last; d = addDays(d, 1)) {
      if (!days.includes(isoWeekday(parse(d)))) continue;
      const weeks = Math.round(daysBetween(startWeek, mondayOf(d)) / 7);
      if (weeks % every === 0) out.push(d);
    }
    return out;
  }

  // monthly / quarterly / yearly: step in whole months from the start month
  const step = freq === 'monthly' ? every : freq === 'quarterly' ? every * 3 : every * 12;
  const s = parse(start);
  const wantDay = Number(task.day_of_month) || s.getUTCDate();
  const startIdx = monthIndex(s);
  const firstIdx = monthIndex(parse(first));
  const lastIdx = monthIndex(parse(last));
  for (let idx = startIdx + Math.max(0, Math.ceil((firstIdx - startIdx) / step)) * step; idx <= lastIdx; idx += step) {
    const y = Math.floor(idx / 12);
    const m = idx % 12;
    const day = Math.min(wantDay, lastDayOfMonth(y, m));
    const date = ymd(new Date(Date.UTC(y, m, day)));
    if (date >= start && date >= first && date <= last) out.push(date);
  }
  return out;
}

const monthRange = (month) => {
  const [y, m] = month.split('-').map(Number);
  return { from: `${month}-01`, to: ymd(new Date(Date.UTC(y, m, 0))) };
};

module.exports = { FREQUENCIES, occurrencesBetween, monthRange, mondayOf, addDays, isoWeekday, parse, ymd, dayOf };
