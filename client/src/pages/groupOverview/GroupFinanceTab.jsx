import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from 'recharts';
import { AlertTriangle, Building2, PiggyBank, Plus, RefreshCw, Scale, TrendingUp, Wallet } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { chartTooltipStyle } from '../../lib/chartTheme.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import { downloadCsv, printReport } from '../../lib/groupExport.js';
import { loadThresholds } from '../../lib/groupSettings.js';
import useLiveData from '../../lib/useLiveData.js';
import { LiveIndicator } from '../analytics/LiveSalesTab.jsx';
import FoundationGroupSection from './FoundationGroupSection.jsx';
import { GROUPINGS, GroupFilterBar, FigureSwitch, monthStr, periodBinding, usePeriod } from './groupFilters.jsx';

// Series colours are assigned by position, so any number of companies gets a legend entry automatically.
const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#be185d', '#65a30d', '#475569', '#ea580c'];

const money = (n) => (n === null || n === undefined ? 'N/A' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
const compact = (n) => {
  const v = Math.abs(Number(n) || 0);
  const sign = Number(n) < 0 ? '-' : '';
  if (v >= 1e7) return `${sign}₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `${sign}₹${(v / 1e5).toFixed(2)} L`;
  return `${sign}₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};
const pctText = (p) => (p === null || p === undefined ? 'N/A' : `${p > 0 ? '+' : ''}${p}%`);

const LIVE_EVERY_MS = 30000;
const DEFAULTS = { granularity: 'month', state: 'all' };

function SectionTitle({ title, hint }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 border-b border-tertiary-100 pb-2 pt-3">
      <span className="h-5 w-1.5 self-center rounded-full bg-[#4f8f60]" aria-hidden="true" />
      <h2 className="font-heading text-lg font-bold tracking-tight text-tertiary-900">{title}</h2>
      {hint && <span className="text-xs text-tertiary-500">{hint}</span>}
    </div>
  );
}

const TREND_METRICS = [
  ['revenue', 'Revenue', 'One line per company'],
  ['profit', 'Profit', 'One line per company'],
  ['valuation', 'Valuation', 'Profit x 240 + asset value x 3, at the end of each period'],
  ['expenses', 'Expenses', 'Revenue minus profit, per company'],
  ['assets', 'Assets', 'Recorded asset value, carried forward until the next entry'],
];

