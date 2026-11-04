import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Download, Plus, Trash2, X } from 'lucide-react';
import apiClient, { downloadAuthenticatedFile } from '../../../lib/apiClient.js';
import { useAlerts } from '../../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../../lib/alerts/apiErrorMessage.js';
import Pill from '../../../components/ui/Pill.jsx';
import Skeleton from '../../../components/ui/Skeleton.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import { LinesEditor, cleanLines } from './DeploymentForm.jsx';
import {
  ARRANGEMENT_LABEL, BudgetBar, CATEGORY_LABEL, EVENT_LABEL, EXPENSE_STATUS, FUNDING_LABEL, FREQ_LABEL, KIND_LABEL, MODE_LABEL, RECOVERY, REQUEST_LABEL, ROLE_LABEL, ReasonModal,
  STATE_EXTRA, STATUS, dayText, inputCls, inr, labelCls, requestSummary, today, whenText,
} from './deploymentsUi.jsx';

const BASE = '/super-dashboard/group/deployments';
const TABS = [['overview', 'Overview'], ['people', 'People'], ['budget', 'Budget'], ['travel', 'Travel'], ['expenses', 'Expenses'], ['onsite', 'Onsite work'], ['history', 'History']];

function Fact({ label, children }) {
  return <div><dt className="text-xs text-tertiary-500">{label}</dt><dd className="font-medium text-tertiary-900">{children || '-'}</dd></div>;
}

// ------------------------------------------------------------------------------------------------------------------ overview
function Approvals({ dep, call }) {
  const [reject, setReject] = useState(null);
  const decide = (id, decision, comment) => call(() => apiClient.post(`${BASE}/requests/${id}/decide`, { decision, comment }), decision === 'approve' ? 'Step approved' : 'Rejected');
  if (!dep.requests.length) return <p className="text-sm text-tertiary-500">Nothing has been sent for approval yet.</p>;
  return (
    <ul className="space-y-3" aria-label="Approvals">
      {dep.requests.map((r) => (
        <li key={r.id} className="rounded-xl border border-tertiary-100 bg-white p-3" data-testid="request">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-tertiary-900">{REQUEST_LABEL[r.kind]} <span className="font-normal text-tertiary-500">· {requestSummary(r)}</span></p>
            <Pill tone={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : r.status === 'cancelled' ? 'gray' : 'amber'}>{r.status === 'pending' ? 'Waiting' : r.status}</Pill>
          </div>
          <ol className="mt-2 flex flex-wrap gap-2 text-xs">
            {r.steps.map((s) => (
              <li key={s.seq} className={`rounded-full px-2.5 py-1 ${s.status === 'approved' ? 'bg-green-50 text-green-700' : s.status === 'rejected' ? 'bg-red-50 text-red-700' : r.next_role === s.role && r.status === 'pending' ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-300' : 'bg-tertiary-100 text-tertiary-600'}`} title={s.comment || ''}>
                {s.seq}. {ROLE_LABEL[s.role]}{s.decided_by_name ? ` · ${s.decided_by_name}` : ''}
              </li>
            ))}
          </ol>
          {r.decision_note && <p className="mt-1 text-xs text-danger-600">Reason: {r.decision_note}</p>}
          {r.status === 'pending' && (
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-primary inline-flex items-center gap-1 text-xs" onClick={() => decide(r.id, 'approve')}><Check className="h-3.5 w-3.5" />Approve {ROLE_LABEL[r.next_role]} step</button>
              <button type="button" className="btn-secondary inline-flex items-center gap-1 text-xs text-danger-700" onClick={() => setReject(r)}><X className="h-3.5 w-3.5" />Reject</button>
            </div>
          )}
        </li>
      ))}
      <ReasonModal open={Boolean(reject)} title="Reject this request" confirmText="Reject" tone="btn-primary" onClose={() => setReject(null)} onConfirm={(reason) => { decide(reject.id, 'reject', reason); setReject(null); }} />
    </ul>
  );
}

