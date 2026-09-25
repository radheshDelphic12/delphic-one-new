import { useCallback, useEffect, useState } from 'react';
import { FolderKanban, Pencil } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Modal from '../../components/ui/Modal.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import LeadClientSelect from '../../components/LeadClientSelect.jsx';
import { PROJECT_CATEGORIES, categoryLabel } from '../../lib/projectCategories.js';

// Same preference order the server uses when a project has no calendar chosen:
// the Ahmedabad calendar, else the org default, else the first one.
function defaultCalendarId(calendars) {
  const lower = (v) => String(v || '').toLowerCase();
  return (
    calendars.find((c) => lower(c.name) === 'ahmedabad calendar') ||
    calendars.find((c) => lower(c.location?.name) === 'ahmedabad') ||
    calendars.find((c) => lower(c.name).includes('ahmedabad')) ||
    calendars.find((c) => c.is_default) ||
    calendars[0]
  )?.id || '';
}

function useCalendars(open) {
  const [calendars, setCalendars] = useState([]);
  useEffect(() => {
    if (!open) return;
    apiClient.get('/calendars').then(({ data }) => setCalendars(data.data || [])).catch(() => setCalendars([]));
  }, [open]);
  return calendars;
}

function CalendarSelect({ value, onChange, calendars }) {
  return (
    <select required value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
      {calendars.length === 0 && <option value="">No calendars yet — create one first</option>}
      {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

/** Admin "Add Project": creates the project and maps it to a calendar in one step — the calendar is mandatory. */
export function AddProjectModal({ open, onClose, onCreated }) {
  const { pushError, pushInfo } = useAlerts();
  const calendars = useCalendars(open);
  const [fields, setFields] = useState({ name: '', client_account_id: '', service_category: 'managed_services', calendar_id: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setFields({ name: '', client_account_id: '', service_category: 'managed_services', calendar_id: '' });
  }, [open]);
  // Preselect the fallback once the calendars have loaded (and keep the user's own pick after that).
  useEffect(() => {
    if (open && calendars.length) setFields((f) => (f.calendar_id ? f : { ...f, calendar_id: defaultCalendarId(calendars) }));
  }, [open, calendars]);

  const set = (key, value) => setFields((f) => ({ ...f, [key]: value }));

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post('/calendars/projects', { ...fields, name: fields.name.trim(), client_account_id: fields.client_account_id || undefined });
      pushInfo(`Project "${fields.name.trim()}" added`);
      onCreated?.();
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to add the project'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Add project"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="add-project-form" className="btn-primary" disabled={saving || !fields.name.trim() || !fields.calendar_id}>
            {saving ? 'Adding…' : 'Add project'}
          </button>
        </>
      }
    >
      <form id="add-project-form" onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-tertiary-600">
          Project name <span className="text-danger-600">*</span>
          <input required autoFocus value={fields.name} onChange={(e) => set('name', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
        </label>
        <div className="block text-xs font-medium text-tertiary-600">
          Client name
          <LeadClientSelect value={fields.client_account_id} onChange={(v) => set('client_account_id', v)} enabled={open} />
        </div>
        <label className="block text-xs font-medium text-tertiary-600">
          Category
          <select value={fields.service_category} onChange={(e) => set('service_category', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
            {PROJECT_CATEGORIES.map((c) => <option key={c.value} value={c.value} disabled={c.disabled}>{c.label}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-tertiary-600">
          Calendar <span className="text-danger-600">*</span>
          <CalendarSelect value={fields.calendar_id} onChange={(v) => set('calendar_id', v)} calendars={calendars} />
          <span className="mt-1 block font-normal text-tertiary-500">
            Every project follows one calendar for its working days and holidays. Ahmedabad Calendar is used unless you pick another. You can change it any time.
          </span>
        </label>
      </form>
    </Modal>
  );
}

/** Edit which calendar an existing project follows. */
export function EditProjectCalendarModal({ project, onClose, onSaved }) {
  const { pushError, pushInfo } = useAlerts();
  const calendars = useCalendars(Boolean(project));
  const [calendarId, setCalendarId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (project) setCalendarId(project.calendar?.id || ''); }, [project]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.put(`/calendars/projects/${project.id}`, { calendar_id: calendarId });
      pushInfo('Calendar mapping updated');
      onSaved?.();
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update the mapping'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={Boolean(project)}
      title={project ? `Edit calendar — ${project.name}` : 'Edit calendar'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="edit-project-calendar-form" className="btn-primary" disabled={saving || !calendarId}>{saving ? 'Saving…' : 'Save mapping'}</button>
        </>
      }
    >
      <form id="edit-project-calendar-form" onSubmit={submit} className="space-y-3">
        <p className="text-tertiary-600">Which calendar should <span className="font-medium text-tertiary-900">{project?.name}</span> follow for working days and holidays?</p>
        <label className="block text-xs font-medium text-tertiary-600">
          Calendar
          <CalendarSelect value={calendarId} onChange={setCalendarId} calendars={calendars} />
        </label>
        <p className="text-xs text-tertiary-500">This only changes the project&apos;s calendar. Who works on the project is managed separately under Finance → Projects.</p>
      </form>
    </Modal>
  );
}

/** Mapping 1 — Project ↔ Calendar. Deliberately has nothing about employees (that is Employee ↔ Project, under Finance). */
export default function ProjectCalendarPanel({ refreshKey, canManage, onAdd }) {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    apiClient.get('/calendars/projects')
      .then(({ data }) => setRows(data.data || []))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load project calendars'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [pushError]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const columns = [
    { key: 'name', header: 'Project', render: (row) => <span className="font-medium text-tertiary-900">{row.name}</span> },
    { key: 'client', header: 'Client', render: (row) => row.client_name || <span className="text-tertiary-400">—</span> },
    { key: 'category', header: 'Category', render: (row) => categoryLabel(row.service_category) },
    {
      key: 'calendar',
      header: 'Calendar',
      render: (row) => (
        <span>
          {row.calendar?.name || <span className="text-tertiary-400">None</span>}
          {row.calendar_is_default && row.calendar && <span className="ml-1.5 text-xs text-tertiary-400">(default — not set yet)</span>}
        </span>
      ),
    },
    ...(canManage
      ? [{
          key: 'actions',
          header: 'Actions',
          render: (row) => (
            <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => setEditing(row)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          ),
        }]
      : []),
  ];

  return (
    <section className="space-y-2 pt-2">
      <div>
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">Project calendars</h3>
        <p className="text-xs text-tertiary-500">Which calendar each project follows for working days and holidays. Every project has exactly one.</p>
      </div>
      {!loading && rows.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Add a project to map it to a calendar."
          action={canManage ? <button type="button" className="btn-secondary" onClick={onAdd}>Add project</button> : null}
        />
      ) : (
        <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No projects" />
      )}
      <EditProjectCalendarModal project={editing} onClose={() => setEditing(null)} onSaved={load} />
    </section>
  );
}
