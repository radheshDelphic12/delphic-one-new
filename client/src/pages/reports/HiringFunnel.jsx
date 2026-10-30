import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import apiClient from '../../lib/apiClient.js';
import { fetchAllPages } from '../../lib/fetchAllPages.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { rangeForPreset } from '../../lib/datePresets.js';
import { CHART_COLORS, chartTooltipStyle } from '../../lib/chartTheme.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import FilterBar from '../../components/ui/FilterBar.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import { ExcelIcon, PdfIcon } from '../../components/ui/ExportIcons.jsx';
import { formatReportDate } from './reportViews.js';

const SERVICE_OPTIONS = [
  { value: 'client', label: 'Client hiring' },
  { value: 'internal', label: 'Internal hiring' },
];
const GROUP_OPTIONS = [
  { value: 'month', label: 'Month-wise' },
  { value: 'week', label: 'Week-wise' },
  { value: 'none', label: 'No breakup' },
];
const COLORS = { passed: CHART_COLORS.success, notHeld: CHART_COLORS.warning, pending: CHART_COLORS.info, dropped: CHART_COLORS.danger, unavailable: CHART_COLORS.muted };

const pctText = (v) => (v == null ? '—' : `${v}%`);
const daysText = (v) => (v == null ? '—' : `${v}d`);
const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-tertiary-500';
const td = 'px-3 py-2 tabular-nums';

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-tertiary-100 bg-white p-3 shadow-card">
      <p className="text-xs text-tertiary-500">{label}</p>
      <p className="mt-1 font-heading text-2xl font-semibold text-tertiary-900">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-tertiary-500">{hint}</p>}
    </div>
  );
}

// What counts as "passed" at a stage depends on the toggle: a round that was not held counts as passed, or is shown on its own.
function stageNumbers(stage, assumedAsPass) {
  const passed = stage.passed + (assumedAsPass ? stage.assumed : 0);
  const notHeld = assumedAsPass ? 0 : stage.assumed;
  const base = stage.reached - stage.unavailable - notHeld;
  return { passed, notHeld, passRate: base > 0 ? Math.round((passed / base) * 1000) / 10 : null };
}

