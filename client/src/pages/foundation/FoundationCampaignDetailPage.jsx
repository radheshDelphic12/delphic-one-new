import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarRange, Pencil, Plus, Scale, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { fxApi, foundationError } from '../../lib/foundation/api.js';
import { fxCan, useFoundation } from '../../lib/foundation/useFoundation.js';
import { useFxPickers } from '../../lib/foundation/pickers.js';
import { ALL_ENTRY_STATUSES, FLAG_META, KIND_LABEL, NEXT_STATUS, STATUS_META, inr, pctLabel } from '../../lib/foundation/meta.js';
import { shortMonth, dateLabel } from '../../lib/format.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import CampaignForm from '../../components/foundation/CampaignForm.jsx';
import EntryDrawer from '../../components/foundation/EntryDrawer.jsx';
import { BudgetForm, PlanEditor } from '../../components/foundation/BudgetAndPlan.jsx';
import { MonthlyChart } from '../../components/foundation/FxCharts.jsx';
import { Detail, Empty, Kpi, Money, card } from '../../components/foundation/ui.jsx';

const STATUS_ACTION = { planned: 'Mark as planned', active: 'Start / resume', on_hold: 'Put on hold', completed: 'Mark completed', cancelled: 'Cancel campaign', draft: 'Back to draft' };
const REASON_FOR = { cancelled: 'Why is the campaign being cancelled?' };

