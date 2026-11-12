import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../lib/apiClient.js';
import { fetchAllPages } from '../../lib/fetchAllPages.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { rangeForPreset } from '../../lib/datePresets.js';
import { useTeamOptions, useVendorAccountOptions } from '../../lib/lookups.js';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import FilterBar from '../../components/ui/FilterBar.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import { ExcelIcon, PdfIcon } from '../../components/ui/ExportIcons.jsx';
import { formatReportDate } from './reportViews.js';

const PROFILE_TYPES = [
  { value: 'vendor', label: 'Vendor' },
  { value: 'market', label: 'Market' },
  { value: 'bench', label: 'Bench' },
];
const th = 'px-3 py-2 text-left text-xs font-semibold text-tertiary-600 align-bottom';
const td = 'px-3 py-2 tabular-nums';
// Since First reads like "20%", Layer by Layer like "20.00%" (the report's own format).
const sinceText = (v) => (v == null ? '—' : `${Number(v.toFixed(1))}%`);
const layerText = (v) => (v == null ? '—' : `${v.toFixed(2)}%`);

// A count that opens the candidates behind it (a zero has nothing to open).
function Count({ value, onClick, className = '' }) {
  if (!value) return <span>{value ?? 0}</span>;
  return (
    <button type="button" data-testid="panel-count" onClick={onClick} title="Click to see the candidates" className={`min-w-[1.5rem] rounded-md px-1.5 py-0.5 font-semibold tabular-nums text-primary-700 hover:bg-primary-50 hover:underline ${className}`}>
      {value}
    </button>
  );
}

const COLUMNS = [
  { key: 'bucket', label: 'Bucket' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'attended', label: 'Attended' },
  { key: 'pending', label: 'Decision Pending' },
  { key: 'rejected', label: 'Rejected', tone: 'text-danger-700' },
  { key: 'passed', label: 'Passed', tone: 'text-success-700' },
  { key: 'skipped', label: 'Skipped', tone: 'text-tertiary-700' },
];

