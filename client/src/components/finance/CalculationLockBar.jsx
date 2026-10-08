import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Eye, History, Lock, RotateCcw, RefreshCw } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Modal from '../ui/Modal.jsx';
import StatusBadge from './StatusBadge.jsx';
import { periodLabel } from './PeriodPicker.jsx';

export function inr(n, currency = 'INR') {
  if (n === null || n === undefined) return '—';
  return `${currency === 'INR' ? '₹' : `${currency} `}${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

const when = (v) => (v ? new Date(v).toLocaleString() : '—');

function ReasonModal({ action, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setReason(''); }, [action]);
  if (!action) return null;
  const required = action.reasonRequired;
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch {
      // the caller has already shown the error
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      title={action.title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="calc-reason-form" className="btn-primary" disabled={saving || (required && !reason.trim())}>{saving ? 'Saving…' : action.confirm}</button>
        </>
      }
    >
      <form id="calc-reason-form" onSubmit={submit} className="space-y-3">
        <p className="text-tertiary-600">{action.body}</p>
        <label className="block text-xs font-medium text-tertiary-600">
          Reason {required ? <span className="text-danger-600">*</span> : <span className="font-normal text-tertiary-400">(optional)</span>}
          <textarea rows={3} autoFocus required={required} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" placeholder="Recorded in the audit history" />
        </label>
      </form>
    </Modal>
  );
}

function valueText(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v !== 'object') return String(v);
  return Object.entries(v)
    .filter(([, x]) => x !== null && x !== undefined && typeof x !== 'object')
    .map(([k, x]) => `${k.replace(/_/g, ' ')}: ${String(x).length > 24 && !Number.isNaN(Date.parse(x)) ? new Date(x).toLocaleString() : x}`)
    .join(' · ');
}

/** The open (and resolved) "Calculation Change Detected" items of a locked period. */
export function ChangeList({ changes, currency, onDismiss }) {
  if (!changes?.length) return null;
  return (
    <ul className="divide-y divide-red-100 rounded-xl border border-red-200 bg-white">
      {changes.map((c) => (
        <li key={c.id} className="space-y-1 px-3 py-2.5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge status={c.status} size="xs" />
              <span className="font-medium text-tertiary-900">{c.description}</span>
            </span>
            {c.status === 'open' && onDismiss && (
              <button type="button" className="btn-ghost text-xs" onClick={() => onDismiss(c)}>Dismiss</button>
            )}
          </div>
          <dl className="grid gap-x-4 gap-y-0.5 text-xs text-tertiary-600 sm:grid-cols-2">
            <div><dt className="inline font-medium">Date: </dt><dd className="inline">{c.date || '—'}</dd></div>
            <div><dt className="inline font-medium">Source: </dt><dd className="inline capitalize">{c.source_type.replace(/_/g, ' ')}</dd></div>
            <div><dt className="inline font-medium">Was: </dt><dd className="inline">{valueText(c.old_value)}</dd></div>
            <div><dt className="inline font-medium">Now: </dt><dd className="inline">{valueText(c.new_value)}</dd></div>
            <div>
              <dt className="inline font-medium">Amount: </dt>
              <dd className="inline">
                {inr(c.previous_amount, currency)} → {inr(c.potential_amount, currency)}
                {c.difference ? <span className={c.difference < 0 ? ' text-danger-700' : ' text-success-700'}> ({c.difference > 0 ? '+' : ''}{inr(c.difference, currency)})</span> : null}
              </dd>
            </div>
            <div><dt className="inline font-medium">Changed by: </dt><dd className="inline">{c.changed_by?.name || '—'} · {when(c.detected_at)}</dd></div>
            {c.status !== 'open' && (
              <div className="sm:col-span-2"><dt className="inline font-medium">Resolved: </dt><dd className="inline">{c.resolved_by?.name || '—'} · {when(c.resolved_at)}{c.resolved_version ? ` · into v${c.resolved_version}` : ''}{c.resolution_note ? ` · ${c.resolution_note}` : ''}</dd></div>
            )}
          </dl>
        </li>
      ))}
    </ul>
  );
}

/**
 * Review → Lock → (change detected) → Recalculate / Reopen, for one
 * calculation (kind + scope + month). The same bar is used for Billing &
 * Sales (per project), Salary, Resource Revenue, Vendor Payments and
 * Financials — one lock system everywhere.
 */
export default function CalculationLockBar({ kind, scopeKey, period, onChanged, title, children }) {
  const { pushError, pushSuccess } = useAlerts();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const params = { kind, ...(scopeKey ? { scope_key: scopeKey } : {}), period_month: period.period_month, period_year: period.period_year };
  const key = JSON.stringify(params);

  const load = useCallback(() => {
    setLoading(true);
    apiClient.get('/calculations/state', { params })
      .then(({ data }) => setState(data.data))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load the lock status'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  async function run(path, reason) {
    try {
      await apiClient.post(`/calculations/${path}`, { ...params, ...(reason ? { reason } : {}) });
      pushSuccess?.('Saved');
      load();
      onChanged?.();
    } catch (err) {
      pushError(apiErrorMessage(err, 'That did not work'), 'Could not save');
      throw err;
    }
  }

  async function dismiss(change, reason) {
    try {
      await apiClient.post(`/calculations/changes/${change.id}/dismiss`, { reason });
      load();
      onChanged?.();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to dismiss the change'), 'Could not save');
      throw err;
    }
  }

  if (loading && !state) return <div className="rounded-xl border border-tertiary-100 bg-white px-4 py-3 text-sm text-tertiary-400">Loading lock status…</div>;
  if (!state) return null;

  const frozen = ['locked', 'change_detected'].includes(state.status);
  const readiness = state.live?.readiness;
  const currency = state.live?.currency || state.currency || 'INR';
  const openChanges = state.changes.filter((c) => c.status === 'open');
  const label = `${title || state.kind_label}${state.scope_label && state.kind === 'billing' ? ` · ${state.scope_label}` : ''} — ${periodLabel(period)}`;

  const actions = {
    review: { title: 'Mark as reviewed', body: `${label}: record that these figures have been reviewed. They stay live (not final) until locked.`, confirm: 'Mark reviewed', path: 'review' },
    lock: { title: 'Lock / finalize', body: `${label}: the current figures become version ${state.current_version + 1} and are frozen. Later attendance, timesheet or salary changes will be flagged, never applied silently.`, confirm: 'Lock', path: 'lock' },
    recalculate: { title: 'Recalculate & re-finalize', body: `${label}: recompute from the current data and save it as version ${state.current_version + 1}. The earlier versions stay in the history.`, confirm: 'Recalculate', path: 'recalculate', reasonRequired: true },
    reopen: { title: 'Reopen', body: `${label}: put the period back to live so it can be corrected and locked again. Locked versions are kept.`, confirm: 'Reopen', path: 'reopen', reasonRequired: true },
  };

  return (
    <section className={`space-y-3 rounded-2xl border px-4 py-3 ${state.status === 'change_detected' ? 'border-red-300 bg-red-50/40' : frozen ? 'border-green-200 bg-green-50/30' : 'border-tertiary-100 bg-white'}`} aria-label="Lock status">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge status={state.status} />
          {state.current_version > 0 && <span className="text-xs text-tertiary-500">v{state.current_version}</span>}
          {frozen && <span className="font-medium text-tertiary-900">Locked: {inr(state.locked_amount, currency)}</span>}
          {state.live && (!frozen || state.status === 'change_detected') && (
            <span className={frozen ? 'text-danger-700' : 'text-tertiary-700'}>{frozen ? 'Live now' : 'Live'}: {inr(state.live.amount, currency)}</span>
          )}
          {state.locked_at && frozen && <span className="text-xs text-tertiary-500">by {state.locked_by?.name || '—'} · {when(state.locked_at)}</span>}
          {state.status === 'reviewed' && <span className="text-xs text-tertiary-500">Reviewed by {state.reviewed_by?.name || '—'} · {when(state.reviewed_at)}</span>}
          {state.status === 'reopened' && <span className="text-xs text-tertiary-500">Reopened by {state.reopened_by?.name || '—'} · {when(state.reopened_at)}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {children}
          {!frozen && state.status !== 'reviewed' && (
            <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" onClick={() => setAction(actions.review)}><Eye className="h-3.5 w-3.5" /> Mark reviewed</button>
          )}
          {!frozen && (
            <button type="button" className="btn-primary inline-flex items-center gap-1.5 text-xs" disabled={readiness && !readiness.can_lock} title={readiness && !readiness.can_lock ? 'Resolve the items listed first' : undefined} onClick={() => setAction(actions.lock)}><Lock className="h-3.5 w-3.5" /> Lock</button>
          )}
          {frozen && (
            <button type="button" className={`${state.status === 'change_detected' ? 'btn-primary' : 'btn-secondary'} inline-flex items-center gap-1.5 text-xs`} onClick={() => setAction(actions.recalculate)}><RefreshCw className="h-3.5 w-3.5" /> Recalculate</button>
          )}
          {frozen && (
            <button type="button" className="btn-ghost inline-flex items-center gap-1.5 text-xs" onClick={() => setAction(actions.reopen)}><RotateCcw className="h-3.5 w-3.5" /> Reopen</button>
          )}
        </div>
      </div>

      {!frozen && readiness && (readiness.blockers.length > 0 || readiness.warnings?.length > 0) && (
        <ul className="space-y-1 text-xs">
          {readiness.blockers.map((b) => (
            <li key={b.code} className="flex items-start gap-1.5 text-danger-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span><span className="font-semibold">Blocks lock:</span> {b.message}</span></li>
          ))}
          {(readiness.warnings || []).map((w) => (
            <li key={w.code} className="flex items-start gap-1.5 text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span><span className="font-semibold">Note:</span> {w.message}</span></li>
          ))}
        </ul>
      )}

      {openChanges.length > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-danger-700"><AlertTriangle className="h-4 w-4" aria-hidden="true" /> Historical Calculation Affected — {openChanges.length} change{openChanges.length === 1 ? '' : 's'} after locking. The locked figures have not changed.</p>
          <ChangeList changes={openChanges} currency={currency} onDismiss={(c) => setAction({ title: 'Dismiss change', body: 'Keep the locked figures and mark this change as reviewed without recalculating.', confirm: 'Dismiss', reasonRequired: true, change: c })} />
        </div>
      )}

      {(state.versions.length > 0 || state.changes.length > openChanges.length) && (
        <div>
          <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-tertiary-600 hover:text-tertiary-900" onClick={() => setHistoryOpen((v) => !v)} aria-expanded={historyOpen}>
            {historyOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <History className="h-3.5 w-3.5" /> Version &amp; audit history
          </button>
          {historyOpen && (
            <div className="mt-2 space-y-3">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-tertiary-500"><th className="py-1 font-medium">Version</th><th className="py-1 font-medium">Amount</th><th className="py-1 font-medium">By</th><th className="py-1 font-medium">When</th><th className="py-1 font-medium">Reason</th></tr></thead>
                <tbody>
                  {state.versions.map((v) => (
                    <tr key={v.version} className="border-t border-tertiary-100"><td className="py-1">v{v.version}</td><td className="py-1 tabular-nums">{inr(v.amount, v.currency)}</td><td className="py-1">{v.created_by?.name || '—'}</td><td className="py-1">{when(v.created_at)}</td><td className="py-1">{v.reason || '—'}</td></tr>
                  ))}
                </tbody>
              </table>
              <ChangeList changes={state.changes.filter((c) => c.status !== 'open')} currency={currency} />
            </div>
          )}
        </div>
      )}

      <ReasonModal
        action={action}
        onClose={() => setAction(null)}
        onConfirm={(reason) => (action.change ? dismiss(action.change, reason) : run(action.path, reason))}
      />
    </section>
  );
}
