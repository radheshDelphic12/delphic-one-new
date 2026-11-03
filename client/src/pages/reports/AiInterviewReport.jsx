import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { saveCsv } from '../../lib/saveCsv.js';
import { useAuth } from '../../lib/authContext.jsx';
import { canMoveSubmissionStage } from '../../lib/submissionStages.js';
import Pill from '../../components/ui/Pill.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';

const STATUS = {
  not_opened: { label: 'Not opened', tone: 'gray' },
  in_progress: { label: 'In progress', tone: 'blue' },
  scored: { label: 'Completed', tone: 'green' },
  pending_review: { label: 'Needs review', tone: 'amber' },
  expired: { label: 'Link expired', tone: 'red' },
};
const OUTCOME = {
  pass: { label: 'Pass', tone: 'green' },
  borderline: { label: 'Borderline', tone: 'amber' },
  below_pass: { label: 'Below pass', tone: 'red' },
};
// The submission (pipeline) status, as on the Submissions page. "Not yet submitted" = not put forward to the client yet.
const SUBMISSION_STATUS_OPTIONS = [
  { value: 'not_submitted', label: 'Not yet submitted' },
  { value: 'sourced', label: 'Sourced' },
  { value: 'internal_screening', label: 'Internal screening' },
  { value: 'submitted_to_client', label: 'Submitted to client' },
  { value: 'interview_scheduled', label: 'Interview scheduled' },
  { value: 'interview_result', label: 'Interview result' },
  { value: 'offer_sent', label: 'Offer sent' },
  { value: 'bgv', label: 'BGV' },
  { value: 'closed', label: 'Closed' },
  { value: 'backout', label: 'Backout' },
  { value: 'rejected', label: 'Rejected' },
];
const SUBMIT_FROM = ['sourced', 'internal_screening']; // a candidate who is not with the client yet may be submitted
const NO_REJECT_FROM = ['rejected', 'closed', 'backout'];
const field = 'rounded-xl border px-3 py-1.5 text-sm';
const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-tertiary-500';
// date and time in Indian time, for the moments the link was sent and the candidate started / finished
const stamp = (v) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const opt = { timeZone: 'Asia/Kolkata' };
  return { day: d.toLocaleDateString('en-GB', { ...opt, day: '2-digit', month: 'short', year: 'numeric' }), time: d.toLocaleTimeString('en-IN', { ...opt, hour: '2-digit', minute: '2-digit', hour12: true }) };
};
const csvStamp = (v) => { const t = stamp(v); return t ? `${t.day} ${t.time}` : ''; };
function When({ value, testId }) {
  const t = stamp(value);
  if (!t) return <span className="text-tertiary-400">-</span>;
  return <span data-testid={testId}>{t.day}<span className="block text-xs text-tertiary-500">{t.time}</span></span>;
}

function Stat({ label, value, tone, onClick, active }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className={`rounded-xl border bg-white p-3 text-left shadow-card transition ${onClick ? 'hover:border-primary-300' : ''} ${active ? 'border-primary-500 ring-2 ring-primary-100' : 'border-tertiary-100'}`}>
      <p className="text-xs text-tertiary-500">{label}</p>
      <p className={`mt-1 font-heading text-2xl font-semibold ${tone || 'text-tertiary-900'}`}>{value ?? '—'}</p>
    </button>
  );
}

