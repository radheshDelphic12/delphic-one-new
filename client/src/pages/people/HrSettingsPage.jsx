import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Download, FolderPlus, MapPin, Pencil, Plus, Settings2, Trash2, UsersRound } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import ProjectCalendarPanel, { AddProjectModal } from './ProjectCalendarPanel.jsx';

const TABS = [
  { key: 'departments', label: 'Departments', icon: UsersRound },
  { key: 'designations', label: 'Designations', icon: UsersRound },
  { key: 'locations', label: 'Locations', icon: MapPin },
  { key: 'shifts', label: 'Shifts', icon: Settings2 },
  { key: 'calendars', label: 'Calendars', icon: CalendarDays },
];

function minutesToTime(value) {
  if (value === undefined || value === null) return '';
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function timeToMinutes(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function NameDrawer({ open, title, value, onClose, onSubmit }) {
  const [name, setName] = useState(value || '');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setName(value || ''); }, [open, value]);
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try { await onSubmit(name.trim()); onClose(); } finally { setSaving(false); }
  }
  return <Drawer open={open} title={title} onClose={onClose} size="sm" tone="create" footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="settings-name-form" className="btn-primary" disabled={saving || !name.trim()}>{saving ? 'Saving...' : 'Save'}</button></>}><form id="settings-name-form" onSubmit={submit}><label className="block text-xs font-medium text-tertiary-600">Name<input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label></form></Drawer>;
}

