import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';

/**
 * Trend charts need several points to draw a line. When the selected period is short (this month, a quarter...),
 * the page's own data has one or two points, so the charts read the last 12 months ending at the period's end
 * instead. Everything else on the page (tiles, cards, tables) keeps following the selected period.
 *
 * It reuses the same `/group/overview` endpoint, so the numbers are identical to the ones the tabs already show;
 * the server caches finished months, so the extra call is cheap.
 */
export const TREND_MONTHS = 12;
const MIN_POINTS = 6;

const idx = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1;
const at = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

export default function useTrendWindow({ data, range, valid, state, orgIds }) {
  const span = valid ? idx(range.to) - idx(range.from) + 1 : 0;
  const widen = Boolean(data) && valid && span < MIN_POINTS;
  const from = valid ? at(idx(range.to) - (TREND_MONTHS - 1)) : '';
  const wide = useLiveData(
    () => apiClient
      .get('/super-dashboard/group/overview', { params: { from, to: range.to, granularity: 'month', state, ...(orgIds ? { org_ids: orgIds } : {}) } })
      .then((r) => r.data.data),
    { intervalMs: 300000, enabled: widen, deps: [from, range?.to, state, orgIds] }
  );
  const source = widen && wide.data ? wide.data : data;
  const widened = Boolean(widen && wide.data);
  return {
    trends: source?.trends,
    companies: source?.companies,
    widened,
    loading: widen && !wide.data,
    note: widened ? `Last ${TREND_MONTHS} months up to ${range.to}, so the trend is visible. The figures above follow your selected period.` : null,
  };
}
