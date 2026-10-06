import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CalendarCheck, FileSpreadsheet, FileText, LineChart, Lock, LockOpen, Target } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { downloadText } from '../../lib/zephyr/csv.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { rupees } from '../../lib/zephyr/projectMeta.js';
import { dateLabel, shortMonth } from '../../lib/format.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import ZephyrTrendChart from '../../components/zephyr/ZephyrTrendChart.jsx';

const TABS = [
  { key: 'plan', label: 'Plan vs actual', icon: Target },
  { key: 'projection', label: 'Projection', icon: LineChart },
  { key: 'close', label: 'Month close', icon: CalendarCheck },
  { key: 'statements', label: 'Statements', icon: FileText },
];
const card = 'rounded-2xl border bg-white p-4 shadow-soft md:p-5';
const inputCls = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const cm = () => new Date().toISOString().slice(0, 7);
const shift = (month, delta) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
};
const varClass = (v, goodWhenUp) => (v === 0 ? 'text-tertiary-500' : (v > 0) === goodWhenUp ? 'text-green-700' : 'text-red-600');

function RangePicker({ from, to, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-tertiary-600">
      <label className="flex items-center gap-1.5">From<input type="month" value={from} max={to} onChange={(e) => e.target.value && onChange({ from: e.target.value, to })} className="rounded-xl border px-2 py-1.5" /></label>
      <label className="flex items-center gap-1.5">To<input type="month" value={to} min={from} onChange={(e) => e.target.value && onChange({ from, to: e.target.value })} className="rounded-xl border px-2 py-1.5" /></label>
    </div>
  );
}

function PlanForm({ month, project, projects, existing, saving, onSubmit, onCancel }) {
  const [v, setV] = useState({ month, project_id: project || '', planned_revenue: existing?.planned_revenue ?? 0, planned_expense: existing?.planned_expense ?? 0, planned_salaries: existing?.planned_salaries ?? 0, notes: existing?.notes || '' });
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ month: v.month, project_id: v.project_id || null, planned_revenue: Number(v.planned_revenue || 0), planned_expense: Number(v.planned_expense || 0), planned_salaries: Number(v.planned_salaries || 0), notes: v.notes.trim() || null });
      }}
      className="space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>Month<input type="month" className={inputCls} value={v.month} onChange={set('month')} required /></label>
        <label className={labelCls}>Applies to<select className={inputCls} value={v.project_id} onChange={set('project_id')}><option value="">Whole company</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
        <label className={labelCls}>Planned revenue (INR)<input type="number" min="0" className={inputCls} value={v.planned_revenue} onChange={set('planned_revenue')} /></label>
        <label className={labelCls}>Planned expense (INR)<input type="number" min="0" className={inputCls} value={v.planned_expense} onChange={set('planned_expense')} /></label>
        <label className={labelCls}>Planned salaries (INR)<input type="number" min="0" className={inputCls} value={v.planned_salaries} onChange={set('planned_salaries')} /></label>
        <label className={labelCls}>Notes<input className={inputCls} value={v.notes} onChange={set('notes')} maxLength={500} /></label>
      </div>
      <p className="text-xs text-tertiary-500">Saving again for the same month and scope replaces the figures. A whole-company plan is used when it exists; otherwise project plans add up.</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save plan'}</button>
      </div>
    </form>
  );
}

