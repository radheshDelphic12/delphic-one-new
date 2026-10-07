import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { BookOpenText, LayoutDashboard, Layers } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { rupees } from '../../lib/zephyr/projectMeta.js';
import { compact, dateLabel } from '../../lib/format.js';
import { useServiceTypes } from '../../lib/zephyr/serviceMeta.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import ZephyrLedger from '../../components/zephyr/ZephyrLedger.jsx';
import ZephyrTrendChart from '../../components/zephyr/ZephyrTrendChart.jsx';

const PRESETS = [
  { value: 'month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'quarter', label: 'This quarter' },
  { value: 'fy', label: 'Financial year to date' },
  { value: 't12', label: 'Last 12 months' },
  { value: 'custom', label: 'Custom range' },
];
const card = 'rounded-2xl border bg-white p-4 shadow-soft md:p-5';

function delta(current, previous) {
  if (current === null || previous === null || previous === undefined) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

function Tile({ label, value, sub, change, goodWhenUp = true, onClick, tone }) {
  const good = change === null || change === 0 ? null : (change > 0) === goodWhenUp;
  const body = (
    <>
      <div className="text-xs font-medium uppercase tracking-wide text-tertiary-500">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${tone || 'text-tertiary-900'}`}>{value}</div>
      <div className="mt-1 flex items-center gap-2 text-xs text-tertiary-500">
        {sub}
        {change !== null && change !== undefined && <span className={`rounded-full px-1.5 py-0.5 font-medium ${good === null ? 'bg-tertiary-100 text-tertiary-600' : good ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{change > 0 ? '+' : ''}{change}% vs previous</span>}
      </div>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="rounded-2xl border bg-white p-4 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-card">{body}</button>
  ) : (
    <div className="rounded-2xl border bg-white p-4 shadow-soft">{body}</div>
  );
}

function ProjectTable({ rows, showSalaries, onOpen }) {
  return (
    <div className={`${card} overflow-x-auto p-0 md:p-0`}>
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-primary-50/60 text-xs uppercase tracking-wide text-tertiary-500">
          <tr><th className="px-4 py-2.5">Project</th><th className="px-4 py-2.5 text-right">Revenue</th><th className="px-4 py-2.5 text-right">Expense</th>{showSalaries && <th className="px-4 py-2.5 text-right">Salaries</th>}<th className="px-4 py-2.5 text-right">Profit</th></tr>
        </thead>
        <tbody className="divide-y">
          {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-tertiary-400">No money recorded in this period.</td></tr>}
          {rows.map((p) => (
            <tr key={p.project_id || 'none'}>
              <td className="px-4 py-2.5">{p.project_id ? <Link to={`/zephyr/projects/${p.project_id}`} className="font-medium text-primary-700 hover:underline">{p.code} · {p.name}</Link> : <span className="text-tertiary-500">{p.name}</span>}</td>
              <td className="px-4 py-2.5 text-right tabular-nums"><button type="button" className="hover:underline" onClick={() => onOpen({ metric: 'revenue', project: p })}>{rupees(p.revenue)}</button></td>
              <td className="px-4 py-2.5 text-right tabular-nums"><button type="button" className="hover:underline" onClick={() => onOpen({ metric: 'expense', project: p })}>{rupees(p.expense)}</button></td>
              {showSalaries && <td className="px-4 py-2.5 text-right tabular-nums"><button type="button" className="hover:underline" onClick={() => onOpen({ metric: 'salaries', project: p })}>{rupees(p.salaries)}</button></td>}
              <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${p.profit < 0 ? 'text-red-600' : 'text-tertiary-900'}`}>{rupees(p.profit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DrillDrawer({ drill, range, onClose }) {
  const { pushError } = useAlerts();
  // Rows are kept with the drill they were loaded for, so a stale list from an earlier drill (revenue / expense)
  // is never rendered as pay slips (it has no `person`) when the Salaries tile is opened.
  const [loaded, setLoaded] = useState({ drill: null, rows: null });
  const rows = loaded.drill === drill ? loaded.rows : null;
  useEffect(() => {
    if (!drill) return;
    const base = { from: range.from, to: range.to };
    const project = drill.project?.project_id ? { project_id: drill.project.project_id } : drill.project ? { unallocated: true } : {};
    const request = drill.metric === 'salaries'
      ? zephyrApi.overviewSalaries({ ...base, ...project })
      : zephyrApi.ledger({ ...base, type: drill.metric, status: 'actual', limit: 200, ...(project.project_id ? { project_id: project.project_id } : {}) }).then((r) => (project.unallocated ? r.data.filter((e) => !e.project_id) : r.data));
    request.then((data) => setLoaded({ drill, rows: data }), (e) => pushError(zephyrError(e, 'Could not load the rows'), 'Load failed'));
  }, [drill, range, pushError]);
  const title = drill ? `${{ revenue: 'Revenue', expense: 'Expense', salaries: 'Salaries' }[drill.metric]}${drill.project ? ` · ${drill.project.name}` : ''}` : '';
  return (
    <Drawer open={Boolean(drill)} onClose={onClose} size="xl" title={title}>
      {rows === null && <div className="text-sm text-tertiary-500">Loading…</div>}
      {rows?.length === 0 && <div className="rounded-xl border border-dashed p-6 text-center text-sm text-tertiary-400">Nothing behind this number.</div>}
      <ul className="divide-y rounded-xl border bg-white">
        {drill && rows?.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium text-tertiary-900">{drill.metric === 'salaries' ? r.person?.name : r.category?.name}</div>
              <div className="truncate text-xs text-tertiary-500">{drill.metric === 'salaries' ? `${r.month} · ${r.status}` : [dateLabel(r.entry_date), r.project?.code, r.party?.name, r.reference].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="shrink-0 tabular-nums">{rupees(r.amount)}</div>
          </li>
        ))}
      </ul>
    </Drawer>
  );
}

function BreakdownTable({ title, rows, showSalaries, hint }) {
  if (!rows || rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="font-heading text-sm font-semibold text-tertiary-900">{title}</h3>
      <div className={`${card} overflow-x-auto p-0 md:p-0`}>
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-primary-50/60 text-xs uppercase tracking-wide text-tertiary-500"><tr><th className="px-4 py-2.5">Name</th><th className="px-4 py-2.5 text-right">Revenue</th><th className="px-4 py-2.5 text-right">Expense</th>{showSalaries && <th className="px-4 py-2.5 text-right">Salaries</th>}<th className="px-4 py-2.5 text-right">Profit</th></tr></thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.key || 'none'}><td className="px-4 py-2.5 font-medium text-tertiary-900">{r.name}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(r.revenue)}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(r.expense)}</td>{showSalaries && <td className="px-4 py-2.5 text-right tabular-nums">{r.salaries == null ? '—' : rupees(r.salaries)}</td>}<td className={`px-4 py-2.5 text-right font-medium tabular-nums ${r.profit < 0 ? 'text-red-600' : 'text-tertiary-900'}`}>{rupees(r.profit)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {hint && <p className="text-xs text-tertiary-400">{hint}</p>}
    </section>
  );
}

function OverviewTab({ isAdmin, canFinance }) {
  const { pushError } = useAlerts();
  const { services } = useServiceTypes();
  const [filter, setFilter] = useState({ service_type: '', property_id: '', party_id: '' });
  const [properties, setProperties] = useState([]);
  const [parties, setParties] = useState([]);
  useEffect(() => {
    if (canFinance) zephyrApi.properties({}).then(setProperties, () => setProperties([]));
    zephyrApi.parties({ status: 'all', limit: 200 }).then((r) => setParties(r.data), () => setParties([]));
  }, [canFinance]);
  const [preset, setPreset] = useState('month');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [drill, setDrill] = useState(null);

  const load = useCallback(async () => {
    if (preset === 'custom' && !(custom.from && custom.to && custom.to >= custom.from)) return;
    try {
      setData(await zephyrApi.overview({ preset, ...(preset === 'custom' ? custom : {}), ...Object.fromEntries(Object.entries(filter).filter(([, v]) => v)) }));
    } catch (e) {
      pushError(zephyrError(e, 'Could not load the overview'), 'Load failed');
    }
  }, [preset, custom, filter, pushError]);
  useEffect(() => {
    load();
  }, [load]);

  const s = data?.summary;
  const p = data?.previous;
  const v = data?.valuation;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <select value={preset} onChange={(e) => setPreset(e.target.value)} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Period">
          {PRESETS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </select>
        {preset === 'custom' && (
          <>
            <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="rounded-xl border px-2 py-1.5 text-sm" aria-label="From" />
            <input type="date" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="rounded-xl border px-2 py-1.5 text-sm" aria-label="To" />
          </>
        )}
        <select value={filter.service_type} onChange={(e) => setFilter({ ...filter, service_type: e.target.value })} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Service"><option value="">All services</option>{services.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
        {canFinance && <select value={filter.property_id} onChange={(e) => setFilter({ ...filter, property_id: e.target.value })} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Property"><option value="">All properties</option>{properties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
        <select value={filter.party_id} onChange={(e) => setFilter({ ...filter, party_id: e.target.value })} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Client or vendor"><option value="">All clients / vendors</option>{parties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        {Object.values(filter).some(Boolean) && <button type="button" className="text-sm font-medium text-primary-700 hover:underline" onClick={() => setFilter({ service_type: '', property_id: '', party_id: '' })}>Clear</button>}
        {data && <span className="text-xs text-tertiary-500">{dateLabel(data.range.from)} – {dateLabel(data.range.to)}</span>}
      </div>

      {!data ? <div className="py-10 text-center text-sm text-tertiary-500">{preset === 'custom' ? 'Pick a start and end date.' : 'Loading…'}</div> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <Tile label="Revenue" value={rupees(s.revenue)} change={delta(s.revenue, p.revenue)} onClick={() => setDrill({ metric: 'revenue' })} tone="text-green-700" />
            <Tile label="Expense" value={rupees(s.expense)} change={delta(s.expense, p.expense)} goodWhenUp={false} onClick={() => setDrill({ metric: 'expense' })} />
            {isAdmin && <Tile label="Salaries" value={rupees(s.salaries)} change={delta(s.salaries, p.salaries)} goodWhenUp={false} sub="approved + paid" onClick={() => setDrill({ metric: 'salaries' })} />}
            <Tile label="Profit" value={rupees(s.profit)} change={delta(s.profit, p.profit)} tone={s.profit < 0 ? 'text-red-600' : 'text-tertiary-900'} sub={isAdmin ? undefined : 'before salaries'} />
            <Tile label="Margin" value={s.margin === null ? '—' : `${s.margin}%`} sub="profit / revenue" />
            {isAdmin && (
              <Tile label="Valuation" value={v?.value == null ? '—' : rupees(v.value)} sub={v ? '(profit x 240) + (assets x 3)' : ''} />
            )}
          </div>

          <section className={card}>
            <h3 className="mb-3 font-heading text-sm font-semibold text-tertiary-900">Last 12 months</h3>
            <ZephyrTrendChart rows={data.trend} showSalaries={isAdmin} />
          </section>

          {data.unrealized && (
            <section className="rounded-2xl border border-dashed border-primary-300 bg-primary-50/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h3 className="font-heading text-sm font-semibold text-tertiary-900">Unrealized property appreciation</h3><p className="text-xs text-tertiary-500">Manual valuation less total investment. Shown beside the P&amp;L, never inside it: it becomes income only when a property or unit is sold.</p></div>
                <dl className="flex flex-wrap gap-6 text-sm">
                  <div><dt className="text-xs text-tertiary-500">Invested</dt><dd className="font-semibold tabular-nums">₹{compact(data.unrealized.total_invested)}</dd></div>
                  <div><dt className="text-xs text-tertiary-500">Valuation</dt><dd className="font-semibold tabular-nums">{data.unrealized.valued_properties ? `₹${compact(data.unrealized.valuation)}` : '—'}</dd></div>
                  <div><dt className="text-xs text-tertiary-500">Appreciation</dt><dd className={`font-semibold tabular-nums ${data.unrealized.appreciation < 0 ? 'text-red-600' : 'text-green-700'}`}>{data.unrealized.appreciation == null ? '—' : `₹${compact(data.unrealized.appreciation)} (${data.unrealized.appreciation_pct ?? '—'}%)`}</dd></div>
                </dl>
              </div>
            </section>
          )}

          <BreakdownTable title="By service" rows={data.by_service} showSalaries={isAdmin} />
          {canFinance && <BreakdownTable title="By property" rows={data.by_property} showSalaries={false} hint="Property rows show rent, sales and property expenses; pay slips are not split by property." />}

          <section className="space-y-2">
            <h3 className="font-heading text-sm font-semibold text-tertiary-900">Profit by project</h3>
            <ProjectTable rows={data.by_project} showSalaries={isAdmin} onOpen={setDrill} />
          </section>

          <section className="space-y-2">
            <h3 className="font-heading text-sm font-semibold text-tertiary-900">By category</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {['revenue', 'expense'].map((type) => (
                <div key={type} className={card}>
                  <div className="mb-2 flex items-center gap-2"><Pill tone={type === 'revenue' ? 'green' : 'amber'}>{type === 'revenue' ? 'Revenue' : 'Expense'}</Pill></div>
                  <ul className="space-y-1.5 text-sm">
                    {data.by_category.filter((c) => c.type === type).length === 0 && <li className="text-tertiary-400">Nothing in this period.</li>}
                    {data.by_category.filter((c) => c.type === type).map((c) => (
                      <li key={c.category_id} className="flex justify-between"><span className="text-tertiary-700">{c.category}</span><span className="tabular-nums">{rupees(c.amount)}</span></li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
          <BreakdownTable title="By client / vendor" rows={data.by_party} showSalaries={false} />
          {isAdmin && <p className="text-xs text-tertiary-400">Profit = revenue - expense - salaries. Salaries are approved and paid pay slips; tax is not included. Valuation settings: Zephyr setup.</p>}
        </>
      )}
      <DrillDrawer drill={drill} range={data?.range || { from: '', to: '' }} onClose={() => setDrill(null)} />
    </div>
  );
}

const SERVICE_ORDER = ['civil_construction', 'interior_design', 'property_management', 'property_trading', 'real_estate_consulting'];

function ServiceReportsTab() {
  const { pushError } = useAlerts();
  const { label } = useServiceTypes();
  const [preset, setPreset] = useState('fy');
  const [data, setData] = useState(null);
  useEffect(() => {
    setData(null);
    zephyrApi.serviceReport({ preset }).then(setData, (e) => pushError(zephyrError(e, 'Could not load the service reports'), 'Load failed'));
  }, [preset, pushError]);
  const s = data?.services;
  const Row = ({ k, v, tone }) => <div className="flex justify-between gap-3 py-1.5 text-sm"><dt className="text-tertiary-600">{k}</dt><dd className={`font-medium tabular-nums ${tone || 'text-tertiary-900'}`}>{v}</dd></div>;
  const pct = (v) => (v == null ? '—' : `${v}%`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={preset} onChange={(e) => setPreset(e.target.value)} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Period">{PRESETS.filter((x) => x.value !== 'custom').map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select>
        {data && <span className="text-xs text-tertiary-500">{dateLabel(data.range.from)} – {dateLabel(data.range.to)}</span>}
      </div>
      {!s ? <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {SERVICE_ORDER.filter((k) => s[k]).map((k) => {
            const x = s[k];
            return (
              <section key={k} className={card}>
                <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">{label(k)}</h3>
                <dl className="divide-y">
                  {(k === 'civil_construction' || k === 'interior_design') && (<>
                    <Row k="Projects (live / completed)" v={`${x.projects} (${x.live} / ${x.completed})`} />
                    <Row k="Contract value" v={rupees(x.contract_value)} />
                    <Row k="Cost" v={rupees(x.cost)} />
                    <Row k="Revenue" v={rupees(x.revenue)} />
                    <Row k="Profit" v={rupees(x.profit)} tone={x.profit < 0 ? 'text-red-600' : 'text-green-700'} />
                    <Row k="Margin" v={pct(x.margin_pct)} />
                  </>)}
                  {k === 'property_management' && (<>
                    <Row k="Properties / units" v={`${x.properties} / ${x.units}`} />
                    <Row k="Occupancy" v={`${x.occupied} rented · ${pct(x.occupancy_pct)}`} />
                    <Row k="Rent collected" v={rupees(x.rent_collected)} />
                    <Row k="Expenses" v={rupees(x.expenses)} />
                    {x.cash_flow !== undefined && <Row k="Financing (EMI)" v={rupees(x.financing)} />}
                    {x.cash_flow !== undefined && <Row k="Net cash flow" v={rupees(x.cash_flow)} tone={x.cash_flow < 0 ? 'text-red-600' : 'text-green-700'} />}
                  </>)}
                  {k === 'property_trading' && (<>
                    <Row k="Properties held or traded" v={x.properties} />
                    <Row k="Total investment" v={rupees(x.total_investment)} />
                    <Row k="Sales (count)" v={x.sales} />
                    <Row k="Sold value" v={rupees(x.sold_value)} />
                    <Row k="Cost of properties sold" v={rupees(x.cost_basis)} />
                    <Row k="Selling costs" v={rupees(x.selling_costs)} />
                    <Row k="Realized profit" v={rupees(x.realized_profit)} tone={x.realized_profit < 0 ? 'text-red-600' : 'text-green-700'} />
                    <Row k="Average holding period" v={x.avg_holding_days == null ? '—' : `${x.avg_holding_days} days`} />
                  </>)}
                  {k === 'real_estate_consulting' && (<>
                    <Row k="Leads (won)" v={`${x.leads} (${x.won_leads})`} />
                    <Row k="Closed deals" v={`${x.closed_deals} of ${x.projects}`} />
                    <Row k="Property value handled" v={rupees(x.property_value)} />
                    <Row k="Average brokerage" v={pct(x.avg_commission_pct)} />
                    <Row k="Brokerage revenue" v={rupees(x.revenue)} />
                    <Row k="Expenses" v={rupees(x.expenses)} />
                    <Row k="Profit" v={rupees(x.profit)} tone={x.profit < 0 ? 'text-red-600' : 'text-green-700'} />
                  </>)}
                </dl>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ZephyrOverviewPage() {
  const { me, loading } = useZephyr();
  const [tab, setTab] = useState('overview');
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!zxCan(me, 'overview')) return <Navigate to="/zephyr" replace />;
  const isAdmin = zxCan(me, 'overviewValuation');
  const canFinance = zxCan(me, 'propertyFinance');
  const fullLedger = zxCan(me, 'ledgerSalaries');
  const tabs = [{ key: 'overview', label: 'Overview', icon: LayoutDashboard }, { key: 'services', label: 'By service', icon: Layers }, { key: 'ledger', label: 'Ledger', icon: BookOpenText }];
  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'overview' && <OverviewTab isAdmin={isAdmin} canFinance={canFinance} />}
      {tab === 'services' && <ServiceReportsTab />}
      {tab === 'ledger' && <ZephyrLedger isAdmin={fullLedger} canDelete={zxCan(me, 'delete')} />}
    </div>
  );
}
