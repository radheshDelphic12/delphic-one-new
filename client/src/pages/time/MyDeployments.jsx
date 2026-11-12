import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Pill from '../../components/ui/Pill.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { ExpenseForm, ExpenseRow, useFinanceActions } from '../groupOverview/deployments/DeploymentDetail.jsx';
import {
  ARRANGEMENT_LABEL, KIND_LABEL, REQUEST_LABEL, ROLE_LABEL, ReasonModal, STATUS, dayText, inputCls, labelCls, requestSummary, today, whenText,
} from '../groupOverview/deployments/deploymentsUi.jsx';

const E = '/deployments';

/** Does this person have anything to do with deployments (so the Time & Attendance hub shows the tab)? */
export function useDeploymentAccess() {
  const [access, setAccess] = useState({ loaded: false, any: false });
  useEffect(() => {
    let live = true;
    const get = (p) => apiClient.get(`${E}${p}`).then((r) => r.data.data).catch(() => null);
    Promise.all([get('/mine'), get('/managed'), get('/approvals'), get('/finance-queue')]).then(([mine, managed, approvals, finance]) => {
      if (live) setAccess({ loaded: true, any: Boolean(mine?.deployments?.length || managed?.deployments?.length || approvals?.requests?.length || finance) });
    });
    return () => { live = false; };
  }, []);
  return access;
}

