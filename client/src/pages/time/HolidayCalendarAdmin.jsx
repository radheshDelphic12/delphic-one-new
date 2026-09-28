import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Pencil, Plus, Trash2, UserPlus, UsersRound, X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import { CalendarDrawer, HolidaysDrawer } from '../people/HrSettingsPage.jsx';
import ProjectCalendarPanel, { AddProjectModal } from '../people/ProjectCalendarPanel.jsx';

const SOURCE_LABEL = {
  assigned: 'Assigned directly',
  department: 'Via department',
  location: 'Via office location',
  default: 'Organization default',
  project: 'Via project',
};

const byDate = (a, b) => (a.date < b.date ? -1 : 1);

/**
 * Employees aligned to one calendar — explicitly assigned ones (removable) and
 * the ones inheriting it through department / location / org default — plus
 * a picker to assign another employee to it as their default calendar.
 */
function CalendarEmployeesDrawer({ calendar, onClose, onChanged }) {
  const { pushError, pushInfo } = useAlerts();
  const [employees, setEmployees] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [membershipId, setMembershipId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!calendar) return;
    setLoading(true);
    apiClient
      .get(`/calendars/${calendar.id}/employees`)
      .then(({ data }) => setEmployees(data.data || []))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load aligned employees'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [calendar, pushError]);

  useEffect(() => {
    setMembershipId('');
    setEmployees([]);
    load();
  }, [load]);
  useEffect(() => {
    if (!calendar) return;
    apiClient.get('/orgs/memberships').then(({ data }) => setMembers(data.data || [])).catch(() => setMembers([]));
  }, [calendar]);

  async function assign(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post(`/calendars/${calendar.id}/assign`, { org_membership_id: membershipId, account_id: null });
      pushInfo('Calendar assigned');
      setMembershipId('');
      load();
      onChanged();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to assign the calendar'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function unassign(employee) {
    try {
      await apiClient.delete(`/calendars/${calendar.id}/assign/${employee.id}`);
      pushInfo(`${employee.person?.name || 'Employee'} removed from ${calendar.name}`);
      load();
      onChanged();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to remove the assignment'), 'Something went wrong');
    }
  }

  const directIds = new Set(employees.filter((e) => e.source === 'assigned').map((e) => e.id));
  const memberOptions = members
    .filter((m) => !directIds.has(m.id))
    .map((m) => ({ value: m.id, label: m.person?.name || m.person?.email || 'Unnamed', hint: m.department?.name || m.employee_code || '' }));

  return (
    <Drawer open={Boolean(calendar)} title={calendar ? `${calendar.name} — employees` : 'Employees'} onClose={onClose} size="lg">
      {calendar && (
        <div className="space-y-4">
          <form onSubmit={assign} className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="text-xs font-medium text-tertiary-600">
              Assign an employee to this calendar
              <div className="mt-1">
                <SearchableSelect value={membershipId} onChange={setMembershipId} options={memberOptions} placeholder="Select employee" searchPlaceholder="Search employees" />
              </div>
            </label>
            <button type="submit" className="btn-primary inline-flex items-center justify-center gap-1.5" disabled={saving || !membershipId}>
              <UserPlus className="h-4 w-4" /> {saving ? 'Assigning...' : 'Assign'}
            </button>
            <p className="text-xs text-tertiary-500 sm:col-span-2">
              This becomes the employee&apos;s standard calendar, replacing any other one assigned to them. Non-IT staff follow only this one calendar; IT staff
              follow it for regular days, and each project&apos;s own calendar for that project (see Project calendars below).
            </p>
          </form>

          <div>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-tertiary-400">
              Aligned employees {!loading && `(${employees.length})`}
            </h4>
            {loading ? (
              <p className="text-sm text-tertiary-500">Loading…</p>
            ) : employees.length === 0 ? (
              <EmptyState icon={UsersRound} title="No employees follow this calendar" description="Assign an employee above, or tie the calendar to a department or office location." />
            ) : (
              <ul className="divide-y divide-tertiary-100 rounded-2xl border border-tertiary-100 bg-white shadow-card">
                {employees.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span>
                      <span className="font-medium text-tertiary-900">{e.person?.name || e.person?.email}</span>
                      <span className="ml-2 text-xs text-tertiary-500">{[e.employee_code, e.department?.name, e.location?.name].filter(Boolean).join(' · ')}</span>
                      {e.projects?.length > 0 && (
                        <span className="mt-0.5 block text-xs text-tertiary-500">
                          {e.source === 'project' ? 'For project' : 'Also for project'}{e.projects.length > 1 ? 's' : ''}: {e.projects.map((p) => p.name).join(', ')}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${e.source === 'assigned' ? 'bg-primary-50 text-primary-700' : 'bg-tertiary-100 text-tertiary-600'}`}>
                        {SOURCE_LABEL[e.source] || e.source}
                      </span>
                      {e.source === 'assigned' && (
                        <button type="button" aria-label="Remove assignment" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => unassign(e)}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

/**
 * Admin management for holiday calendars inside Time & Attendance → Holiday
 * Calendar: add / edit / delete calendars, manage their holidays, and align
 * employees to them. Same endpoints as People → HR Settings → Calendars.
 */
export default function HolidayCalendarAdmin({ onChanged }) {
  const { pushError, pushInfo } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingCalendar, setEditingCalendar] = useState(null);
  const [holidayCalendar, setHolidayCalendar] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [employeesCalendar, setEmployeesCalendar] = useState(null);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [projectsRefresh, setProjectsRefresh] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/calendars');
      setRows(data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load calendars'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [pushError]);

  useEffect(() => { load(); }, [load]);

  function changed() {
    load();
    onChanged?.();
  }

  async function createCalendar(payload) {
    try {
      await apiClient.post('/calendars', payload);
      setAdding(false);
      pushInfo('Calendar created');
      changed();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to create calendar'), 'Something went wrong');
    }
  }

  async function saveCalendarEdit(payload) {
    try {
      await apiClient.patch(`/calendars/${editingCalendar.id}`, payload);
      setEditingCalendar(null);
      pushInfo('Calendar updated');
      changed();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update calendar'), 'Something went wrong');
    }
  }

  async function deleteCalendar(calendar) {
    if (!window.confirm(`Delete ${calendar.name}? Its holidays are deleted too.`)) return;
    try {
      await apiClient.delete(`/calendars/${calendar.id}`);
      pushInfo(`${calendar.name} deleted`);
      changed();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to delete calendar'), 'Something went wrong');
    }
  }

  async function openHolidays(calendar) {
    setHolidayCalendar(calendar);
    setHolidays([]);
    try {
      const { data } = await apiClient.get(`/calendars/${calendar.id}/holidays`);
      setHolidays(data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load holidays'), 'Something went wrong');
    }
  }

  async function addHoliday(payload) {
    try {
      const { data } = await apiClient.post(`/calendars/${holidayCalendar.id}/holidays`, payload);
      setHolidays((current) => [...current, data.data].sort(byDate));
      pushInfo('Holiday added');
      changed();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to add holiday'), 'Something went wrong');
    }
  }

  async function updateHoliday(holiday, payload) {
    try {
      const { data } = await apiClient.patch(`/calendars/${holidayCalendar.id}/holidays/${holiday.id}`, payload);
      setHolidays((current) => current.map((h) => (h.id === holiday.id ? data.data : h)).sort(byDate));
      pushInfo('Holiday updated');
      onChanged?.();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update holiday'), 'Something went wrong');
    }
  }

  async function deleteHoliday(holiday) {
    try {
      await apiClient.delete(`/calendars/${holidayCalendar.id}/holidays/${holiday.id}`);
      setHolidays((current) => current.filter((h) => h.id !== holiday.id));
      pushInfo('Holiday deleted');
      changed();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to delete holiday'), 'Something went wrong');
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

  const columns = [
    { key: 'name', header: 'Calendar', render: (row) => <button type="button" className="font-medium text-primary-700 hover:underline" onClick={() => openHolidays(row)}>{row.name}</button> },
    { key: 'kind', header: 'Kind', render: (row) => <span className="capitalize">{row.kind}</span> },
    { key: 'location', header: 'Location', render: (row) => row.location?.name || '-' },
    { key: 'department', header: 'Department', render: (row) => row.department?.name || '-' },
    { key: 'default', header: 'Default', render: (row) => (row.is_default ? 'Yes' : 'No') },
    { key: 'holidays', header: 'Holidays', render: (row) => <button type="button" className="text-primary-700 hover:underline" onClick={() => openHolidays(row)}>{row._count?.holidays ?? 0}</button> },
    { key: 'employees', header: 'Assigned', render: (row) => <button type="button" className="text-primary-700 hover:underline" onClick={() => setEmployeesCalendar(row)}>{row._count?.employees ?? 0}</button> },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => setEmployeesCalendar(row)}>
            <UsersRound className="h-3.5 w-3.5" /> Employees
          </button>
          <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => openHolidays(row)}>
            <CalendarDays className="h-3.5 w-3.5" /> Holidays
          </button>
          <button type="button" aria-label="Edit calendar" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-tertiary-50 hover:text-tertiary-700" onClick={() => setEditingCalendar(row)}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="Delete calendar" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => deleteCalendar(row)}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <section className="space-y-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-heading text-sm font-semibold text-tertiary-900">Manage calendars</h3>
          <p className="text-xs text-tertiary-500">Add or edit holiday calendars, their holidays, and which employees follow them.</p>
        </div>
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Add calendar
        </button>
      </div>
      {!loading && rows.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No calendars yet" description="Create the first holiday calendar for your organization." />
      ) : (
        <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No calendars yet" />
      )}

      <CalendarDrawer open={adding} onClose={() => setAdding(false)} onSubmit={createCalendar} />
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
      <CalendarEmployeesDrawer calendar={employeesCalendar} onClose={() => setEmployeesCalendar(null)} onChanged={changed} />

      {/* IT staff work per project: each project's calendar applies to them for that project. */}
      <ProjectCalendarPanel refreshKey={projectsRefresh} canManage onAdd={() => setAddProjectOpen(true)} />
      <AddProjectModal open={addProjectOpen} onClose={() => setAddProjectOpen(false)} onCreated={() => { setProjectsRefresh((n) => n + 1); onChanged?.(); }} />
    </section>
  );
}
