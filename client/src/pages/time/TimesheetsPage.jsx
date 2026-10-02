import { useEffect, useState } from 'react';
import { Clock, Plus } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useLeaveDay } from '../../lib/useLeaveDay.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import LeaveDayNotice from './LeaveDayNotice.jsx';
import RegularisationSection from './RegularisationSection.jsx';
import NoteText from '../../components/NoteText.jsx';
import WeekHoursView from './WeekHoursView.jsx';

const STATUS_LABEL = { submitted: 'Pending', approved: 'Approved', rejected: 'Rejected' };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Non-IT timesheet: Date, Hours and Notes. If you are allocated to projects (or a team mate of someone
// who is) you can also pick the project the hours belong to; without one it is general time.
function EntryDrawer({ open, onClose, onSubmit, projects }) {
  const [fields, setFields] = useState({ date: todayIso(), hours: '', notes: '', account_id: '' });
  const [saving, setSaving] = useState(false);
  const leave = useLeaveDay(open ? fields.date : null);

  useEffect(() => {
    if (open) setFields({ date: todayIso(), hours: '', notes: '', account_id: '' });
  }, [open]);

  function set(key, value) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit({ date: fields.date, hours: Number(fields.hours), notes: fields.notes.trim() || undefined, ...(fields.account_id ? { account_id: fields.account_id } : {}) });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      title="Log time"
      onClose={onClose}
      size="sm"
      tone="create"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="timesheet-entry-form" className="btn-primary" disabled={saving || !fields.hours || leave.is_leave_day}>
            {saving ? 'Saving…' : 'Log time'}
          </button>
        </>
      }
    >
      <form id="timesheet-entry-form" onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-tertiary-600">
          Date
          <input required type="date" max={todayIso()} value={fields.date} onChange={(e) => set('date', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
        </label>
        <LeaveDayNotice leave={leave} />
        {projects.length > 0 && (
          <label className="block text-xs font-medium text-tertiary-600">
            Project
            <select value={fields.account_id} onChange={(e) => set('account_id', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
              <option value="">No project (general time)</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <label className="block text-xs font-medium text-tertiary-600">
          Hours
          <input required type="number" min="0.5" max={leave.work_capacity ?? 24} step="0.5" value={fields.hours} onChange={(e) => set('hours', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
        </label>
        <label className="block text-xs font-medium text-tertiary-600">
          Notes
          <textarea value={fields.notes} onChange={(e) => set('notes', e.target.value)} rows={3} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
        </label>
      </form>
    </Drawer>
  );
}

/**
 * Self-service timesheet for everyone outside IT (IT staff use the project
 * grid instead). Entries go to your reporting manager for approval; weeks
 * lock automatically on Saturday 00:00 — later corrections go through
 * Timesheet Regularisation. Team-wide oversight lives in Team Monitoring.
 */
export default function TimesheetsPage() {
  const { pushError, pushInfo } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [entryDrawerOpen, setEntryDrawerOpen] = useState(false);
  const [weekKey, setWeekKey] = useState(0);
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    apiClient.get('/timesheets/my-projects').then(({ data }) => setProjects(data.data || [])).catch(() => setProjects([]));
  }, []);

  async function loadEntries() {
    setLoading(true);
    setWeekKey((k) => k + 1);
    try {
      const { data } = await apiClient.get('/timesheets/entries/me', { params: { limit: 50 } });
      setRows(data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load timesheets'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadEntries(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function createEntry(payload) {
    try {
      await apiClient.post('/timesheets/entries', payload);
      pushInfo('Time logged — sent to your reporting manager');
      loadEntries();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to log time'), 'Timesheet not saved');
      throw err;
    }
  }

  const columns = [
    { key: 'date', header: 'Date', render: (row) => new Date(`${row.date}`.slice(0, 10)).toLocaleDateString() },
    { key: 'project', header: 'Project', render: (row) => row.account?.name || <span className="text-tertiary-400">General</span> },
    { key: 'hours', header: 'Hours', render: (row) => row.hours },
    { key: 'notes', header: 'Notes', render: (row) => <NoteText text={row.notes} /> },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div>
          <Badge value={row.status} label={STATUS_LABEL[row.status] || row.status} />
          {row.status === 'rejected' && row.decision_reason && <p className="mt-0.5 text-xs text-danger-600">Manager: {row.decision_reason}</p>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-sm font-semibold text-tertiary-900">My timesheet</h2>
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setEntryDrawerOpen(true)}>
          <Plus className="h-4 w-4" /> Log time
        </button>
      </div>

      <WeekHoursView canDeleteOwn reloadKey={weekKey} onChanged={loadEntries} />

      {!loading && rows.length === 0 ? (
        <EmptyState icon={Clock} title="No timesheet entries yet" description="Log your hours to get started." />
      ) : (
        <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No entries." />
      )}

      <RegularisationSection onChanged={loadEntries} />
      <EntryDrawer open={entryDrawerOpen} onClose={() => setEntryDrawerOpen(false)} onSubmit={createEntry} projects={projects} />
    </div>
  );
}
