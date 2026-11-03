import { useEffect, useMemo, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { saveCsv } from '../../lib/saveCsv.js';
import Pill from '../../components/ui/Pill.jsx';

const MEASURES = [
  { value: 'projects', label: 'Projects won', hint: 'Projects added in Finance > Projects, by agreement start date' },
  { value: 'joinings', label: 'Candidates joined', hint: 'Candidates who joined on the client’s requirements, by joining date' },
  { value: 'requirements', label: 'Requirements closed', hint: 'Requirements marked closed, by closing date' },
];
const TYPES = [
  { value: '', label: 'All project types' },
  { value: 'managed_services', label: 'Managed services' },
  { value: 'project', label: 'Project' },
  { value: 'recruitment', label: 'Recruitment' },
  { value: 'internal_hiring', label: 'Internal hiring' },
];
const STAGES = [
  { value: '', label: 'All statuses' },
  { value: 'lead', label: 'Lead' },
  { value: 'meeting_scheduled', label: 'Meeting scheduled' },
  { value: 'active', label: 'Active' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'dropped', label: 'Dropped' },
];
const STAGE_TONE = { active: 'green', lead: 'blue', meeting_scheduled: 'purple', rescheduled: 'amber', dropped: 'red' };
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.value, s.label]));
const field = 'rounded-xl border px-3 py-1.5 text-sm';

const monthValue = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const lastDay = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};

