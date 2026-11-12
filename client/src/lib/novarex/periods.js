// Reporting-period presets shared by every Novarex page (and the same ones the filters send to the server as from / to dates).
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
const addMonths = (y, m, n) => { const i = y * 12 + (m - 1) + n; return [Math.floor(i / 12), (i % 12) + 1]; };
const todayLocal = () => { const d = new Date(); return [d.getFullYear(), d.getMonth() + 1, d.getDate()]; };

export const PERIOD_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'current_week', label: 'Current week' },
  { value: 'current_month', label: 'Current month' },
  { value: 'previous_month', label: 'Previous month' },
  { value: 'last_3', label: 'Last 3 months' },
  { value: 'last_6', label: 'Last 6 months' },
  { value: 'current_quarter', label: 'Current quarter' },
  { value: 'previous_quarter', label: 'Previous quarter' },
  { value: 'current_year', label: 'Current year' },
  { value: 'previous_year', label: 'Previous year' },
  { value: 'financial_year', label: 'Financial year' },
  { value: 'previous_financial_year', label: 'Previous financial year' },
  { value: 'custom', label: 'Custom dates' },
];

const monthSpan = (y, m, count) => {
  const [sy, sm] = addMonths(y, m, -(count - 1));
  return { from: ymd(sy, sm, 1), to: ymd(y, m, lastDay(y, m)) };
};

/** { from, to } (YYYY-MM-DD) for a preset. Quarters follow the financial year (it starts in `fyStart`, April by default). */
export function presetRange(preset, fyStart = 4) {
  const [y, m] = todayLocal();
  const fyYear = m >= fyStart ? y : y - 1;
  const quarterStart = (yy, mm) => {
    const offset = ((mm - fyStart) % 12 + 12) % 12;
    return addMonths(yy, mm, -(offset % 3));
  };
  switch (preset) {
    case 'today': return { from: ymd(y, m, todayLocal()[2]), to: ymd(y, m, todayLocal()[2]) };
    case 'current_week': { const now = new Date(Date.UTC(y, m - 1, todayLocal()[2])); const dow = (now.getUTCDay() + 6) % 7; const a = new Date(now.getTime() - dow * 86400000); const b = new Date(a.getTime() + 6 * 86400000); return { from: a.toISOString().slice(0, 10), to: b.toISOString().slice(0, 10) }; }
    case 'previous_month': { const [py, pm] = addMonths(y, m, -1); return monthSpan(py, pm, 1); }
    case 'last_3': return monthSpan(y, m, 3);
    case 'last_6': return monthSpan(y, m, 6);
    case 'current_quarter': { const [qy, qm] = quarterStart(y, m); const [ey, em] = addMonths(qy, qm, 2); return { from: ymd(qy, qm, 1), to: ymd(ey, em, lastDay(ey, em)) }; }
    case 'previous_quarter': { const [cy, cm] = quarterStart(y, m); const [qy, qm] = addMonths(cy, cm, -3); const [ey, em] = addMonths(qy, qm, 2); return { from: ymd(qy, qm, 1), to: ymd(ey, em, lastDay(ey, em)) }; }
    case 'current_year': return { from: ymd(y, 1, 1), to: ymd(y, 12, 31) };
    case 'previous_year': return { from: ymd(y - 1, 1, 1), to: ymd(y - 1, 12, 31) };
    case 'financial_year': { const [ey, em] = addMonths(fyYear, fyStart, 11); return { from: ymd(fyYear, fyStart, 1), to: ymd(ey, em, lastDay(ey, em)) }; }
    case 'previous_financial_year': { const [ey, em] = addMonths(fyYear - 1, fyStart, 11); return { from: ymd(fyYear - 1, fyStart, 1), to: ymd(ey, em, lastDay(ey, em)) }; }
    default: return monthSpan(y, m, 1);
  }
}

/** Label for the active range, e.g. "01 Oct 2026 - 31 Oct 2026". */
export function rangeLabel({ from, to }) {
  const f = (s) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return from && to ? `${f(from)} - ${f(to)}` : 'All dates';
}
