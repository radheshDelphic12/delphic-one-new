const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shortDay = (d) => d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });

// Sunday-to-Saturday weeks (the timesheet lock week) touching the month,
// clipped to it: { key, label, from, to }.
export function monthWeeks({ month, year }) {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const weeks = [];
  let start = new Date(first);
  while (start <= last) {
    const end = new Date(start);
    end.setDate(end.getDate() + (6 - start.getDay())); // through Saturday
    const clippedEnd = end > last ? last : end;
    weeks.push({ key: ymdLocal(start), label: `${shortDay(start)} – ${shortDay(clippedEnd)}`, from: ymdLocal(start), to: ymdLocal(clippedEnd) });
    start = new Date(clippedEnd);
    start.setDate(start.getDate() + 1);
  }
  return weeks;
}
