import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { saveCsv } from '../../lib/saveCsv.js';
import Pill from '../../components/ui/Pill.jsx';
import Drawer from '../../components/ui/Drawer.jsx';

const MEASURES = [
  { value: 'projects', label: 'Projects won', hint: 'Requirements with a closed candidate, counted once per requirement in the month the seat was closed (same as the Monthly Performance Review)' },
  { value: 'joinings', label: 'Candidates joined', hint: 'Candidates who joined on the client’s requirements, by joining date' },
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

/** A count that opens the records behind it. A zero is plain text: there is nothing to open. */
function Count({ value, onClick, label, className = '' }) {
  if (!value) return <span className="text-tertiary-300">{value === 0 ? '·' : '—'}</span>;
  return (
    <button type="button" data-testid="closure-count" title="Click to see the records" aria-label={label} onClick={onClick} className={`min-w-[1.75rem] rounded-md px-1.5 py-0.5 tabular-nums text-primary-700 hover:bg-primary-50 hover:underline ${className}`}>
      {value}
    </button>
  );
}

/** The records behind one number: each one links to its own page (project, candidate's submission or requirement). */
function RecordsDrawer({ request, onClose, noun }) {
  const { pushError } = useAlerts();
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!request) { setData(null); return undefined; }
    let live = true;
    setData(null);
    apiClient.get('/reports/closure-matrix/records', { params: request.params })
      .then((res) => { if (live) setData(res.data.data); })
      .catch((e) => { if (live) { pushError(apiErrorMessage(e, 'Could not load the records'), 'Report failed'); onClose(); } });
    return () => { live = false; };
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps
  const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-tertiary-500';
  return (
    <Drawer open={Boolean(request)} onClose={onClose} title={request?.title || ''} size="xl" tone="info">
      {!data && <p className="text-sm text-tertiary-500">Loading…</p>}
      {data && (
        <div className="space-y-2" data-testid="closure-records">
          <p className="text-xs text-tertiary-500">{data.total} record{data.total === 1 ? '' : 's'}{data.truncated ? ' (the first 1000 are shown)' : ''}. Click a name to open it.</p>
          <div className="overflow-x-auto rounded-xl border border-tertiary-100">
            <table className="min-w-full text-sm">
              <thead className="bg-tertiary-50"><tr><th className={th}>{data.measure === 'joinings' ? 'Candidate' : 'Requirement'}</th><th className={th}>Details</th><th className={th}>{noun}</th><th className={th}>Date</th></tr></thead>
              <tbody>
                {data.records.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} className="border-t border-tertiary-100">
                    <td className="px-3 py-2 font-medium"><Link to={r.path} className="text-primary-700 hover:underline" data-testid="closure-record-link">{r.title}</Link></td>
                    <td className="px-3 py-2 text-tertiary-600">{r.subtitle || '—'}</td>
                    <td className="px-3 py-2 text-tertiary-800">{r.party_id ? <Link to={`/accounts/${r.party_id}`} className="hover:underline">{r.party}</Link> : r.party}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-tertiary-600"><span className="block text-[11px] text-tertiary-400">{r.date_label}</span>{r.date}</td>
                  </tr>
                ))}
                {!data.records.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-tertiary-500">Nothing here.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Drawer>
  );
}

/** Client-wise (kind="client") or vendor-wise (kind="vendor") matrix: names down the side, months across the top, a count in each cell. */
export default function ClosureMatrix({ kind }) {
  const { pushError } = useAlerts();
  const isVendor = kind === 'vendor';
  const now = new Date();
  const [from, setFrom] = useState(monthValue(new Date(now.getFullYear(), now.getMonth() - 5, 1)));
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
  const [records, setRecords] = useState(null); // { title, params } of the count that was clicked

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

  // The records of a count carry every filter of the report, narrowed to the client / vendor and month that was clicked.
  const openRecords = (title, extra = {}) => setRecords({ title: `${title} - ${measureLabel}`, params: { ...params, ...extra } });

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
                {data.months.map((m) => <td key={m.key} className={`border-b px-3 py-2 text-right tabular-nums ${r.counts[m.key] ? 'font-semibold text-tertiary-900' : 'text-tertiary-300'}`}><Count value={r.counts[m.key] || 0} label={`${r.name} ${m.label}: ${r.counts[m.key] || 0}`} onClick={() => openRecords(`${r.name} · ${m.label}`, { account_id: r.id || 'none', month: m.key })} /></td>)}
                <td className="border-b px-3 py-2 text-right font-semibold tabular-nums text-tertiary-900"><Count value={r.total} label={`${r.name} total: ${r.total}`} onClick={() => openRecords(`${r.name} · all months`, { account_id: r.id || 'none' })} /></td>
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
                {data.months.map((m) => <td key={m.key} className="sticky bottom-0 border-t bg-tertiary-50 px-3 py-2 text-right font-semibold tabular-nums"><Count value={data.totals[m.key] || 0} label={`${m.label} total`} onClick={() => openRecords(`All ${noun.toLowerCase()}s · ${m.label}`, { month: m.key })} /></td>)}
                <td className="sticky bottom-0 border-t bg-tertiary-50 px-3 py-2 text-right font-bold tabular-nums"><Count value={data.grand_total} label="Grand total" onClick={() => openRecords(`All ${noun.toLowerCase()}s · all months`)} /></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <RecordsDrawer request={records} onClose={() => setRecords(null)} noun={noun} />
    </div>
  );
}
