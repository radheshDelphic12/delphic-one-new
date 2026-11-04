import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Settings2, X } from 'lucide-react';
import apiClient from '../../../lib/apiClient.js';
import useLiveData from '../../../lib/useLiveData.js';
import { useAlerts } from '../../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../../components/ui/Drawer.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import Pill from '../../../components/ui/Pill.jsx';
import Skeleton from '../../../components/ui/Skeleton.jsx';
import DeploymentForm from './DeploymentForm.jsx';
import DeploymentDetail, { ExpenseRow, useFinanceActions } from './DeploymentDetail.jsx';
import {
  EVENT_LABEL, KIND_LABEL, REQUEST_LABEL, ROLE_LABEL, ReasonModal, STATE_EXTRA, STATUS, dayText, inr, inputCls, labelCls, requestSummary, whenText,
} from './deploymentsUi.jsx';

const BASE = '/super-dashboard/group/deployments';

/** The list filters a dashboard count opens: each one is exactly the set of records behind the number. */
function matches(d, f) {
  if (!f) return true;
  // the dashboard counts leave cancelled deployments out, so the records behind a count do too (unless a status is asked for)
  if (!f.status && d.status === 'cancelled') return false;
  if (f.status && d.status !== f.status) return false;
  if (f.client !== undefined && (d.client_name || '').toLowerCase() !== f.client) return false;
  if (f.org !== undefined && (d.org_id || 'group') !== f.org) return false;
  if (f.project !== undefined && (d.pm_project_id || 'none') !== f.project) return false;
  const flags = {
    ending_soon: () => ['ending_soon', 'overdue'].includes(d.state),
    drafts: () => ['draft', 'pending_approval', 'approved'].includes(d.status),
    recovery: () => d.pending_recovery > 0,
    over_budget: () => d.over_budget,
    spent: () => d.actual > 0,
    waiting: () => d.pending_requests > 0,
    people: () => d.status === 'active' && d.people_count > 0,
    counted: () => ['draft', 'pending_approval', 'approved', 'active', 'closed'].includes(d.status),
  };
  return f.flag ? Boolean(flags[f.flag]?.()) : true;
}

/** A count that opens the records behind it. */
function Count({ value, onClick, label, tone = '' }) {
  return (
    <button type="button" className={`font-semibold tabular-nums text-primary-700 underline-offset-2 hover:underline ${tone}`} onClick={onClick} aria-label={label} data-testid="count">{value}</button>
  );
}