function PlanTab({ projects }) {
  const { pushError, pushSuccess } = useAlerts();
  const [range, setRange] = useState({ from: shift(cm(), -5), to: shift(cm(), 2) });
  const [project, setProject] = useState('');
  const [data, setData] = useState(null);
  const [plans, setPlans] = useState([]);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = { ...range, ...(project ? { project_id: project } : {}) };
      const [pva, pl] = await Promise.all([zephyrApi.planVsActual(params), zephyrApi.plans(range)]);
      setData(pva);
      setPlans(pl);
    } catch (e) {
      pushError(zephyrError(e, 'Could not load plan vs actual'), 'Load failed');
    }
  }, [range, project, pushError]);
  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  async function save(body) {
    setSaving(true);
    try {
      await zephyrApi.savePlan(body);
      pushSuccess('Plan saved');
      setForm(null);
      await load();
    } catch (e) {
      pushError(zephyrError(e, 'Could not save the plan'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  async function removePlan(id) {
    try {
      await zephyrApi.deletePlan(id);
      await load();
    } catch (e) {
      pushError(zephyrError(e), 'Could not delete');
    }
  }

  const chartRows = data?.rows.map((r) => ({ month: r.month, revenue: r.actual.revenue, expense: r.actual.expense, salaries: r.actual.salaries, profit: r.actual.profit })) || [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <RangePicker {...range} onChange={setRange} />
          <select value={project} onChange={(e) => setProject(e.target.value)} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Project"><option value="">Whole company</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select>
        </div>
        <button type="button" className="btn-primary" onClick={() => setForm({ month: cm() })}>Plan a month</button>
      </div>

      {data && <section className={card}><ZephyrTrendChart rows={chartRows} height={220} /></section>}

      <div className="overflow-x-auto rounded-2xl border bg-white shadow-soft">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-primary-50/60 text-xs uppercase tracking-wide text-tertiary-500">
            <tr><th className="px-4 py-2.5">Month</th><th className="px-4 py-2.5 text-right">Revenue plan</th><th className="px-4 py-2.5 text-right">Revenue actual</th><th className="px-4 py-2.5 text-right">Expense plan</th><th className="px-4 py-2.5 text-right">Expense actual</th><th className="px-4 py-2.5 text-right">Profit plan</th><th className="px-4 py-2.5 text-right">Profit actual</th><th className="px-4 py-2.5 text-right">Variance</th><th className="px-4 py-2.5" /></tr>
          </thead>
          <tbody className="divide-y">
            {!data && <tr><td colSpan={9} className="px-4 py-6 text-center text-tertiary-400">Loading…</td></tr>}
            {data?.rows.map((r) => (
              <tr key={r.month}>
                <td className="px-4 py-2.5 font-medium">{shortMonth(r.month)} {r.status === 'closed' && <Lock className="ml-1 inline h-3 w-3 text-tertiary-400" />}{r.stale && <span className="ml-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">stale</span>}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-tertiary-500">{r.has_plan ? rupees(r.planned.revenue) : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{rupees(r.actual.revenue)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-tertiary-500">{r.has_plan ? rupees(r.planned.expense) : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{rupees(r.actual.expense)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-tertiary-500">{r.has_plan ? rupees(r.planned.profit) : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{rupees(r.actual.profit)}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${r.has_plan ? varClass(r.variance.profit, true) : 'text-tertiary-300'}`}>{r.has_plan ? `${r.variance.profit > 0 ? '+' : ''}${rupees(r.variance.profit)}` : '—'}</td>
                <td className="px-2 text-right"><button type="button" className="text-xs font-medium text-primary-700 hover:underline" onClick={() => setForm({ month: r.month })}>{r.has_plan ? 'Edit plan' : 'Add plan'}</button></td>
              </tr>
            ))}
          </tbody>
          {data && (
            <tfoot className="border-t bg-primary-50/40 text-sm font-medium">
              <tr><td className="px-4 py-2.5">Total</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(data.totals.planned.revenue)}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(data.totals.actual.revenue)}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(data.totals.planned.expense)}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(data.totals.actual.expense)}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(data.totals.planned.profit)}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(data.totals.actual.profit)}</td><td colSpan={2} /></tr>
            </tfoot>
          )}
        </table>
      </div>

      {plans.length > 0 && (
        <section className={card}>
          <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Saved plans</h3>
          <ul className="divide-y text-sm">
            {plans.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <span><span className="font-mono text-xs text-tertiary-500">{p.month}</span> · {p.project ? `${p.project.code} ${p.project.name}` : 'Whole company'} · revenue {rupees(p.planned_revenue)}, expense {rupees(p.planned_expense)}, salaries {rupees(p.planned_salaries)}</span>
                <button type="button" className="text-xs font-medium text-danger-600 hover:underline" onClick={() => removePlan(p.id)}>Delete</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Drawer open={Boolean(form)} onClose={() => setForm(null)} size="md" tone="edit" title="Plan a month">
        {form && <PlanForm key={form.month + (project || '')} month={form.month} project={project} projects={projects} existing={plans.find((p) => p.month === form.month && (p.project_id || '') === (project || ''))} saving={saving} onSubmit={save} onCancel={() => setForm(null)} />}
      </Drawer>
    </div>
  );
}

const CONF_TONE = { high: 'green', medium: 'amber', low: 'red', insufficient: 'gray' };
const CONF_TEXT = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence', insufficient: 'Not enough history' };

function ProjectionTab() {
  const { pushError } = useAlerts();
  const [data, setData] = useState(null);
  useEffect(() => {
    zephyrApi.projection().then(setData, (e) => pushError(zephyrError(e, 'Could not load the projection'), 'Load failed'));
  }, [pushError]);
  if (!data) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  const rows = data.series.revenue.points.map((p, i) => ({
    month: p.month,
    revenue: p.value ?? 0,
    expense: data.series.expense.points[i].value ?? 0,
    salaries: data.series.salaries.points[i].value ?? 0,
    profit: data.series.profit.points[i].value ?? 0,
  }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Pill tone={CONF_TONE[data.confidence]}>{CONF_TEXT[data.confidence]}</Pill>
        <span className="text-sm text-tertiary-500">{data.basis_months ? `Straight-line trend over ${data.basis_months} completed month${data.basis_months === 1 ? '' : 's'} (${shortMonth(data.from)} – ${shortMonth(data.to)}). The running month is left out of the fit.` : 'Record at least three completed months of money to project the next six.'}</span>
      </div>
      {data.confidence !== 'insufficient' ? (
        <>
          <section className={card}><ZephyrTrendChart rows={rows} height={240} /></section>
          <div className="overflow-x-auto rounded-2xl border bg-white shadow-soft">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-primary-50/60 text-xs uppercase tracking-wide text-tertiary-500"><tr><th className="px-4 py-2.5">Month</th><th className="px-4 py-2.5 text-right">Revenue</th><th className="px-4 py-2.5 text-right">Expense</th><th className="px-4 py-2.5 text-right">Salaries</th><th className="px-4 py-2.5 text-right">Profit</th></tr></thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.month}><td className="px-4 py-2.5 font-medium">{shortMonth(r.month)}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(r.revenue)}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(r.expense)}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(r.salaries)}</td><td className={`px-4 py-2.5 text-right tabular-nums font-medium ${r.profit < 0 ? 'text-red-600' : ''}`}>{rupees(r.profit)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-tertiary-400">Fit quality (R²): revenue {data.series.revenue.r2 ?? '—'}, expense {data.series.expense.r2 ?? '—'}, salaries {data.series.salaries.r2 ?? '—'}. This is a trend, not a forecast of specific deals.</p>
        </>
      ) : <div className={`${card} text-sm text-tertiary-500`}>Once three or more finished months have entries or approved salary slips, the next six months appear here.</div>}
    </div>
  );
}

function CloseTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [range, setRange] = useState({ from: shift(cm(), -11), to: shift(cm(), -1) });
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => zephyrApi.closes(range).then(setRows, (e) => pushError(zephyrError(e, 'Could not load month status'), 'Load failed')), [range, pushError]);
  useEffect(() => {
    setRows(null);
    load();
  }, [load]);

  async function act(action, success) {
    setBusy(true);
    try {
      await action();
      pushSuccess(success);
      await load();
    } catch (e) {
      pushError(zephyrError(e, 'Could not update'), 'Could not update');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <RangePicker {...range} onChange={setRange} />
      <div className="overflow-x-auto rounded-2xl border bg-white shadow-soft">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-primary-50/60 text-xs uppercase tracking-wide text-tertiary-500"><tr><th className="px-4 py-2.5">Month</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5 text-right">Revenue</th><th className="px-4 py-2.5 text-right">Expense</th><th className="px-4 py-2.5 text-right">Salaries</th><th className="px-4 py-2.5 text-right">Profit</th><th className="px-4 py-2.5 text-right">Action</th></tr></thead>
          <tbody className="divide-y">
            {!rows && <tr><td colSpan={7} className="px-4 py-6 text-center text-tertiary-400">Loading…</td></tr>}
            {rows?.map((r) => {
              const figures = r.status === 'closed' ? r.snapshot.summary : r.live;
              return (
                <tr key={r.month}>
                  <td className="px-4 py-2.5 font-medium">{shortMonth(r.month)}</td>
                  <td className="px-4 py-2.5">
                    {r.status === 'closed' ? <span className="inline-flex items-center gap-1.5"><Pill tone="gray">Closed</Pill>{r.stale && <span title="Money dated in this month changed after it was closed" className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">Changed since close</span>}</span> : <Pill tone="blue">Open</Pill>}
                    {r.reopen_reason && r.status === 'open' && <div className="mt-0.5 text-[11px] text-tertiary-400">Reopened: {r.reopen_reason}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{rupees(figures.revenue)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{rupees(figures.expense)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{rupees(figures.salaries)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{rupees(figures.profit)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {r.status === 'open'
                      ? <button type="button" disabled={busy} className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline" onClick={() => act(() => zephyrApi.closeMonth(r.month), `${shortMonth(r.month)} closed`)}><Lock className="h-3.5 w-3.5" />Close month</button>
                      : <button type="button" disabled={busy} className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:underline" onClick={() => { const reason = window.prompt('Why is this month being reopened?'); if (reason?.trim()) act(() => zephyrApi.reopenMonth(r.month, reason.trim()), `${shortMonth(r.month)} reopened`); }}><LockOpen className="h-3.5 w-3.5" />Reopen</button>}
                    {r.status === 'closed' && r.stale && <div className="text-[11px] text-tertiary-400">Live profit {rupees(r.live.profit)}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-tertiary-400">Closing a month saves its totals as a snapshot. Money dated in a closed month can still be entered; it flags the month as changed, and you reopen and close again to refresh the snapshot. All draft salary slips of the month must be approved or deleted first.</p>
    </div>
  );
}

const GROUPS = [['month', 'By month'], ['project', 'By project'], ['service', 'By service'], ['property', 'By property'], ['party', 'By client / vendor']];

function StatementsTab() {
  const { pushError } = useAlerts();
  const [group, setGroup] = useState('month');
  const [range, setRange] = useState({ from: shift(cm(), -11), to: cm() });
  const [data, setData] = useState(null);
  useEffect(() => {
    setData(null);
    zephyrApi.statement({ group, ...range }).then(setData, (e) => pushError(zephyrError(e, 'Could not load the statement'), 'Load failed'));
  }, [group, range, pushError]);

  async function download(format) {
    try {
      const blob = await zephyrApi.statementFile({ group, ...range, format });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `zephyr-pnl-${group}-${range.from}-${range.to}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      pushError(zephyrError(e, 'Download failed'), 'Download failed');
    }
  }
  function csv() {
    const lines = [['Name', 'Revenue', 'Expense', 'Salaries', 'Profit'], ...[...data.rows, data.totals].map((r) => [r.name, r.revenue, r.expense, r.salaries ?? '', r.profit])];
    downloadText(`zephyr-pnl-${group}.csv`, lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex overflow-hidden rounded-xl border bg-white text-sm">
            {GROUPS.map(([key, label]) => <button key={key} type="button" onClick={() => setGroup(key)} className={`px-3 py-1.5 ${group === key ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-primary-50'}`}>{label}</button>)}
          </div>
          <RangePicker {...range} onChange={setRange} />
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => download('xlsx')}><FileSpreadsheet className="h-4 w-4" />Excel</button>
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => download('pdf')}><FileText className="h-4 w-4" />PDF</button>
          <button type="button" className="btn-secondary" disabled={!data} onClick={csv}>CSV</button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border bg-white shadow-soft">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-primary-50/60 text-xs uppercase tracking-wide text-tertiary-500"><tr><th className="px-4 py-2.5">{GROUPS.find(([k]) => k === group)[1].replace('By ', '')}</th><th className="px-4 py-2.5 text-right">Revenue</th><th className="px-4 py-2.5 text-right">Expense</th><th className="px-4 py-2.5 text-right">Salaries</th><th className="px-4 py-2.5 text-right">Profit</th></tr></thead>
          <tbody className="divide-y">
            {!data && <tr><td colSpan={5} className="px-4 py-6 text-center text-tertiary-400">Loading…</td></tr>}
            {data?.rows.map((r) => (
              <tr key={r.name}><td className="px-4 py-2.5 font-medium">{group === 'month' ? shortMonth(r.name) : r.name}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(r.revenue)}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(r.expense)}</td><td className="px-4 py-2.5 text-right tabular-nums">{r.salaries === null ? '—' : rupees(r.salaries)}</td><td className={`px-4 py-2.5 text-right tabular-nums font-medium ${r.profit < 0 ? 'text-red-600' : ''}`}>{rupees(r.profit)}</td></tr>
            ))}
          </tbody>
          {data && <tfoot className="border-t bg-primary-50/40 font-medium"><tr><td className="px-4 py-2.5">Total</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(data.totals.revenue)}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(data.totals.expense)}</td><td className="px-4 py-2.5 text-right tabular-nums">{data.totals.salaries === null ? '—' : rupees(data.totals.salaries)}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(data.totals.profit)}</td></tr></tfoot>}
        </table>
      </div>
      {group === 'party' && <p className="text-xs text-tertiary-400">Salaries are not charged to clients or vendors, so profit here is revenue minus expense.</p>}
      {data && <p className="text-xs text-tertiary-400">{dateLabel(`${data.from}-01`)} to {dateLabel(`${data.to}-28`)} · actual entries and approved or paid pay slips.</p>}
    </div>
  );
}

export default function ZephyrFinancialsPage() {
  const { me, loading } = useZephyr();
  const [tab, setTab] = useState('plan');
  const [projects, setProjects] = useState([]);
  useEffect(() => {
    zephyrApi.projects({}).then(setProjects, () => setProjects([]));
  }, []);
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!zxCan(me, 'financials')) return <Navigate to="/zephyr" replace />;
  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'plan' && <PlanTab projects={projects} />}
      {tab === 'projection' && <ProjectionTab />}
      {tab === 'close' && <CloseTab />}
      {tab === 'statements' && <StatementsTab />}
    </div>
  );
}