function LogForm({ dep, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const [date, setDate] = useState(today());
  const existing = dep.logs.find((l) => l.log_date === date);
  const [f, setF] = useState({ location_mode: dep.person.arrangement === 'remote' ? 'remote' : 'client_office', hours: '8', activities: '', deliverables: '', pending_tasks: '' });
  useEffect(() => {
    const l = dep.logs.find((x) => x.log_date === date);
    if (l) setF({ location_mode: l.location_mode, hours: String(l.hours), activities: l.activities || '', deliverables: l.deliverables || '', pending_tasks: l.pending_tasks || '' });
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  const save = async () => {
    try {
      await apiClient.post(`${E}/${dep.id}/logs`, { log_date: date, location_mode: f.location_mode, hours: Number(f.hours), activities: f.activities, deliverables: f.deliverables || null, pending_tasks: f.pending_tasks || null });
      pushSuccess(existing ? 'Your day was updated' : 'Your day was saved');
      onSaved();
    } catch (e) { pushError(apiErrorMessage(e, 'Could not save your day'), 'Not saved'); }
  };
  return (
    <div className="grid grid-cols-2 gap-2 rounded-xl border border-dashed border-tertiary-200 p-3 sm:grid-cols-4" data-testid="log-form">
      <label className={labelCls}>Day<input type="date" max={today()} min={dep.person.start_date || dep.start_date} className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label className={labelCls}>Where you worked
        <select className={inputCls} value={f.location_mode} onChange={set('location_mode')}><option value="client_office">At the client office</option><option value="remote">Remote</option></select>
      </label>
      <label className={labelCls}>Hours<input type="number" min="0" max="24" step="0.5" className={inputCls} value={f.hours} onChange={set('hours')} aria-label="Hours worked" /></label>
      <div className="hidden sm:block" />
      <label className={`${labelCls} col-span-2 sm:col-span-4`}>What you did<textarea rows={2} className={inputCls} value={f.activities} onChange={set('activities')} maxLength={4000} aria-label="Daily activities" /></label>
      <label className={`${labelCls} col-span-2`}>Completed deliverables<textarea rows={2} className={inputCls} value={f.deliverables} onChange={set('deliverables')} maxLength={4000} /></label>
      <label className={`${labelCls} col-span-2`}>Pending tasks<textarea rows={2} className={inputCls} value={f.pending_tasks} onChange={set('pending_tasks')} maxLength={4000} /></label>
      <div className="col-span-2 sm:col-span-4"><button type="button" className="btn-primary" disabled={f.activities.trim().length < 2 || f.hours === ''} onClick={save}>{existing ? 'Update this day' : 'Save this day'}</button></div>
    </div>
  );
}

function MineCard({ dep, onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [busy, setBusy] = useState(false);
  const [tone, label] = STATUS[dep.status] || ['gray', dep.status];
  const submitExpense = async (fd) => {
    setBusy(true);
    try { await apiClient.post(`${E}/${dep.id}/expenses`, fd); pushSuccess('Expense submitted for verification'); onChanged(); return true; } catch (e) { pushError(apiErrorMessage(e, 'Could not submit the expense'), 'Not saved'); return false; } finally { setBusy(false); }
  };
  return (
    <section className="space-y-4 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="my-deployment">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-heading text-base font-semibold text-tertiary-900">{dep.title}</h3>
        <Pill tone={tone}>{label}</Pill>
        <span className="text-xs text-tertiary-500">{KIND_LABEL[dep.kind]} · {dep.code}</span>
      </div>
      <p className="text-sm text-tertiary-600">{dep.client_name}{dep.client_location ? ` · ${dep.client_location}` : ''} · {dayText(dep.start_date)} → {dayText(dep.expected_end_date)}{dep.days_left != null ? ` (${dep.days_left < 0 ? `${-dep.days_left} days over` : `${dep.days_left} days left`})` : ''} · {ARRANGEMENT_LABEL[dep.person.arrangement]}{dep.person.role ? ` · ${dep.person.role}` : ''}</p>
      {dep.client_supervisor_name && <p className="text-xs text-tertiary-500">Client supervisor: {[dep.client_supervisor_name, dep.client_supervisor_phone].filter(Boolean).join(' · ')}</p>}
      {dep.status === 'active' ? (
        <>
          <h4 className="text-sm font-semibold text-tertiary-900">Log your day {dep.logged_today ? <Pill tone="green">Today is logged</Pill> : <Pill tone="amber">Today is not logged</Pill>}</h4>
          <LogForm key={dep.logs.map((l) => l.id).join(',')} dep={dep} onSaved={onChanged} />
          <ul className="space-y-1.5" aria-label="My recent days">
            {dep.logs.map((l) => (
              <li key={l.id} className="rounded-lg bg-tertiary-50 px-3 py-1.5 text-xs text-tertiary-700"><span className="font-medium">{dayText(l.log_date)}</span> · {l.location_mode === 'remote' ? 'Remote' : 'Client office'} · {l.hours} h · {l.activities}</li>
            ))}
          </ul>
        </>
      ) : <p className="rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">Approved. You can log your days once the deployment starts.</p>}
      <h4 className="text-sm font-semibold text-tertiary-900">My expenses</h4>
      {dep.can_submit_expense && <ExpenseForm dep={{ people: [] }} onSubmit={submitExpense} busy={busy} />}
      <ul className="space-y-2" aria-label="My expenses">
        {dep.expenses.map((e) => <ExpenseRow key={e.id} e={e} canFinance={false} />)}
        {!dep.expenses.length && <li className="text-sm text-tertiary-500">No expense yet.</li>}
      </ul>
    </section>
  );
}

function ManagedCard({ dep, onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [logs, setLogs] = useState(null);
  const [rv, setRv] = useState({ kind: 'weekly', period_start: today(), rating: '', summary: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => apiClient.get(`${E}/${dep.id}/logs`, { params: { month } }).then((r) => setLogs(r.data.data)).catch(() => setLogs(null)), [dep.id, month]);
  useEffect(() => { load(); }, [load]);
  const [tone, label] = STATUS[dep.status] || ['gray', dep.status];
  const review = async () => {
    try { await apiClient.post(`${E}/${dep.id}/reviews`, { kind: rv.kind, period_start: rv.period_start, rating: rv.rating === '' ? null : Number(rv.rating), summary: rv.summary }); pushSuccess('Review saved'); setRv((c) => ({ ...c, summary: '', rating: '' })); onChanged(); } catch (e) { pushError(apiErrorMessage(e, 'Could not save the review'), 'Not saved'); }
  };
  const submitExpense = async (fd) => {
    setBusy(true);
    try { await apiClient.post(`${E}/${dep.id}/expenses`, fd); pushSuccess('Expense submitted for verification'); onChanged(); return true; } catch (e) { pushError(apiErrorMessage(e, 'Could not submit the expense'), 'Not saved'); return false; } finally { setBusy(false); }
  };
  return (
    <section className="space-y-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="managed-deployment">
      <div className="flex flex-wrap items-center gap-2"><h3 className="font-heading text-base font-semibold text-tertiary-900">{dep.title}</h3><Pill tone={tone}>{label}</Pill><span className="text-xs text-tertiary-500">{dep.client_name} · {dayText(dep.start_date)} → {dayText(dep.expected_end_date)}</span></div>
      <p className="text-sm text-tertiary-700">On it: {dep.people.map((p) => p.name).join(', ') || 'nobody'}</p>
      <div className="flex items-center justify-between"><h4 className="text-sm font-semibold text-tertiary-900">Team logs</h4><input type="month" className="rounded-xl border px-2 py-1 text-sm" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" /></div>
      {logs && <p className="text-xs text-tertiary-500">{logs.summary.days} days · {logs.summary.hours} hours · {logs.summary.client_office_days} at the client office · {logs.summary.remote_days} remote</p>}
      <ul className="space-y-1.5">
        {(logs?.logs || []).slice(0, 30).map((l) => <li key={l.id} className="rounded-lg bg-tertiary-50 px-3 py-1.5 text-xs text-tertiary-700"><span className="font-medium">{dayText(l.log_date)}</span> · {l.person_name} · {l.location_mode === 'remote' ? 'Remote' : 'Client office'} · {l.hours} h · {l.activities}{l.pending_tasks ? ` · Pending: ${l.pending_tasks}` : ''}</li>)}
      </ul>
      {['active', 'approved'].includes(dep.status) && (
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-dashed border-tertiary-200 p-3 sm:grid-cols-4">
          <label className={labelCls}>Review<select className={inputCls} value={rv.kind} onChange={(e) => setRv((c) => ({ ...c, kind: e.target.value }))}><option value="weekly">Weekly progress</option><option value="client_feedback">Monthly client feedback</option></select></label>
          <label className={labelCls}>A day in that period<input type="date" className={inputCls} value={rv.period_start} onChange={(e) => setRv((c) => ({ ...c, period_start: e.target.value }))} /></label>
          <label className={labelCls}>Rating (1-5)<input type="number" min="1" max="5" className={inputCls} value={rv.rating} onChange={(e) => setRv((c) => ({ ...c, rating: e.target.value }))} /></label>
          <div />
          <label className={`${labelCls} col-span-2 sm:col-span-4`}>Summary<textarea rows={2} className={inputCls} value={rv.summary} onChange={(e) => setRv((c) => ({ ...c, summary: e.target.value }))} maxLength={4000} /></label>
          <div className="col-span-2 sm:col-span-4"><button type="button" className="btn-secondary" disabled={rv.summary.trim().length < 2} onClick={review}>Save review</button></div>
        </div>
      )}
      {['approved', 'active'].includes(dep.status) && (
        <details className="rounded-xl border border-tertiary-100 p-3"><summary className="cursor-pointer text-sm font-medium text-tertiary-800">Submit an expense for someone on this deployment</summary><div className="mt-3"><ExpenseForm dep={{ people: dep.people }} onSubmit={submitExpense} busy={busy} /></div></details>
      )}
    </section>
  );
}

function Approvals({ list, onDone }) {
  const { pushError, pushSuccess } = useAlerts();
  const [reject, setReject] = useState(null);
  const decide = async (id, decision, comment) => {
    try { await apiClient.post(`${E}/requests/${id}/decide`, { decision, comment }); pushSuccess(decision === 'approve' ? 'Approved' : 'Rejected'); onDone(); } catch (e) { pushError(apiErrorMessage(e, 'Could not decide'), 'Not saved'); }
  };
  return (
    <section className="space-y-2" data-testid="my-approvals">
      <h3 className="font-heading text-base font-semibold text-tertiary-900">Waiting for my approval ({list.length})</h3>
      {list.map((r) => (
        <div key={r.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
          <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-tertiary-900">{r.deployment.code} · {r.deployment.title}</span><Pill tone="amber">{REQUEST_LABEL[r.kind]}</Pill><span className="text-xs text-tertiary-500">{r.deployment.client_name} · {r.requested_by_name || ''} · {whenText(r.created_at)}</span></div>
          <p className="mt-1 text-sm text-tertiary-700">{requestSummary(r)}</p>
          <p className="text-xs text-tertiary-500">Your step: {ROLE_LABEL[r.next_role]}</p>
          <div className="mt-2 flex gap-2"><button type="button" className="btn-primary text-xs" onClick={() => decide(r.id, 'approve')}>Approve</button><button type="button" className="btn-secondary text-xs text-danger-700" onClick={() => setReject(r)}>Reject</button></div>
        </div>
      ))}
      <ReasonModal open={Boolean(reject)} title="Reject this request" confirmText="Reject" onClose={() => setReject(null)} onConfirm={(c) => { decide(reject.id, 'reject', c); setReject(null); }} />
    </section>
  );
}

function Finance({ queue, onDone }) {
  const { pushError, pushSuccess } = useAlerts();
  const run = async (path, body, msg) => {
    try { await apiClient.post(`${E}/${path}`, body); pushSuccess(msg); onDone(); } catch (e) { pushError(apiErrorMessage(e, 'That did not work'), 'Not saved'); }
  };
  const fin = useFinanceActions(run);
  return (
    <section className="space-y-2" data-testid="my-finance">
      <h3 className="font-heading text-base font-semibold text-tertiary-900">Finance: deployment expenses ({queue.length})</h3>
      <ul className="space-y-2">
        {queue.map((e) => <div key={e.id}><p className="mb-0.5 text-xs text-tertiary-500">{e.deployment.code} · {e.deployment.title} · {e.deployment.client_name}</p><ExpenseRow e={e} canFinance onVerify={fin.verify} onSettle={fin.settle} onRecover={fin.recover} /></div>)}
        {!queue.length && <li className="text-sm text-tertiary-500">Nothing to verify, settle or recover.</li>}
      </ul>
      {fin.node}
    </section>
  );
}

/** Time & Attendance > Deployments: the person's own client deployments (log the day, submit expenses), the ones they manage, the approval steps that name them and the Finance queue. */
export default function MyDeployments() {
  const { pushError } = useAlerts();
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    try {
      const get = (p) => apiClient.get(`${E}${p}`).then((r) => r.data.data);
      const [mine, managed, approvals] = await Promise.all([get('/mine'), get('/managed'), get('/approvals')]);
      const finance = await get('/finance-queue').catch(() => null);
      setData({ mine: mine.deployments, managed: managed.deployments, approvals: approvals.requests, finance: finance ? finance.expenses : null });
    } catch (e) { pushError(apiErrorMessage(e, 'Could not load your deployments'), 'Load failed'); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  if (!data) return <Skeleton className="h-40 w-full" />;
  const nothing = !data.mine.length && !data.managed.length && !data.approvals.length && data.finance === null;
  return (
    <div className="space-y-6" data-testid="my-deployments">
      {nothing && <p className="rounded-2xl border border-dashed border-tertiary-200 bg-white px-6 py-8 text-center text-sm text-tertiary-500">You are not on any client deployment.</p>}
      {data.approvals.length > 0 && <Approvals list={data.approvals} onDone={load} />}
      {data.mine.length > 0 && (
        <div className="space-y-3"><h3 className="font-heading text-base font-semibold text-tertiary-900">My deployments</h3>{data.mine.map((d) => <MineCard key={d.id} dep={d} onChanged={load} />)}</div>
      )}
      {data.managed.length > 0 && (
        <div className="space-y-3"><h3 className="font-heading text-base font-semibold text-tertiary-900">Deployments I manage</h3>{data.managed.map((d) => <ManagedCard key={d.id} dep={d} onChanged={load} />)}</div>
      )}
      {data.finance !== null && <Finance queue={data.finance} onDone={load} />}
      <p className="text-xs text-tertiary-400">Budgets and approvals are managed by the group admin under Group Dashboard &gt; Travel &gt; Client deployments.</p>
    </div>
  );
}

