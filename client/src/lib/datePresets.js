/**
 * Format a Date as YYYY-MM-DD in local time (safe for `<input type="date">`).
 */
export function formatLocalDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Map filter bar date presets to ISO date_from / date_to (YYYY-MM-DD).
 */
export function rangeForPreset(preset, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const iso = formatLocalDate;

  if (preset === 'today') {
    return { date_from: iso(now), date_to: iso(now) };
  }
  if (preset === 'this_week') {
    // Monday-start week, matching the calendar grid.
    const diffToMonday = (now.getDay() + 6) % 7;
    const from = new Date(y, m, now.getDate() - diffToMonday);
    const to = new Date(from);
    to.setDate(from.getDate() + 6);
    return { date_from: iso(from), date_to: iso(to) };
  }
  if (preset === 'last_month') {
    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m, 0);
    return { date_from: iso(from), date_to: iso(to) };
  }
  if (preset === 'this_quarter') {
    const q = Math.floor(m / 3) * 3;
    const from = new Date(y, q, 1);
    const to = new Date(y, q + 3, 0);
    return { date_from: iso(from), date_to: iso(to) };
  }
  if (preset === 'last_quarter') {
    const q = Math.floor(m / 3) * 3 - 3;
    const from = new Date(y, q, 1);
    const to = new Date(y, q + 3, 0);
    return { date_from: iso(from), date_to: iso(to) };
  }
  if (preset === 'ytd') {
    return { date_from: iso(new Date(y, 0, 1)), date_to: iso(now) };
  }
  // this_month (default)
  const from = new Date(y, m, 1);
  const to = new Date(y, m + 1, 0);
  return { date_from: iso(from), date_to: iso(to) };
}
