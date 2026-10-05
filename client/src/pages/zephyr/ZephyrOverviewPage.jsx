import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { BookOpenText, LayoutDashboard } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { rupees } from '../../lib/zephyr/projectMeta.js';
import { dateLabel } from '../../lib/format.js';
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
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (!drill) return;
    setRows(null);
    const base = { from: range.from, to: range.to };
    const project = drill.project?.project_id ? { project_id: drill.project.project_id } : drill.project ? { unallocated: true } : {};
    const request = drill.metric === 'salaries'
      ? zephyrApi.overviewSalaries({ ...base, ...project })
      : zephyrApi.ledger({ ...base, type: drill.metric, status: 'actual', limit: 200, ...(project.project_id ? { project_id: project.project_id } : {}) }).then((r) => (project.unallocated ? r.data.filter((e) => !e.project_id) : r.data));
    request.then(setRows, (e) => pushError(zephyrError(e, 'Could not load the rows'), 'Load failed'));
  }, [drill, range, pushError]);
  const title = drill ? `${{ revenue: 'Revenue', expense: 'Expense', salaries: 'Salaries' }[drill.metric]}${drill.project ? ` · ${drill.project.name}` : ''}` : '';
  return (
    <Drawer open={Boolean(drill)} onClose={onClose} size="xl" title={title}>
      {rows === null && <div className="text-sm text-tertiary-500">Loading…</div>}
      {rows?.length === 0 && <div className="rounded-xl border border-dashed p-6 text-center text-sm text-tertiary-400">Nothing behind this number.</div>}
      <ul className="divide-y rounded-xl border bg-white">
        {rows?.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium text-tertiary-900">{drill.metric === 'salaries' ? r.person.name : r.category?.name}</div>
              <div className="truncate text-xs text-tertiary-500">{drill.metric === 'salaries' ? `${r.month} · ${r.status}` : [dateLabel(r.entry_date), r.project?.code, r.party?.name, r.reference].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="shrink-0 tabular-nums">{rupees(r.amount)}</div>
          </li>
        ))}
      </ul>
    </Drawer>
  );
}

function OverviewTab({ isAdmin }) {
  const { pushError } = useAlerts();
  const [preset, setPreset] = useState('month');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [drill, setDrill] = useState(null);

  const load = useCallback(async () => {
    if (preset === 'custom' && !(custom.from && custom.to && custom.to >= custom.from)) return;
    try {
      setData(await zephyrApi.overview({ preset, ...(preset === 'custom' ? custom : {}) }));
    } catch (e) {
      pushError(zephyrError(e, 'Could not load the overview'), 'Load failed');
    }
  }, [preset, custom, pushError]);
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
              <Tile label="Valuation" value={v?.value == null ? '—' : rupees(v.value)} sub={v ? (v.method === 'manual' ? 'set manually' : `${v.multiple}x ${v.basis}`) : ''} />
            )}
          </div>

          <section className={card}>
            <h3 className="mb-3 font-heading text-sm font-semibold text-tertiary-900">Last 12 months</h3>
            <ZephyrTrendChart rows={data.trend} showSalaries={isAdmin} />
          </section>

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
          {isAdmin && <p className="text-xs text-tertiary-400">Profit = revenue - expense - salaries. Salaries are approved and paid pay slips; tax is not included. Valuation settings: Zephyr setup.</p>}
        </>
      )}
      <DrillDrawer drill={drill} range={data?.range || { from: '', to: '' }} onClose={() => setDrill(null)} />
    </div>
  );
}

export default function ZephyrOverviewPage() {
  const { me, loading } = useZephyr();
  const [tab, setTab] = useState('overview');
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!zxCan(me, 'overview')) return <Navigate to="/zephyr" replace />;
  const isAdmin = zxCan(me, 'overviewValuation');
  const tabs = [{ key: 'overview', label: 'Overview', icon: LayoutDashboard }, { key: 'ledger', label: 'Ledger', icon: BookOpenText }];
  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'overview' ? <OverviewTab isAdmin={isAdmin} /> : <ZephyrLedger isAdmin={isAdmin} canDelete={zxCan(me, 'delete')} />}
    </div>
  );
}