/** Reports > AI interviews: who attempted it, for which requirement, how it went, with a link to the submission. */
export default function AiInterviewReport() {
  const { pushError, pushSuccess } = useAlerts();
  const { user } = useAuth();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [requirementId, setRequirementId] = useState('');
  const [status, setStatus] = useState('');
  const [outcome, setOutcome] = useState('');
  const [submissionStage, setSubmissionStage] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [busyIds, setBusyIds] = useState(() => new Set()); // rows with a submit / reject in flight (a second click does nothing)
  const [rejecting, setRejecting] = useState(null); // { row, reason }
  const [attempted, setAttempted] = useState(false); // every link that was sent is listed; tick to see only those who started
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [requirements, setRequirements] = useState([]);

  const params = useMemo(
    () => ({
      ...(from ? { from } : {}), ...(to ? { to } : {}),
      ...(requirementId ? { requirement_id: requirementId } : {}),
      ...(status ? { status } : {}), ...(outcome ? { outcome } : {}), ...(submissionStage ? { submission_stage: submissionStage } : {}),
      ...(attempted ? { attempted: 'yes' } : {}), ...(q.trim() ? { q: q.trim() } : {}),
    }),
    [from, to, requirementId, status, outcome, submissionStage, attempted, q]
  );

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await apiClient.get('/ai-interviews/report', { params });
        if (!live) return;
        setData(res.data.data);
        // The requirement picker lists every requirement that has an AI interview in the period, not just the one chosen.
        if (!requirementId) setRequirements(res.data.data.by_requirement.filter((r) => r.requirement_id).map((r) => ({ id: r.requirement_id, title: `${r.requirement_title}${r.client_name ? ` · ${r.client_name}` : ''}` })));
      } catch (e) {
        if (live) pushError(apiErrorMessage(e, 'Could not load the AI interview report'), 'Report failed');
      }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [params, requirementId, reloadKey, pushError]);

  const s = data?.summary;
  const pick = (key, value) => () => {
    if (key === 'status') { setStatus((cur) => (cur === value ? '' : value)); setOutcome(''); }
    else { setOutcome((cur) => (cur === value ? '' : value)); setStatus(''); }
  };

  const canAct = canMoveSubmissionStage(user);
  const canSubmit = (r) => canAct && !r.submission_locked && SUBMIT_FROM.includes(r.submission_stage);
  const canReject = (r) => canAct && !r.submission_locked && r.submission_stage && !NO_REJECT_FROM.includes(r.submission_stage);
  const setBusy = (id, on) => setBusyIds((cur) => { const next = new Set(cur); if (on) next.add(id); else next.delete(id); return next; });
  // The row shows the new status at once; the list and the summary are then read again so every count agrees.
  const showStage = (id, stage) => setData((d) => (d ? { ...d, rows: d.rows.map((r) => (r.id === id ? { ...r, submission_stage: stage } : r)) } : d));

  // Same move as on the Submissions page: a candidate still at "Sourced" goes through "Internal screening" to "Submitted to client".
  async function submitRow(r) {
    if (busyIds.has(r.id)) return;
    setBusy(r.id, true);
    try {
      for (const to_stage of r.submission_stage === 'sourced' ? ['internal_screening', 'submitted_to_client'] : ['submitted_to_client']) {
        await apiClient.post(`/submissions/${r.submission_id}/stage`, { to_stage });
        showStage(r.id, to_stage);
      }
      pushSuccess('The candidate was submitted.', 'Submitted');
    } catch (e) {
      pushError(apiErrorMessage(e, 'Could not submit the candidate'), 'Something went wrong');
    } finally {
      setBusy(r.id, false);
      setReloadKey((k) => k + 1); // show what the server really has, also after a failed second step
    }
  }

  async function rejectRow() {
    const { row, reason } = rejecting;
    if (busyIds.has(row.id) || reason.trim().length < 3) return;
    setBusy(row.id, true);
    try {
      await apiClient.post(`/submissions/${row.submission_id}/stage`, { to_stage: 'rejected', rejection_reason: reason.trim() });
      showStage(row.id, 'rejected');
      setRejecting(null);
      pushSuccess('The candidate was rejected.', 'Rejected');
    } catch (e) {
      pushError(apiErrorMessage(e, 'Could not reject the candidate'), 'Something went wrong');
    } finally {
      setBusy(row.id, false);
      setReloadKey((k) => k + 1);
    }
  }

  function exportCsv() {
    if (!data) return;
    saveCsv('ai-interviews.csv', [
      ['Candidate', 'Email', 'Requirement', 'Client', 'Interview Status', 'Submission Status', 'Score %', 'Result', 'Tab switches', 'Overridden', 'Link sent', 'Attempt started', 'Completed'],
      ...data.rows.map((r) => [r.candidate_name, r.candidate_email, r.requirement_title, r.client_name, STATUS[r.view_status]?.label, SUBMISSION_STATUS_OPTIONS.find((o) => o.value === r.submission_stage)?.label || '', r.score_percent, OUTCOME[r.outcome]?.label || '', r.tab_switches, r.overridden ? 'Yes' : '', csvStamp(r.invited_at), csvStamp(r.started_at), csvStamp(r.completed_at)]),
    ]);
  }

  return (
    <div className="space-y-4" data-testid="ai-interview-report">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card">
        <label className="text-xs font-medium text-tertiary-600">Sent from<input type="date" className={`${field} mt-1 block`} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-xs font-medium text-tertiary-600">Sent to<input type="date" className={`${field} mt-1 block`} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="text-xs font-medium text-tertiary-600">Requirement<select className={`${field} mt-1 block w-64`} value={requirementId} onChange={(e) => setRequirementId(e.target.value)}><option value="">All requirements</option>{requirements.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>
        <label className="text-xs font-medium text-tertiary-600">Interview status<select className={`${field} mt-1 block`} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label className="text-xs font-medium text-tertiary-600">Submission status<select className={`${field} mt-1 block`} aria-label="Submission status" value={submissionStage} onChange={(e) => setSubmissionStage(e.target.value)}><option value="">All</option>{SUBMISSION_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label className="text-xs font-medium text-tertiary-600">Result<select className={`${field} mt-1 block`} value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="">All</option>{Object.entries(OUTCOME).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}<option value="none">No result yet</option></select></label>
        <label className="text-xs font-medium text-tertiary-600">Search<input className={`${field} mt-1 block w-44`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Candidate, requirement…" /></label>
        <label className="flex items-center gap-2 pb-2 text-sm text-tertiary-700"><input type="checkbox" checked={attempted} onChange={(e) => setAttempted(e.target.checked)} />Only those who attempted</label>
        <button type="button" className="btn-secondary ml-auto" onClick={exportCsv} disabled={!data}>Export CSV</button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Interviews sent" value={s?.sent} />
        <Stat label="Attempted" value={s?.attempted} />
        <Stat label="Completed" value={s?.scored} onClick={pick('status', 'scored')} active={status === 'scored'} />
        <Stat label="In progress" value={s?.in_progress} onClick={pick('status', 'in_progress')} active={status === 'in_progress'} />
        <Stat label="Not opened" value={s?.not_opened} onClick={pick('status', 'not_opened')} active={status === 'not_opened'} />
        <Stat label="Pass" value={s?.pass} tone="text-green-700" onClick={pick('outcome', 'pass')} active={outcome === 'pass'} />
        <Stat label="Borderline" value={s?.borderline} tone="text-amber-700" onClick={pick('outcome', 'borderline')} active={outcome === 'borderline'} />
        <Stat label="Below pass" value={s?.below_pass} tone="text-red-700" onClick={pick('outcome', 'below_pass')} active={outcome === 'below_pass'} />
      </div>
      {s?.average_score != null && <p className="text-xs text-tertiary-500">Average score {s.average_score}%. {s.pending_review ? `${s.pending_review} need a person to review them. ` : ''}Click a number to filter the list.</p>}

      <div className="overflow-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <div className="border-b px-3 py-2 text-sm font-semibold text-tertiary-800">By requirement</div>
        <table className="min-w-full text-sm">
          <thead className="bg-tertiary-50"><tr><th className={th}>Requirement</th><th className={th}>Client</th><th className={`${th} text-right`}>Sent</th><th className={`${th} text-right`}>Attempted</th><th className={`${th} text-right`}>Pass</th><th className={`${th} text-right`}>Borderline</th><th className={`${th} text-right`}>Below pass</th><th className={`${th} text-right`}>Avg score</th></tr></thead>
          <tbody>
            {(data?.by_requirement || []).map((r) => (
              <tr key={r.requirement_id || 'none'} className="cursor-pointer border-t hover:bg-primary-50/40" onClick={() => r.requirement_id && setRequirementId(r.requirement_id)}>
                <td className="px-3 py-2 font-medium text-tertiary-900">{r.requirement_title}</td>
                <td className="px-3 py-2 text-tertiary-600">{r.client_name || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.sent}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.attempted}</td>
                <td className="px-3 py-2 text-right tabular-nums text-green-700">{r.pass}</td>
                <td className="px-3 py-2 text-right tabular-nums text-amber-700">{r.borderline}</td>
                <td className="px-3 py-2 text-right tabular-nums text-red-700">{r.below_pass}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.average_score != null ? `${r.average_score}%` : '—'}</td>
              </tr>
            ))}
            {data && data.by_requirement.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-tertiary-500">No AI interviews match these filters.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="overflow-auto rounded-2xl border border-tertiary-100 bg-white shadow-card" style={{ maxHeight: '60vh' }}>
        <div className="sticky left-0 border-b px-3 py-2 text-sm font-semibold text-tertiary-800">Candidates{data ? ` (${data.rows.length})` : ''}</div>
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-tertiary-50"><tr><th className={th}>Candidate</th><th className={th}>Requirement</th><th className={th}>Interview Status</th><th className={th}>Submission Status</th><th className={`${th} text-right`}>Score</th><th className={th}>Result</th><th className={th}>Notes</th><th className={th}>Link sent</th><th className={th}>Attempt started</th><th className={th}>Completed</th><th className={th} /></tr></thead>
          <tbody>
            {(data?.rows || []).map((r) => (
              <tr key={r.id} className="border-t hover:bg-primary-50/40">
                <td className="px-3 py-2"><span className="font-medium text-tertiary-900">{r.candidate_name}</span>{r.candidate_email && <span className="block text-xs text-tertiary-500">{r.candidate_email}</span>}</td>
                <td className="px-3 py-2"><span className="text-tertiary-800">{r.requirement_title || '—'}</span>{r.client_name && <span className="block text-xs text-tertiary-500">{r.client_name}</span>}</td>
                <td className="px-3 py-2"><Pill tone={STATUS[r.view_status]?.tone}>{STATUS[r.view_status]?.label}</Pill></td>
                <td className="px-3 py-2" data-testid="submission-status">{r.submission_stage ? <Badge value={r.submission_stage} /> : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.score_percent != null ? `${r.score_percent}%` : '—'}</td>
                <td className="px-3 py-2">{r.outcome ? <Pill tone={OUTCOME[r.outcome]?.tone}>{OUTCOME[r.outcome]?.label}</Pill> : '—'}</td>
                <td className="px-3 py-2 text-xs text-tertiary-500">{[r.overridden && 'Decision changed by a person', r.auto_rejected && 'Auto-rejected', r.tab_switches > 0 && `${r.tab_switches} tab switch${r.tab_switches === 1 ? '' : 'es'}`, r.recording && 'Recorded'].filter(Boolean).join(' · ') || '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-tertiary-600"><When value={r.invited_at} testId="ai-sent-at" />{r.invited_by_name && <span className="block text-xs text-tertiary-400">by {r.invited_by_name}</span>}</td>
                <td className="whitespace-nowrap px-3 py-2 text-tertiary-600"><When value={r.started_at} testId="ai-started-at" /></td>
                <td className="whitespace-nowrap px-3 py-2 text-tertiary-600"><When value={r.completed_at} testId="ai-completed-at" /></td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {canSubmit(r) && <button type="button" data-testid="report-submit" className="btn-primary px-2.5 py-1 text-xs" disabled={busyIds.has(r.id)} onClick={() => submitRow(r)}>{busyIds.has(r.id) ? 'Please wait…' : 'Submit'}</button>}
                    {canReject(r) && <button type="button" data-testid="report-reject" className="rounded-xl border border-danger-200 px-2.5 py-1 text-xs font-medium text-danger-700 hover:bg-danger-50 disabled:opacity-50" disabled={busyIds.has(r.id)} onClick={() => setRejecting({ row: r, reason: '' })}>Reject</button>}
                    <Link to={`/submissions/${r.submission_id}`} className="text-sm font-medium text-primary-700 hover:underline">Open submission</Link>
                  </div>
                </td>
              </tr>
            ))}
            {data && data.rows.length === 0 && <tr><td colSpan={11} className="px-3 py-8 text-center text-sm text-tertiary-500">No AI interview matches this selection.</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal
        open={Boolean(rejecting)}
        title="Reject this candidate?"
        onClose={() => (rejecting && busyIds.has(rejecting.row.id) ? undefined : setRejecting(null))}
        footer={(
          <>
            <button type="button" className="btn-secondary" disabled={rejecting && busyIds.has(rejecting.row.id)} onClick={() => setRejecting(null)}>Cancel</button>
            <button type="button" data-testid="confirm-reject" className="btn-danger" disabled={!rejecting || rejecting.reason.trim().length < 3 || busyIds.has(rejecting.row.id)} onClick={rejectRow}>{rejecting && busyIds.has(rejecting.row.id) ? 'Rejecting…' : 'Reject candidate'}</button>
          </>
        )}
      >
        {rejecting && (
          <div className="space-y-3">
            <p className="text-tertiary-700">{rejecting.row.candidate_name} will be moved to Rejected on the submission{rejecting.row.requirement_title ? ` for ${rejecting.row.requirement_title}` : ''}. Their AI interview result stays as it is.</p>
            <label className="block text-xs font-medium text-tertiary-600">Reason (required, saved with the submission)
              <textarea data-testid="reject-reason" rows={3} maxLength={500} className={`${field} mt-1 block w-full`} value={rejecting.reason} onChange={(e) => setRejecting((cur) => ({ ...cur, reason: e.target.value }))} />
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
