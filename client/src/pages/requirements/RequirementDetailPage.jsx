import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Modal from '../../components/ui/Modal.jsx';
import DetailSkeleton from '../../components/ui/DetailSkeleton.jsx';
import Breadcrumbs from '../../components/ui/Breadcrumbs.jsx';
import Tooltip from '../../components/ui/Tooltip.jsx';
import NotesPanel from '../../components/NotesPanel.jsx';
import FilesPanel from '../../components/FilesPanel.jsx';
import UnlockButton from '../../components/UnlockButton.jsx';
import DeleteRecordButton from '../../components/DeleteRecordButton.jsx';
import { userCan } from '../../lib/permissions.js';
import RequirementFormPage from './RequirementFormPage.jsx';
import AssignRecruiterDrawer from './AssignRecruiterDrawer.jsx';
import { canAssignRecruiters } from '../profiles/profileUtils.js';
import {
  canChangeSeatStage,
  canMutateRequirement,
  canOverrideRequirementStatus,
  nextRequirementStatuses,
  nextSeatStatuses,
  requiresDropReason,
  requiresJoinedAt,
} from '../../lib/requirementStages.js';
import RequirementStatusOverrideDrawer from './RequirementStatusOverrideDrawer.jsx';

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
}

export default function RequirementDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editOpen, setEditOpen] = useState(searchParams.get('edit') === '1');
  const [requirement, setRequirement] = useState(null);
  const [seats, setSeats] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [taggedProfiles, setTaggedProfiles] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [statusModal, setStatusModal] = useState(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [seatModal, setSeatModal] = useState(null);
  const [reason, setReason] = useState('');
  const [joinedAt, setJoinedAt] = useState('');
  const [addSeatOpen, setAddSeatOpen] = useState(false);
  const [seatLabel, setSeatLabel] = useState('');
  const [assignRole, setAssignRole] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reqRes, seatsRes, assignRes, histRes, subsRes] = await Promise.all([
        apiClient.get(`/requirements/${id}`),
        apiClient.get(`/requirements/${id}/seats`),
        apiClient.get(`/requirements/${id}/assignments`),
        apiClient.get(`/requirements/${id}/history`),
        apiClient.get('/submissions', { params: { requirement_id: id, limit: 100, sort_by: 'created_at', sort_order: 'desc' } }),
      ]);
      setRequirement(reqRes.data.data);
      setSeats(seatsRes.data.data || []);
      setAssignments(assignRes.data.data || []);
      setHistory(histRes.data.data || []);
      setTaggedProfiles(subsRes.data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load requirement'), 'Something went wrong');
      setRequirement(null);
    } finally {
      setLoading(false);
    }
  }, [id, pushError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (searchParams.get('edit') === '1') setEditOpen(true);
  }, [searchParams]);

  function closeEdit() {
    setEditOpen(false);
    if (searchParams.get('edit')) {
      searchParams.delete('edit');
      setSearchParams(searchParams, { replace: true });
    }
  }

  const canEdit = canMutateRequirement(requirement, user);
  const canSeat = canChangeSeatStage(user);
  const canOverrideStatus = canOverrideRequirementStatus(user);
  const locked = Boolean(requirement?.is_locked);

  async function applyStatusOverride(body) {
    setBusy(true);
    try {
      await apiClient.post(`/requirements/${id}/status/override`, body);
      setOverrideOpen(false);
      await load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Status override failed'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function confirmRequirementStatus() {
    if (!statusModal) return;
    setBusy(true);
    try {
      const body = { to_status: statusModal };
      if (requiresDropReason(statusModal)) body.reason = reason.trim();
      await apiClient.post(`/requirements/${id}/status`, body);
      setStatusModal(null);
      setReason('');
      await load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Status change failed'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function confirmSeatStage() {
    if (!seatModal) return;
    setBusy(true);
    try {
      const body = { to_status: seatModal.toStatus };
      if (requiresDropReason(seatModal.toStatus)) body.reason = reason.trim();
      if (requiresJoinedAt(seatModal.toStatus)) body.joined_at = joinedAt || new Date().toISOString();
      await apiClient.post(`/seats/${seatModal.seatId}/stage`, body);
      setSeatModal(null);
      setReason('');
      setJoinedAt('');
      await load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Seat stage change failed'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function confirmAddSeat() {
    setBusy(true);
    try {
      await apiClient.post(`/requirements/${id}/seats`, {
        seat_label: seatLabel.trim() || undefined,
      });
      setAddSeatOpen(false);
      setSeatLabel('');
      await load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to add seat'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  function openStatus(toStatus) {
    setReason('');
    setStatusModal(toStatus);
  }

  function openSeat(seat, toStatus) {
    setReason('');
    setJoinedAt(new Date().toISOString().slice(0, 10));
    setSeatModal({ seatId: seat.id, seatLabel: seat.seat_label || seat.id.slice(0, 8), toStatus });
  }

  if (loading) return <DetailSkeleton />;
  if (!requirement) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-tertiary-600">Requirement not found or could not be loaded.</p>
        <Link to="/requirements" className="text-sm text-primary-600 hover:underline">
          ← Back to requirements
        </Link>
      </div>
    );
  }

  const nextStatuses = nextRequirementStatuses(requirement.status);
  const activeAssignments = assignments.filter((a) => !a.unassigned_at);

  const seatColumns = [
    {
      key: 'seat_label',
      header: 'Seat',
      render: (s) => s.seat_label || s.id.slice(0, 8),
    },
    {
      key: 'seat_status',
      header: 'Status',
      render: (s) => <Badge value={s.seat_status} />,
    },
    {
      key: 'subs',
      header: 'Submissions',
      render: (s) => `${s.active_submissions_count || 0} active / ${s.submissions_count || 0} total`,
    },
    {
      key: 'joined_at',
      header: 'Joined',
      render: (s) => formatDate(s.joined_at),
    },
    {
      key: 'actions',
      header: 'Move stage',
      render: (s) => {
        if (s.is_locked) {
          return (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-tertiary-400">Locked</span>
              {user?.role === 'admin' && (
                <UnlockButton entityType="seat" entityId={s.id} onUnlocked={load} label="Unlock seat" />
              )}
            </div>
          );
        }
        if (!canSeat) {
          return <span className="text-xs text-tertiary-400">—</span>;
        }
        const next = nextSeatStatuses(s.seat_status);
        if (!next.length) return <span className="text-xs text-tertiary-400">—</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {next.map((to) => (
              <Tooltip
                key={to}
                label={
                  requiresDropReason(to)
                    ? 'Requires a reason'
                    : requiresJoinedAt(to)
                      ? 'Requires a joined date'
                      : `Move this seat to ${to.replace(/_/g, ' ')}`
                }
              >
                <button
                  type="button"
                  className={`text-xs ${to === 'dropped' ? 'btn-danger px-2 py-1' : 'btn-secondary px-2 py-1'}`}
                  onClick={() => openSeat(s, to)}
                >
                  → {to.replace(/_/g, ' ')}
                </button>
              </Tooltip>
            ))}
          </div>
        );
      },
    },
  ];

  const taggedColumns = [
    {
      key: 'profile',
      header: 'Candidate',
      render: (row) =>
        row.profile?.id ? (
          <Link to={`/profiles/${row.profile.id}`} className="font-medium text-primary-700 hover:underline">
            {row.profile.name}
          </Link>
        ) : (
          row.profile?.name || '—'
        ),
    },
    { key: 'stage', header: 'Stage', render: (row) => <Badge value={row.stage} /> },
    { key: 'seat', header: 'Seat', render: (row) => row.seat?.seat_label || '—' },
    { key: 'submitted_by', header: 'Recruiter', render: (row) => row.submitted_by?.name || '—' },
    { key: 'created_at', header: 'Tagged on', render: (row) => formatDate(row.created_at) },
    {
      key: 'open',
      header: '',
      render: (row) => (
        <Link to={`/submissions/${row.id}`} className="text-xs font-medium text-primary-700 hover:underline">
          Open submission
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Breadcrumbs
            items={[
              { label: 'Requirements', to: '/requirements' },
              { label: requirement.title },
            ]}
          />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-xl font-semibold text-tertiary-900">{requirement.title}</h1>
            <Badge value={requirement.status} />
            <Badge value={requirement.priority} />
            {locked && <span className="rounded bg-tertiary-100 px-2 py-0.5 text-xs text-tertiary-600">Locked</span>}
          </div>
          <p className="mt-1 text-sm text-tertiary-500">
            {requirement.account?.name || '—'} · {requirement.req_type?.replace(/_/g, ' ')} · Seats{' '}
            {requirement.seats_closed ?? 0}/{requirement.seats_total}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && !locked && (
            <button type="button" className="btn-secondary" onClick={() => setEditOpen(true)}>
              Edit
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={() => setAssignRole('recruiter')}>
            {canAssignRecruiters(user, requirement) ? 'Assign recruiter team' : 'View recruiter team'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setAssignRole('vendor_team')}>
            {canAssignRecruiters(user, requirement) ? 'Assign vendor team' : 'View vendor team'}
          </button>
          <Link to={`/requirements/${id}/board`} className="btn-secondary">
            Pipeline board
          </Link>
          {canEdit && !locked && (
            <button type="button" className="btn-primary" onClick={() => setAddSeatOpen(true)}>
              + Add seat
            </button>
          )}
          {user?.role === 'admin' && locked && (
            <UnlockButton entityType="requirement" entityId={requirement.id} onUnlocked={load} />
          )}
          {userCan(user, 'deleteRecords') && (
            <DeleteRecordButton
              entityType="requirement"
              entityId={requirement.id}
              entityLabel={`Requirement - ${requirement.title}`}
              onDeleted={() => navigate('/requirements')}
            />
          )}
        </div>
      </div>

      {locked && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          This requirement is locked. It remains available for viewing.
          {user?.role === 'admin' ? ' Use Unlock to allow edits again.' : ''}
        </div>
      )}

      {/* Status controls */}
      <section className="rounded-lg border bg-white p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold text-tertiary-800">Requirement status</h2>
          {canOverrideStatus && (
            <button type="button" className="btn-secondary text-xs" onClick={() => setOverrideOpen(true)}>
              Override status…
            </button>
          )}
        </div>
        {locked || !canEdit ? (
          <p className="mt-2 text-sm text-tertiary-500">
            {locked ? 'This requirement is locked. Admin unlock is required to change status.' : 'Only the sales owner or admin can change status.'}
          </p>
        ) : nextStatuses.length === 0 ? (
          <p className="mt-2 text-sm text-tertiary-500">No further transitions.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {nextStatuses.map((to) => (
              <Tooltip
                key={to}
                label={
                  to === 'closed'
                    ? 'All seats must already be closed or dropped'
                    : requiresDropReason(to)
                      ? 'Requires a reason'
                      : `Move this requirement to ${to.replace(/_/g, ' ')}`
                }
              >
                <button
                  type="button"
                  className={to === 'dropped' ? 'btn-danger' : 'btn-secondary'}
                  onClick={() => openStatus(to)}
                >
                  Move to {to.replace(/_/g, ' ')}
                </button>
              </Tooltip>
            ))}
          </div>
        )}
      </section>

      {canOverrideStatus && (
        <RequirementStatusOverrideDrawer
          requirement={requirement}
          open={overrideOpen}
          saving={busy}
          onClose={() => setOverrideOpen(false)}
          onMove={applyStatusOverride}
        />
      )}

      {/* Info panels */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border bg-white p-4">
          <h2 className="text-sm font-semibold text-tertiary-800">Job details</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <dt className="text-tertiary-500">Type</dt>
            <dd className="capitalize">{requirement.req_type?.replace(/_/g, ' ') || '—'}</dd>
            <dt className="text-tertiary-500">Designation</dt>
            <dd>{requirement.designation || '—'}</dd>
            <dt className="text-tertiary-500">Department</dt>
            <dd>{requirement.department || '—'}</dd>
            <dt className="text-tertiary-500">Experience</dt>
            <dd>
              {requirement.experience_min ?? '—'}–{requirement.experience_max ?? '—'} yrs
            </dd>
            <dt className="text-tertiary-500">Work mode</dt>
            <dd className="capitalize">{requirement.work_mode?.replace(/_/g, ' ') || '—'}</dd>
            <dt className="text-tertiary-500">Location</dt>
            <dd>{requirement.work_location || '—'}</dd>
            <dt className="text-tertiary-500">Time zone</dt>
            <dd>{requirement.time_zone_preference || '—'}</dd>
            <dt className="text-tertiary-500">Engagement</dt>
            <dd className="capitalize">{requirement.engagement_type?.replace(/_/g, ' ') || '—'}</dd>
            <dt className="text-tertiary-500">Contract duration</dt>
            <dd>{requirement.contract_duration_months != null ? `${requirement.contract_duration_months} months` : '—'}</dd>
            <dt className="text-tertiary-500">Budget</dt>
            <dd>
              {requirement.budget_min ?? '—'}–{requirement.budget_max ?? '—'} {requirement.budget_currency || ''}{' '}
              {requirement.budget_type ? `(${requirement.budget_type.replace(/_/g, ' ')})` : ''}
            </dd>
            <dt className="text-tertiary-500">SLA</dt>
            <dd>{requirement.sla_days != null ? `${requirement.sla_days} days` : '—'}</dd>
            <dt className="text-tertiary-500">Start target</dt>
            <dd>{formatDate(requirement.start_date_target)}</dd>
            <dt className="text-tertiary-500">Notice period max</dt>
            <dd>{requirement.notice_period_max_days != null ? `${requirement.notice_period_max_days} days` : '—'}</dd>
            <dt className="text-tertiary-500">Sales owner</dt>
            <dd>{requirement.sales_owner?.name || '—'}</dd>
          </dl>
          {requirement.description && (
            <p className="mt-3 whitespace-pre-wrap border-t pt-3 text-sm text-tertiary-700">{requirement.description}</p>
          )}
          {requirement.billing_notes && (
            <div className="mt-3 border-t pt-3">
              <p className="text-xs font-medium text-tertiary-500">Billing notes</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-tertiary-700">{requirement.billing_notes}</p>
            </div>
          )}
        </section>

        <section className="rounded-lg border bg-white p-4">
          <h2 className="text-sm font-semibold text-tertiary-800">Skills & assignees</h2>
          <div className="mt-3">
            <p className="text-xs font-medium text-tertiary-500">Primary stack</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {(requirement.primary_tech_stack || []).length === 0 && <span className="text-sm text-tertiary-400">—</span>}
              {(requirement.primary_tech_stack || []).map((t) => (
                <span key={t} className="rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700">
                  {t}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-3">
            <p className="text-xs font-medium text-tertiary-500">Secondary stack</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {(requirement.secondary_tech_stack || []).length === 0 && <span className="text-sm text-tertiary-400">—</span>}
              {(requirement.secondary_tech_stack || []).map((t) => (
                <span key={t} className="rounded-full bg-tertiary-100 px-2 py-0.5 text-xs text-tertiary-700">
                  {t}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-3">
            <p className="text-xs font-medium text-tertiary-500">Certifications required</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {(requirement.certifications_required || []).length === 0 && <span className="text-sm text-tertiary-400">—</span>}
              {(requirement.certifications_required || []).map((c) => (
                <span key={c} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                  {c}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-3">
            <p className="text-xs font-medium text-tertiary-500">Domain experience</p>
            <p className="mt-1 text-sm text-tertiary-700">{requirement.domain_experience || '—'}</p>
          </div>
          <div className="mt-3">
            <p className="text-xs font-medium text-tertiary-500">Assigned recruiter team</p>
            <ul className="mt-1 space-y-1 text-sm">
              {(requirement.assigned_recruiters || []).length === 0 && (
                <li className="text-tertiary-400">None yet - use Assign recruiter team above</li>
              )}
              {(requirement.assigned_recruiters || []).map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-tertiary-100 text-xs font-medium">
                    {r.name.slice(0, 2).toUpperCase()}
                  </span>
                  {r.name}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-3">
            <p className="text-xs font-medium text-tertiary-500">Assigned vendor team</p>
            <ul className="mt-1 space-y-1 text-sm">
              {(requirement.assigned_vendor_team || []).length === 0 && (
                <li className="text-tertiary-400">None yet - use Assign vendor team above</li>
              )}
              {(requirement.assigned_vendor_team || []).map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-tertiary-100 text-xs font-medium">
                    {r.name.slice(0, 2).toUpperCase()}
                  </span>
                  {r.name}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-4">
            <p className="text-xs font-medium text-tertiary-500">Assignment history</p>
            <ul className="mt-1 max-h-40 space-y-1 overflow-auto text-xs text-tertiary-600">
              {assignments.length === 0 && <li className="text-tertiary-400">No assignments</li>}
              {assignments.map((a) => (
                <li key={a.id}>
                  {a.user?.name} ({a.role_on_req?.replace(/_/g, ' ')}) - {formatDate(a.assigned_at)}
                  {a.unassigned_at ? ` → ended ${formatDate(a.unassigned_at)}` : ' · active'}
                </li>
              ))}
            </ul>
            {activeAssignments.length > 0 && (
              <p className="mt-1 text-xs text-tertiary-400">{activeAssignments.length} active assignment(s)</p>
            )}
          </div>
        </section>
      </div>

      {requirement.job_description && (
        <section className="rounded-lg border bg-white p-4">
          <h2 className="text-sm font-semibold text-tertiary-800">Job description</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm text-tertiary-700">{requirement.job_description}</p>
        </section>
      )}

      {/* Seats */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-tertiary-800">Seats</h2>
          <span className="text-xs text-tertiary-500">{seats.length} seat(s)</span>
        </div>
        <DataTable columns={seatColumns} rows={seats} emptyLabel="No seats yet" />
        <p className="text-xs text-tertiary-400">
          Seat path: open → interviewing → offer → bgv → closed (joined date required). Drop needs a reason.
        </p>
      </section>

      {/* Tagged profiles */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-tertiary-800">Tagged profiles</h2>
          <span className="text-xs text-tertiary-500">{taggedProfiles.length} candidate(s)</span>
        </div>
        <DataTable
          columns={taggedColumns}
          rows={taggedProfiles}
          emptyLabel="No candidates tagged to this requirement yet"
        />
        {user?.role === 'recruiter' && (
          <p className="text-xs text-tertiary-400">You only see candidates you submitted.</p>
        )}
      </section>

      {/* History */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="text-sm font-semibold text-tertiary-800">Status history</h2>
        <ul className="mt-2 space-y-1 text-sm text-tertiary-700">
          {history.length === 0 && <li className="text-tertiary-400">No status changes yet</li>}
          {history.map((h) => (
            <li key={h.id}>
              <span className="capitalize">{h.from_stage?.replace(/_/g, ' ') || '—'}</span>
              {' → '}
              <span className="capitalize font-medium">{h.to_stage?.replace(/_/g, ' ')}</span>
              <span className="text-tertiary-400"> · {formatDate(h.changed_at)}</span>
              <span className="text-tertiary-500"> · {h.changed_by?.name || 'Unknown'}</span>
              {h.reason && <span className="text-tertiary-500"> - {h.reason}</span>}
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <NotesPanel entityType="requirement" entityId={requirement.id} />
        <FilesPanel
          entityType="requirement"
          entityId={requirement.id}
          canUpload={canEdit && !locked}
          defaultLabel="Job document"
        />
      </div>

      {/* Requirement status confirmation */}
      <Modal
        open={Boolean(statusModal)}
        title={`Move requirement to ${statusModal?.replace(/_/g, ' ') || ''}`}
        onClose={() => !busy && setStatusModal(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setStatusModal(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || (requiresDropReason(statusModal) && !reason.trim())}
              onClick={confirmRequirementStatus}
            >
              Confirm
            </button>
          </>
        }
      >
        {statusModal === 'closed' && (
          <p className="mb-2 text-tertiary-600">All seats must already be closed or dropped.</p>
        )}
        {requiresDropReason(statusModal) && (
          <div>
            <label className="mb-1 block text-xs font-medium text-tertiary-500">Reason *</label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder="Why is this being dropped?"
            />
          </div>
        )}
        {!requiresDropReason(statusModal) && statusModal !== 'closed' && (
          <p className="text-tertiary-600">Confirm moving this requirement to {statusModal?.replace(/_/g, ' ')}.</p>
        )}
      </Modal>

      {/* Seat stage confirmation */}
      <Modal
        open={Boolean(seatModal)}
        title={`Move ${seatModal?.seatLabel || 'seat'} → ${seatModal?.toStatus?.replace(/_/g, ' ') || ''}`}
        onClose={() => !busy && setSeatModal(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setSeatModal(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={
                busy ||
                (requiresDropReason(seatModal?.toStatus) && !reason.trim()) ||
                (requiresJoinedAt(seatModal?.toStatus) && !joinedAt)
              }
              onClick={confirmSeatStage}
            >
              Confirm
            </button>
          </>
        }
      >
        {requiresDropReason(seatModal?.toStatus) && (
          <div>
            <label className="mb-1 block text-xs font-medium text-tertiary-500">Reason *</label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
        )}
        {requiresJoinedAt(seatModal?.toStatus) && (
          <div>
            <label className="mb-1 block text-xs font-medium text-tertiary-500">Joined date *</label>
            <input
              type="date"
              value={joinedAt}
              onChange={(e) => setJoinedAt(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
        )}
        {!requiresDropReason(seatModal?.toStatus) && !requiresJoinedAt(seatModal?.toStatus) && (
          <p className="text-tertiary-600">Confirm this seat stage change.</p>
        )}
      </Modal>

      {/* Add seat confirmation */}
      <Modal
        open={addSeatOpen}
        title="Add seat"
        onClose={() => !busy && setAddSeatOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setAddSeatOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={confirmAddSeat}>
              Add seat
            </button>
          </>
        }
      >
        <label className="mb-1 block text-xs font-medium text-tertiary-500">Label (optional)</label>
        <input
          value={seatLabel}
          onChange={(e) => setSeatLabel(e.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm"
          placeholder="e.g. Seat 3 - Backend"
        />
      </Modal>

      <Drawer open={editOpen} title="Edit requirement" onClose={closeEdit} size="xl" tone="edit">
        {editOpen && (
          <RequirementFormPage
            asPanel
            onCancel={closeEdit}
            onDone={() => {
              closeEdit();
              load();
            }}
          />
        )}
      </Drawer>

      {assignRole && requirement && (
        <AssignRecruiterDrawer
          requirement={requirement}
          role={assignRole}
          onClose={() => {
            setAssignRole(null);
            load();
          }}
        />
      )}
    </div>
  );
}