function Panel({ panel, onOpen }) {
  return (
    <section className="space-y-2" data-testid={`panel-${panel.template.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">
          {panel.template.name}
          {!panel.template.is_active && <span className="ml-2 rounded-full bg-tertiary-100 px-2 py-0.5 text-[10px] font-normal text-tertiary-600">inactive</span>}
        </h3>
        <span className="text-xs text-tertiary-500">{panel.submissions} submission{panel.submissions === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-sm">
          <thead className="bg-canvas-muted">
            <tr>
              <th className={th}>No</th>
              <th className={th}>Layer</th>
              <th className={th}>Since First</th>
              <th className={th}>Layer by Layer</th>
              {COLUMNS.map((c) => <th key={c.key} className={th}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {panel.layers.map((l) => (
              <tr key={l.round_id} className="border-t border-tertiary-100" data-testid={`layer-${l.no}`}>
                <td className={td}>{l.no}</td>
                <td className="min-w-[18rem] px-3 py-2 font-medium text-tertiary-900">{l.label}</td>
                <td className={td}>{sinceText(l.since_first_pct)}</td>
                <td className={td}>{layerText(l.layer_pct)}</td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className={`${td} ${c.tone || ''}`}>
                    <Count value={l[c.key]} className={c.tone || ''} onClick={() => onOpen({ title: `${panel.template.name} · Layer ${l.no} · ${c.label}`, params: { template_id: panel.template.id, layer: l.no, metric: c.key } })} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DetailsDrawer({ detail, onClose }) {
  const data = detail?.data;
  return (
    <Drawer open={Boolean(detail)} onClose={onClose} title={detail?.title || ''} size="xl" tone="info">
      {detail?.loading && <p className="text-sm text-tertiary-500">Loading…</p>}
      {detail?.error && <p className="text-sm text-danger-700">{detail.error}</p>}
      {data && (
        <div className="space-y-2" data-testid="panel-details">
          <p className="text-xs text-tertiary-500">{data.total} candidate{data.total === 1 ? '' : 's'}{data.shown < data.total ? ` (showing the latest ${data.shown})` : ''}</p>
          <div className="overflow-x-auto rounded-xl border border-tertiary-100">
            <table className="min-w-full text-sm">
              <thead className="bg-canvas-muted">
                <tr>
                  <th className={th}>Candidate</th><th className={th}>Submitted on</th><th className={th}>Recruiter</th><th className={th}>Type</th><th className={th}>Client / requirement</th>
                  <th className={th}>Sales owner</th><th className={th}>Brought by</th><th className={th}>At this layer</th><th className={th}>Submission</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.submission_id} className="border-t border-tertiary-100" data-testid="panel-detail-row">
                    <td className="px-3 py-2 font-medium"><Link to={`/profiles/${i.profile_id}`} className="text-primary-700 hover:underline">{i.name}</Link></td>
                    <td className="whitespace-nowrap px-3 py-2">{formatReportDate(i.submitted_on)}</td>
                    <td className="px-3 py-2">{i.recruiter}</td>
                    <td className="px-3 py-2">{i.profile_type}{i.vendor && <span className="block text-[11px] text-tertiary-500">{i.vendor}</span>}</td>
                    <td className="px-3 py-2">{i.client || '—'}{i.requirement && <span className="block text-[11px] text-tertiary-500">{i.requirement}</span>}</td>
                    <td className="px-3 py-2">{i.sales_owner || '—'}</td>
                    <td className="px-3 py-2">{i.brought_by || '—'}</td>
                    <td className="px-3 py-2">{i.layer_status}</td>
                    <td className="px-3 py-2"><Link to={`/submissions/${i.submission_id}`} className="text-primary-700 hover:underline">Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Drawer>
  );
}

/**
 * Hiring panels: one table per interview template (Client Hiring, Internal Technical, Internal Sales / HR / Operations ...), each
 * template round a layer: how many reach it (bucket), get it scheduled, attend, and are decided, plus the conversion from the first
 * layer and from the layer before. Candidates are picked by the date they were submitted.
 */
export default function HiringPanels() {
  const { pushError } = useAlerts();
  const initial = rangeForPreset('this_month');
  const [datePreset, setDatePreset] = useState('this_month');
  const [dateFrom, setDateFrom] = useState(initial.date_from);
  const [dateTo, setDateTo] = useState(initial.date_to);
  const [vendorId, setVendorId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [sourcerId, setSourcerId] = useState('');
  const [clientId, setClientId] = useState('');
  const [salesOwnerId, setSalesOwnerId] = useState('');
  const [broughtById, setBroughtById] = useState('');
  const [profileType, setProfileType] = useState('');
  const [people, setPeople] = useState([]);
  const [clients, setClients] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState(null);
  const vendorOptions = useVendorAccountOptions(true);
  const teamOptions = useTeamOptions(true);

  useEffect(() => {
    apiClient.get('/users/directory').then(({ data: res }) => setPeople((res.data || []).map((u) => ({ value: u.id, label: u.active === false ? `${u.name} (inactive)` : u.name })))).catch(() => setPeople([]));
    fetchAllPages('/accounts', { sort_by: 'name', sort_order: 'asc' }).then((rows) => setClients(rows.map((a) => ({ value: a.id, label: a.name })))).catch(() => setClients([]));
  }, []);

  useEffect(() => {
    if (datePreset === 'custom') return;
    const range = rangeForPreset(datePreset);
    setDateFrom(range.date_from);
    setDateTo(range.date_to);
  }, [datePreset]);

  const params = useMemo(() => ({
    date_from: dateFrom,
    date_to: dateTo,
    ...(vendorId ? { vendor_account_id: vendorId } : {}),
    ...(teamId ? { team_id: teamId } : {}),
    ...(sourcerId ? { sourcer_id: sourcerId } : {}),
    ...(clientId ? { client_id: clientId } : {}),
    ...(salesOwnerId ? { sales_owner_id: salesOwnerId } : {}),
    ...(broughtById ? { brought_by_id: broughtById } : {}),
    ...(profileType ? { profile_type: profileType } : {}),
  }), [dateFrom, dateTo, vendorId, teamId, sourcerId, clientId, salesOwnerId, broughtById, profileType]);

  useEffect(() => {
    if (!dateFrom || !dateTo) return undefined;
    let cancelled = false;
    setLoading(true);
    apiClient.get('/reports/hiring-panels', { params })
      .then(({ data: res }) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) { setData(null); pushError(apiErrorMessage(err, 'Failed to load the hiring panels'), 'Could not load'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openDetail({ title, params: extra }) {
    setDetail({ title, loading: true });
    try {
      const { data: res } = await apiClient.get('/reports/hiring-panels/details', { params: { ...params, ...extra } });
      setDetail({ title, data: res.data });
    } catch (err) {
      setDetail({ title, error: apiErrorMessage(err, 'Failed to load the candidates') });
    }
  }

  async function exportReport(type) {
    setExporting(true);
    try {
      const { data: blob } = await apiClient.get('/reports/export', { params: { type, report: 'hiring-panels', ...params }, responseType: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hiring-panels.${type}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Export failed'), 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const select = (props) => <SearchableSelect className="w-44" allowClear searchPlaceholder="Search…" {...props} />;
  return (
    <div className="space-y-4" data-testid="hiring-panels">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-3xl text-xs text-tertiary-500">
          One table per hiring template. Each template round is a layer: <b>Bucket</b> = candidates who reach it (everyone for layer 1, then those who passed or skipped the layer before), then how many were scheduled, attended and decided. <b>Since First</b> = bucket / layer 1 bucket, <b>Layer by Layer</b> = bucket / the bucket before. Candidates are picked by the date they were submitted.
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" disabled={exporting} onClick={() => exportReport('xlsx')} aria-label="Export Excel"><ExcelIcon /> Excel</button>
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" disabled={exporting} onClick={() => exportReport('pdf')} aria-label="Export PDF"><PdfIcon /> PDF</button>
        </div>
      </div>

      <FilterBar
        datePreset={datePreset}
        onDatePresetChange={setDatePreset}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={(v) => { setDatePreset('custom'); setDateFrom(v); }}
        onDateToChange={(v) => { setDatePreset('custom'); setDateTo(v); }}
      >
        {select({ ariaLabel: 'Filter by vendor', value: vendorId, onChange: setVendorId, placeholder: 'Vendor: All', options: vendorOptions })}
        {select({ ariaLabel: 'Filter by team', value: teamId, onChange: setTeamId, placeholder: 'Team: All', options: teamOptions })}
        {select({ ariaLabel: 'Filter by recruiter', value: sourcerId, onChange: setSourcerId, placeholder: 'Recruiter: All', options: people })}
        {select({ ariaLabel: 'Filter by client', value: clientId, onChange: setClientId, placeholder: 'Client: All', options: clients })}
        {select({ ariaLabel: 'Filter by sales owner', value: salesOwnerId, onChange: setSalesOwnerId, placeholder: 'Sales owner: All', options: people })}
        {select({ ariaLabel: 'Filter by who brought the client', value: broughtById, onChange: setBroughtById, placeholder: 'Sales brought: All', options: people })}
        {select({ ariaLabel: 'Filter by profile type', value: profileType, onChange: setProfileType, placeholder: 'Profile type: All', options: PROFILE_TYPES })}
      </FilterBar>

      <DetailsDrawer detail={detail} onClose={() => setDetail(null)} />

      {loading && !data && <p className="text-sm text-tertiary-500">Loading…</p>}
      {data && (
        <>
          <p className="text-xs text-tertiary-500">Submissions made {formatReportDate(data.filters.date_from)} to {formatReportDate(data.filters.date_to)}: {data.total_submissions}{data.without_template ? ` (${data.without_template} left out: requirement has no interview template)` : ''}.</p>
          {data.panels.length === 0
            ? <EmptyState title="No hiring templates" description="Add interview templates in Hiring setup to see their panels here." />
            : data.panels.map((panel) => <Panel key={panel.template.id} panel={panel} onOpen={openDetail} />)}
          <details className="rounded-xl border border-tertiary-100 bg-white p-3 text-xs text-tertiary-600 shadow-card" data-testid="panel-assumptions">
            <summary className="cursor-pointer text-sm font-medium text-tertiary-800">How these numbers are worked out</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">{data.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
          </details>
        </>
      )}
    </div>
  );
}
