// Group-level preferences of the signed-in group superadmin, kept in this browser.
const KEY = 'group_alert_thresholds';

export const DEFAULT_THRESHOLDS = { revenue_drop_pct: 20, profit_drop_pct: 20, expense_rise_pct: 30, valuation_drop_pct: 0 };

export function loadThresholds() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return Object.fromEntries(Object.entries(DEFAULT_THRESHOLDS).map(([k, d]) => [k, Number.isFinite(Number(raw[k])) && raw[k] !== '' && raw[k] !== null && raw[k] !== undefined ? Number(raw[k]) : d]));
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}

export function saveThresholds(values) {
  try {
    localStorage.setItem(KEY, JSON.stringify(values));
  } catch {
    /* storage unavailable: the defaults apply */
  }
}

export function resetThresholds() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