function LocationDrawer({ open, onClose, onSubmit }) {
  const [fields, setFields] = useState({ name: '', city: '', country: '', is_default: false });
  const [saving, setSaving] = useState(false);
  function set(key, value) { setFields((current) => ({ ...current, [key]: value })); }
  async function submit(event) { event.preventDefault(); setSaving(true); try { await onSubmit(fields); onClose(); } finally { setSaving(false); } }
  return <Drawer open={open} title="Add location" onClose={onClose} size="sm" tone="create" footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="location-form" className="btn-primary" disabled={saving || !fields.name.trim()}>{saving ? 'Saving...' : 'Add location'}</button></>}><form id="location-form" onSubmit={submit} className="space-y-3"><label className="block text-xs font-medium text-tertiary-600">Name<input required value={fields.name} onChange={(event) => set('name', event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label><label className="block text-xs font-medium text-tertiary-600">City<input value={fields.city} onChange={(event) => set('city', event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label><label className="block text-xs font-medium text-tertiary-600">Country<input value={fields.country} onChange={(event) => set('country', event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label><label className="flex items-center gap-2 text-sm text-tertiary-700"><input type="checkbox" checked={fields.is_default} onChange={(event) => set('is_default', event.target.checked)} /> Default location</label></form></Drawer>;
}

function ShiftDrawer({ open, onClose, onSubmit }) {
  const [fields, setFields] = useState({ name: '', start: '09:00', end: '18:00', grace_minutes: 15 });
  const [saving, setSaving] = useState(false);
  function set(key, value) { setFields((current) => ({ ...current, [key]: value })); }
  async function submit(event) { event.preventDefault(); setSaving(true); try { await onSubmit({ name: fields.name.trim(), start_minutes: timeToMinutes(fields.start), end_minutes: timeToMinutes(fields.end), grace_minutes: Number(fields.grace_minutes) }); onClose(); } finally { setSaving(false); } }
  return <Drawer open={open} title="Add shift" onClose={onClose} size="sm" tone="create" footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="shift-form" className="btn-primary" disabled={saving || !fields.name.trim()}>{saving ? 'Saving...' : 'Add shift'}</button></>}><form id="shift-form" onSubmit={submit} className="space-y-3"><label className="block text-xs font-medium text-tertiary-600">Name<input required value={fields.name} onChange={(event) => set('name', event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label><div className="grid grid-cols-2 gap-3"><label className="text-xs font-medium text-tertiary-600">Start<input type="time" value={fields.start} onChange={(event) => set('start', event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label><label className="text-xs font-medium text-tertiary-600">End<input type="time" value={fields.end} onChange={(event) => set('end', event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label></div><label className="block text-xs font-medium text-tertiary-600">Grace period in minutes<input type="number" min="0" max="120" value={fields.grace_minutes} onChange={(event) => set('grace_minutes', event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label></form></Drawer>;
}

// Handles both create (calendar prop absent) and edit (calendar prop set) —
// same fields either way, only the title/submit label and create-vs-update
// call differ.
function CalendarDrawer({ open, calendar, onClose, onSubmit }) {
  const isEditing = Boolean(calendar);
  const [fields, setFields] = useState({ name: '', kind: 'internal', is_default: false, location_id: '' });
  const [locations, setLocations] = useState([]);
  const [saving, setSaving] = useState(false);
  function set(key, value) { setFields((current) => ({ ...current, [key]: value })); }
  useEffect(() => {
    if (!open) return;
    apiClient.get('/orgs/locations').then(({ data }) => setLocations(data.data || [])).catch(() => setLocations([]));
    setFields(calendar
      ? { name: calendar.name, kind: calendar.kind, is_default: calendar.is_default, location_id: calendar.location?.id || '' }
      : { name: '', kind: 'internal', is_default: false, location_id: '' });
  }, [open, calendar]);
  async function submit(event) { event.preventDefault(); setSaving(true); try { await onSubmit({ ...fields, location_id: fields.location_id || null }); onClose(); } finally { setSaving(false); } }
  return <Drawer open={open} title={isEditing ? `Edit ${calendar?.name || 'calendar'}` : 'Add calendar'} onClose={onClose} size="sm" tone={isEditing ? 'edit' : 'create'} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="calendar-form" className="btn-primary" disabled={saving || !fields.name.trim()}>{saving ? 'Saving...' : isEditing ? 'Save changes' : 'Add calendar'}</button></>}><form id="calendar-form" onSubmit={submit} className="space-y-3"><label className="block text-xs font-medium text-tertiary-600">Name<input required value={fields.name} onChange={(event) => set('name', event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label><label className="block text-xs font-medium text-tertiary-600">Kind<select value={fields.kind} onChange={(event) => set('kind', event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"><option value="internal">Internal</option><option value="client">Client</option><option value="custom">Custom</option></select></label><label className="block text-xs font-medium text-tertiary-600">Office location / zone <span className="font-normal text-tertiary-400">(optional - leave empty for a client calendar)</span><select value={fields.location_id} onChange={(event) => set('location_id', event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"><option value="">No location</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label className="flex items-center gap-2 text-sm text-tertiary-700"><input type="checkbox" checked={fields.is_default} onChange={(event) => set('is_default', event.target.checked)} /> Default calendar</label></form></Drawer>;
}

// Same create/edit dual-purpose pattern as CalendarDrawer above.
function HolidayFormDrawer({ open, holiday, calendarName, onClose, onSubmit }) {
  const isEditing = Boolean(holiday);
  const [date, setDate] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setDate(holiday ? String(holiday.date).slice(0, 10) : '');
    setLabel(holiday?.label || '');
  }, [open, holiday]);
  async function submit(event) { event.preventDefault(); setSaving(true); try { await onSubmit({ date, label }); onClose(); } finally { setSaving(false); } }
  return <Drawer open={open} title={isEditing ? 'Edit holiday' : `Add holiday to ${calendarName || 'calendar'}`} onClose={onClose} size="sm" tone={isEditing ? 'edit' : 'create'} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="holiday-form" className="btn-primary" disabled={saving || !date || !label.trim()}>{saving ? 'Saving...' : isEditing ? 'Save changes' : 'Add holiday'}</button></>}><form id="holiday-form" onSubmit={submit} className="space-y-3"><label className="block text-xs font-medium text-tertiary-600">Date<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label><label className="block text-xs font-medium text-tertiary-600">Label<input required value={label} onChange={(event) => setLabel(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label></form></Drawer>;
}

/**
 * Full holiday list for one calendar — grouped by month so "which date is a
 * holiday, in which month" is readable at a glance, with edit/delete per
 * holiday. Replaces the old bottom-corner popup, which only ever showed a
 * bare list with no way to change anything once added.
 */
function HolidaysDrawer({ calendar, holidays, onClose, onAdd, onUpdate, onDelete, onExport }) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState(null);

  const grouped = useMemo(() => {
    const byMonth = new Map();
    for (const h of holidays) {
      const key = new Date(`${String(h.date).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(h);
    }
    return byMonth;
  }, [holidays]);

  return (
    <Drawer open={Boolean(calendar)} title={calendar ? `${calendar.name} — holidays` : 'Holidays'} onClose={onClose} size="lg">
      {calendar && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-tertiary-500">
              <span className="capitalize">{calendar.kind}</span> · {calendar.location?.name || 'Not tied to a location'}
            </p>
            <span className="flex gap-2">
              <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" onClick={() => onExport(calendar)} disabled={holidays.length === 0}>
                <Download className="h-3.5 w-3.5" /> Export to Excel
              </button>
              <button type="button" className="btn-primary inline-flex items-center gap-1.5 text-xs" onClick={() => setFormOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add holiday
              </button>
            </span>
          </div>

          {holidays.length === 0 ? (
            <EmptyState icon={CalendarDays} title="No holidays configured" description="Add the first holiday for this calendar above." />
          ) : (
            Array.from(grouped.entries()).map(([month, rows]) => (
              <div key={month}>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-tertiary-400">{month}</h4>
                <ul className="divide-y divide-tertiary-100 rounded-2xl border border-tertiary-100 bg-white shadow-card">
                  {rows.map((h) => (
                    <li key={h.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                      <span className="text-tertiary-700">
                        <span className="font-medium text-tertiary-900">
                          {new Date(`${String(h.date).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' })}
                        </span>
                        {' — '}{h.label}
                      </span>
                      <span className="flex shrink-0 gap-1">
                        <button type="button" aria-label="Edit holiday" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-tertiary-50 hover:text-tertiary-700" onClick={() => setEditingHoliday(h)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" aria-label="Delete holiday" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => onDelete(h)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
      <HolidayFormDrawer
        open={formOpen || Boolean(editingHoliday)}
        holiday={editingHoliday}
        calendarName={calendar?.name}
        onClose={() => { setFormOpen(false); setEditingHoliday(null); }}
        onSubmit={(payload) => (editingHoliday ? onUpdate(editingHoliday, payload) : onAdd(payload))}
      />
    </Drawer>
  );
}

export default function HrSettingsPage() {
  const { user } = useAuth();
  const { pushError, pushInfo } = useAlerts();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab') || 'departments';
  const tab = TABS.some((item) => item.key === requestedTab) ? requestedTab : 'departments';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState(null);
  const [editingCalendar, setEditingCalendar] = useState(null);
  const [holidayCalendar, setHolidayCalendar] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [projectsRefresh, setProjectsRefresh] = useState(0);

  async function load() {
    setLoading(true);
    try {
      const endpoint = tab === 'departments' ? '/departments' : tab === 'designations' ? '/designations' : tab === 'locations' ? '/orgs/locations' : tab === 'shifts' ? '/attendance/shifts' : '/calendars';
      const { data } = await apiClient.get(endpoint);
      setRows(data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load HR settings'), 'Something went wrong');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createResource(payload) {
    const endpoint = tab === 'departments' ? '/departments' : tab === 'designations' ? '/designations' : tab === 'locations' ? '/orgs/locations' : tab === 'shifts' ? '/attendance/shifts' : '/calendars';
    try { const { data } = await apiClient.post(endpoint, payload); setRows((current) => [...current, data.data]); setDrawer(null); pushInfo('HR setting created'); } catch (err) { pushError(apiErrorMessage(err, 'Failed to create HR setting'), 'Something went wrong'); }
  }

  async function saveCalendarEdit(payload) {
    try {
      const { data } = await apiClient.patch(`/calendars/${editingCalendar.id}`, payload);
      setRows((current) => current.map((r) => (r.id === data.data.id ? { ...r, ...data.data } : r)));
      setEditingCalendar(null);
      pushInfo('Calendar updated');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update calendar'), 'Something went wrong');
    }
  }

  async function deleteCalendar(calendar) {
    try {
      await apiClient.delete(`/calendars/${calendar.id}`);
      setRows((current) => current.filter((r) => r.id !== calendar.id));
      pushInfo(`${calendar.name} deleted`);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to delete calendar'), 'Something went wrong');
    }
  }

  async function openHolidays(calendar) {
    setHolidayCalendar(calendar);
    try { const { data } = await apiClient.get(`/calendars/${calendar.id}/holidays`); setHolidays(data.data || []); } catch (err) { pushError(apiErrorMessage(err, 'Failed to load holidays'), 'Something went wrong'); }
  }

  async function addHoliday(payload) {
    try {
      const { data } = await apiClient.post(`/calendars/${holidayCalendar.id}/holidays`, payload);
      setHolidays((current) => [...current, data.data].sort((a, b) => (a.date < b.date ? -1 : 1)));
      setRows((current) => current.map((r) => (r.id === holidayCalendar.id ? { ...r, _count: { ...r._count, holidays: (r._count?.holidays || 0) + 1 } } : r)));
      pushInfo('Holiday added');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to add holiday'), 'Something went wrong');
    }
  }

  async function updateHoliday(holiday, payload) {
    try {
      const { data } = await apiClient.patch(`/calendars/${holidayCalendar.id}/holidays/${holiday.id}`, payload);
      setHolidays((current) => current.map((h) => (h.id === holiday.id ? data.data : h)).sort((a, b) => (a.date < b.date ? -1 : 1)));
      pushInfo('Holiday updated');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update holiday'), 'Something went wrong');
    }
  }

  async function exportHolidays(calendar) {
    try {
      const { data: blob } = await apiClient.get(`/calendars/${calendar.id}/holidays/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${calendar.name.replace(/[^\w.-]+/g, '-').toLowerCase()}-holidays.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to export holidays'), 'Export failed');
    }
  }

  async function deleteHoliday(holiday) {
    try {
      await apiClient.delete(`/calendars/${holidayCalendar.id}/holidays/${holiday.id}`);
      setHolidays((current) => current.filter((h) => h.id !== holiday.id));
      setRows((current) => current.map((r) => (r.id === holidayCalendar.id ? { ...r, _count: { ...r._count, holidays: Math.max(0, (r._count?.holidays || 1) - 1) } } : r)));
      pushInfo('Holiday deleted');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to delete holiday'), 'Something went wrong');
    }
  }

  const canManage = user?.role === 'admin';
  const names = { departments: 'department', designations: 'designation' };
  const columns = tab === 'departments' || tab === 'designations'
    ? [{ key: 'name', header: 'Name' }, { key: 'created', header: 'Created', render: (row) => new Date(row.created_at).toLocaleDateString() }]
    : tab === 'locations'
    ? [{ key: 'name', header: 'Location' }, { key: 'city', header: 'City', render: (row) => row.city || 'Not set' }, { key: 'country', header: 'Country', render: (row) => row.country || 'Not set' }, { key: 'default', header: 'Default', render: (row) => row.is_default ? 'Yes' : 'No' }]
    : tab === 'shifts'
    ? [{ key: 'name', header: 'Shift' }, { key: 'hours', header: 'Hours', render: (row) => `${minutesToTime(row.start_minutes)} - ${minutesToTime(row.end_minutes)}` }, { key: 'grace', header: 'Grace', render: (row) => `${row.grace_minutes}m` }]
    : [
        { key: 'name', header: 'Calendar', render: (row) => <button type="button" className="font-medium text-primary-700 hover:underline" onClick={() => openHolidays(row)}>{row.name}</button> },
        { key: 'kind', header: 'Kind', render: (row) => <span className="capitalize">{row.kind}</span> },
        { key: 'location', header: 'Zone / Location', render: (row) => row.location?.name || 'Not tied to a location' },
        { key: 'default', header: 'Default', render: (row) => (row.is_default ? 'Yes' : 'No') },
        { key: 'holidays', header: 'Holidays', render: (row) => <button type="button" className="text-primary-700 hover:underline" onClick={() => openHolidays(row)}>{row._count?.holidays ?? 0}</button> },
        {
          key: 'actions',
          header: 'Actions',
          render: (row) => (
            <div className="flex items-center gap-1">
              <button type="button" className="btn-ghost text-xs" onClick={() => openHolidays(row)}>View holidays</button>
              {canManage && (
                <>
                  <button type="button" aria-label="Edit calendar" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-tertiary-50 hover:text-tertiary-700" onClick={() => setEditingCalendar(row)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" aria-label="Delete calendar" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => deleteCalendar(row)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          ),
        },
      ];

  return <div className="space-y-4">
    <div className="flex flex-wrap gap-1 border-b border-tertiary-200">{TABS.map(({ key, label, icon: Icon }) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${tab === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500'}`} onClick={() => setParams({ section: 'hr-settings', tab: key })}><Icon className="h-4 w-4" />{label}</button>)}</div>
    <div className="flex flex-wrap justify-end gap-2">{canManage && <button type="button" className={tab === 'calendars' ? 'btn-secondary inline-flex items-center gap-2' : 'btn-primary inline-flex items-center gap-2'} onClick={() => setDrawer(tab)}><Plus className="h-4 w-4" /> Add {names[tab] || tab.slice(0, -1)}</button>}{canManage && tab === 'calendars' && <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setAddProjectOpen(true)}><FolderPlus className="h-4 w-4" /> Add Project</button>}</div>
    {!loading && rows.length === 0 ? <EmptyState icon={Settings2} title={`No ${tab} configured`} description="Create the first setting when your organization is ready." action={canManage ? <button type="button" className="btn-secondary" onClick={() => setDrawer(tab)}>Add {names[tab] || tab.slice(0, -1)}</button> : null} /> : <DataTable columns={columns} rows={rows} loading={loading} emptyLabel={`No ${tab} configured`} />}
    <NameDrawer open={drawer === 'departments' || drawer === 'designations'} title={`Add ${names[tab] || 'setting'}`} onClose={() => setDrawer(null)} value="" onSubmit={(name) => createResource({ name })} />
    <LocationDrawer open={drawer === 'locations'} onClose={() => setDrawer(null)} onSubmit={createResource} />
    <ShiftDrawer open={drawer === 'shifts'} onClose={() => setDrawer(null)} onSubmit={createResource} />
    {tab === 'calendars' && <ProjectCalendarPanel refreshKey={projectsRefresh} canManage={canManage} onAdd={() => setAddProjectOpen(true)} />}
    <AddProjectModal open={addProjectOpen} onClose={() => setAddProjectOpen(false)} onCreated={() => setProjectsRefresh((n) => n + 1)} />
    <CalendarDrawer open={drawer === 'calendars'} onClose={() => setDrawer(null)} onSubmit={createResource} />
    <CalendarDrawer open={Boolean(editingCalendar)} calendar={editingCalendar} onClose={() => setEditingCalendar(null)} onSubmit={saveCalendarEdit} />
    <HolidaysDrawer
      calendar={holidayCalendar}
      holidays={holidays}
      onClose={() => setHolidayCalendar(null)}
      onAdd={addHoliday}
      onUpdate={updateHoliday}
      onDelete={deleteHoliday}
      onExport={exportHolidays}
    />
  </div>;
}