/** Client-wise (kind="client") or vendor-wise (kind="vendor") matrix: names down the side, months across the top, a count in each cell. */
export default function ClosureMatrix({ kind }) {
  const { pushError } = useAlerts();
  const isVendor = kind === 'vendor';
  const now = new Date();
  const [from, setFrom] = useState(monthValue(new Date(now.getFullYear(), now.getMonth() - 11, 1)));
  const [to, setTo] = useState(monthValue(now));
  const [measure, setMeasure] = useState('projects');
  const [reqType, setReqType] = useState('');
  const [stage, setStage] = useState('');
  const [vendorType, setVendorType] = useState('');
  const [premium, setPremium] = useState('');
  const [search, setSearch] = useState('');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const params = useMemo(
    () => ({
      kind, date_from: `${from}-01`, date_to: lastDay(to),
      ...(!isVendor ? { measure } : {}),
      ...(reqType ? { req_type: reqType } : {}),
      ...(stage ? { account_stage: stage } : {}),
      ...(isVendor && vendorType ? { vendor_type: vendorType } : {}),
      ...(premium ? { premium } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(hideEmpty ? { hide_empty: 'true' } : {}),
    }),
    [kind, isVendor, from, to, measure, reqType, stage, vendorType, premium, search, hideEmpty]
  );

  useEffect(() => {
    if (!from || !to || from > to) return undefined;
    let live = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiClient.get('/reports/closure-matrix', { params });
        if (live) setData(res.data.data);
      } catch (e) {
        if (live) pushError(apiErrorMessage(e, 'Could not load the report'), 'Report failed');
      } finally {
        if (live) setLoading(false);
      }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [params, from, to, pushError]);

  const noun = isVendor ? 'Vendor' : 'Client';
  const measureLabel = isVendor ? 'Candidates joined' : MEASURES.find((m) => m.value === measure)?.label;
  const typeLabel = measure === 'projects' && !isVendor ? 'Project type' : 'Requirement type';

  function exportCsv() {
    if (!data) return;
    saveCsv(`${isVendor ? 'vendor' : 'client'}-wise-${measure}-${from}-to-${to}.csv`, [
      [noun, 'Status', ...data.months.map((m) => m.label), 'Total'],
      ...data.rows.map((r) => [r.name, STAGE_LABEL[r.stage] || '', ...data.months.map((m) => r.counts[m.key] || 0), r.total]),
      ['Total', '', ...data.months.map((m) => data.totals[m.key] || 0), data.grand_total],
    ]);
  }

  return (
    <div className="space-y-4" data-testid={`closure-matrix-${kind}`}>
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card">
        <label className="text-xs font-medium text-tertiary-600">From month<input type="month" className={`${field} mt-1 block`} value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-xs font-medium text-tertiary-600">To month<input type="month" className={`${field} mt-1 block`} value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        {!isVendor && (
          <label className="text-xs font-medium text-tertiary-600">Count<select className={`${field} mt-1 block`} value={measure} onChange={(e) => setMeasure(e.target.value)}>{MEASURES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
        )}
        <label className="text-xs font-medium text-tertiary-600">{typeLabel}<select className={`${field} mt-1 block`} value={reqType} onChange={(e) => setReqType(e.target.value)}>{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
        <label className="text-xs font-medium text-tertiary-600">{noun} status<select className={`${field} mt-1 block`} value={stage} onChange={(e) => setStage(e.target.value)}>{STAGES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
        {isVendor && (
          <label className="text-xs font-medium text-tertiary-600">Vendor type<select className={`${field} mt-1 block`} value={vendorType} onChange={(e) => setVendorType(e.target.value)}><option value="">All vendor types</option><option value="assets">Assets</option><option value="bgv">BGV</option></select></label>
        )}
        <label className="text-xs font-medium text-tertiary-600">Premium<select className={`${field} mt-1 block`} value={premium} onChange={(e) => setPremium(e.target.value)}><option value="">All</option><option value="yes">Premium</option><option value="no">Not premium</option></select></label>
        <label className="text-xs font-medium text-tertiary-600">Search<input className={`${field} mt-1 block w-44`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`${noun} name…`} /></label>
        <label className="flex items-center gap-2 pb-2 text-sm text-tertiary-700"><input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />Hide {isVendor ? 'vendors' : 'clients'} with none</label>
        <button type="button" className="btn-secondary ml-auto" onClick={exportCsv} disabled={!data}>Export CSV</button>
      </div>

      <p className="text-xs text-tertiary-500">
        {isVendor ? 'Candidates sourced from each vendor who joined, by joining date.' : MEASURES.find((m) => m.value === measure)?.hint + '.'} Every {noun.toLowerCase()} is listed, whatever its status.
      </p>

      <div className="overflow-auto rounded-2xl border border-tertiary-100 bg-white shadow-card" style={{ maxHeight: '68vh' }}>
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 min-w-[14rem] border-b bg-tertiary-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-tertiary-500">{noun}</th>
              <th className="sticky top-0 z-20 border-b bg-tertiary-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-tertiary-500">Status</th>
              {(data?.months || []).map((m) => <th key={m.key} className="sticky top-0 z-20 whitespace-nowrap border-b bg-tertiary-50 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-tertiary-500">{m.label}</th>)}
              <th className="sticky top-0 z-20 border-b bg-tertiary-50 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-tertiary-700">Total</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows || []).map((r) => (
              <tr key={r.id || 'none'} className="hover:bg-primary-50/40">
                <td className="sticky left-0 z-10 border-b bg-white px-3 py-2 font-medium text-tertiary-900">{r.name}{r.premium && <span className="ml-2 text-xs text-amber-600">★ Premium</span>}</td>
                <td className="border-b px-3 py-2">{r.stage ? <Pill tone={STAGE_TONE[r.stage]}>{STAGE_LABEL[r.stage]}</Pill> : '—'}</td>
                {data.months.map((m) => <td key={m.key} className={`border-b px-3 py-2 text-right tabular-nums ${r.counts[m.key] ? 'font-semibold text-tertiary-900' : 'text-tertiary-300'}`}>{r.counts[m.key] || '·'}</td>)}
                <td className="border-b px-3 py-2 text-right font-semibold tabular-nums text-tertiary-900">{r.total}</td>
              </tr>
            ))}
            {data && data.rows.length === 0 && <tr><td colSpan={data.months.length + 3} className="px-3 py-10 text-center text-sm text-tertiary-500">Nothing matches these filters.</td></tr>}
            {!data && <tr><td colSpan={3} className="px-3 py-10 text-center text-sm text-tertiary-500">{loading ? 'Loading…' : 'Choose a period.'}</td></tr>}
          </tbody>
          {data && data.rows.length > 0 && (
            <tfoot>
              <tr>
                <td className="sticky bottom-0 left-0 z-20 border-t bg-tertiary-50 px-3 py-2 text-xs font-semibold uppercase text-tertiary-700">Total {measureLabel?.toLowerCase()}</td>
                <td className="sticky bottom-0 border-t bg-tertiary-50" />
                {data.months.map((m) => <td key={m.key} className="sticky bottom-0 border-t bg-tertiary-50 px-3 py-2 text-right font-semibold tabular-nums">{data.totals[m.key] || 0}</td>)}
                <td className="sticky bottom-0 border-t bg-tertiary-50 px-3 py-2 text-right font-bold tabular-nums">{data.grand_total}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
