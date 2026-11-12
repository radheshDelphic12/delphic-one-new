import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Undo2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../components/ui/Drawer.jsx';
import { canMoveSubmissionBackward, canMoveSubmissionStage } from '../../lib/submissionStages.js';
import { formatStageLabel, shortKey } from '../pipeline/pipelineBoardUtils.js';

const PAGE_SIZE = 25;
const INPUT_CLASS =
  'mt-1 w-full rounded-md border border-tertiary-200 px-2.5 py-1.5 text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100';
const dateOf = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/**
 * Every rejected candidate in one place (sidebar > Rejected). A rejected submission is not on the Pipeline at all: it leaves the Candidates board
 * the moment it is rejected (from the ⋯ menu on that board) and is listed here with who, why and when.
 * An admin can reactivate one, which puts it back at "Sourced" on the Candidate pipeline.
 */
export default function RejectedCandidatesPage() {
  const { user } = useAuth();
  const { pushError, pushSuccess } = useAlerts();
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const canReactivate = canMoveSubmissionStage(user) && canMoveSubmissionBackward(user);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/submissions', { params: { stage: 'rejected', sort_by: 'created_at', sort_order: 'desc', limit: PAGE_SIZE, page, ...(search ? { search } : {}) } });
      setRows(data.data || []);
      setPagination(data.pagination || { page, total: (data.data || []).length, totalPages: 1 });
    } catch (err) {
      setRows([]);
      pushError(apiErrorMessage(err, 'Failed to load rejected candidates'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [page, search, pushError]);

  useEffect(() => {
    load();
  }, [load]);

  async function reactivate(event) {
    event.preventDefault();
    if (!target) return;
    setSaving(true);
    try {
      await apiClient.post(`/submissions/${target.id}/stage`, { to_stage: 'sourced', reason: reason.trim() });
      pushSuccess(`${target.profile?.name || 'Candidate'} is back in the Candidate pipeline at Sourced`);
      setTarget(null);
      setReason('');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to reactivate the candidate'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-base font-semibold text-tertiary-900">Rejected candidates</h2>
          <p className="mt-1 text-sm text-tertiary-500">
            Rejected candidates are taken off the Candidate pipeline and kept here. To reject someone, use the ⋯ menu on their card in{' '}
            <Link to="/pipeline?view=candidates" className="font-medium text-primary-700 hover:underline">Candidates</Link>.
          </p>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSearch(draftSearch.trim());
          }}
        >
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary-400" />
            <input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Search name or job" className="w-56 rounded-lg border border-tertiary-200 py-1.5 pl-8 pr-2 text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100" />
          </label>
          <button type="submit" className="btn-secondary">Search</button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-tertiary-100 bg-tertiary-50/60 text-xs uppercase tracking-wide text-tertiary-500">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Candidate</th>
              <th className="px-4 py-2.5 font-semibold">Job · client</th>
              <th className="px-4 py-2.5 font-semibold">Rejected at</th>
              <th className="px-4 py-2.5 font-semibold">Reason</th>
              <th className="px-4 py-2.5 font-semibold">Recruiter</th>
              <th className="px-4 py-2.5 font-semibold">Rejected on</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-tertiary-100">
            {loading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-tertiary-400">Loading rejected candidates…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-tertiary-400">{search ? 'No rejected candidate matches this search.' : 'No rejected candidates.'}</td></tr>
            )}
            {!loading && rows.map((submission) => (
              <tr key={submission.id} className="align-top hover:bg-tertiary-50/60">
                <td className="px-4 py-2.5">
                  <Link to={`/submissions/${submission.id}`} className="font-medium text-primary-700 hover:underline">{submission.profile?.name || 'Candidate'}</Link>
                  <div className="font-mono text-[10px] text-tertiary-400">{shortKey('SUB', submission.id)}</div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="text-tertiary-800">{submission.requirement?.title || '—'}</div>
                  <div className="text-xs text-tertiary-500">{submission.requirement?.account_name || ''}</div>
                </td>
                <td className="px-4 py-2.5 text-tertiary-700">{submission.rejection_stage ? formatStageLabel(submission.rejection_stage) : '—'}</td>
                <td className="max-w-xs px-4 py-2.5 text-tertiary-700">{submission.rejection_reason || '—'}</td>
                <td className="px-4 py-2.5 text-tertiary-700">{submission.submitted_by?.name || '—'}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-tertiary-700">{dateOf(submission.updated_at)}</td>
                <td className="px-4 py-2.5 text-right">
                  {canReactivate && !submission.is_locked && (
                    <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => { setTarget(submission); setReason(''); }}>
                      <Undo2 className="h-3.5 w-3.5" /> Reactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-tertiary-500">
          <span>{pagination.total} rejected · page {pagination.page} of {pagination.totalPages}</span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button type="button" className="btn-secondary" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}

      <Drawer
        open={Boolean(target)}
        title="Reactivate candidate"
        onClose={() => !saving && setTarget(null)}
        size="sm"
        tone="edit"
        footer={
          <>
            <button type="button" onClick={() => setTarget(null)} disabled={saving} className="btn-secondary">Cancel</button>
            <button type="submit" form="reactivate-candidate-form" disabled={saving || !reason.trim()} className="btn-primary">{saving ? 'Reactivating…' : 'Reactivate'}</button>
          </>
        }
      >
        <form id="reactivate-candidate-form" onSubmit={reactivate} className="space-y-3">
          <p className="text-sm text-tertiary-600">
            <span className="font-medium">{target?.profile?.name}</span> goes back to the Candidate pipeline at <span className="font-medium">Sourced</span>.
          </p>
          <label className="block text-xs font-medium text-tertiary-600">
            Reason
            <textarea required rows={3} value={reason} onChange={(event) => setReason(event.target.value)} className={INPUT_CLASS} />
          </label>
        </form>
      </Drawer>
    </div>
  );
}
