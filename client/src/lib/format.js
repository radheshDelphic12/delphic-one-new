export function money(value, currency) {
  const n = Number(value || 0);
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${formatted}` : formatted;
}

/** 1.2K / 3.4M / 5.6Cr style for chart axes and KPI tiles. */
export function compact(value) {
  const n = Number(value || 0);
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${(n / 1e7).toFixed(2).replace(/\.?0+$/, '')}Cr`;
  if (abs >= 1e5) return `${(n / 1e5).toFixed(2).replace(/\.?0+$/, '')}L`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
}

export function titleCase(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function shortMonth(key) {
  if (!key) return '';
  const [year, month] = key.split('-');
  return new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

export function dateLabel(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
