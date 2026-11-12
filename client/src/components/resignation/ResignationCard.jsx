import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CalendarCheck, Check, FileCheck2, Info, MessageSquare, ShieldCheck, Undo2, UserCheck, UserRound } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { ConfirmDialog, REASON_LABEL, StatusPill, todayYmd } from './resignationShared.jsx';

const STEPS = [
  { icon: MessageSquare, label: 'Manager meeting', hint: 'Discuss your reason' },
  { icon: UserCheck, label: 'Manager approval', hint: 'Request goes on to HR' },
  { icon: CalendarCheck, label: 'HR confirmation', hint: 'Last working day is fixed' },
  { icon: FileCheck2, label: 'Notice and F&F', hint: 'Handover and settlement' },
];

const GOOD_TO_KNOW = [
  { icon: ShieldCheck, text: 'You confirm first. Nothing is sent until you say yes.' },
  { icon: Undo2, text: 'You can withdraw any time before HR approves.' },
  { icon: UserRound, text: 'Your manager and HR see the reason you give.' },
];

// Where a request is: the step in progress (steps before it are done). -1 = nothing submitted yet.
const STEP_OF_STATUS = { submitted: 0, manager_approved: 2, approved: 3 };

function Steps({ current = -1 }) {
  return (
    <ol className="grid grid-cols-2 gap-y-5 sm:grid-cols-4">
      {STEPS.map(({ icon: Icon, label, hint }, index) => {
        const done = index < current;
        const active = index === current;
        const last = index === STEPS.length - 1;
        const circle = done
          ? 'border-primary-600 bg-primary-600 text-white'
          : active
            ? 'border-primary-600 bg-white text-primary-700 ring-4 ring-primary-100'
            : 'border-tertiary-300 bg-white text-tertiary-500';
        return (
          <li key={label} className="relative flex flex-col items-center px-2 text-center">
            {!last && <span aria-hidden className={`absolute left-1/2 top-[18px] hidden h-0.5 w-full sm:block ${done ? 'bg-primary-600' : 'bg-tertiary-300'}`} />}
            <span className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full border-2 ${circle}`}>
              {done ? <Check className="h-4 w-4" aria-hidden /> : <Icon className="h-4 w-4" aria-hidden />}
            </span>
            <span className={`mt-2.5 text-sm font-medium ${done || active ? 'text-tertiary-900' : 'text-tertiary-600'}`}>{label}</span>
            <span className="mt-0.5 text-xs text-tertiary-500">{hint}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Settings > Account > Resignation. The employee asks to resign (an "Are you sure?" popup comes first), then follows
 * where the request is: with the reporting manager, with HR, approved (last working day) or closed.
 */
export default function ResignationCard() {
  const { pushError, pushSuccess } = useAlerts();
  const [settings, setSettings] = useState(null);
  const [requests, setRequests] = useState(null);
  const [form, setForm] = useState(null);
  const [confirm, setConfirm] = useState(null); // 'submit' | 'withdraw'
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([apiClient.get('/resignations/settings'), apiClient.get('/resignations/mine')]);
      setSettings(s.data.data);
      setRequests(r.data.data);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not load resignation details'), 'Something went wrong');
      setRequests([]);
    }
  }, [pushError]);

  useEffect(() => { load(); }, [load]);

  if (!settings || !requests) return null;
  const current = requests.find((r) => r.status === 'submitted' || r.status === 'manager_approved') || requests.find((r) => r.status === 'approved') || null;
  const last = !current ? requests[0] : null;
  if (!settings.resignation_enabled && !current) return null;

  const open = () => setForm({ reason: '', reason_category: 'other', proposed_lwd: '' });

  async function submit() {
    setBusy(true);
    try {
      await apiClient.post('/resignations', { ...form, proposed_lwd: form.proposed_lwd || undefined });
      pushSuccess('Resignation submitted. Your reporting manager will contact you.');
      setConfirm(null);
      setForm(null);
      await load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not submit the resignation'), 'Something went wrong');
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    try {
      await apiClient.post(`/resignations/${current.id}/withdraw`);
      pushSuccess('Resignation withdrawn');
      setConfirm(null);
      await load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not withdraw the resignation'), 'Something went wrong');
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  const idle = !current && !form;
  const field = 'mt-1.5 w-full rounded-lg border border-tertiary-200 bg-white px-3 py-2.5 text-sm text-tertiary-900 placeholder:text-tertiary-400 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
  const dt = 'text-xs font-medium uppercase tracking-wide text-tertiary-400';

  return (
    <section className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
      <div className="flex flex-col gap-3 border-b border-tertiary-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-sm font-semibold text-tertiary-900">Resignation</h2>
          <p className="mt-0.5 text-xs text-tertiary-500">Planning to leave? Start your resignation here. Your reporting manager speaks to you first.</p>
        </div>
        {idle && (
          <button
            type="button"
            onClick={open}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
          >
            Request resignation
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      <div className="space-y-6 px-6 py-6">
        {current ? (
          <>
            <div className="rounded-2xl border border-tertiary-100 bg-tertiary-50/50 px-4 py-6"><Steps current={STEP_OF_STATUS[current.status] ?? -1} /></div>
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className={dt}>Status</dt><dd className="mt-1"><StatusPill status={current.status} /></dd></div>
              <div>
                <dt className={dt}>{current.status === 'approved' ? 'Last working day' : 'Proposed last day'}</dt>
                <dd className="mt-1 text-sm font-medium text-tertiary-900">{current.status === 'approved' ? current.approved_lwd : (current.proposed_lwd || 'Not specified')}</dd>
              </div>
              <div><dt className={dt}>Reporting manager</dt><dd className="mt-1 text-sm text-tertiary-800">{current.manager || 'Not assigned'}</dd></div>
              <div><dt className={dt}>Reason</dt><dd className="mt-1 text-sm text-tertiary-800">{current.reason_category ? `${REASON_LABEL[current.reason_category] || current.reason_category}. ` : ''}{current.reason}</dd></div>
            </dl>
            <p className="rounded-xl bg-primary-50/60 px-4 py-3 text-sm text-tertiary-700">
              {current.status === 'submitted' && (current.manager ? `${current.manager} will meet you to understand the reason and will update the request.` : 'You have no reporting manager, so HR will review it directly.')}
              {current.status === 'manager_approved' && 'Your manager has approved it. HR will confirm your last working day.'}
              {current.status === 'approved' && 'You are now serving notice. HR will start your full and final settlement.'}
            </p>
            {current.status !== 'approved' && (
              <button type="button" className="btn-secondary" onClick={() => setConfirm('withdraw')}>Withdraw resignation</button>
            )}
          </>
        ) : form ? (
          <form onSubmit={(event) => { event.preventDefault(); setConfirm('submit'); }} className="space-y-6">
            <div>
              <h3 className="font-heading text-sm font-semibold text-tertiary-900">Resignation details</h3>
              <p className="mt-0.5 text-xs text-tertiary-500">Tell us when you plan to leave and why. Your reporting manager will review this with you before it goes to HR.</p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="resign-category" className="block text-sm font-medium text-tertiary-800">Reason category</label>
                <select id="resign-category" value={form.reason_category} onChange={(e) => setForm({ ...form, reason_category: e.target.value })} className={field}>
                  {(settings.reason_categories || []).map((key) => <option key={key} value={key}>{REASON_LABEL[key] || key}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="resign-lwd" className="block text-sm font-medium text-tertiary-800">Proposed last working day <span className="font-normal text-tertiary-400">(optional)</span></label>
                <input id="resign-lwd" type="date" min={todayYmd()} value={form.proposed_lwd} onChange={(e) => setForm({ ...form, proposed_lwd: e.target.value })} className={field} />
                <p className="mt-1.5 text-xs text-tertiary-400">Leave it empty if you are not sure. HR confirms the final date.</p>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="resign-reason" className="block text-sm font-medium text-tertiary-800">Reason for leaving <span className="text-red-500">*</span></label>
                <textarea id="resign-reason" required minLength={3} maxLength={1000} rows={5} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Share the reason so your manager can discuss it with you" className={field} />
                <p className="mt-1.5 text-right text-xs text-tertiary-400">{form.reason.length} / 1000</p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-sm text-amber-800">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>Please review before submitting. You will be asked to confirm, and you can withdraw the request until HR approves it.</p>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-tertiary-100 pt-5 sm:flex-row sm:justify-end">
              <button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className="btn-danger">Submit resignation</button>
            </div>
          </form>
        ) : (
          <>
            {last && (
              <p className="text-sm text-tertiary-600">
                Last request: <StatusPill status={last.status} />
                {last.decision_remarks ? ` · ${last.decision_remarks}` : ''}
                {last.status === 'retained' && last.manager_notes ? ` · ${last.manager_notes}` : ''}
              </p>
            )}
            <div className="rounded-2xl border border-tertiary-100 bg-tertiary-50/50 px-4 py-6"><Steps /></div>
            <ul className="grid gap-3 text-sm text-tertiary-600 sm:grid-cols-3">
              {GOOD_TO_KNOW.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-2.5">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" aria-hidden />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirm === 'submit'}
        title="Submit your resignation?"
        message="Are you sure you want to resign? This sends your resignation to your reporting manager and HR. You can withdraw it until HR approves it."
        details={[
          ['Proposed last working day', form?.proposed_lwd || 'Not specified'],
          ['Reason category', REASON_LABEL[form?.reason_category] || form?.reason_category || ''],
        ]}
        confirmLabel="Yes, submit resignation"
        danger
        busy={busy}
        onConfirm={submit}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'withdraw'}
        title="Withdraw your resignation?"
        message="Your request will be closed and you will continue as before."
        confirmLabel="Yes, withdraw"
        busy={busy}
        onConfirm={withdraw}
        onClose={() => setConfirm(null)}
      />
    </section>
  );
}
