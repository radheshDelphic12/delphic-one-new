import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import useLiveData from '../../lib/useLiveData.js';
import { zkApi, zklyreraError } from '../../lib/zklyrera/api.js';
import { useZklyrera, zkCan } from '../../lib/zklyrera/useZklyrera.js';
import { useZkPickers } from '../../lib/zklyrera/pickers.js';
import { PROJECTION_LINES, PROJECTION_STATUSES, inr } from '../../lib/zklyrera/meta.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Pill from '../../components/ui/Pill.jsx';
import ChartCard from '../../components/ui/ChartCard.jsx';
import ZkFilterBar, { useZkFilters } from '../../components/zklyrera/ZkFilters.jsx';
import ProjectionDrawer from '../../components/zklyrera/ProjectionDrawer.jsx';
import { ProjectedActualChart } from '../../components/zklyrera/ZkCharts.jsx';
import { Empty, Kpi, Money, card } from '../../components/zklyrera/ui.jsx';

const TONE = { on_track: 'green', off_track: 'red', unplanned: 'amber', none: 'gray' };
const LABEL = { on_track: 'On track', off_track: 'Off track', unplanned: 'Not planned', none: '-' };

/** Plan future months and compare them with what actually happened. A projection is a plan; it never creates a transaction. */
export default function ZklyreraProjectionsPage() {
  const { me, loading } = useZklyrera();
  const { pushError, pushSuccess } = useAlerts();
  const pickers = useZkPickers({ people: true });
  const filters = useZkFilters({ preset: 'current_quarter', fyStart: me?.fy_start_month || 4, extra: { line: '', status: '' } });
  const { f, params, key } = filters;
  const [drawer, setDrawer] = useState({ open: false, projection: null });
  const range = { from: f.from.slice(0, 7), to: f.to.slice(0, 7) };
  const list = useLiveData(() => zkApi.projections({ ...range, line: f.line, status: f.status }), { enabled: Boolean(me), deps: [key] });
  const cmp = useLiveData(() => zkApi.projectionCompare(params), { enabled: Boolean(me), deps: [key] });
  const dash = useLiveData(() => zkApi.dashboard({ ...params, from: `${at(range.to, -11)}-01`, to: params.to }), { enabled: Boolean(me), deps: [key] });
  useEffect(() => { if (list.error) pushError(zklyreraError(list.error, 'Could not load the projections'), 'Load failed'); }, [list.error]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !zkCan(me, 'projections')) return <Navigate to="/zklyrera" replace />;
  const canEdit = zkCan(me, 'projectionsEdit');
  const canSalary = zkCan(me, 'payroll');
  const refresh = () => { list.refresh(); cmp.refresh(); dash.refresh(); };
  const close = () => setDrawer({ open: false, projection: null });
  async function remove(p) {
    if (!window.confirm(`Delete the projection "${p.name}"?`)) return;
    try { await zkApi.deleteProjection(p.id); pushSuccess('Projection deleted'); refresh(); } catch (e) { pushError(zklyreraError(e, 'Could not delete'), 'Not deleted'); }
  }
  const t = cmp.data?.projected_totals;
  const rows = (list.data || []).filter((p) => canSalary || p.line !== 'salary');
  const columns = [
    { key: 'month', header: 'Month', render: (r) => r.month },
    { key: 'name', header: 'Projection', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span>{r.notes && <span className="block text-xs text-tertiary-500">{r.notes}</span>}</span> },
    { key: 'line', header: 'Line', render: (r) => <span>{r.line_label}{r.category && <span className="block text-xs text-tertiary-500">{r.category.name}</span>}{r.investment && <span className="block text-xs text-tertiary-500">{r.investment.code}</span>}</span> },
    { key: 'amount', header: 'Planned', render: (r) => <Money v={r.amount} /> },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={PROJECTION_STATUSES.find((s) => s.value === r.status)?.tone}>{PROJECTION_STATUSES.find((s) => s.value === r.status)?.label}</Pill> },
    { key: 'a', header: '', render: (r) => canEdit && (
      <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <button type="button" title="Edit" className="rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => setDrawer({ open: true, projection: r })}><Pencil className="h-4 w-4" /></button>
        <button type="button" title="Delete" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></button>
      </span>
    ) },
  ];
  return (
    <div className="mt-4 space-y-4">
      <ZkFilterBar
        filters={filters}
        pickers={pickers}
        fields={[]}
        extraFields={[
          { key: 'line', label: 'Financial line', type: 'select', any: 'All', options: PROJECTION_LINES.filter((l) => canSalary || l.value !== 'salary').map((l) => ({ value: l.value, label: l.label })) },
          { key: 'status', label: 'Projection status', type: 'select', any: 'All', options: PROJECTION_STATUSES.map((s) => ({ value: s.value, label: s.label })) },
        ]}
        searchPlaceholder="Search..."
      >
        {canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ open: true, projection: null })}><Plus className="h-4 w-4" />New projection</button>}
      </ZkFilterBar>

      {t && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Projected income" value={<Money v={t.income} />} hint="Expected earnings + other income (a plan)" />
          <Kpi label="Projected expenses" value={<Money v={canSalary ? t.expenses : t.expenses - t.salary} />} hint="Operating, salary and other" />
          <Kpi label="Projected net result" value={<Money v={canSalary ? t.net : t.income - (t.expenses - t.salary)} signed />} />
          <Kpi label="Planned investment / recovery" value={<Money v={t.new_investment} />} hint={`${inr(t.principal_recovery)} principal expected back`} />
        </div>
      )}

      <section className={card} aria-label="Projected versus actual">
        <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Projected versus actual</h3>
        {!cmp.data ? <p className="text-sm text-tertiary-500">Loading...</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="text-left text-xs text-tertiary-500"><tr><th className="py-1.5 font-medium">Line</th><th className="px-2 text-right font-medium">Projected</th><th className="px-2 text-right font-medium">Actual</th><th className="px-2 text-right font-medium">Variance</th><th className="px-2 text-right font-medium">Var %</th><th className="px-2 text-right font-medium">Remaining expected</th><th className="px-2 font-medium">Performance</th></tr></thead>
              <tbody>
                {cmp.data.total.map((c) => (
                  <tr key={c.line} className="border-t"><td className="py-1.5">{c.label}</td><td className="px-2 text-right tabular-nums"><Money v={c.projected} /></td><td className="px-2 text-right tabular-nums"><Money v={c.actual} /></td>
                    <td className={`px-2 text-right tabular-nums ${c.favourable === false ? 'text-red-600' : c.favourable ? 'text-emerald-700' : ''}`}><Money v={c.variance} /></td>
                    <td className="px-2 text-right tabular-nums">{c.variance_pct === null ? '-' : `${c.variance_pct}%`}</td><td className="px-2 text-right tabular-nums"><Money v={c.remaining} /></td>
                    <td className="px-2"><Pill tone={TONE[c.status]}>{LABEL[c.status]}</Pill></td></tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-tertiary-500">Variance = actual - projected. Income and returns below plan, or expenses above plan, are unfavourable. Principal recovery is capital coming back, not profit; expected returns are not guaranteed.</p>
          </div>
        )}
      </section>

      {dash.data && (
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard title="Projected vs actual income" subtitle="Month by month"><ProjectedActualChart rows={dash.data.projected_by_month} side="income" /></ChartCard>
          <ChartCard title="Projected vs actual expenses" subtitle="Month by month"><ProjectedActualChart rows={dash.data.projected_by_month} side="expenses" /></ChartCard>
        </div>
      )}

      <section className="space-y-2" aria-label="Projection records">
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">Projection records</h3>
        {list.data && rows.length === 0 ? <Empty>No projections for these filters. Add one to plan a month.</Empty> : <DataTable columns={columns} rows={rows} loading={!list.data} emptyLabel="No projections." onRowClick={(r) => canEdit && setDrawer({ open: true, projection: r })} maxHeight="50vh" />}
      </section>
      <ProjectionDrawer key={`${drawer.projection?.id || 'new'}-${drawer.open}`} open={drawer.open} projection={drawer.projection} defaultMonth={range.from} pickers={pickers} canSeeSalary={canSalary} onClose={close} onSaved={() => { close(); refresh(); }} />
    </div>
  );
}

function at(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const i = y * 12 + (m - 1) + delta;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}
