import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AlertTriangle, Flag, Plus } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import useLiveData from '../../lib/useLiveData.js';
import { chartTooltipStyle } from '../../lib/chartTheme.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { fxApi, foundationError } from '../../lib/foundation/api.js';
import { fxCan, useFoundation } from '../../lib/foundation/useFoundation.js';
import { useFxPickers } from '../../lib/foundation/pickers.js';
import { CAMPAIGN_STATUSES, FLAG_META, STATUS_META, inr, pctLabel } from '../../lib/foundation/meta.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Pill from '../../components/ui/Pill.jsx';
import FilterBar from '../../components/zephyr/FilterBar.jsx';
import ChartCard from '../../components/ui/ChartCard.jsx';
import { Empty, Kpi, Money, card } from '../../components/foundation/ui.jsx';
import { FX_COLORS, MonthlyChart } from '../../components/foundation/FxCharts.jsx';

const BLANK = { from: '', to: '', category_id: '', status: '', state: '', city: '', q: '' };
const ATTENTION_ORDER = ['over_budget', 'projected_overrun', 'delayed', 'no_budget', 'ending_with_funds', 'behind_plan', 'completed_unspent'];

export default function FoundationHomePage() {
  const { me, loading } = useFoundation();
  const { pushError } = useAlerts();
  const navigate = useNavigate();
  const pickers = useFxPickers({ people: false });
  const [f, setF] = useState(BLANK);
  const set = (k, v) => setF((c) => ({ ...c, [k]: v }));
  const { data, loading: busy, error } = useLiveData(() => fxApi.dashboard(f), { intervalMs: 60000, enabled: Boolean(me), deps: [JSON.stringify(f)] });
  useEffect(() => { if (error) pushError(foundationError(error, 'Could not load the dashboard'), 'Load failed'); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  const k = data?.kpis;
  const monthly = useMemo(() => data?.monthly || [], [data]);
  const attention = useMemo(() => ATTENTION_ORDER.flatMap((type) => (data?.attention?.[type] || []).map((a) => ({ ...a, type }))), [data]);
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !fxCan(me, 'dashboard')) return <Navigate to="/foundation/campaigns" replace />;

  const columns = [
    { key: 'name', header: 'Campaign', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{r.code}{r.category ? ` · ${r.category.name}` : ''}</span></span> },
    { key: 'location', header: 'Location', render: (r) => [r.city, r.state].filter(Boolean).join(', ') || '-' },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={STATUS_META[r.status]?.tone}>{STATUS_META[r.status]?.label}</Pill> },
    { key: 'budget', header: 'Budget', render: (r) => <Money v={r.metrics.allocated_budget} /> },
    { key: 'spent', header: 'Actual spend', render: (r) => <Money v={r.metrics.actual_expenditure} /> },
    { key: 'remaining', header: 'Remaining', render: (r) => (r.metrics.overspend > 0 ? <span className="text-red-600">Over by <Money v={r.metrics.overspend} /></span> : <Money v={r.metrics.remaining_allocated} />) },
    { key: 'end', header: 'End date', render: (r) => r.planned_end || '-' },
  ];
  const catData = (data?.by_category || []).filter((c) => c.allocated_budget > 0);

  return (
    <div className="mt-4 space-y-4">
      <FilterBar
        q={f.q}
        onQ={(v) => set('q', v)}
        searchPlaceholder="Search campaign, code, place..."
        fields={[
          { key: 'from', label: 'From (campaign window / money moved)', type: 'date' },
          { key: 'to', label: 'To', type: 'date' },
          { key: 'category_id', label: 'Initiative / category', type: 'select', any: 'All', options: pickers.initiatives },
          { key: 'status', label: 'Status', type: 'select', any: 'All', options: CAMPAIGN_STATUSES.map((s) => ({ value: s.value, label: s.label })) },
          { key: 'state', label: 'State', type: 'text' },
          { key: 'city', label: 'City', type: 'text' },
        ]}
        values={f}
        defaults={BLANK}
        onChange={set}
        onReset={() => setF(BLANK)}
      >
        {fxCan(me, 'campaignsEdit') && <Link to="/foundation/campaigns?new=1" className="btn-primary inline-flex items-center gap-1.5"><Plus className="h-4 w-4" />New campaign</Link>}
        {fxCan(me, 'entries') && <Link to="/foundation/funds?new=1" className="btn-secondary inline-flex items-center gap-1.5">Record money</Link>}
      </FilterBar>

      {!k ? <div className="py-8 text-center text-sm text-tertiary-500">{busy ? 'Loading...' : 'No data.'}</div> : (
        <div className={`space-y-4 transition-opacity ${busy ? 'opacity-60' : ''}`}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Total campaigns" value={k.campaigns.total} hint={`${k.campaigns.draft} draft · ${k.campaigns.on_hold} on hold · ${k.campaigns.cancelled} cancelled`} />
            <Kpi label="Active campaigns" value={k.campaigns.active} />
            <Kpi label="Planned campaigns" value={k.campaigns.planned} />
            <Kpi label="Completed campaigns" value={k.campaigns.completed} />
            <Kpi label="Allocated budget" value={<Money v={k.allocated_budget} />} hint="Assigned to campaigns, not spent" />
            <Kpi label="Planned investment" value={<Money v={k.planned_investment} />} hint="What the foundation intends to invest" />
            <Kpi label={f.from || f.to ? 'Spent in the period' : 'Actual expenditure'} value={<Money v={k.period.actual_expenditure} />} hint={`Of which programme investment ${inr(k.period.actual_investment)}`} />
            <Kpi label={f.from || f.to ? 'Funds received in the period' : 'Funds received'} value={<Money v={k.period.funds_received} />} hint={k.funds_pledged ? `${inr(k.funds_pledged)} pledged, not yet received` : undefined} />
            <Kpi label="Remaining allocated budget" value={<Money v={k.remaining_allocated} />} hint={k.overspend > 0 ? `${inr(k.overspend)} over budget on some campaigns` : 'Allocated minus actual expenditure'} tone="text-primary-700" />
            <Kpi label="Uncommitted budget" value={<Money v={k.uncommitted} />} hint={`After ${inr(k.commitments)} of approved, unpaid commitments`} />
            <Kpi label="Planned investment still to invest" value={<Money v={k.planned_remaining} />} />
            <Kpi label="Projected final expenditure" value={<Money v={k.projected_final_expenditure} />} hint={k.projected_overrun > 0 ? `${inr(k.projected_overrun)} projected over budget` : 'An estimate, not a transaction'} tone={k.projected_overrun > 0 ? 'text-amber-600' : undefined} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <ChartCard className="xl:col-span-2" title="Planned versus actual, month by month" subtitle="Investment plan, actual investment and spending; the dashed line is the projection (an estimate)">
              <MonthlyChart rows={monthly} showFunding />
            </ChartCard>
            <ChartCard title="Budget by initiative" subtitle="Allocated budget share">
              {catData.length === 0 ? <Empty>No budgets yet.</Empty> : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie isAnimationActive={false} data={catData} dataKey="allocated_budget" nameKey="name" innerRadius="50%" outerRadius="80%" paddingAngle={2}>
                        {catData.map((c, i) => <Cell key={c.name} fill={['#2F7A4F', '#67A87A', '#D9993D', '#5B8DB8', '#7A6BB5', '#B06A3B', '#9CC9AB'][i % 7]} />)}
                      </Pie>
                      <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [inr(v), name]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              <ul className="mt-2 space-y-1 text-xs text-tertiary-600">
                {catData.slice(0, 6).map((c) => <li key={c.name} className="flex justify-between"><span>{c.name}</span><span className="tabular-nums">{inr(c.actual_expenditure)} of {inr(c.allocated_budget)}</span></li>)}
              </ul>
            </ChartCard>
          </div>

          {attention.length > 0 && (
            <section className={`${card} border-amber-200 bg-amber-50/40`} aria-label="Campaigns that need attention">
              <h3 className="mb-2 flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><AlertTriangle className="h-4 w-4 text-amber-600" />Needs attention ({attention.length})</h3>
              <ul className="grid gap-1.5 md:grid-cols-2">
                {attention.slice(0, 12).map((a) => (
                  <li key={`${a.type}-${a.campaign_id}`}>
                    <Link to={`/foundation/campaigns/${a.campaign_id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white">
                      <span className="min-w-0 truncate"><span className="font-medium text-tertiary-900">{a.name}</span> <span className="text-xs text-tertiary-500">{a.code}</span></span>
                      <Pill tone={FLAG_META[a.type]?.tone}>{FLAG_META[a.type]?.label}{a.amount ? ` · ${inr(a.amount)}` : ''}</Pill>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className={card}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><Flag className="h-4 w-4" />Campaign overview</h3>
              <Link to="/foundation/campaigns" className="text-xs font-medium text-primary-700 hover:underline">All campaigns</Link>
            </div>
            <DataTable columns={columns} rows={data.campaigns} emptyLabel="No campaigns match these filters." onRowClick={(r) => navigate(`/foundation/campaigns/${r.id}`)} maxHeight="50vh" />
            <p className="mt-2 text-[11px] text-tertiary-500">Utilisation overall: {pctLabel(k.allocated_budget > 0 ? Math.round((k.actual_expenditure / k.allocated_budget) * 1000) / 10 : null)}. Budgets are shown to date; the date filter narrows the spending and funding counted in the period. <span style={{ color: FX_COLORS.projected }}>Projections</span> are estimates and never create transactions.</p>
          </section>
        </div>
      )}
    </div>
  );
}