function FunnelSection({ funnel, assumedAsPass }) {
  const rows = useMemo(() => funnel.stages.map((s) => ({ ...s, ...stageNumbers(s, assumedAsPass) })), [funnel, assumedAsPass]);
  const chartData = rows.map((r) => ({ name: r.label, Passed: r.passed, 'Not held': r.notHeld, 'In progress': r.pending, Dropped: r.dropped, 'Data unavailable': r.unavailable }));
  const clientR1 = rows.find((r) => r.key === 'client_r1');
  return (
    <section className="space-y-3" data-testid={`funnel-${funnel.track}`}>
      <ChartCard title={`${funnel.label} funnel`} subtitle={`${funnel.profiles} profiles reached this funnel`}>
        <div style={{ height: Math.max(220, rows.length * 38) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 24, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={chartTooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Passed" stackId="a" fill={COLORS.passed} />
              <Bar dataKey="Not held" stackId="a" fill={COLORS.notHeld} />
              <Bar dataKey="In progress" stackId="a" fill={COLORS.pending} />
              <Bar dataKey="Dropped" stackId="a" fill={COLORS.dropped} />
              <Bar dataKey="Data unavailable" stackId="a" fill={COLORS.unavailable} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {clientR1 && (
        <div className="rounded-xl border border-primary-200 bg-primary-50/50 px-4 py-3 text-sm text-tertiary-800" data-testid="client-round-1">
          <b>Client Round 1:</b> {clientR1.reached} came, <b className="text-success-700">{clientR1.passed} passed</b>
          {clientR1.notHeld > 0 && <>, {clientR1.notHeld} not held</>}, <b className="text-danger-700">{clientR1.dropped} dropped</b>, {clientR1.pending} in progress
          {clientR1.unavailable > 0 && <>, {clientR1.unavailable} data unavailable</>}. Pass-through <b>{pctText(clientR1.passRate)}</b>.
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-sm">
          <thead className="bg-canvas-muted">
            <tr>
              <th className={th}>Stage</th><th className={th}>Came</th><th className={th}>Passed</th><th className={th}>Not held</th>
              <th className={th}>Dropped</th><th className={th}>In progress</th><th className={th}>Data unavailable</th><th className={th}>Pass rate</th><th className={th}>Avg days from sourcing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const flagged = !assumedAsPass && r.notHeld > 0;
              return (
                <tr key={r.key} className={`border-t border-tertiary-100 ${flagged ? 'bg-warning-50' : ''} ${r.key === 'client_r1' ? 'font-semibold' : ''}`} data-testid={`stage-row-${r.key}`} data-flagged={flagged ? 'true' : 'false'}>
                  <td className="px-3 py-2">
                    {r.label}{r.optional && <span className="ml-1.5 rounded-full bg-tertiary-100 px-1.5 py-0.5 text-[10px] font-normal text-tertiary-600">optional</span>}
                    {r.names.length > 0 && <span className="block text-[11px] font-normal text-tertiary-500">{r.names.join(' / ')}</span>}
                  </td>
                  <td className={td}>{r.reached}</td>
                  <td className={`${td} text-success-700`}>{r.passed}{assumedAsPass && r.assumed > 0 && <span className="ml-1 text-[11px] text-tertiary-500">(incl. {r.assumed} not held)</span>}</td>
                  <td className={`${td} ${flagged ? 'font-semibold text-warning-800' : ''}`}>{r.notHeld || (assumedAsPass ? '—' : 0)}</td>
                  <td className={`${td} text-danger-700`}>{r.dropped}</td>
                  <td className={td}>{r.pending}</td>
                  <td className={td}>{r.unavailable}</td>
                  <td className={td}>{r.key === 'sourced' ? '—' : pctText(r.passRate)}</td>
                  <td className={td}>{daysText(r.avg_days_from_start)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RecruiterTable({ rows, summary }) {
  const team = { first: summary.first_round_pct, client: summary.client_round_pct, selected: summary.selected_pct };
  const weak = (value, ref) => value != null && ref != null && value < ref;
  return (
    <div className="overflow-x-auto rounded-xl border border-tertiary-100 bg-white shadow-card" data-testid="recruiter-table">
      <table className="min-w-full text-sm">
        <thead className="bg-canvas-muted">
          <tr>
            <th className={th}>Recruiter</th><th className={th}>Sourced</th><th className={th}>Submitted</th><th className={th}>First round cleared</th>
            <th className={th}>Reached client round</th><th className={th}>Selected</th><th className={th}>Dropped</th><th className={th}>In progress</th>
            <th className={th}>First round %</th><th className={th}>Client round %</th><th className={th}>Selected %</th><th className={th}>Avg days to join</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sourcer_id} className="border-t border-tertiary-100">
              <td className="px-3 py-2 font-medium text-tertiary-900">{r.sourcer}</td>
              <td className={td}>{r.sourced}</td><td className={td}>{r.submitted}</td><td className={td}>{r.first_round_cleared}</td>
              <td className={td}>{r.reached_client_round}</td><td className={td}>{r.selected}</td><td className={td}>{r.dropped}</td><td className={td}>{r.in_progress}</td>
              <td className={`${td} ${weak(r.first_round_pct, team.first) ? 'bg-warning-50 font-semibold text-warning-800' : ''}`}>{pctText(r.first_round_pct)}</td>
              <td className={`${td} ${weak(r.client_round_pct, team.client) ? 'bg-warning-50 font-semibold text-warning-800' : ''}`}>{pctText(r.client_round_pct)}</td>
              <td className={`${td} ${weak(r.selected_pct, team.selected) ? 'bg-warning-50 font-semibold text-warning-800' : ''}`}>{pctText(r.selected_pct)}</td>
              <td className={td}>{daysText(r.avg_days_to_join)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-tertiary-200 bg-canvas-muted font-semibold">
            <td className="px-3 py-2">Whole team</td>
            <td className={td}>{summary.sourced}</td><td className={td}>{summary.submitted}</td><td className={td}>{summary.first_round_cleared}</td>
            <td className={td}>{summary.reached_client_round}</td><td className={td}>{summary.selected}</td><td className={td}>{summary.dropped}</td><td className={td}>{summary.in_progress}</td>
            <td className={td}>{pctText(team.first)}</td><td className={td}>{pctText(team.client)}</td><td className={td}>{pctText(team.selected)}</td><td className={td}>{daysText(summary.avg_days_to_join)}</td>
          </tr>
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-tertiary-500">Amber = below the team's rate. First round % = cleared / submitted; client round % = reached a client round / cleared the first round; selected % = selected / sourced.</p>
    </div>
  );
}

export default function HiringFunnel() {
  const { pushError } = useAlerts();
  const initial = rangeForPreset('this_month');
  const [datePreset, setDatePreset] = useState('this_month');
  const [dateFrom, setDateFrom] = useState(initial.date_from);
  const [dateTo, setDateTo] = useState(initial.date_to);
  const [sourcerId, setSourcerId] = useState('');
  const [clientId, setClientId] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [groupBy, setGroupBy] = useState('month');
  const [assumedAsPass, setAssumedAsPass] = useState(true);
  const [people, setPeople] = useState([]);
  const [clients, setClients] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

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
    group_by: groupBy,
    ...(sourcerId ? { sourcer_id: sourcerId } : {}),
    ...(clientId ? { client_id: clientId } : {}),
    ...(serviceType ? { service_type: serviceType } : {}),
  }), [dateFrom, dateTo, groupBy, sourcerId, clientId, serviceType]);

  useEffect(() => {
    if (!dateFrom || !dateTo) return undefined;
    let cancelled = false;
    setLoading(true);
    apiClient.get('/reports/hiring-funnel', { params })
      .then(({ data: res }) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) { setData(null); pushError(apiErrorMessage(err, 'Failed to load the hiring funnel'), 'Could not load'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  async function exportReport(type) {
    setExporting(true);
    try {
      const { data: blob } = await apiClient.get('/reports/export', { params: { type, report: 'hiring-funnel', ...params }, responseType: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hiring-funnel.${type}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Export failed'), 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const summary = data?.summary;
  return (
    <div className="space-y-4" data-testid="hiring-funnel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-heading text-base font-semibold text-tertiary-900">Hiring funnel</h2>
          <p className="text-xs text-tertiary-500">Profiles sourced between the dates, followed through every round. What happens after the end date is counted too.</p>
        </div>
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
        <SearchableSelect className="w-48" allowClear ariaLabel="Filter by recruiter" value={sourcerId} onChange={setSourcerId} placeholder="Recruiter: All" searchPlaceholder="Search people…" options={people} />
        <SearchableSelect className="w-48" allowClear ariaLabel="Filter by client" value={clientId} onChange={setClientId} placeholder="Client: All" searchPlaceholder="Search clients…" options={clients} />
        <SearchableSelect className="w-44" allowClear ariaLabel="Filter by service type" value={serviceType} onChange={setServiceType} placeholder="Service: All" searchPlaceholder="Search…" options={SERVICE_OPTIONS} />
        <SearchableSelect className="w-40" ariaLabel="Group by" value={groupBy} onChange={(v) => setGroupBy(v || 'month')} placeholder="Breakup" searchPlaceholder="Search…" options={GROUP_OPTIONS} />
        <label className="flex items-center gap-2 text-xs text-tertiary-700" data-testid="assumed-toggle">
          <input type="checkbox" checked={assumedAsPass} onChange={(e) => setAssumedAsPass(e.target.checked)} />
          Count rounds that were not held as passed
        </label>
      </FilterBar>

      {loading && !data && <p className="text-sm text-tertiary-500">Loading…</p>}
      {data && (
        <>
          <p className="text-xs text-tertiary-500">Cohort: profiles sourced {formatReportDate(data.filters.date_from)} to {formatReportDate(data.filters.date_to)}.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7" data-testid="funnel-summary">
            <Stat label="Sourced" value={summary.sourced} hint={`${summary.not_submitted} not submitted anywhere`} />
            <Stat label="Submitted" value={summary.submitted} />
            <Stat label="First round cleared" value={summary.first_round_cleared} hint={pctText(summary.first_round_pct)} />
            <Stat label="Reached a client round" value={summary.reached_client_round} hint={pctText(summary.client_round_pct)} />
            <Stat label="Selected / joined" value={summary.selected} hint={pctText(summary.selected_pct)} />
            <Stat label="Dropped / in progress" value={`${summary.dropped} / ${summary.in_progress}`} />
            <Stat label="Avg time sourcing → joined" value={daysText(summary.avg_days_to_join)} hint={summary.joined_count ? `median ${daysText(summary.median_days_to_join)} · ${summary.joined_count} joined` : 'no joiners yet'} />
          </div>

          {data.funnels.length === 0 ? (
            <EmptyState title="No profiles in this funnel" description="No profile sourced in these dates has been submitted to a requirement yet." />
          ) : (
            data.funnels.map((funnel) => <FunnelSection key={funnel.track} funnel={funnel} assumedAsPass={assumedAsPass} />)
          )}

          <section className="space-y-2">
            <h3 className="font-heading text-sm font-semibold text-tertiary-900">Recruiter-wise</h3>
            {data.recruiters.length ? <RecruiterTable rows={data.recruiters} summary={summary} /> : <p className="text-sm text-tertiary-500">No recruiters in this selection.</p>}
          </section>

          {data.trend.length > 0 && (
            <section className="space-y-2" data-testid="funnel-trend">
              <h3 className="font-heading text-sm font-semibold text-tertiary-900">{groupBy === 'week' ? 'Week-wise' : 'Month-wise'} (by sourcing date)</h3>
              <div className="overflow-x-auto rounded-xl border border-tertiary-100 bg-white shadow-card">
                <table className="min-w-full text-sm">
                  <thead className="bg-canvas-muted"><tr><th className={th}>Period</th><th className={th}>Sourced</th><th className={th}>First round cleared</th><th className={th}>Reached client round</th><th className={th}>Selected</th><th className={th}>Dropped</th></tr></thead>
                  <tbody>
                    {data.trend.map((t) => (
                      <tr key={t.bucket} className="border-t border-tertiary-100"><td className="px-3 py-2 font-medium">{t.bucket}</td><td className={td}>{t.sourced}</td><td className={td}>{t.first_round_cleared}</td><td className={td}>{t.reached_client_round}</td><td className={td}>{t.selected}</td><td className={td}>{t.dropped}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <details className="rounded-xl border border-tertiary-100 bg-white p-3 text-xs text-tertiary-600 shadow-card" data-testid="funnel-assumptions">
            <summary className="cursor-pointer text-sm font-medium text-tertiary-800">Assumptions behind these numbers</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">{data.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
          </details>
        </>
      )}
    </div>
  );
}