function Tile({ label, value, hint, onClick, tone = 'text-tertiary-900', testId }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId || 'tile'} className="rounded-2xl border border-tertiary-100 bg-white p-4 text-left shadow-card transition hover:border-primary-300 hover:shadow-md">
      <p className="text-xs font-medium text-tertiary-500">{label}</p>
      <p className={`mt-1 font-heading text-2xl font-bold ${tone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-tertiary-500">{hint}</p>}
    </button>
  );
}

// ------------------------------------------------------------------------------------------------------------------ settings
function SettingsModal({ open, onClose, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) apiClient.get(`${BASE}/settings`).then((r) => setS(r.data.data)).catch((e) => pushError(apiErrorMessage(e, 'Could not load the settings'), 'Load failed')); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const steps = s?.approval_steps || [];
  const move = (i, d) => { const next = [...steps]; const j = i + d; if (j < 0 || j >= next.length) return; [next[i], next[j]] = [next[j], next[i]]; setS({ ...s, approval_steps: next }); };
  const toggle = (role) => setS({ ...s, approval_steps: steps.includes(role) ? steps.filter((r) => r !== role) : [...steps, role] });
  const save = async () => {
    setBusy(true);
    try {
      await apiClient.put(`${BASE}/settings`, { approval_steps: s.approval_steps, emergency_allowed: s.emergency_allowed, extension_needs_approval: s.extension_needs_approval, allocation_needs_approval: s.allocation_needs_approval, overrun_tolerance_pct: Number(s.overrun_tolerance_pct), ending_soon_days: Number(s.ending_soon_days) });
      pushSuccess('Approval settings saved');
      onSaved();
      onClose();
    } catch (e) { pushError(apiErrorMessage(e, 'Could not save'), 'Not saved'); } finally { setBusy(false); }
  };
  return (
    <Modal open wide title="Deployment approval settings" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={!s || busy} onClick={save}>Save</button></>}>
      {!s ? <Skeleton className="h-24 w-full" /> : (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">Approval chain, in order</p>
            <ol className="mt-2 space-y-1.5">
              {steps.map((r, i) => (
                <li key={r} className="flex items-center gap-2 rounded-xl border border-tertiary-100 bg-white px-3 py-1.5 text-sm"><span className="w-5 text-tertiary-400">{i + 1}.</span><span className="flex-1">{ROLE_LABEL[r]}</span>
                  <button type="button" className="rounded p-1 hover:bg-tertiary-100" aria-label="Move up" onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button type="button" className="rounded p-1 hover:bg-tertiary-100" aria-label="Move down" onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></button>
                  <button type="button" className="rounded p-1 text-danger-600 hover:bg-danger-50" aria-label={`Remove ${ROLE_LABEL[r]}`} onClick={() => toggle(r)}><X className="h-3.5 w-3.5" /></button>
                </li>
              ))}
              {!steps.length && <li className="text-xs text-tertiary-500">No step: a deployment is approved as soon as it is submitted.</li>}
            </ol>
            <div className="mt-2 flex flex-wrap gap-2">{Object.keys(ROLE_LABEL).filter((r) => !steps.includes(r)).map((r) => <button key={r} type="button" className="btn-secondary text-xs" onClick={() => toggle(r)}>+ {ROLE_LABEL[r]}</button>)}</div>
            <p className="mt-1 text-[11px] text-tertiary-500">A manager step with nobody named on the deployment is skipped. A group admin can decide any step.</p>
          </div>
          {[['emergency_allowed', 'Allow an emergency deployment to start before its approval is complete'], ['extension_needs_approval', 'An extension of the end date needs approval'], ['allocation_needs_approval', 'A change of people needs approval']].map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm text-tertiary-800"><input type="checkbox" checked={Boolean(s[k])} onChange={(e) => setS({ ...s, [k]: e.target.checked })} />{label}</label>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>Spend over the budget by more than (%) needs approval<input type="number" min="0" max="100" className={inputCls} value={s.overrun_tolerance_pct} onChange={(e) => setS({ ...s, overrun_tolerance_pct: e.target.value })} /></label>
            <label className={labelCls}>&quot;Ending soon&quot; means within (days)<input type="number" min="1" max="180" className={inputCls} value={s.ending_soon_days} onChange={(e) => setS({ ...s, ending_soon_days: e.target.value })} /></label>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------------------------ the views
function Breakdown({ title, rows, onPick, testId }) {
  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid={testId}>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">{title}</h4>
      {rows.length === 0 ? <p className="text-sm text-tertiary-400">Nothing yet</p> : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-tertiary-500"><tr><th className="py-1">Name</th><th className="text-right">Deployments</th><th className="text-right">People</th><th className="text-right">Estimated</th><th className="text-right">Actual</th></tr></thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="max-w-[12rem] truncate py-1.5"><button type="button" className="text-left text-tertiary-900 hover:underline" onClick={() => onPick(r, null)}>{r.label}</button></td>
                <td className="text-right"><Count value={r.deployments} label={`Deployments of ${r.label}`} onClick={() => onPick(r, null)} /></td>
                <td className="text-right"><Count value={r.people} label={`People on ${r.label}`} onClick={() => onPick(r, 'people')} /></td>
                <td className="text-right tabular-nums">{inr(r.estimated)}</td>
                <td className="text-right tabular-nums">{inr(r.actual)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Dashboard({ d, go, openDetail, setView }) {
  const s = d.summary;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile testId="tile-active" label="Active deployments" value={s.active} hint="Click to see them" onClick={() => go({ label: 'Active deployments', status: 'active' })} />
        <Tile testId="tile-people" label="People deployed" value={s.deployed_people} hint="On active deployments" onClick={() => go({ label: 'Deployments with people on site', flag: 'people' })} />
        <Tile testId="tile-ending" label="Ending soon" value={s.ending_soon} hint={`Within ${d.ending_soon_days} days or past the end date`} tone={s.ending_soon ? 'text-amber-600' : undefined} onClick={() => go({ label: 'Ending soon', flag: 'ending_soon' })} />
        <Tile testId="tile-drafts" label="Draft / waiting to start" value={s.draft_or_pending} hint="Draft, in approval or approved" onClick={() => go({ label: 'Draft, in approval or approved', flag: 'drafts' })} />
        <Tile testId="tile-estimated" label="Estimated budget" value={inr(s.estimated_total)} hint={`Active: ${inr(s.active_estimated)}`} onClick={() => go({ label: 'All deployments with a budget', flag: 'counted' })} />
        <Tile testId="tile-actual" label="Actual spend" value={inr(s.actual_total)} hint={`Active: ${inr(s.active_actual)}`} tone={s.actual_total > s.estimated_total ? 'text-danger-600' : undefined} onClick={() => go({ label: 'Deployments with spend', flag: 'spent' })} />
        <Tile testId="tile-recovery" label="Client still owes" value={inr(s.pending_recovery)} hint={`Recovered ${inr(s.recovered)}`} tone={s.pending_recovery ? 'text-amber-600' : undefined} onClick={() => go({ label: 'Pending client recoveries', flag: 'recovery' })} />
        <Tile testId="tile-approvals" label="Waiting for approval" value={s.pending_approvals} hint="Requests with a step pending" onClick={() => setView('approvals')} />
        <Tile testId="tile-billable" label="Billable spend" value={inr(s.billable_actual)} hint={`Non-billable ${inr(s.non_billable_actual)}`} onClick={() => go({ label: 'Deployments with spend', flag: 'spent' })} />
        <Tile testId="tile-client-funded" label="Client-funded spend" value={inr(s.client_funded_actual)} hint={`Company-funded ${inr(s.company_funded_actual)}`} onClick={() => go({ label: 'Deployments with spend', flag: 'spent' })} />
        <Tile testId="tile-verify" label="Expenses to verify" value={s.expenses_to_verify} hint="Open the Finance queue" tone={s.expenses_to_verify ? 'text-amber-600' : undefined} onClick={() => setView('finance')} />
        <Tile testId="tile-overbudget" label="Over budget" value={d.over_budget_count} hint="Spend above the estimate" tone={d.over_budget_count ? 'text-danger-600' : undefined} onClick={() => go({ label: 'Over budget', flag: 'over_budget' })} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown testId="by-client" title="Client-wise resources" rows={d.by_client} onPick={(r, flag) => go({ label: `Client: ${r.label}${flag ? ' (with people)' : ''}`, client: r.key, ...(flag ? { flag } : {}) })} />
        <Breakdown testId="by-project" title="Project-wise resources" rows={d.by_project} onPick={(r, flag) => go({ label: `Project: ${r.label}${flag ? ' (with people)' : ''}`, project: r.key, ...(flag ? { flag } : {}) })} />
        <Breakdown testId="by-company" title="Company-wise resources" rows={d.by_company} onPick={(r, flag) => go({ label: `Company: ${r.label}${flag ? ' (with people)' : ''}`, org: r.key, ...(flag ? { flag } : {}) })} />

        <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="upcoming-ends">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Upcoming end dates</h4>
          {d.upcoming_ends.length === 0 ? <p className="text-sm text-tertiary-400">No active deployment</p> : (
            <ul className="divide-y text-sm">
              {d.upcoming_ends.map((u) => (
                <li key={u.id} className="flex items-center gap-2 py-1.5">
                  <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => openDetail(u.id)}>{u.title} <span className="text-xs text-tertiary-500">· {u.client_name}</span></button>
                  <span className="text-xs text-tertiary-500">{dayText(u.expected_end_date)}</span>
                  <Pill tone={u.days_left < 0 ? 'red' : u.days_left <= d.ending_soon_days ? 'amber' : 'gray'}>{u.days_left < 0 ? `${-u.days_left} d over` : `${u.days_left} d left`}</Pill>
                  <button type="button" className="text-xs text-primary-700 hover:underline" onClick={() => openDetail(u.id, 'people')} aria-label={`People on ${u.title}`}>{u.people} {u.people === 1 ? 'person' : 'people'}</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="monthly">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Month by month, budget vs actual</h4>
          {d.monthly.length === 0 ? <p className="text-sm text-tertiary-400">Nothing yet</p> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-tertiary-500"><tr><th className="py-1">Month</th><th className="text-right">Budget</th><th className="text-right">Actual</th><th className="text-right">Variance</th></tr></thead>
              <tbody className="divide-y">{d.monthly.map((m) => <tr key={m.month}><td className="py-1.5">{m.month}</td><td className="text-right tabular-nums">{inr(m.budget)}</td><td className="text-right tabular-nums">{inr(m.actual)}</td><td className={`text-right tabular-nums ${m.budget - m.actual < 0 ? 'text-danger-600' : ''}`}>{m.budget - m.actual < 0 ? '-' : ''}{inr(Math.abs(m.budget - m.actual))}</td></tr>)}</tbody>
            </table>
          )}
        </section>

        <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="recoveries">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Pending client recoveries</h4>
          {d.recoveries.length === 0 ? <p className="text-sm text-tertiary-400">Nothing to recover</p> : (
            <ul className="divide-y text-sm">{d.recoveries.map((r) => <li key={r.id} className="flex items-center gap-2 py-1.5"><button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => openDetail(r.id, 'expenses')}>{r.title} <span className="text-xs text-tertiary-500">· {r.client_name}</span></button><span className="font-semibold tabular-nums text-amber-700">{inr(r.owed)}</span></li>)}</ul>
          )}
        </section>

        <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="history">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Recent history</h4>
          {d.history.length === 0 ? <p className="text-sm text-tertiary-400">Nothing yet</p> : (
            <ul className="divide-y text-sm">{d.history.map((h) => <li key={h.id} className="py-1.5"><button type="button" className="text-left hover:underline" onClick={() => openDetail(h.deployment.id, 'history')}><span className="font-medium">{EVENT_LABEL[h.kind] || h.kind}</span> · {h.deployment.title}</button><span className="ml-2 text-xs text-tertiary-500">{h.by_name ? `${h.by_name} · ` : ''}{whenText(h.created_at)}</span></li>)}</ul>
          )}
        </section>
      </div>
    </div>
  );
}

function ListView({ rows, filter, clearFilter, statusFilter, setStatusFilter, q, setQ, openDetail, loading }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {filter && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-800" data-testid="active-filter">{filter.label}<button type="button" aria-label="Clear the filter" onClick={clearFilter}><X className="h-3.5 w-3.5" /></button></span>
        )}
        <select className="rounded-xl border px-3 py-1.5 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
          {[['open', 'Open (not closed)'], ['all', 'All'], ['draft', 'Draft'], ['pending_approval', 'Waiting for approval'], ['approved', 'Approved'], ['active', 'Active'], ['closed', 'Closed'], ['cancelled', 'Cancelled']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input className="w-56 rounded-xl border px-3 py-1.5 text-sm" placeholder="Search title, client, code…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <span className="ml-auto text-sm text-tertiary-500"><span data-testid="list-count">{rows.length}</span> deployment{rows.length === 1 ? '' : 's'}</span>
      </div>
      {loading ? <Skeleton className="h-32 w-full" /> : (
        <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
          <table className="w-full text-left text-sm" aria-label="Deployments">
            <thead className="bg-tertiary-50 text-xs uppercase tracking-wide text-tertiary-500"><tr><th className="px-3 py-2">Deployment</th><th>Client</th><th>Dates</th><th>People</th><th className="text-right">Estimated</th><th className="text-right">Actual</th><th>Status</th></tr></thead>
            <tbody className="divide-y">
              {rows.map((d) => {
                const [tone, label] = STATUS[d.status] || ['gray', d.status];
                const extra = STATE_EXTRA[d.state];
                return (
                  <tr key={d.id} className="hover:bg-tertiary-50/60">
                    <td className="px-3 py-2"><button type="button" className="text-left font-medium text-tertiary-900 hover:underline" onClick={() => openDetail(d.id)}>{d.title}</button><span className="block text-xs text-tertiary-500">{d.code} · {KIND_LABEL[d.kind]} · {d.org_name}</span></td>
                    <td>{d.client_name}{d.client_location ? <span className="block text-xs text-tertiary-500">{d.client_location}</span> : null}</td>
                    <td className="whitespace-nowrap text-xs">{dayText(d.start_date)} → {dayText(d.expected_end_date)}{d.days_left != null ? <span className="block text-tertiary-500">{d.days_left < 0 ? `${-d.days_left} days over` : `${d.days_left} days left`}</span> : null}</td>
                    <td><Count value={d.people_count} label={`People on ${d.title}`} onClick={() => openDetail(d.id, 'people')} /></td>
                    <td className="text-right tabular-nums">{inr(d.estimated)}</td>
                    <td className={`text-right tabular-nums ${d.over_budget ? 'text-danger-600' : ''}`}>{d.actual > 0 ? <button type="button" className="hover:underline" onClick={() => openDetail(d.id, 'expenses')}>{inr(d.actual)}</button> : inr(0)}</td>
                    <td><Pill tone={tone}>{label}</Pill>{extra && <span className="ml-1"><Pill tone={extra[0]}>{extra[1]}</Pill></span>}{d.pending_requests > 0 && <button type="button" className="ml-1 text-xs text-amber-700 hover:underline" onClick={() => openDetail(d.id)}>{d.pending_requests} waiting</button>}</td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-tertiary-500">No deployment matches. Create one to place people at a client site.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Approvals({ queue, openDetail, onDone }) {
  const { pushError, pushSuccess } = useAlerts();
  const [reject, setReject] = useState(null);
  const decide = async (id, decision, comment) => {
    try { await apiClient.post(`${BASE}/requests/${id}/decide`, { decision, comment }); pushSuccess(decision === 'approve' ? 'Step approved' : 'Rejected'); onDone(); } catch (e) { pushError(apiErrorMessage(e, 'Could not decide'), 'Not saved'); }
  };
  const rows = queue.data?.requests || [];
  return (
    <div className="space-y-3" data-testid="approvals-view">
      <p className="text-sm text-tertiary-600"><span data-testid="approvals-count">{rows.length}</span> request{rows.length === 1 ? '' : 's'} waiting. As a group admin you may decide any step.</p>
      {rows.map((r) => (
        <div key={r.id} className="rounded-xl border border-tertiary-100 bg-white p-3 shadow-card">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="font-medium text-tertiary-900 hover:underline" onClick={() => openDetail(r.deployment.id)}>{r.deployment.code} · {r.deployment.title}</button>
            <Pill tone="amber">{REQUEST_LABEL[r.kind]}</Pill>
            <span className="text-xs text-tertiary-500">{r.deployment.client_name} · by {r.requested_by_name || '-'} · {whenText(r.created_at)}</span>
          </div>
          <p className="mt-1 text-sm text-tertiary-700">{requestSummary(r)}</p>
          <p className="mt-1 text-xs text-tertiary-500">Next step: {ROLE_LABEL[r.next_role]}</p>
          <div className="mt-2 flex gap-2"><button type="button" className="btn-primary text-xs" onClick={() => decide(r.id, 'approve')}>Approve</button><button type="button" className="btn-secondary text-xs text-danger-700" onClick={() => setReject(r)}>Reject</button></div>
        </div>
      ))}
      {!rows.length && <p className="rounded-2xl border border-dashed border-tertiary-200 bg-white px-6 py-8 text-center text-sm text-tertiary-500">Nothing is waiting for approval.</p>}
      <ReasonModal open={Boolean(reject)} title="Reject this request" confirmText="Reject" onClose={() => setReject(null)} onConfirm={(c) => { decide(reject.id, 'reject', c); setReject(null); }} />
    </div>
  );
}

function FinanceQueue({ queue, openDetail, onDone }) {
  const { pushError, pushSuccess } = useAlerts();
  const run = async (path, body, msg) => {
    try { await apiClient.post(`${BASE}/${path}`, body); pushSuccess(msg); onDone(); } catch (e) { pushError(apiErrorMessage(e, 'That did not work'), 'Not saved'); }
  };
  const fin = useFinanceActions(run);
  const rows = queue.data?.expenses || [];
  const groups = [['To verify', rows.filter((e) => e.status === 'submitted')], ['Verified, to settle', rows.filter((e) => e.status === 'verified')], ['Settled, client still to pay', rows.filter((e) => e.status === 'settled')]];
  return (
    <div className="space-y-4" data-testid="finance-view">
      {groups.map(([title, items]) => (
        <section key={title} className="space-y-2">
          <h4 className="text-sm font-semibold text-tertiary-900">{title} (<span data-testid="finance-count">{items.length}</span>)</h4>
          <ul className="space-y-2">
            {items.map((e) => (
              <div key={e.id}>
                <button type="button" className="mb-0.5 text-xs text-primary-700 hover:underline" onClick={() => openDetail(e.deployment.id, 'expenses')}>{e.deployment.code} · {e.deployment.title} · {e.deployment.client_name}</button>
                <ExpenseRow e={e} canFinance onVerify={fin.verify} onSettle={fin.settle} onRecover={fin.recover} />
              </div>
            ))}
            {!items.length && <li className="text-sm text-tertiary-400">Nothing here.</li>}
          </ul>
        </section>
      ))}
      {fin.node}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------ the tab
export default function DeploymentsTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [view, setView] = useState('dashboard');
  const [filter, setFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('open');
  const [q, setQ] = useState('');
  const [drawer, setDrawer] = useState(null); // { form: deployment|null } | { detail: id, tab }
  const [settings, setSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const dash = useLiveData(() => apiClient.get(`${BASE}/dashboard`).then((r) => r.data.data), { intervalMs: 60000, deps: [] });
  const list = useLiveData(() => apiClient.get(BASE, { params: { status: 'all' } }).then((r) => r.data.data.deployments), { intervalMs: 60000, deps: [] });
  const opts = useLiveData(() => apiClient.get(`${BASE}/options`).then((r) => r.data.data), { deps: [] });
  const approvals = useLiveData(() => apiClient.get(`${BASE}/approvals`).then((r) => r.data.data), { intervalMs: 60000, deps: [] });
  const finance = useLiveData(() => apiClient.get(`${BASE}/finance-queue`).then((r) => r.data.data), { intervalMs: 60000, deps: [] });
  useEffect(() => { if (dash.error) pushError(apiErrorMessage(dash.error, 'Could not load the deployments'), 'Load failed'); }, [dash.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshAll = useCallback(() => Promise.all([dash.refresh(), list.refresh(), approvals.refresh(), finance.refresh()]), [dash, list, approvals, finance]);
  const go = useCallback((f) => { setFilter(f); setStatusFilter('all'); setQ(''); setView('list'); }, []);
  const openDetail = useCallback((id, tab) => setDrawer({ detail: id, tab }), []);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list.data || []).filter((d) => matches(d, filter)
      && (statusFilter === 'all' || (statusFilter === 'open' ? ['draft', 'pending_approval', 'approved', 'active'].includes(d.status) : d.status === statusFilter))
      && (!needle || [d.title, d.client_name, d.code].some((x) => String(x || '').toLowerCase().includes(needle))));
  }, [list.data, filter, statusFilter, q]);

  async function save(body) {
    setSaving(true);
    setError('');
    try {
      const editing = drawer?.form;
      const r = editing ? await apiClient.patch(`${BASE}/${editing.id}`, body) : await apiClient.post(BASE, body);
      pushSuccess(editing ? 'Saved' : 'Deployment created as a draft');
      refreshAll();
      setDrawer({ detail: r.data.data.deployment.id });
    } catch (e) { setError(apiErrorMessage(e, 'Could not save the deployment')); } finally { setSaving(false); }
  }
  async function remove(dep) {
    try { await apiClient.delete(`${BASE}/${dep.id}`); pushSuccess('Draft deleted'); setDrawer(null); refreshAll(); } catch (e) { pushError(apiErrorMessage(e, 'Could not delete'), 'Not deleted'); }
  }

  const d = dash.data;
  const pending = approvals.data?.requests?.length || 0;
  const toVerify = (finance.data?.expenses || []).filter((e) => e.status === 'submitted').length;
  const dashData = d ? { ...d, over_budget_count: (list.data || []).filter((x) => x.over_budget && x.status !== 'cancelled').length } : null;
  const views = [['dashboard', 'Dashboard'], ['list', 'Deployments'], ['approvals', `Approvals${pending ? ` (${pending})` : ''}`], ['finance', `Finance queue${toVerify ? ` (${toVerify})` : ''}`]];

  return (
    <div className="space-y-5" data-testid="deployments-tab">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-tertiary-200 p-0.5" role="tablist" aria-label="Deployment views">
          {views.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => { if (k === 'list' && view !== 'list') setFilter(null); setView(k); }} className={`rounded-lg px-4 py-1.5 text-sm font-medium ${view === k ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-tertiary-50'}`}>{label}</button>
          ))}
        </div>
        <button type="button" className="btn-secondary ml-auto inline-flex items-center gap-1.5 text-sm" onClick={() => setSettings(true)}><Settings2 className="h-4 w-4" />Approval settings</button>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => { setError(''); setDrawer({ form: null }); }}><Plus className="h-4 w-4" />New deployment</button>
      </div>

      {view === 'dashboard' && (dash.loading && !dashData ? <Skeleton className="h-40 w-full" /> : dashData && <Dashboard d={dashData} go={go} openDetail={openDetail} setView={setView} />)}
      {view === 'list' && <ListView rows={rows} filter={filter} clearFilter={() => setFilter(null)} statusFilter={statusFilter} setStatusFilter={setStatusFilter} q={q} setQ={setQ} openDetail={openDetail} loading={list.loading && !list.data} />}
      {view === 'approvals' && <Approvals queue={approvals} openDetail={openDetail} onDone={refreshAll} />}
      {view === 'finance' && <FinanceQueue queue={finance} openDetail={openDetail} onDone={refreshAll} />}

      <Drawer open={Boolean(drawer && 'form' in drawer)} onClose={() => setDrawer(null)} size="xl" tone={drawer?.form ? 'edit' : 'create'} title={drawer?.form ? 'Edit deployment' : 'New deployment'}>
        {drawer && 'form' in drawer && <DeploymentForm key={drawer.form?.id || 'new'} initial={drawer.form} options={opts.data} onSubmit={save} saving={saving} error={error} />}
      </Drawer>
      <Drawer open={Boolean(drawer?.detail)} onClose={() => { setDrawer(null); refreshAll(); }} size="xl" tone="info" title="Deployment">
        {drawer?.detail && <DeploymentDetail key={`${drawer.detail}:${drawer.tab || ''}`} id={drawer.detail} initialTab={drawer.tab} options={opts.data} onChanged={refreshAll} onEdit={(dep) => { setError(''); setDrawer({ form: dep }); }} onDelete={remove} />}
      </Drawer>
      <SettingsModal open={settings} onClose={() => setSettings(false)} onSaved={refreshAll} />
    </div>
  );
}