function TrendChart({ title, subtitle, rows, companies, metric }) {
  const hasData = rows.some((r) => companies.some((c) => r[c.org.id]));
  return (
    <ChartCard title={title} subtitle={subtitle}>
      {!hasData ? (
        <EmptyState title="No data in this period" description="Nothing has been recorded for the selected companies and dates." />
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={compact} width={70} />
              <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [money(v), name]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {companies.map((c, i) => (
                <Line key={`${metric}-${c.org.id}`} type="monotone" dataKey={c.org.id} name={c.org.name} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={rows.length < 25} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

function ShareBars({ title, rows }) {
  const data = rows.map((r) => ({ name: r.org_name, share: r.share_pct ?? 0, value: r.value }));
  return (
    <ChartCard title={title} subtitle="Share of the group total (companies with a loss count as 0%)">
      {data.length === 0 ? (
        <EmptyState title="No companies" description="" />
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 20, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
              <Tooltip contentStyle={chartTooltipStyle} formatter={(v, n, p) => [`${v}%  (${money(p.payload.value)})`, 'Share']} />
              <Bar dataKey="share" fill="#2563eb" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

function AssetValueForm({ company, onSaved }) {
  const { pushError, pushInfo } = useAlerts();
  const [history, setHistory] = useState(null);
  const [month, setMonth] = useState(monthStr(new Date()));
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const orgId = company.org.id;

  const load = useCallback(() => {
    apiClient.get(`/super-dashboard/companies/${orgId}/asset-values`).then(({ data }) => setHistory(data.data)).catch((err) => pushError(apiErrorMessage(err, 'Failed to load asset values'), 'Something went wrong'));
  }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await apiClient.put(`/super-dashboard/companies/${orgId}/asset-values`, { month, asset_value: Number(value), notes: notes || undefined });
      pushInfo(data.data.previous === null ? 'Asset value added' : `Asset value revised (was ${money(data.data.previous)})`);
      setValue('');
      setNotes('');
      load();
      onSaved();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save the asset value'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={save} className="grid grid-cols-2 gap-2 rounded-xl border border-tertiary-100 p-3">
        <label className="text-xs font-medium text-tertiary-600">Month
          <input type="month" required max={monthStr(new Date())} value={month} onChange={(e) => setMonth(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs font-medium text-tertiary-600">Asset value (₹)
          <input type="number" required min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm" />
        </label>
        <label className="col-span-2 text-xs font-medium text-tertiary-600">Note (optional)
          <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm" />
        </label>
        <div className="col-span-2 flex items-center justify-between">
          <span className="text-[11px] text-tertiary-500">Saving an existing month revises it; other months are kept. Every change is audited.</span>
          <button type="submit" className="btn-primary inline-flex items-center gap-1 text-sm" disabled={saving || value === ''}><Plus className="h-4 w-4" />{saving ? 'Saving…' : 'Add / revise'}</button>
        </div>
      </form>
      {!history ? <Skeleton className="h-20 w-full" /> : history.length === 0 ? (
        <p className="text-xs text-tertiary-500">No asset value recorded yet - the valuation uses profit only.</p>
      ) : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-tertiary-500"><th className="py-1">Month</th><th className="text-right">Asset value</th><th className="pl-3">Note</th></tr></thead>
          <tbody>{history.map((h) => <tr key={h.id} className="border-t border-tertiary-100"><td className="py-1">{h.month}</td><td className="text-right">{money(h.asset_value)}</td><td className="pl-3 text-xs text-tertiary-500">{h.notes || ''}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

function DrillDown({ orgId, range, state }) {
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    setRes(null);
    setErr(false);
    apiClient.get(`/super-dashboard/companies/${orgId}/drilldown`, { params: { from: range.from, to: range.to, state } }).then(({ data }) => setRes(data.data)).catch(() => setErr(true));
  }, [orgId, range.from, range.to, state]);
  if (err) return <p className="text-sm text-danger-600">Could not load the breakdown.</p>;
  if (!res) return <Skeleton className="h-24 w-full" />;
  return (
    <div className="space-y-4">
      {res.sections.map((sec) => (
        <div key={sec.key}>
          <div className="mb-1 flex items-center justify-between">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">{sec.title}</h5>
            <button type="button" className="text-xs text-primary-700 hover:underline" onClick={() => downloadCsv(`${res.org.name}-${sec.key}-${res.from}-${res.to}.csv`, sec.columns, sec.rows)}>CSV</button>
          </div>
          {sec.rows.length === 0 ? <p className="text-sm text-tertiary-500">No records in this period.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-tertiary-500">{sec.columns.map((c, i) => <th key={c} className={i > 0 && typeof sec.rows[0][i] === 'number' ? 'text-right' : ''}>{c}</th>)}</tr></thead>
              <tbody>{sec.rows.map((r, ri) => <tr key={ri} className="border-t border-tertiary-100">{r.map((c, i) => <td key={i} className={`py-1 ${typeof c === 'number' ? 'text-right' : ''}`}>{typeof c === 'number' ? money(c) : c}</td>)}</tr>)}</tbody>
            </table>
          )}
        </div>
      ))}
      <p className="text-[11px] text-tertiary-500">{res.note}</p>
    </div>
  );
}

function CompanyDrawer({ company, formula, range, state, onClose, onOpen, onChanged }) {
  if (!company) return <Drawer open={false} onClose={onClose} title="" />;
  const v = company.valuation;
  const isFx = company.org.kind === 'foundation';
  return (
    <Drawer open title={company.org.name} onClose={onClose} size="lg" footer={<button type="button" className="btn-primary" onClick={() => onOpen(company.org)}>Open {company.org.name} (admin view)</button>}>
      <div className="space-y-5">
        <section>
          <h4 className="mb-2 font-heading text-sm font-semibold">Valuation</h4>
          {isFx ? <p className="rounded-xl bg-tertiary-50 px-3 py-2 text-sm text-tertiary-600">Not applicable: valuation (profit × {formula.profit} + asset value × {formula.asset_value}) is a business measure. A foundation is followed through its income, expenses, fund balance and campaign budgets instead. Its assets here are the fund balance: {money(company.assets)}.</p> : !v ? <p className="text-sm text-tertiary-500">No data in the selected period.</p> : (
            <div className="space-y-1 rounded-xl border border-tertiary-100 p-3 text-sm">
              <div className="flex justify-between"><span>Profit component ({money(v.profit_component / formula.profit)} × {formula.profit})</span><b>{money(v.profit_component)}</b></div>
              <div className="flex justify-between"><span>Asset component ({money(company.assets)} × {formula.asset_value})</span><b>{money(v.asset_component)}</b></div>
              <div className="flex justify-between border-t pt-1"><span>Current valuation ({v.as_of})</span><b>{money(v.current)}</b></div>
              <div className="flex justify-between text-tertiary-600"><span>Previous period</span><span>{money(v.previous)}</span></div>
              <div className="flex justify-between text-tertiary-600"><span>Change / growth</span><span>{v.change === null ? 'N/A' : `${money(v.change)} (${pctText(v.growth_pct)})`}</span></div>
            </div>
          )}
        </section>
        <section>
          <h4 className="mb-2 font-heading text-sm font-semibold">History</h4>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-tertiary-500"><th>Period</th><th className="text-right">Revenue</th><th className="text-right">Profit</th><th className="text-right">Asset value</th><th className="text-right">Valuation</th></tr></thead>
            <tbody>{company.series.map((r) => <tr key={r.key} className="border-t border-tertiary-100"><td className="py-1">{r.label}</td><td className="text-right">{money(r.revenue)}</td><td className="text-right">{money(r.profit)}</td><td className="text-right">{money(r.asset_value)}</td><td className="text-right font-medium">{money(r.valuation)}</td></tr>)}</tbody>
          </table>
        </section>
        <section>
          <h4 className="mb-2 font-heading text-sm font-semibold">Where the numbers come from</h4>
          <DrillDown orgId={company.org.id} range={range} state={state} />
        </section>
        <section>
          <h4 className="mb-2 font-heading text-sm font-semibold">{isFx ? 'Fund balance' : 'Monthly asset values'}</h4>
          {isFx ? <p className="text-sm text-tertiary-600">The fund balance is funds received minus paid spending, so it is not typed in. Record funding and spending in the foundation (open it with the button below); campaigns, budgets and their projections are managed there too.</p> : <AssetValueForm company={company} onSaved={onChanged} />}
        </section>
      </div>
    </Drawer>
  );
}

const sameDay = (a, b) => a.toDateString() === b.toDateString();
function dayLabel(d) {
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// One readable sentence per audit row; unknown actions fall back to the action name.
function describe(a) {
  const snap = a.snapshot || {};
  const who = a.actor || 'The system';
  if (a.entity === 'asset_value') {
    const was = snap.previous !== null && snap.previous !== undefined ? ` (was ${money(snap.previous)})` : '';
    return { icon: PiggyBank, tone: 'text-purple-700 bg-purple-50', title: `${who} ${a.action === 'asset_value_create' ? 'added' : 'revised'} the asset value`, detail: `${snap.month || ''}: ${money(snap.new)}${was}` };
  }
  if (a.action === 'group_admin_access') return { icon: Building2, tone: 'text-blue-700 bg-blue-50', title: `${who} opened the company as group admin`, detail: '' };
  const words = `${a.action || ''}`.replace(/_/g, ' ');
  return { icon: TrendingUp, tone: 'text-tertiary-600 bg-tertiary-100', title: `${who}: ${words}`, detail: [a.entity && a.entity.replace(/_/g, ' '), a.detail].filter(Boolean).join(' - ') };
}

function ActivityFeed({ items, colorOf }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) {
    return <EmptyState title="No activity yet" description="Nothing changed in the last 7 days. Changes made in any company of the group, such as asset values, appear here." />;
  }
  const shown = all ? items : items.slice(0, 8);
  const days = [];
  for (const a of shown) {
    const label = dayLabel(new Date(a.at));
    const last = days[days.length - 1];
    if (last && last.label === label) last.rows.push(a);
    else days.push({ label, rows: [a] });
  }
  return (
    <div>
      <div className="space-y-5">
        {days.map((d) => (
          <div key={d.label}>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary-400">{d.label}</div>
            <ol className="relative space-y-3 border-l-2 border-tertiary-100 pl-5">
              {d.rows.map((a) => {
                const x = describe(a);
                const Icon = x.icon;
                return (
                  <li key={a.id} className="relative">
                    <span className={`absolute -left-[33px] flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-white ${x.tone}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-sm font-medium text-tertiary-900">{x.title}</span>
                      {a.company?.name && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: colorOf(a.company.id) }}>{a.company.name}</span>}
                    </div>
                    {x.detail && <div className="text-sm text-tertiary-600">{x.detail}</div>}
                    <div className="text-xs text-tertiary-400">{new Date(a.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
      {items.length > 8 && (
        <button type="button" className="mt-4 text-sm font-medium text-primary-700 hover:underline" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

export default function GroupFinanceTab() {
  const { switchOrg } = useAuth();
  const { pushError } = useAlerts();
  const navigate = useNavigate();
  const { pushInfo } = useAlerts();
  const period = usePeriod('this_month');
  const [granularity, setGranularity] = useState(DEFAULTS.granularity);
  const [state, setState] = useState(DEFAULTS.state);
  const [selected, setSelected] = useState(null); // null = all companies
  const [allCompanies, setAllCompanies] = useState([]);
  const [activity, setActivity] = useState([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'valuation', dir: 'desc' });
  const [openOrgId, setOpenOrgId] = useState(null);

  const { range, valid: validRange } = period;
  const selectedKey = selected ? selected.join(',') : '';

  // Every filter change reloads at once (a slower, older answer can never overwrite a newer one), and the page
  // refreshes itself every 30 seconds while it is open, so the figures follow the books.
  const { data, loading, error, updatedAt, refresh } = useLiveData(
    () => {
      const params = { from: range.from, to: range.to, granularity, state, ...loadThresholds() };
      if (selectedKey) params.org_ids = selectedKey;
      return apiClient.get('/super-dashboard/group/overview', { params }).then((r) => r.data.data);
    },
    { intervalMs: LIVE_EVERY_MS, enabled: validRange, deps: [range?.from, range?.to, granularity, state, selectedKey] }
  );

  useEffect(() => {
    if (error) pushError(apiErrorMessage(error, 'Failed to load the group dashboard'), 'Something went wrong');
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (data && !selected) setAllCompanies(data.companies.map((c) => c.org));
  }, [data, selected]);

  useEffect(() => {
    if (!updatedAt) return;
    apiClient.get('/super-dashboard/group/activity', { params: { limit: 100, days: 7 } }).then(({ data: res }) => setActivity(res.data)).catch(() => setActivity([]));
  }, [updatedAt]);

  function resetFilters() {
    period.reset();
    setGranularity(DEFAULTS.granularity);
    setState(DEFAULTS.state);
    setSelected(null);
    setSearch('');
  }

  async function openCompany(org) {
    try {
      await switchOrg(org.id);
      navigate('/');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to open that company'), 'Something went wrong');
    }
  }

  const everyCompany = useMemo(() => data?.companies || [], [data]);
  const companies = useMemo(() => everyCompany.filter((c) => !c.coming_soon), [everyCompany]);
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const pick = {
      name: (c) => c.org.name.toLowerCase(), revenue: (c) => c.totals.revenue, expenses: (c) => c.totals.expenses, profit: (c) => c.totals.profit,
      margin: (c) => c.totals.margin_pct ?? -Infinity, assets: (c) => c.assets, valuation: (c) => c.valuation?.current ?? -Infinity, growth: (c) => c.valuation?.growth_pct ?? -Infinity,
    }[sort.key];
    return everyCompany.filter((c) => !needle || c.org.name.toLowerCase().includes(needle)).sort((a, b) => (pick(a) > pick(b) ? 1 : -1) * (sort.dir === 'asc' ? 1 : -1));
  }, [everyCompany, search, sort]);
  const th = (key, label, right = true) => (
    <th className={`cursor-pointer px-3 py-2 ${right ? 'text-right' : 'text-left'}`} onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}>
      {label}{sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  );
  const [exportKey, setExportKey] = useState('comparison');
  const [trendMetric, setTrendMetric] = useState('revenue');
  const exportSets = useMemo(() => {
    if (!data) return {};
    const trendSet = (metric) => ({ headers: ['Period', ...companies.map((c) => c.org.name), 'Group total'], rows: data.trends[metric].map((r) => [r.label, ...companies.map((c) => r[c.org.id] ?? ''), r.total]) });
    return {
      comparison: { title: 'Company comparison', headers: ['Company', 'Revenue', 'Expenses', 'Profit', 'Margin %', 'Assets', 'Valuation', 'Valuation growth %', 'Employees', 'Contractors'], rows: companies.map((c) => [c.org.name, c.totals.revenue, c.totals.expenses, c.totals.profit, c.totals.margin_pct ?? '', c.assets, c.valuation?.current ?? '', c.valuation?.growth_pct ?? '', c.people.employees, c.people.contractors]) },
      revenue: { title: 'Revenue report', ...trendSet('revenue') },
      expenses: { title: 'Expense report', ...trendSet('expenses') },
      profit: { title: 'Profit report', ...trendSet('profit') },
      assets: { title: 'Asset report', ...trendSet('assets') },
      valuation: { title: 'Valuation report', ...trendSet('valuation') },
      group: { title: 'Group financial report', headers: ['Company', 'Period', 'Revenue', 'Expenses', 'Profit', 'Asset value', 'Valuation'], rows: companies.flatMap((c) => c.series.map((r) => [c.org.name, r.label, r.revenue, r.expenses, r.profit, r.asset_value, r.valuation])) },
    };
  }, [data, companies]);
  function doExport(kind) {
    const set = exportSets[exportKey];
    if (!set) return;
    const sub = `${range.from} to ${range.to} - ${granularity} - ${state === 'all' ? 'all figures' : `${state} figures`}`;
    if (kind === 'csv') downloadCsv(`${set.title.toLowerCase().replace(/\s+/g, '-')}-${range.from}-${range.to}.csv`, set.headers, set.rows);
    else if (!printReport(set.title, sub, set.headers, set.rows)) pushError('Allow pop-ups to export the PDF', 'Export blocked');
  }
  const t = data?.totals;
  const openCompanyData = companies.find((c) => c.org.id === openOrgId) || null;

  function toggleCompany(id) {
    const live = allCompanies.filter((o) => !o.coming_soon);
    const base = selected || live.map((o) => o.id);
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    setSelected(next.length === 0 || next.length === live.length ? null : next);
  }

  const pb = periodBinding(period);
  const filterFields = [
    ...pb.fields,
    { key: 'group', label: 'Group by', type: 'select', options: GROUPINGS },
    { key: 'companies', label: 'Companies', type: 'checks', options: allCompanies.filter((o) => !o.coming_soon).map((o) => [o.id, o.name]) },
  ];
  const filterValues = { ...pb.values, group: granularity, companies: selected || [] };
  const filterDefaults = { ...pb.defaults, group: DEFAULTS.granularity, companies: [] };
  function changeFilter(key, value) {
    if (key === 'group') setGranularity(value);
    else if (key === 'companies') setSelected(value.length ? value : null);
    else pb.change(key, value);
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <div className={`h-1 overflow-hidden rounded-t-2xl bg-primary-100 ${loading ? '' : 'invisible'}`} aria-hidden="true"><div className="h-full w-1/3 animate-pulse rounded-r bg-primary-500" /></div>
        <div className="space-y-3 p-4">
          <GroupFilterBar fields={filterFields} values={filterValues} defaults={filterDefaults} onChange={changeFilter} onToggle={(key, id) => toggleCompany(id)} onReset={resetFilters} below={<FigureSwitch value={state} onChange={setState} />}>
            {validRange && <span className="rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-700">{range.from} to {range.to}</span>}
            <LiveIndicator updatedAt={updatedAt} everyMs={LIVE_EVERY_MS} />
            <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium text-tertiary-700 hover:bg-tertiary-50" onClick={refresh} aria-label="Refresh now">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh
            </button>
          </GroupFilterBar>

          <div className="flex flex-wrap items-center gap-2 border-t border-tertiary-100 pt-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-tertiary-400">Export</span>
            <select value={exportKey} onChange={(e) => setExportKey(e.target.value)} className="rounded-lg border px-2 py-1 text-sm" aria-label="Report to export">
              <option value="comparison">Company comparison</option><option value="revenue">Revenue report</option><option value="profit">Profit report</option>
              <option value="expenses">Expense report</option><option value="assets">Asset report</option><option value="valuation">Valuation report</option><option value="group">Group financial report</option>
            </select>
            <button type="button" className="btn-secondary text-sm" disabled={!data} onClick={() => doExport('csv')}>CSV</button>
            <button type="button" className="btn-secondary text-sm" disabled={!data} onClick={() => doExport('pdf')}>PDF</button>
            <span className="ml-auto text-[11px] text-tertiary-500">Month is the finest period; quarter and year follow the April-March financial year. Group totals add live companies together.{allCompanies.some((o) => o.coming_soon) ? ` Coming soon: ${allCompanies.filter((o) => o.coming_soon).map((o) => o.name).join(', ')}.` : ''}</span>
          </div>
        </div>
      </div>

      {!validRange && <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-tertiary-500">Pick a start month and an end month (the end cannot be before the start).</div>}
      {validRange && loading && !data ? <Skeleton className="h-40 w-full" /> : !data ? null : (
        <div className={`space-y-5 transition-opacity ${loading ? 'pointer-events-none opacity-60' : ''}`}>
          {t.mixed_currency && <div className="rounded-xl border border-warning-200 bg-warning-50 px-3 py-2 text-sm">Companies report in different currencies, so group totals are shown as plain sums.</div>}
          <SectionTitle title="1. Group at a glance" hint={`${range.from} to ${range.to} - ${t.active_companies} companies`} />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <KpiCard label="Group revenue" value={compact(t.revenue)} hint={t.change_pct?.revenue != null ? `${pctText(t.change_pct.revenue)} vs previous period` : undefined} icon={Wallet} theme="green" />
            <KpiCard label="Group profit" value={compact(t.profit)} hint={t.change_pct?.profit != null ? `${pctText(t.change_pct.profit)} vs previous period` : undefined} icon={TrendingUp} theme="blue" />
            <KpiCard label="Group expenses" value={compact(t.expenses)} hint={t.change_pct?.expenses != null ? `${pctText(t.change_pct.expenses)} vs previous period` : undefined} icon={Scale} theme="orange" />
            <KpiCard label="Group assets" value={compact(t.assets)} hint={t.change_pct?.assets != null ? `${pctText(t.change_pct.assets)} vs previous period` : undefined} icon={PiggyBank} theme="purple" />
            <KpiCard label="Group valuation" value={compact(t.valuation)} hint={t.change_pct?.valuation != null ? `${pctText(t.change_pct.valuation)} vs previous period` : undefined} icon={PiggyBank} theme="blue" />
            <KpiCard label="Active companies" value={t.active_companies} hint={t.coming_soon_companies ? `${t.coming_soon_companies} coming soon` : undefined} icon={Building2} theme="purple" />
          </div>
          <p className="text-xs text-tertiary-500">Profit margin {t.margin_pct === null ? 'N/A' : `${t.margin_pct}%`} · {t.employees} employees · {t.contractors} contractors. Group valuation = sum of each company&apos;s valuation (profit × {data.formula.profit} + asset value × {data.formula.asset_value}).</p>

          {data.alerts.length > 0 && (
            <div className="rounded-2xl border border-warning-200 bg-warning-50 p-4">
              <h3 className="mb-2 flex items-center gap-2 font-heading text-sm font-semibold"><AlertTriangle className="h-4 w-4" />Attention required</h3>
              <ul className="space-y-1 text-sm">{data.alerts.map((a, i) => <li key={`${a.org_id}-${a.type}-${i}`}><b>{a.org_name}:</b> {a.message}</li>)}</ul>
            </div>
          )}

          <FoundationGroupSection foundation={data.foundation} />

          <SectionTitle title="2. Companies" hint="Click a company for its valuation, history, drill-down and asset values" />
          <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="font-heading text-sm font-semibold">Company comparison</h3>
              <input placeholder="Search company…" value={search} onChange={(e) => setSearch(e.target.value)} className="rounded-lg border px-2 py-1 text-sm" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-tertiary-500">{th('name', 'Company', false)}{th('revenue', 'Revenue')}{th('expenses', 'Expenses')}{th('profit', 'Profit')}{th('margin', 'Margin')}{th('assets', 'Assets')}{th('valuation', 'Valuation')}{th('growth', 'Growth')}<th className="px-3 text-right">People</th></tr></thead>
                <tbody>
                  {rows.map((c) => (
                    c.coming_soon ? (
                      <tr key={c.org.id} className="cursor-pointer border-t border-dashed border-tertiary-200 bg-tertiary-50/50 text-tertiary-400" onClick={() => pushInfo(`${c.org.name} is coming soon. Its figures will appear here once it is ready.`)}>
                        <td className="px-3 py-2 font-medium">{c.org.name} <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">Coming soon</span></td>
                        <td className="px-3 text-center italic" colSpan={8}>Not live yet - will be added here when it is ready</td>
                      </tr>
                    ) : (
                    <tr key={c.org.id} className="cursor-pointer border-t border-tertiary-100 hover:bg-tertiary-50" onClick={() => setOpenOrgId(c.org.id)}>
                      <td className="px-3 py-2 font-medium text-primary-700">{c.org.name}</td>
                      <td className="px-3 text-right">{c.has_data ? money(c.totals.revenue) : 'No data'}</td>
                      <td className="px-3 text-right">{c.has_data ? money(c.totals.expenses) : 'No data'}</td>
                      <td className={`px-3 text-right ${c.totals.profit < 0 ? 'text-danger-600' : ''}`}>{c.has_data ? money(c.totals.profit) : 'No data'}</td>
                      <td className="px-3 text-right">{c.totals.margin_pct === null ? 'N/A' : `${c.totals.margin_pct}%`}</td>
                      <td className="px-3 text-right">{c.assets ? money(c.assets) : 'Not set'}</td>
                      <td className="px-3 text-right font-semibold">{c.valuation ? money(c.valuation.current) : 'N/A'}</td>
                      <td className="px-3 text-right">{pctText(c.valuation?.growth_pct)}</td>
                      <td className="px-3 text-right text-xs text-tertiary-500">{c.people.employees} emp · {c.people.contractors} con</td>
                    </tr>
                    )
                  ))}
                  {rows.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-tertiary-500">No companies match.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-tertiary-500">Click a company for the valuation breakdown, history and monthly asset values. Projects, leads, receivables and payables are company-specific and are shown inside each company.</p>
          </div>

          <SectionTitle title="3. Trends" hint="Every company has its own line and legend" />
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Trend metric">
            {TREND_METRICS.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={trendMetric === k} onClick={() => setTrendMetric(k)} className={`rounded-full border px-3.5 py-1 text-sm ${trendMetric === k ? 'border-primary-600 bg-primary-600 text-white' : 'border-tertiary-200 bg-white text-tertiary-600 hover:bg-tertiary-50'}`}>{label}</button>
            ))}
          </div>
          <TrendChart title={`${TREND_METRICS.find(([k]) => k === trendMetric)[1]} comparison`} subtitle={TREND_METRICS.find(([k]) => k === trendMetric)[2]} rows={data.trends[trendMetric]} companies={companies} metric={trendMetric} />

          <SectionTitle title="4. Who contributes and who leads" />
          <div className="grid gap-4 lg:grid-cols-2">
            <ShareBars title="Revenue contribution" rows={data.contribution.revenue} />
            <ShareBars title="Profit contribution" rows={data.contribution.profit} />
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[['revenue', 'Highest revenue', money], ['profit', 'Highest profit', money], ['valuation', 'Highest valuation', money], ['growth', 'Highest valuation growth', pctText]].map(([k, label, fmt]) => (
              <div key={k} className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
                <h4 className="mb-2 font-heading text-sm font-semibold">{label}</h4>
                <ol className="space-y-1 text-sm">{data.rankings[k].map((r) => <li key={r.org_id} className="flex justify-between"><span>{r.rank}. {r.org_name}</span><span className="text-tertiary-600">{fmt(r.value)}</span></li>)}</ol>
              </div>
            ))}
          </div>

          <SectionTitle title="5. Recent activity" hint="Last 7 days - changes made in any company of the group" />
          <div className="rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card">
            <ActivityFeed items={activity} colorOf={(id) => PALETTE[Math.max(0, allCompanies.findIndex((o) => o.id === id)) % PALETTE.length]} />
          </div>
        </div>
      )}

      <CompanyDrawer company={openCompanyData} range={range} state={state} formula={data?.formula || { profit: 240, asset_value: 3 }} onClose={() => setOpenOrgId(null)} onOpen={openCompany} onChanged={refresh} />
    </div>
  );
}
