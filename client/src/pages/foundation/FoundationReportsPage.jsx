import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import useLiveData from '../../lib/useLiveData.js';
import { downloadCsv, printReport } from '../../lib/groupExport.js';
import { fxApi, foundationError } from '../../lib/foundation/api.js';
import { fxCan, useFoundation } from '../../lib/foundation/useFoundation.js';
import { useFxPickers } from '../../lib/foundation/pickers.js';
import { CAMPAIGN_STATUSES, REPORT_GROUPS, STATUS_META, inr } from '../../lib/foundation/meta.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import FilterBar from '../../components/zephyr/FilterBar.jsx';
import Pill from '../../components/ui/Pill.jsx';
import { Empty, card } from '../../components/foundation/ui.jsx';
import { ReportChart } from '../../components/foundation/FxCharts.jsx';

const BLANK = { from: '', to: '', category_id: '', status: '', state: '', city: '', q: '' };

const show = (col, v) => {
  if (v === null || v === undefined || v === '') return '-';
  if (col.type === 'money') return inr(v);
  if (col.type === 'pct') return `${v}%`;
  return v;
};

export default function FoundationReportsPage() {
  const { me, loading } = useFoundation();
  const { pushError } = useAlerts();
  const navigate = useNavigate();
  const pickers = useFxPickers({ people: false });
  const [report, setReport] = useState('campaign_budget');
  const [f, setF] = useState(BLANK);
  const { data, loading: busy, error } = useLiveData(() => fxApi.report({ ...f, report }), { enabled: Boolean(me), deps: [report, JSON.stringify(f)] });
  useEffect(() => { if (error) pushError(foundationError(error, 'Could not load the report'), 'Load failed'); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  const titles = useMemo(() => Object.fromEntries((data?.reports || []).map((r) => [r.key, r.title])), [data]);
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !fxCan(me, 'reports')) return <Navigate to="/foundation" replace />;

  const exportRows = () => data.rows.map((r) => data.columns.map((c) => (r[c.key] ?? '')));
  const sub = `${f.from || 'start'} to ${f.to || 'today'}${f.status ? ` - ${f.status}` : ''}`;
  return (
    <div className="mt-4 space-y-4">
      <section className={`${card} flex flex-wrap items-end gap-3`}>
        <label className="text-xs font-medium text-tertiary-600">
          Report
          <select className="mt-1 block min-w-[18rem] rounded-xl border px-3 py-2 text-sm" value={report} onChange={(e) => setReport(e.target.value)} aria-label="Report">
            {REPORT_GROUPS.map(([group, keys]) => (
              <optgroup key={group} label={group}>
                {keys.map((k) => <option key={k} value={k}>{titles[k] || k.replace(/_/g, ' ')}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn-secondary" disabled={!data} onClick={() => downloadCsv(`${report}-${f.from || 'all'}.csv`, data.columns.map((c) => c.label), exportRows())}>CSV</button>
          <button type="button" className="btn-secondary" disabled={!data} onClick={() => { if (!printReport(data.title, sub, data.columns.map((c) => c.label), exportRows())) pushError('Allow pop-ups to export the PDF', 'Export blocked'); }}>PDF</button>
        </div>
      </section>
      <FilterBar
        q={f.q}
        onQ={(v) => setF((c) => ({ ...c, q: v }))}
        searchPlaceholder="Search campaign, code, place..."
        fields={[
          { key: 'from', label: 'From', type: 'date' },
          { key: 'to', label: 'To', type: 'date' },
          { key: 'category_id', label: 'Initiative / category', type: 'select', any: 'All', options: pickers.initiatives },
          { key: 'status', label: 'Campaign status', type: 'select', any: 'All', options: CAMPAIGN_STATUSES.map((s) => ({ value: s.value, label: s.label })) },
          { key: 'state', label: 'State', type: 'text' },
          { key: 'city', label: 'City', type: 'text' },
        ]}
        values={f}
        defaults={BLANK}
        onChange={(k, v) => setF((c) => ({ ...c, [k]: v }))}
        onReset={() => setF(BLANK)}
      />
      {!data ? <div className="py-8 text-center text-sm text-tertiary-500">{busy ? 'Loading...' : 'No data.'}</div> : (
        <div className={`space-y-4 transition-opacity ${busy ? 'opacity-60' : ''}`}>
          <h2 className="font-heading text-lg font-semibold text-tertiary-900">{data.title}</h2>
          {data.note && <p className="text-xs text-tertiary-500">{data.note}</p>}
          {data.chart && data.rows.length > 0 && <ChartCard title="Chart" subtitle={data.title}><ReportChart chart={data.chart} rows={data.rows} /></ChartCard>}
          <section className={`${card} overflow-x-auto`}>
            {data.rows.length === 0 ? <Empty>Nothing matches these filters.</Empty> : (
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="text-left text-xs text-tertiary-500"><tr>{data.columns.map((c) => <th key={c.key} className={`px-3 py-2 font-medium ${c.type ? 'text-right' : ''}`}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={r.id || r.month || r.quarter || r.name || i} className={`border-t ${r.id ? 'cursor-pointer hover:bg-primary-50/40' : ''}`} onClick={() => r.id && navigate(`/foundation/campaigns/${r.id}`)}>
                      {data.columns.map((c) => <td key={c.key} className={`px-3 py-2 ${c.type ? 'text-right tabular-nums' : ''}`}>{c.key === 'status' ? <Pill tone={STATUS_META[r[c.key]]?.tone}>{STATUS_META[r[c.key]]?.label || r[c.key]}</Pill> : show(c, r[c.key])}</td>)}
                    </tr>
                  ))}
                </tbody>
                {data.totals && (
                  <tfoot>
                    <tr className="border-t-2 font-semibold">
                      {data.columns.map((c, i) => <td key={c.key} className={`px-3 py-2 ${c.type ? 'text-right tabular-nums' : ''}`}>{i === 0 ? 'Total' : data.totals[c.key] !== undefined ? show(c, data.totals[c.key]) : ''}</td>)}
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
