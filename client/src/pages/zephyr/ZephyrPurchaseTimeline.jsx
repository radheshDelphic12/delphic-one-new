import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { rupees } from '../../lib/zephyr/projectMeta.js';
import { dateLabel } from '../../lib/format.js';

const KIND = { purchase: 'Purchased', step: 'Step', payment: 'Payment' };
const STATE = { done: ['#10B981', 'Done'], late: ['#EF4444', 'Late'], upcoming: ['#3B82F6', 'Planned'], no_date: ['#9CA3AF', 'No date'] };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ms = (d) => Date.parse(`${d}T00:00:00Z`);

function SortTh({ k, children, right, sort, onSort }) {
  return (
    <th className={`px-3 py-2 ${right ? 'text-right' : 'text-left'}`}><button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 uppercase" data-testid={`sort-${k}`}>{children}{sort.key === k && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</button></th>
  );
}

/**
 * Zephyr > Properties > Purchase timeline: when each property was bought and every planned step and payment of its purchase, on one chart
 * (a row per property along the dates; a bigger dot = a bigger amount) and in a table that sorts by any column.
 */
export default function ZephyrPurchaseTimeline({ canFinance }) {
  const { pushError } = useAlerts();
  const [data, setData] = useState(null);
  const [sort, setSort] = useState({ key: 'date', dir: 'asc' });
  const [kind, setKind] = useState('');
  useEffect(() => { zephyrApi.purchaseTimeline().then(setData, (e) => { setData({ events: [], properties: [] }); pushError(zephyrError(e), 'Could not load the timeline'); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const events = useMemo(() => (data?.events || []).filter((e) => !kind || e.kind === kind), [data, kind]);
  const sorted = useMemo(() => {
    const val = (e) => (sort.key === 'property' ? e.property.code : sort.key === 'amount' ? (e.amount ?? -1) : sort.key === 'kind' ? e.kind : sort.key === 'state' ? e.state : e.date);
    return [...events].sort((a, b) => { const x = val(a); const y = val(b); const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y)); return sort.dir === 'asc' ? c : -c; });
  }, [events, sort]);
  const by = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
  const th = (k, text, right = false) => <SortTh k={k} right={right} sort={sort} onSort={by}>{text}</SortTh>;
  const [todayStr] = useState(() => new Date().toISOString().slice(0, 10));

  // the chart: one row per property, x = time
  const chart = useMemo(() => {
    if (!events.length) return null;
    const props = [...new Map(events.map((e) => [e.property.id, e.property])).values()].sort((a, b) => a.code.localeCompare(b.code));
    const min = Math.min(...events.map((e) => ms(e.date)));
    const max = Math.max(...events.map((e) => ms(e.date)));
    const pad = 86400000 * 10;
    const from = min - pad; const to = Math.max(max + pad, from + 86400000 * 60);
    const left = 170; const width = 900; const rowH = 34; const top = 26;
    const x = (d) => left + ((ms(d) - from) / (to - from)) * (width - left - 20);
    const maxAmt = Math.max(1, ...events.map((e) => e.amount || 0));
    const r = (e) => (e.amount ? 5 + 9 * Math.sqrt(e.amount / maxAmt) : 5);
    const ticks = [];
    const start = new Date(from); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
    const months = (to - from) / (86400000 * 30);
    const step = months > 36 ? 6 : months > 18 ? 3 : 1;
    for (let d = new Date(start); d.getTime() <= to; d.setUTCMonth(d.getUTCMonth() + step)) if (d.getTime() >= from) ticks.push(new Date(d));
    return { props, x, r, ticks, left, width, rowH, top, height: top + props.length * rowH + 10, today: ms(todayStr) >= from && ms(todayStr) <= to ? x(todayStr) : null };
  }, [events, todayStr]);

  if (!data) return <p className="text-sm text-tertiary-500">Loading...</p>;
  return (
    <div className="space-y-3" data-testid="zx-purchase-timeline">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-tertiary-600">Purchase dates, planned steps and payments of every property. Plan the steps on a property&apos;s Purchase timeline tab.</p>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm" aria-label="Show"><option value="">Everything</option><option value="purchase">Purchase dates</option><option value="step">Planned steps</option>{canFinance && <option value="payment">Payments</option>}</select>
      </div>
      {!chart ? <p className="rounded-2xl border border-dashed border-tertiary-200 p-6 text-center text-sm text-tertiary-500">No purchase dates or steps yet.</p> : (
        <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white p-2 shadow-card">
          <svg viewBox={`0 0 ${chart.width} ${chart.height}`} width="100%" style={{ minWidth: 640 }} role="img" aria-label="Purchase timeline chart" data-testid="zx-timeline-chart">
            {chart.ticks.map((t) => { const d = t.toISOString().slice(0, 10); const tx = chart.x(d); return <g key={d}><line x1={tx} x2={tx} y1={chart.top - 6} y2={chart.height - 6} stroke="#E5E7EB" /><text x={tx} y={14} fontSize="10" textAnchor="middle" fill="#64748B">{MON[t.getUTCMonth()]} {String(t.getUTCFullYear()).slice(2)}</text></g>; })}
            {chart.today && <line x1={chart.today} x2={chart.today} y1={chart.top - 6} y2={chart.height - 6} stroke="#F59E0B" strokeDasharray="4 3" />}
            {chart.props.map((p, i) => {
              const y = chart.top + i * chart.rowH + chart.rowH / 2;
              const mine = events.filter((e) => e.property.id === p.id);
              return (
                <g key={p.id}>
                  <text x={8} y={y + 4} fontSize="11.5" fontWeight="600" fill="#0F172A">{`${p.code} ${p.name}`.slice(0, 26)}</text>
                  <line x1={chart.left} x2={chart.width - 20} y1={y} y2={y} stroke="#F1F5F9" />
                  {mine.map((e, j) => (
                    <circle key={j} cx={chart.x(e.date)} cy={y} r={chart.r(e)} fill={e.kind === 'payment' ? '#8B5CF6' : e.kind === 'purchase' ? '#105AA9' : STATE[e.state][0]} fillOpacity="0.8" stroke="#fff">
                      <title>{`${e.date} · ${p.code} · ${e.title}${e.amount ? ` · ${rupees(e.amount)}` : ''}${e.kind === 'step' ? ` · ${STATE[e.state][1]}` : ''}`}</title>
                    </circle>
                  ))}
                </g>
              );
            })}
          </svg>
          <div className="mt-1 flex flex-wrap gap-3 px-2 text-[11px] text-tertiary-600">
            {[['#105AA9', 'Purchase date'], ['#10B981', 'Step done'], ['#3B82F6', 'Step planned'], ['#EF4444', 'Step late'], ...(canFinance ? [['#8B5CF6', 'Payment']] : [])].map(([c, l]) => <span key={l} className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />{l}</span>)}
            <span>· bigger dot = bigger amount · dashed line = today</span>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-sm" data-testid="zx-timeline-table">
          <thead className="bg-canvas-muted text-xs text-tertiary-500"><tr>{th('date', 'Date')}{th('property', 'Property')}{th('kind', 'What')}{th('state', 'Status')}{canFinance && th('amount', 'Amount', true)}</tr></thead>
          <tbody>{sorted.map((e, i) => (
            <tr key={i} className="border-t border-tertiary-100" data-testid="zx-timeline-row">
              <td className="whitespace-nowrap px-3 py-2">{dateLabel(e.date)}{e.kind === 'step' && e.done_date && e.planned_date && e.done_date !== e.planned_date && <span className="block text-[11px] text-tertiary-500">planned {dateLabel(e.planned_date)}</span>}</td>
              <td className="px-3 py-2"><Link to={`/zephyr/properties/${e.property.id}`} className="font-medium text-primary-700 hover:underline">{e.property.code}</Link> <span className="text-tertiary-600">{e.property.name}</span></td>
              <td className="px-3 py-2">{KIND[e.kind]}: {e.title}</td>
              <td className="px-3 py-2"><span className="inline-flex items-center gap-1 text-xs"><span className="inline-block h-2 w-2 rounded-full" style={{ background: STATE[e.state][0] }} />{STATE[e.state][1]}</span></td>
              {canFinance && <td className="px-3 py-2 text-right tabular-nums">{e.amount ? rupees(e.amount) : '-'}</td>}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