function Overview({ dep, call, onEdit, onDelete }) {
  const [ask, setAsk] = useState(null); // 'extend' | 'close' | 'cancel' | 'emergency'
  const [newEnd, setNewEnd] = useState('');
  const [reasonBusy, setReasonBusy] = useState(false);
  const [tone, label] = STATUS[dep.status] || ['gray', dep.status];
  const act = (path, body, msg) => call(() => apiClient.post(`${BASE}/${dep.id}/${path}`, body || {}), msg);
  const stateTag = STATE_EXTRA[dep.state];
  const est = dep.estimate;
  const s = dep.settings;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={tone}>{label}</Pill>
        {stateTag && <Pill tone={stateTag[0]}>{stateTag[1]}</Pill>}
        {dep.emergency && <Pill tone="red">Emergency</Pill>}
        <span className="text-xs text-tertiary-500">{KIND_LABEL[dep.kind]} · {dep.code}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {['draft', 'pending_approval', 'approved', 'active'].includes(dep.status) && <button type="button" className="btn-secondary text-xs" onClick={onEdit}>Edit details</button>}
          {dep.status === 'draft' && <button type="button" className="btn-primary text-xs" onClick={() => act('submit', {}, 'Sent for approval')}>Submit for approval</button>}
          {dep.status === 'draft' && s?.emergency_allowed && <button type="button" className="btn-secondary text-xs text-danger-700" onClick={() => setAsk('emergency')}>Submit as emergency</button>}
          {dep.status === 'approved' && <button type="button" className="btn-primary text-xs" onClick={() => act('start', {}, 'Deployment started')}>Start deployment</button>}
          {dep.status === 'pending_approval' && dep.emergency && <button type="button" className="btn-primary text-xs" onClick={() => act('start', {}, 'Started before approval')}>Start now (emergency)</button>}
          {dep.status === 'active' && <button type="button" className="btn-secondary text-xs" onClick={() => { setNewEnd(dep.expected_end_date); setAsk('extend'); }}>Extend</button>}
          {dep.status === 'active' && <button type="button" className="btn-secondary text-xs" onClick={() => setAsk('close')}>Close deployment</button>}
          {['draft', 'pending_approval', 'approved', 'active'].includes(dep.status) && <button type="button" className="btn-secondary text-xs text-danger-700" onClick={() => setAsk('cancel')}>Cancel</button>}
          {dep.status === 'draft' && <button type="button" className="btn-secondary text-xs text-danger-700" onClick={() => { if (window.confirm('Delete this draft?')) onDelete(dep); }}>Delete draft</button>}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        <Fact label="Client">{dep.client_name}</Fact>
        <Fact label="Client location">{dep.client_location}</Fact>
        <Fact label="Company">{dep.org_name}</Fact>
        <Fact label="Start">{dayText(dep.start_date)}</Fact>
        <Fact label="Expected end">{dayText(dep.expected_end_date)}{dep.days_left != null ? ` · ${dep.days_left < 0 ? `${-dep.days_left} days over` : `${dep.days_left} days left`}` : ''}</Fact>
        <Fact label="Duration">{dep.days} days · {dep.months} month{dep.months === 1 ? '' : 's'}</Fact>
        <Fact label="Working arrangement">{ARRANGEMENT_LABEL[dep.working_arrangement]}</Fact>
        <Fact label="Reporting manager">{dep.reporting_manager_name}</Fact>
        <Fact label="Project / delivery manager">{dep.delivery_manager_name}</Fact>
        <Fact label="Client supervisor">{[dep.client_supervisor_name, dep.client_supervisor_phone, dep.client_supervisor_email].filter(Boolean).join(' · ')}</Fact>
        <Fact label="Project">{dep.project ? `${dep.project.code} ${dep.project.name}` : 'Not linked'}</Fact>
        <Fact label="People">{dep.people.filter((p) => p.status === 'active').length} active</Fact>
      </dl>
      {dep.purpose && <p className="rounded-xl bg-tertiary-50 px-3 py-2 text-sm text-tertiary-700">{dep.purpose}</p>}

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-tertiary-900">Budget against spend</h4>
        <BudgetBar estimated={est.total} actual={dep.actual.total} />
        <p className="text-xs text-tertiary-500">Billable {inr(dep.actual.billable)} · Non-billable {inr(dep.actual.non_billable)} · Client still owes {inr(dep.actual.pending_recovery)}</p>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-tertiary-900">Approvals</h4>
        <Approvals dep={dep} call={call} />
      </section>

      <ReasonModal open={ask === 'emergency'} title="Submit as an emergency" label="Why is this an emergency?" confirmText="Submit" onClose={() => setAsk(null)} onConfirm={(reason) => { setAsk(null); act('submit', { emergency: true, emergency_reason: reason }, 'Sent as an emergency'); }} />
      <ReasonModal open={ask === 'cancel'} title="Cancel this deployment" confirmText="Cancel deployment" onClose={() => setAsk(null)} onConfirm={(reason) => { setAsk(null); act('cancel', { reason }, 'Deployment cancelled'); }} />
      <ReasonModal open={ask === 'close'} title="Close this deployment" required={false} label="Closing note (optional)" confirmText="Close" busy={reasonBusy} onClose={() => setAsk(null)} onConfirm={async (reason) => { setReasonBusy(true); await act('close', { reason: reason || null }, 'Deployment closed'); setReasonBusy(false); setAsk(null); }} extra={<p className="text-xs text-tertiary-500">Everyone still on it is released from today.</p>} />
      <ReasonModal
        open={ask === 'extend'}
        title="Extend the deployment"
        label="Reason for the extension"
        confirmText="Request extension"
        onClose={() => setAsk(null)}
        extra={<label className={labelCls}>New end date<input type="date" className={inputCls} value={newEnd} min={dep.expected_end_date} onChange={(e) => setNewEnd(e.target.value)} /></label>}
        onConfirm={(reason) => { setAsk(null); act('extend', { new_end_date: newEnd, reason }, 'Extension sent'); }}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------ people
function PersonPicker({ options, value, onChange }) {
  const [guest, setGuest] = useState('');
  return (
    <div className="space-y-2">
      <select className={inputCls} value={value ? `${value.user_id}:${value.org_id}` : ''} onChange={(e) => { const p = (options?.people || []).find((x) => `${x.user_id}:${x.org_id}` === e.target.value); onChange(p ? { user_id: p.user_id, name: p.name, org_id: p.org_id } : null); }} aria-label="Person">
        <option value="">Choose from any company…</option>
        {(options?.people || []).map((p) => <option key={`${p.user_id}:${p.org_id}`} value={`${p.user_id}:${p.org_id}`}>{p.name} · {p.org_name}</option>)}
      </select>
      <div className="flex gap-2"><input className={inputCls} placeholder="Or someone outside the group" value={guest} onChange={(e) => setGuest(e.target.value)} maxLength={120} /><button type="button" className="btn-secondary" disabled={!guest.trim()} onClick={() => { onChange({ user_id: null, name: guest.trim(), org_id: null }); setGuest(''); }}>Use</button></div>
      {value && !value.user_id && <p className="text-xs text-tertiary-500">Selected: {value.name}</p>}
    </div>
  );
}

function People({ dep, options, call }) {
  const [modal, setModal] = useState(null); // { action, person? }
  const [target, setTarget] = useState(null);
  const [role, setRole] = useState('');
  const [reason, setReason] = useState('');
  const [on, setOn] = useState(today());
  const open = ['draft', 'pending_approval', 'approved', 'active'].includes(dep.status);
  const reset = () => { setModal(null); setTarget(null); setRole(''); setReason(''); setOn(today()); };
  const submit = async () => {
    const body = modal.action === 'add' ? { action: 'add', person: { ...target, role: role || null }, reason: reason || null }
      : modal.action === 'replace' ? { action: 'replace', person_id: modal.person.id, person: { ...target, role: role || modal.person.role || null }, reason, on }
        : { action: 'release', person_id: modal.person.id, reason, on };
    await call(() => apiClient.post(`${BASE}/${dep.id}/allocation`, body), dep.status === 'draft' ? 'Saved' : 'Done (a change of people may wait for approval)');
    reset();
  };
  const needsPerson = modal && modal.action !== 'release';
  const bad = !modal || (needsPerson && !target) || (modal.action !== 'add' && reason.trim().length < 3);
  return (
    <div className="space-y-3">
      <div className="flex justify-between">
        <p className="text-xs text-tertiary-500">A change of people on a submitted deployment goes through approval.</p>
        {open && <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" onClick={() => setModal({ action: 'add' })}><Plus className="h-3.5 w-3.5" />Add a person</button>}
      </div>
      <div className="overflow-x-auto rounded-xl border border-tertiary-100">
        <table className="w-full text-left text-sm">
          <thead className="bg-tertiary-50 text-xs uppercase tracking-wide text-tertiary-500"><tr><th className="px-3 py-2">Person</th><th>Role</th><th>Works</th><th>From</th><th>Status</th><th className="px-3 text-right">Today</th><th /></tr></thead>
          <tbody className="divide-y">
            {dep.people.map((p) => (
              <tr key={p.id} className={p.status !== 'active' ? 'text-tertiary-400' : ''}>
                <td className="px-3 py-2 font-medium">{p.name}</td>
                <td>{p.role || '-'}</td>
                <td>{ARRANGEMENT_LABEL[p.arrangement]}</td>
                <td>{dayText(p.start_date)}{p.released_on ? ` → ${dayText(p.released_on)}` : ''}</td>
                <td><Pill tone={p.status === 'active' ? 'green' : p.status === 'replaced' ? 'amber' : 'gray'}>{p.status === 'replaced' ? 'Replaced' : p.status === 'released' ? 'Released' : 'Active'}</Pill>{p.release_reason && <span className="ml-1 text-xs">{p.release_reason}</span>}</td>
                <td className="px-3 text-right text-xs">{p.status === 'active' ? (p.today === 'client_office' ? 'At the client office' : p.today === 'remote' ? 'Remote' : 'Not logged') : ''}</td>
                <td className="px-3 text-right whitespace-nowrap">
                  {p.status === 'active' && open && (
                    <>
                      <button type="button" className="text-xs text-primary-700 hover:underline" onClick={() => setModal({ action: 'replace', person: p })}>Replace</button>
                      <button type="button" className="ml-3 text-xs text-danger-700 hover:underline" onClick={() => setModal({ action: 'release', person: p })}>Release early</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!dep.people.length && <tr><td colSpan={7} className="px-3 py-4 text-center text-tertiary-500">Nobody is on this deployment yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <Modal
        open={Boolean(modal)}
        wide
        title={modal?.action === 'add' ? 'Add a person' : modal?.action === 'replace' ? `Replace ${modal?.person?.name}` : `Release ${modal?.person?.name} early`}
        onClose={reset}
        footer={<><button type="button" className="btn-secondary" onClick={reset}>Cancel</button><button type="button" className="btn-primary" disabled={bad} onClick={submit}>Confirm</button></>}
      >
        <div className="space-y-3">
          {needsPerson && <PersonPicker options={options} value={target} onChange={setTarget} />}
          {needsPerson && <label className={labelCls}>Role<input className={inputCls} value={role} onChange={(e) => setRole(e.target.value)} maxLength={120} /></label>}
          {modal?.action !== 'add' && <label className={labelCls}>Effective from<input type="date" className={inputCls} value={on} onChange={(e) => setOn(e.target.value)} /></label>}
          <label className={labelCls}>Reason{modal?.action === 'add' ? ' (optional)' : ''}<textarea rows={2} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>
        </div>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------ budget
function Budget({ dep, call }) {
  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState([]);
  const [reason, setReason] = useState('');
  const est = dep.estimate;
  const act = dep.actual;
  const open = ['draft', 'pending_approval', 'approved', 'active'].includes(dep.status);
  const save = async () => {
    await call(() => apiClient.put(`${BASE}/${dep.id}/budget`, { lines: cleanLines(lines), reason: reason || null }), dep.status === 'draft' ? 'Budget saved' : 'Budget revision sent for approval');
    setEditing(false);
  };
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['Estimated total', est.total], ['Actual spend', act.total], [act.variance >= 0 ? 'Left in budget' : 'Over budget', Math.abs(act.variance)], ['Client still owes', act.pending_recovery]].map(([k, val]) => (
          <div key={k} className="rounded-xl border border-tertiary-100 bg-white p-3"><p className="text-xs text-tertiary-500">{k}</p><p className="font-heading text-lg font-semibold text-tertiary-900">{inr(val)}</p></div>
        ))}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <Fact label="One-time lines">{inr(est.one_time)}</Fact>
        <Fact label={`Monthly lines (${est.months} month${est.months === 1 ? '' : 's'})`}>{inr(est.monthly_per_month)} a month = {inr(est.monthly_total)}</Fact>
        <Fact label="Billable / non-billable (estimate)">{inr(est.billable)} / {inr(est.non_billable)}</Fact>
        <Fact label="Company pays / client pays / to recover">{inr(est.company_borne)} / {inr(est.client_borne)} / {inr(est.recoverable)}</Fact>
        <Fact label="Actual billable / non-billable">{inr(act.billable)} / {inr(act.non_billable)}</Fact>
        <Fact label="Actual company-funded / client-funded">{inr(act.company_borne)} / {inr(act.client_borne)}</Fact>
        <Fact label="Spend waiting for Finance">{inr(act.unverified)}</Fact>
        <Fact label="Recovered from the client">{inr(act.recovered)}</Fact>
      </dl>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-tertiary-900">Estimated budget lines</h4>
          {open && !editing && <button type="button" className="btn-secondary text-xs" onClick={() => { setLines(dep.budget_lines.map((l) => ({ ...l, client_share_pct: l.client_share_pct ?? '' }))); setReason(''); setEditing(true); }}>{dep.status === 'draft' ? 'Edit budget' : 'Revise budget'}</button>}
        </div>
        {editing ? (
          <div className="space-y-3">
            <LinesEditor lines={lines} onChange={setLines} />
            {dep.status !== 'draft' && <label className={labelCls}>Why is the budget changing?<input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>}
            <div className="flex gap-2"><button type="button" className="btn-primary" onClick={save}>{dep.status === 'draft' ? 'Save' : 'Send for approval'}</button><button type="button" className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button></div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-tertiary-100">
            <table className="w-full text-left text-sm">
              <thead className="bg-tertiary-50 text-xs uppercase tracking-wide text-tertiary-500"><tr><th className="px-3 py-2">Expense</th><th>How often</th><th>Who pays</th><th>Billable</th><th className="px-3 text-right">Amount</th><th className="px-3 text-right">For the deployment</th></tr></thead>
              <tbody className="divide-y">
                {dep.budget_lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2">{CATEGORY_LABEL[l.category]}{l.description ? <span className="block text-xs text-tertiary-500">{l.description}</span> : null}</td>
                    <td>{FREQ_LABEL[l.frequency]}</td>
                    <td>{FUNDING_LABEL[l.funding]}{l.funding === 'shared' ? ` (client ${l.client_share_pct}%)` : ''}</td>
                    <td>{l.billable ? 'Billable' : 'Non-billable'}</td>
                    <td className="px-3 text-right tabular-nums">{inr(l.amount)}</td>
                    <td className="px-3 text-right tabular-nums">{inr(l.frequency === 'monthly' ? l.amount * est.months : l.amount)}</td>
                  </tr>
                ))}
                {!dep.budget_lines.length && <tr><td colSpan={6} className="px-3 py-4 text-center text-tertiary-500">No budget yet. A deployment needs one before it can be submitted (unless it is an emergency).</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-tertiary-900">Month by month</h4>
        <div className="overflow-x-auto rounded-xl border border-tertiary-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-tertiary-50 text-xs uppercase tracking-wide text-tertiary-500"><tr><th className="px-3 py-2">Month</th><th className="px-3 text-right">Budget</th><th className="px-3 text-right">Actual</th><th className="px-3 text-right">Variance</th></tr></thead>
            <tbody className="divide-y">
              {act.months.map((m) => (
                <tr key={m.month}><td className="px-3 py-2">{m.month}</td><td className="px-3 text-right tabular-nums">{inr(m.budget)}</td><td className="px-3 text-right tabular-nums">{inr(m.actual)}</td><td className={`px-3 text-right tabular-nums ${m.variance < 0 ? 'text-danger-600' : ''}`}>{m.variance < 0 ? '-' : ''}{inr(Math.abs(m.variance))}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------ travel
function Travel({ dep, call }) {
  const blank = { mode: 'flight', from_place: '', to_place: '', start_date: '', end_date: '', vendor: '', booking_ref: '', estimated_cost: '', status: 'planned' };
  const [f, setF] = useState(blank);
  const open = ['draft', 'pending_approval', 'approved', 'active'].includes(dep.status);
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  const add = async () => {
    await call(() => apiClient.post(`${BASE}/${dep.id}/travel`, { ...f, from_place: f.from_place || null, to_place: f.to_place || null, start_date: f.start_date || null, end_date: f.end_date || null, vendor: f.vendor || null, booking_ref: f.booking_ref || null, estimated_cost: f.estimated_cost === '' ? null : Number(f.estimated_cost) }), 'Arrangement added');
    setF(blank);
  };
  return (
    <div className="space-y-4">
      <ul className="space-y-2" aria-label="Travel arrangements">
        {dep.travel.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-tertiary-100 bg-white px-3 py-2 text-sm">
            <Pill tone="blue">{MODE_LABEL[t.mode]}</Pill>
            <span className="font-medium text-tertiary-900">{[t.from_place, t.to_place].filter(Boolean).join(' → ') || '-'}</span>
            <span className="text-xs text-tertiary-500">{dayText(t.start_date)}{t.end_date ? ` – ${dayText(t.end_date)}` : ''}{t.vendor ? ` · ${t.vendor}` : ''}{t.booking_ref ? ` · ${t.booking_ref}` : ''}</span>
            <span className="ml-auto tabular-nums text-tertiary-700">{t.estimated_cost != null ? inr(t.estimated_cost) : ''}</span>
            <select className="rounded-lg border px-2 py-1 text-xs" value={t.status} aria-label="Travel status" onChange={(e) => call(() => apiClient.patch(`${BASE}/${dep.id}/travel/${t.id}`, { status: e.target.value }), 'Updated')}>{['planned', 'booked', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
            {open && <button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" aria-label="Remove" onClick={() => call(() => apiClient.delete(`${BASE}/${dep.id}/travel/${t.id}`), 'Removed')}><Trash2 className="h-4 w-4" /></button>}
          </li>
        ))}
        {!dep.travel.length && <li className="text-sm text-tertiary-500">No travel arrangement yet.</li>}
      </ul>
      {open && (
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-dashed border-tertiary-200 p-3 sm:grid-cols-4">
          <label className={labelCls}>Type<select className={inputCls} value={f.mode} onChange={set('mode')}>{Object.entries(MODE_LABEL).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></label>
          <label className={labelCls}>From<input className={inputCls} value={f.from_place} onChange={set('from_place')} /></label>
          <label className={labelCls}>To / place<input className={inputCls} value={f.to_place} onChange={set('to_place')} /></label>
          <label className={labelCls}>Estimated ₹<input type="number" min="0" step="any" className={inputCls} value={f.estimated_cost} onChange={set('estimated_cost')} /></label>
          <label className={labelCls}>From date<input type="date" className={inputCls} value={f.start_date} onChange={set('start_date')} /></label>
          <label className={labelCls}>To date<input type="date" className={inputCls} value={f.end_date} onChange={set('end_date')} /></label>
          <label className={labelCls}>Vendor<input className={inputCls} value={f.vendor} onChange={set('vendor')} /></label>
          <label className={labelCls}>Booking ref<input className={inputCls} value={f.booking_ref} onChange={set('booking_ref')} /></label>
          <div className="col-span-2 sm:col-span-4"><button type="button" className="btn-secondary" onClick={add}>Add arrangement</button></div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------ expenses
export function ExpenseForm({ dep, onSubmit, busy }) {
  const blank = { expense_date: today(), category: 'food', description: '', amount: '', funding: 'company', client_share_pct: '', billable: false, person_id: '' };
  const [f, setF] = useState(blank);
  const [file, setFile] = useState(null);
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  const bad = !(Number(f.amount) > 0) || (f.funding === 'shared' && f.client_share_pct === '');
  return (
    <form
      className="grid grid-cols-2 gap-2 rounded-xl border border-dashed border-tertiary-200 p-3 sm:grid-cols-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData();
        Object.entries({ ...f, billable: String(f.billable) }).forEach(([k, v]) => { if (v !== '') fd.append(k, v); });
        if (file) fd.append('file', file);
        if (await onSubmit(fd)) { setF(blank); setFile(null); e.target.reset?.(); }
      }}
    >
      <label className={labelCls}>Date<input required type="date" max={today()} className={inputCls} value={f.expense_date} onChange={set('expense_date')} /></label>
      <label className={labelCls}>Expense<select className={inputCls} value={f.category} onChange={set('category')}>{Object.entries(CATEGORY_LABEL).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></label>
      <label className={labelCls}>Amount ₹<input required type="number" min="1" step="any" className={inputCls} value={f.amount} onChange={set('amount')} aria-label="Expense amount" /></label>
      <label className={labelCls}>Who bears it<select className={inputCls} value={f.funding} onChange={set('funding')}>{Object.entries(FUNDING_LABEL).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></label>
      {f.funding === 'shared' && <label className={labelCls}>Client pays %<input type="number" min="0" max="100" className={inputCls} value={f.client_share_pct} onChange={set('client_share_pct')} /></label>}
      {dep.people?.length > 1 && (
        <label className={labelCls}>For<select className={inputCls} value={f.person_id} onChange={set('person_id')}><option value="">Me</option>{dep.people.filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      )}
      <label className={`${labelCls} sm:col-span-2`}>What for<input className={inputCls} value={f.description} onChange={set('description')} maxLength={500} /></label>
      <label className={labelCls}>Bill / receipt<input type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx" className="mt-1 block w-full text-xs" onChange={(e) => setFile(e.target.files?.[0] || null)} aria-label="Bill or receipt" /></label>
      <label className="flex items-end gap-1.5 pb-2 text-xs text-tertiary-700"><input type="checkbox" checked={f.billable} onChange={(e) => setF((c) => ({ ...c, billable: e.target.checked }))} />Billable to the client</label>
      <div className="col-span-2 sm:col-span-4"><button type="submit" className="btn-primary" disabled={bad || busy}>{busy ? 'Submitting…' : 'Submit expense'}</button></div>
    </form>
  );
}

export function ExpenseRow({ e, canFinance, onVerify, onSettle, onRecover }) {
  const [tone, label] = EXPENSE_STATUS[e.status] || ['gray', e.status];
  const [rtone, rlabel] = RECOVERY[e.recovery_status] || ['gray', ''];
  return (
    <li className="space-y-2 rounded-xl border border-tertiary-100 bg-white px-3 py-2 text-sm" data-testid="expense">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={tone}>{label}</Pill>
        {e.over_budget && <Pill tone="red">Over budget</Pill>}
        <span className="font-medium text-tertiary-900">{CATEGORY_LABEL[e.category]}</span>
        <span className="text-xs text-tertiary-500">{dayText(e.expense_date)} · {FUNDING_LABEL[e.funding]}{e.billable ? ' · Billable' : ''}{e.submitted_by_name ? ` · by ${e.submitted_by_name}` : ''}</span>
        <span className="ml-auto font-semibold tabular-nums">{inr(e.amount)}</span>
      </div>
      {e.description && <p className="text-xs text-tertiary-600">{e.description}</p>}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {e.has_bill && <button type="button" className="inline-flex items-center gap-1 text-primary-700 hover:underline" onClick={() => downloadAuthenticatedFile(e.bill_url, e.bill_name)}><Download className="h-3.5 w-3.5" />{e.bill_name || 'Bill'}</button>}
        {e.client_amount > 0 && ['verified', 'settled'].includes(e.status) && <Pill tone={rtone}>{rlabel}: {inr(e.client_amount - e.recovered_amount)} of {inr(e.client_amount)}</Pill>}
        {e.verify_note && <span className="text-tertiary-500">Finance: {e.verify_note}</span>}
        {e.settlement_ref && <span className="text-tertiary-500">Ref {e.settlement_ref}</span>}
        {canFinance && (
          <span className="ml-auto flex gap-2">
            {e.status === 'submitted' && <button type="button" className="btn-primary text-xs" onClick={() => onVerify(e, 'verify')}>Verify</button>}
            {e.status === 'submitted' && <button type="button" className="btn-secondary text-xs text-danger-700" onClick={() => onVerify(e, 'reject')}>Reject</button>}
            {e.status === 'verified' && <button type="button" className="btn-secondary text-xs" onClick={() => onSettle(e)}>Mark settled</button>}
            {['verified', 'settled'].includes(e.status) && e.client_amount - e.recovered_amount > 0.005 && <button type="button" className="btn-secondary text-xs" onClick={() => onRecover(e)}>Client paid</button>}
          </span>
        )}
      </div>
    </li>
  );
}

/** The three Finance dialogs (reject reason, settlement reference, client payment), shared by this tab and the Finance queue. */
export function useFinanceActions(run) {
  const [dlg, setDlg] = useState(null); // { kind, e }
  const [amount, setAmount] = useState('');
  const node = (
    <>
      <ReasonModal open={dlg?.kind === 'reject'} title="Reject this expense" confirmText="Reject" onClose={() => setDlg(null)} onConfirm={(note) => { run(`expenses/${dlg.e.id}/verify`, { decision: 'reject', note }, 'Expense rejected'); setDlg(null); }} />
      <ReasonModal open={dlg?.kind === 'settle'} title="Mark as settled" label="Settlement reference (bank / UTR)" required={false} confirmText="Settle" onClose={() => setDlg(null)} onConfirm={(ref) => { run(`expenses/${dlg.e.id}/settle`, { settlement_ref: ref || null }, 'Settled'); setDlg(null); }} />
      <ReasonModal
        open={dlg?.kind === 'recover'}
        title="Client payment received"
        label="Note (optional)"
        required={false}
        confirmText="Record"
        onClose={() => setDlg(null)}
        extra={dlg?.kind === 'recover' ? <label className={labelCls}>Amount received ₹ (the client owes {inr(dlg.e.client_amount - dlg.e.recovered_amount)})<input type="number" min="1" step="any" className={inputCls} value={amount} onChange={(ev) => setAmount(ev.target.value)} aria-label="Amount received" /></label> : null}
        onConfirm={() => { run(`expenses/${dlg.e.id}/recover`, { amount: Number(amount) }, 'Recorded'); setDlg(null); setAmount(''); }}
      />
    </>
  );
  return {
    node,
    verify: (e, decision) => (decision === 'verify' ? run(`expenses/${e.id}/verify`, { decision: 'verify' }, 'Expense verified') : setDlg({ kind: 'reject', e })),
    settle: (e) => setDlg({ kind: 'settle', e }),
    recover: (e) => { setAmount(String(Math.round((e.client_amount - e.recovered_amount) * 100) / 100)); setDlg({ kind: 'recover', e }); },
  };
}

function Expenses({ dep, call, safe }) {
  const { pushError } = useAlerts();
  const [busy, setBusy] = useState(false);
  const fin = useFinanceActions((path, body, msg) => safe(() => apiClient.post(`${BASE}/${path}`, body), msg));
  const canSubmit = ['approved', 'active'].includes(dep.status);
  const submit = async (fd) => {
    setBusy(true);
    try { await call(() => apiClient.post(`${BASE}/${dep.id}/expenses`, fd), 'Expense submitted'); return true; } catch (err) { pushError(apiErrorMessage(err, 'Could not submit the expense'), 'Not saved'); return false; } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      {canSubmit ? <ExpenseForm dep={dep} onSubmit={submit} busy={busy} /> : <p className="text-sm text-tertiary-500">Expenses can be submitted once the deployment is approved or running.</p>}
      <ul className="space-y-2" aria-label="Expenses">
        {dep.expenses.map((e) => <ExpenseRow key={e.id} e={e} canFinance onVerify={fin.verify} onSettle={fin.settle} onRecover={fin.recover} />)}
        {!dep.expenses.length && <li className="text-sm text-tertiary-500">No expense submitted yet.</li>}
      </ul>
      {fin.node}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------ onsite work and reviews
function Onsite({ dep, call }) {
  const { pushError } = useAlerts();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [logs, setLogs] = useState(null);
  const [rv, setRv] = useState({ kind: 'weekly', period_start: today(), rating: '', summary: '', client_contact: '' });
  const load = useCallback(() => apiClient.get(`${BASE}/${dep.id}/logs`, { params: { month } }).then((r) => setLogs(r.data.data)).catch((err) => pushError(apiErrorMessage(err, 'Could not load the logs'), 'Load failed')), [dep.id, month]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  const pr = dep.presence;
  const addReview = async () => {
    await call(() => apiClient.post(`${BASE}/${dep.id}/reviews`, { kind: rv.kind, period_start: rv.period_start, rating: rv.rating === '' ? null : Number(rv.rating), summary: rv.summary, client_contact: rv.client_contact || null }), 'Review saved');
    setRv((c) => ({ ...c, summary: '', rating: '' }));
  };
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3 text-center">
        {[['At the client office today', pr.client_office], ['Remote today', pr.remote], ['Not logged today', pr.not_logged]].map(([k, n]) => (
          <div key={k} className="rounded-xl border border-tertiary-100 bg-white p-3"><p className="font-heading text-xl font-semibold text-tertiary-900">{n}</p><p className="text-xs text-tertiary-500">{k}</p></div>
        ))}
      </div>
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-tertiary-900">Daily logs</h4>
          <input type="month" className="rounded-xl border px-2 py-1 text-sm" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
        </div>
        {logs && <p className="text-xs text-tertiary-500">{logs.summary.days} days logged · {logs.summary.hours} hours · {logs.summary.client_office_days} at the client office · {logs.summary.remote_days} remote</p>}
        <ul className="space-y-2" aria-label="Daily logs">
          {(logs?.logs || []).map((l) => (
            <li key={l.id} className="rounded-xl border border-tertiary-100 bg-white px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{dayText(l.log_date)}</span><span className="text-tertiary-700">{l.person_name}</span><Pill tone={l.location_mode === 'remote' ? 'amber' : 'green'}>{l.location_mode === 'remote' ? 'Remote' : 'Client office'}</Pill><span className="ml-auto tabular-nums">{l.hours} h</span></div>
              <p className="mt-1 text-xs text-tertiary-700">{l.activities}</p>
              {l.deliverables && <p className="text-xs text-green-700">Delivered: {l.deliverables}</p>}
              {l.pending_tasks && <p className="text-xs text-amber-700">Pending: {l.pending_tasks}</p>}
            </li>
          ))}
          {logs && !logs.logs.length && <li className="text-sm text-tertiary-500">Nothing logged in this month.</li>}
        </ul>
      </section>
      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-tertiary-900">Weekly reviews and client feedback</h4>
        <ul className="space-y-2" aria-label="Reviews">
          {dep.reviews.map((r) => (
            <li key={r.id} className="rounded-xl border border-tertiary-100 bg-white px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2"><Pill tone={r.kind === 'weekly' ? 'blue' : 'purple'}>{r.kind === 'weekly' ? `Week of ${dayText(r.period_start)}` : `Client feedback · ${r.period_start.slice(0, 7)}`}</Pill>{r.rating && <span className="text-xs text-amber-600">{'★'.repeat(r.rating)}</span>}<span className="ml-auto text-xs text-tertiary-500">{r.created_by_name}</span></div>
              <p className="mt-1 text-xs text-tertiary-700">{r.summary}{r.client_contact ? ` — ${r.client_contact}` : ''}</p>
            </li>
          ))}
          {!dep.reviews.length && <li className="text-sm text-tertiary-500">No review yet.</li>}
        </ul>
        {['active', 'approved', 'closed'].includes(dep.status) && (
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-dashed border-tertiary-200 p-3 sm:grid-cols-4">
            <label className={labelCls}>Type<select className={inputCls} value={rv.kind} onChange={(e) => setRv((c) => ({ ...c, kind: e.target.value }))}><option value="weekly">Weekly progress review</option><option value="client_feedback">Monthly client feedback</option></select></label>
            <label className={labelCls}>{rv.kind === 'weekly' ? 'A day in that week' : 'A day in that month'}<input type="date" className={inputCls} value={rv.period_start} onChange={(e) => setRv((c) => ({ ...c, period_start: e.target.value }))} /></label>
            <label className={labelCls}>Rating (1-5)<input type="number" min="1" max="5" className={inputCls} value={rv.rating} onChange={(e) => setRv((c) => ({ ...c, rating: e.target.value }))} /></label>
            {rv.kind === 'client_feedback' && <label className={labelCls}>Client contact<input className={inputCls} value={rv.client_contact} onChange={(e) => setRv((c) => ({ ...c, client_contact: e.target.value }))} /></label>}
            <label className={`${labelCls} col-span-2 sm:col-span-4`}>Summary<textarea rows={2} className={inputCls} value={rv.summary} onChange={(e) => setRv((c) => ({ ...c, summary: e.target.value }))} maxLength={4000} /></label>
            <div className="col-span-2 sm:col-span-4"><button type="button" className="btn-secondary" disabled={rv.summary.trim().length < 2} onClick={addReview}>Save review</button></div>
          </div>
        )}
      </section>
    </div>
  );
}

function History({ dep }) {
  return (
    <ol className="space-y-2" aria-label="History">
      {dep.events.map((e) => (
        <li key={e.id} className="rounded-xl border border-tertiary-100 bg-white px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-tertiary-900">{EVENT_LABEL[e.kind] || e.kind}</span><span className="text-xs text-tertiary-500">{e.by_name ? `by ${e.by_name} · ` : ''}{whenText(e.created_at)}</span></div>
          {e.reason && <p className="text-xs text-tertiary-600">{e.reason}</p>}
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------------------------------------------------------------ the drawer body
export default function DeploymentDetail({ id, initialTab, options, onChanged, onEdit, onDelete }) {
  const { pushError, pushSuccess } = useAlerts();
  const [dep, setDep] = useState(null);
  const [tab, setTab] = useState(initialTab || 'overview');
  const load = useCallback(() => apiClient.get(`${BASE}/${id}`).then((r) => setDep(r.data.data.deployment)).catch((err) => pushError(apiErrorMessage(err, 'Could not open the deployment'), 'Load failed')), [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDep(null); setTab(initialTab || 'overview'); load(); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Runs a call, shows the result and refreshes this deployment and the lists behind it. */
  const call = useCallback(async (fn, message) => {
    try {
      const r = await fn();
      const body = r?.data?.data;
      if (body?.deployment) setDep(body.deployment); else await load();
      if (body?.requested) pushSuccess('Sent for approval. It applies once every step approves.', 'Waiting for approval'); else if (message) pushSuccess(message);
      onChanged?.();
      return body;
    } catch (err) {
      pushError(apiErrorMessage(err, 'That did not work'), 'Something went wrong');
      throw err;
    }
  }, [load, onChanged]); // eslint-disable-line react-hooks/exhaustive-deps
  const safeCall = useCallback((fn, message) => call(fn, message).catch(() => null), [call]);
  const counts = useMemo(() => ({ expenses: dep?.expenses?.length || 0, people: dep?.people?.filter((p) => p.status === 'active').length || 0, requests: dep?.requests?.filter((r) => r.status === 'pending').length || 0 }), [dep]);

  if (!dep) return <Skeleton className="h-48 w-full" />;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-heading text-lg font-semibold text-tertiary-900">{dep.title}</h3>
        <p className="text-xs text-tertiary-500">{dep.client_name}{dep.client_location ? ` · ${dep.client_location}` : ''}</p>
      </div>
      <div className="flex flex-wrap gap-1 border-b" role="tablist" aria-label="Deployment sections">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500 hover:text-tertiary-800'}`}>
            {label}{k === 'people' ? ` (${counts.people})` : k === 'expenses' && counts.expenses ? ` (${counts.expenses})` : k === 'overview' && counts.requests ? ` · ${counts.requests} waiting` : ''}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview dep={dep} call={safeCall} onEdit={() => onEdit(dep)} onDelete={onDelete} />}
      {tab === 'people' && <People dep={dep} options={options} call={safeCall} />}
      {tab === 'budget' && <Budget dep={dep} call={safeCall} />}
      {tab === 'travel' && <Travel dep={dep} call={safeCall} />}
      {tab === 'expenses' && <Expenses dep={dep} call={call} safe={safeCall} />}
      {tab === 'onsite' && <Onsite dep={dep} call={safeCall} />}
      {tab === 'history' && <History dep={dep} />}
    </div>
  );
}