export default function FoundationCampaignDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { me, loading } = useFoundation();
  const { pushError, pushSuccess } = useAlerts();
  const pickers = useFxPickers();
  const [c, setC] = useState(null);
  const [entries, setEntries] = useState(null);
  const [drawer, setDrawer] = useState(null); // edit | budget | plan
  const [entryDrawer, setEntryDrawer] = useState({ open: false, entry: null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => Promise.all([fxApi.campaign(id), fxApi.entries({ campaign_id: id, limit: 100 })]).then(([camp, ents]) => { setC(camp); setEntries(ents); }, (e) => pushError(foundationError(e, 'Could not load the campaign'), 'Load failed')), [id, pushError]);
  useEffect(() => { if (me) load(); }, [me, load]);

  const forecastRows = useMemo(() => {
    if (!c) return [];
    const proj = new Map((c.forecast.monthly || []).map((m) => [m.month, m.projected]));
    const months = new Set([...c.monthly.map((m) => m.month), ...proj.keys()]);
    const by = new Map(c.monthly.map((m) => [m.month, m]));
    return [...months].sort().map((month) => ({ month, ...(by.get(month) || { planned_investment: 0, actual_investment: 0, actual_expenditure: 0, funding_received: 0 }), projected: proj.get(month) }));
  }, [c]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !fxCan(me, 'campaigns')) return <Navigate to="/foundation" replace />;
  if (!c) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  const canEdit = fxCan(me, 'campaignsEdit');
  const m = c.metrics;
  const t = c.timeline;
  const fc = c.forecast;
  const isAdmin = me.role === 'admin';

  async function run(fn, ok) {
    setSaving(true);
    setError('');
    try { await fn(); if (ok) pushSuccess(ok); setDrawer(null); await load(); } catch (e) { setError(foundationError(e, 'Could not save')); } finally { setSaving(false); }
  }
  async function changeStatus(to) {
    let reason;
    if (to === 'cancelled' || ['completed', 'cancelled'].includes(c.status)) {
      reason = window.prompt(REASON_FOR[to] || `Reason for moving this campaign to "${STATUS_META[to].label}":`);
      if (!reason || !reason.trim()) return;
    }
    try { await fxApi.setCampaignStatus(id, { to, ...(reason ? { reason: reason.trim() } : {}) }); pushSuccess(`Campaign is now ${STATUS_META[to].label}`); load(); } catch (e) { pushError(foundationError(e, 'Could not change the status'), 'Not changed'); }
  }
  async function removeCampaign() {
    if (!window.confirm('Delete this campaign? This only works while it has no transactions.')) return;
    try { await fxApi.deleteCampaign(id); pushSuccess('Campaign deleted'); navigate('/foundation/campaigns'); } catch (e) { pushError(foundationError(e, 'Could not delete'), 'Not deleted'); }
  }
  async function entryAction(entry, to) {
    let reason;
    if (['rejected', 'cancelled', 'reversed'].includes(to)) { reason = window.prompt(`Reason to ${to === 'reversed' ? 'reverse this payment' : to === 'rejected' ? 'reject this' : 'cancel this'}:`); if (!reason || !reason.trim()) return; }
    try { await fxApi.setEntryStatus(entry.id, { to, ...(reason ? { reason: reason.trim() } : {}) }); load(); } catch (e) {
      const data = e?.response?.data;
      if (data?.code === 'over_budget' || data?.code === 'override_reason_required') {
        const why = window.prompt(`${foundationError(e, '')}\n\nReason for going over budget (admin only):`);
        if (why && why.trim()) { try { await fxApi.setEntryStatus(entry.id, { to, override_reason: why.trim() }); load(); return; } catch (e2) { pushError(foundationError(e2, 'Not changed'), 'Not changed'); return; } }
      }
      pushError(foundationError(e, 'Could not change the entry'), 'Not changed');
    }
  }

  const entryCols = [
    { key: 'date', header: 'Date', render: (r) => dateLabel(r.entry_date) },
    { key: 'kind', header: 'Type', render: (r) => <span>{KIND_LABEL[r.kind]}{r.expense_class && <span className="block text-xs text-tertiary-500">{r.expense_class === 'programme' ? 'Programme' : 'Operational'}</span>}</span> },
    { key: 'cat', header: 'Category / party', render: (r) => <span>{r.category?.name || '-'}{r.party_name && <span className="block text-xs text-tertiary-500">{r.party_name}</span>}</span> },
    { key: 'amount', header: 'Amount', render: (r) => <span className={r.kind === 'funding' ? 'text-green-700' : ''}><Money v={r.amount} /></span> },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={ALL_ENTRY_STATUSES[r.status]?.tone}>{ALL_ENTRY_STATUSES[r.status]?.label || r.status}</Pill> },
    { key: 'ref', header: 'Reference', render: (r) => r.reference || '-' },
    { key: 'a', header: '', render: (r) => (
      <span className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
        {r.kind === 'expense' && r.status === 'pending' && fxCan(me, 'entriesApprove') && <button type="button" className="text-xs font-medium text-primary-700 hover:underline" onClick={() => entryAction(r, 'approved')}>Approve</button>}
        {r.kind === 'expense' && r.status === 'approved' && fxCan(me, 'entriesApprove') && <button type="button" className="text-xs font-medium text-primary-700 hover:underline" onClick={() => entryAction(r, 'paid')}>Mark paid</button>}
        {r.kind === 'funding' && r.status === 'pledged' && <button type="button" className="text-xs font-medium text-primary-700 hover:underline" onClick={() => entryAction(r, 'received')}>Received</button>}
        <button type="button" title="Edit" className="rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => setEntryDrawer({ open: true, entry: r })}><Pencil className="h-4 w-4" /></button>
      </span>
    ) },
  ];

  return (
    <div className="mt-4 space-y-4">
      <Link to="/foundation/campaigns" className="inline-flex items-center gap-1 text-xs font-medium text-tertiary-500 hover:text-primary-700"><ArrowLeft className="h-3.5 w-3.5" />All campaigns</Link>

      <section className={`${card} flex flex-wrap items-start justify-between gap-3`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-xl font-bold text-tertiary-900">{c.name}</h2>
            <Pill tone={STATUS_META[c.status]?.tone}>{STATUS_META[c.status]?.label}</Pill>
            {c.flags.map((f) => <span key={f.type} title={f.message}><Pill tone={FLAG_META[f.type]?.tone}>{FLAG_META[f.type]?.label}{f.amount ? ` · ${inr(f.amount)}` : ''}</Pill></span>)}
          </div>
          <p className="mt-1 text-sm text-tertiary-500">{c.code}{c.category ? ` · ${c.category.name}` : ''}{c.manager ? ` · Managed by ${c.manager.name}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => { setError(''); setDrawer('edit'); }}><Pencil className="h-4 w-4" />Edit</button>}
          {fxCan(me, 'budget') && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => { setError(''); setDrawer('budget'); }}><Scale className="h-4 w-4" />Revise budget</button>}
          {fxCan(me, 'plan') && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => { setError(''); setDrawer('plan'); }}><CalendarRange className="h-4 w-4" />Monthly plan</button>}
          {canEdit && (NEXT_STATUS[c.status] || []).filter(() => !(['completed', 'cancelled'].includes(c.status) && !isAdmin)).map((s) => (
            <button key={s} type="button" className="btn-secondary" onClick={() => changeStatus(s)}>{STATUS_ACTION[s]}</button>
          ))}
          {fxCan(me, 'delete') && <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-danger-600" onClick={removeCampaign}><Trash2 className="h-4 w-4" />Delete</button>}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Allocated budget" value={<Money v={m.allocated_budget} />} hint="Assigned, not spent" />
        <Kpi label="Planned investment" value={<Money v={m.planned_investment} />} hint={`${inr(m.planned_remaining)} still to invest`} />
        <Kpi label="Actual expenditure" value={<Money v={m.actual_expenditure} />} hint={`Investment ${inr(m.actual_investment)} · operational ${inr(m.actual_operational)}`} />
        <Kpi label="Funds received" value={<Money v={m.funds_received} />} hint={m.funds_pledged ? `${inr(m.funds_pledged)} pledged` : `Net of spending ${inr(m.net_funds)}`} />
        <Kpi label="Remaining budget" value={<Money v={m.remaining_allocated} />} hint={m.overspend > 0 ? `Over budget by ${inr(m.overspend)}` : `${pctLabel(m.utilization_pct)} of the budget used`} tone={m.overspend > 0 ? 'text-red-600' : 'text-primary-700'} />
        <Kpi label="Commitments" value={<Money v={m.commitments} />} hint="Approved, not yet paid" />
        <Kpi label="Uncommitted budget" value={<Money v={m.uncommitted} />} hint={m.over_committed > 0 ? `Commitments exceed it by ${inr(m.over_committed)}` : 'After commitments'} />
        <Kpi label="Projected final spend" value={fc.projected_final_expenditure === null ? 'N/A' : <Money v={fc.projected_final_expenditure} />} hint={fc.projected_overrun > 0 ? `${inr(fc.projected_overrun)} over budget` : fc.projected_underspend > 0 && fc.projected_final_expenditure !== null ? `${inr(fc.projected_underspend)} left unspent` : 'An estimate'} tone={fc.projected_overrun > 0 ? 'text-amber-600' : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className={`${card} lg:col-span-2`}>
          <h3 className="mb-3 font-heading text-sm font-semibold text-tertiary-900">Overview</h3>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Detail label="Objective and expected outcome">{c.objective}</Detail>
            <Detail label="Description">{c.description}</Detail>
            <Detail label="Location">{[c.area, c.city, c.state, c.country].filter(Boolean).join(', ')}</Detail>
            <Detail label="Address">{c.address}</Detail>
            <Detail label="Financial notes">{c.financial_notes}</Detail>
            <Detail label="Created">{c.created_by_name ? `${c.created_by_name}, ${dateLabel(c.created_at)}` : dateLabel(c.created_at)}</Detail>
          </dl>
        </section>
        <section className={card}>
          <h3 className="mb-3 font-heading text-sm font-semibold text-tertiary-900">Timeline</h3>
          <dl className="space-y-2">
            <Detail label="Planned">{t.planned_start || t.planned_end ? `${t.planned_start ? dateLabel(t.planned_start) : '?'} to ${t.planned_end ? dateLabel(t.planned_end) : '?'}` : null}</Detail>
            <Detail label="Duration">{t.duration_days ? `${t.duration_days} days (${t.duration_months} month${t.duration_months === 1 ? '' : 's'})` : null}</Detail>
            <Detail label="Actual start">{t.actual_start ? dateLabel(t.actual_start) : null}</Detail>
            <Detail label="Actual completion">{t.actual_end ? dateLabel(t.actual_end) : null}</Detail>
            <Detail label="Schedule elapsed">{t.schedule_elapsed_pct === null ? null : `${t.schedule_elapsed_pct}%${t.delayed ? ' (past its planned end)' : ''}`}</Detail>
            <Detail label="Objective progress">Not tracked (budget used is not the same as work completed)</Detail>
          </dl>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard className="xl:col-span-2" title="Month by month" subtitle="Planned investment, actual investment and spending; dashed = projected spending (an estimate)">
          <MonthlyChart rows={forecastRows} showFunding />
        </ChartCard>
        <section className={card}>
          <h3 className="mb-1 font-heading text-sm font-semibold text-tertiary-900">Projection</h3>
          <p className="mb-3 text-xs text-tertiary-500">{fc.note}</p>
          <dl className="space-y-2">
            <Detail label="Method">{fc.method === 'run_rate' ? 'Run rate' : fc.method === 'final' ? 'Final actuals' : 'Planned schedule'}</Detail>
            <Detail label="Projected final expenditure">{fc.projected_final_expenditure === null ? null : inr(fc.projected_final_expenditure)}</Detail>
            <Detail label="Projected remaining budget">{fc.projected_remaining_budget === null ? null : inr(fc.projected_remaining_budget)}</Detail>
            {fc.projected_overrun > 0 && <Detail label="Projected overrun"><span className="font-semibold text-amber-700">{inr(fc.projected_overrun)}</span></Detail>}
            <Detail label="Months left">{fc.remaining_months || null}</Detail>
            <Detail label="Plan">{c.plan_source === 'plan' ? 'Monthly plan set' : c.plan_source === 'even' ? 'Spread evenly (no monthly plan yet)' : 'No plan'}</Detail>
          </dl>
          {fc.monthly.length > 0 && (
            <table className="mt-3 w-full text-xs">
              <thead className="text-left text-tertiary-500"><tr><th className="py-1">Month</th><th className="text-right">Projected</th></tr></thead>
              <tbody>{fc.monthly.map((x) => <tr key={x.month} className="border-t"><td className="py-1">{shortMonth(x.month)}</td><td className="text-right tabular-nums">{inr(x.projected)}</td></tr>)}</tbody>
            </table>
          )}
        </section>
      </div>

      <section className={card}>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-heading text-sm font-semibold text-tertiary-900">Transactions</h3>
          {fxCan(me, 'entries') && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setEntryDrawer({ open: true, entry: null })}><Plus className="h-4 w-4" />Record money</button>}
        </div>
        <DataTable columns={entryCols} rows={entries?.data || []} loading={!entries} emptyLabel="Nothing recorded for this campaign yet." maxHeight="50vh" />
        <p className="mt-2 text-[11px] text-tertiary-500">Only paid spending and received funds count. Pending, rejected, cancelled and reversed entries never do, and transfers are neither income nor expense.</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`${card} overflow-x-auto`}>
          <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Budget history</h3>
          <table className="w-full min-w-[26rem] text-xs">
            <thead className="text-left text-tertiary-500"><tr><th className="py-1">When</th><th className="text-right">Allocated</th><th className="text-right">Planned inv.</th><th className="pl-3">Why / who</th></tr></thead>
            <tbody>{c.budget_history.map((h) => (
              <tr key={h.id} className="border-t"><td className="py-1.5">{dateLabel(h.effective_date)}</td><td className="text-right tabular-nums">{inr(h.previous_allocated)} → {inr(h.new_allocated)}</td><td className="text-right tabular-nums">{inr(h.previous_planned)} → {inr(h.new_planned)}</td><td className="pl-3">{h.reason}{h.changed_by && <span className="block text-tertiary-400">{h.changed_by}</span>}</td></tr>
            ))}</tbody>
          </table>
        </section>
        <section className={card}>
          <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Activity</h3>
          {c.activity.length === 0 ? <Empty>No activity yet.</Empty> : (
            <ol className="space-y-2 text-xs">
              {c.activity.map((a) => (
                <li key={a.id} className="border-l-2 border-primary-200 pl-3">
                  <span className="font-medium text-tertiary-800">{a.entity === 'budget' ? 'Budget revised' : a.entity === 'plan' ? 'Monthly plan changed' : a.action === 'status' ? `Status: ${a.before?.status} → ${a.after?.status}` : a.action === 'create' ? 'Campaign created' : 'Campaign updated'}</span>
                  <span className="block text-tertiary-500">{a.actor || 'System'} · {dateLabel(a.created_at)}{a.reason ? ` · ${a.reason}` : ''}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <Drawer open={drawer === 'edit'} onClose={() => setDrawer(null)} size="xl" tone="edit" title={`Edit ${c.code}`}>
        {drawer === 'edit' && <CampaignForm initial={c} initiatives={pickers.initiatives} managers={pickers.managers} saving={saving} error={error} onCancel={() => setDrawer(null)} onSubmit={(body) => run(() => fxApi.updateCampaign(id, body), 'Campaign saved')} />}
      </Drawer>
      <Drawer open={drawer === 'budget'} onClose={() => setDrawer(null)} size="lg" tone="edit" title="Revise budget">
        {drawer === 'budget' && <BudgetForm campaign={c} canOverride={fxCan(me, 'override')} saving={saving} error={error} onCancel={() => setDrawer(null)} onSubmit={(body) => run(() => fxApi.reviseBudget(id, body), 'Budget revised')} />}
      </Drawer>
      <Drawer open={drawer === 'plan'} onClose={() => setDrawer(null)} size="lg" tone="edit" title="Monthly investment plan">
        {drawer === 'plan' && <PlanEditor campaign={c} saving={saving} error={error} onCancel={() => setDrawer(null)} onSubmit={(rows) => run(() => fxApi.setPlan(id, rows), 'Plan saved')} />}
      </Drawer>
      <EntryDrawer open={entryDrawer.open} entry={entryDrawer.entry} fixedCampaign={c} campaigns={pickers.campaigns} categories={pickers.categories} me={me} onClose={() => setEntryDrawer({ open: false, entry: null })} onSaved={() => { setEntryDrawer({ open: false, entry: null }); load(); }} />
    </div>
  );
}
