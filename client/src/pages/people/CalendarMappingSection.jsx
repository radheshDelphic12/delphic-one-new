import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';

/**
 * The employee's OWN default calendar. Which calendar a project follows is a
 * separate mapping (Project ↔ Calendar, People → HR Settings → Calendars) and
 * who works on which project is another (Employee ↔ Project, Finance → Projects)
 * — this form deliberately touches neither. Timesheets for a project use the
 * project's calendar; payroll and everything else uses this default.
 */
export default function CalendarMappingSection({ membershipId, locationName, canEdit }) {
  const { pushError, pushInfo } = useAlerts();
  const [assignments, setAssignments] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [calendarId, setCalendarId] = useState('');
  const [saving, setSaving] = useState(false);
  // Effective calendars (admin view): standard + per-project for IT / contractors.
  const [overview, setOverview] = useState(null);

  const load = useCallback(() => {
    apiClient
      .get(`/calendars/assignments/${membershipId}`)
      .then(({ data }) => setAssignments(data.data || []))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load calendar mappings'), 'Something went wrong'));
    if (canEdit) {
      apiClient.get(`/calendars/members/${membershipId}`).then(({ data }) => setOverview(data.data || null)).catch(() => setOverview(null));
    }
  }, [membershipId, canEdit, pushError]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!canEdit) return;
    apiClient.get('/calendars').then(({ data }) => setCalendars(data.data || [])).catch(() => setCalendars([]));
  }, [canEdit]);

  const defaultMapping = assignments.find((a) => !a.account_id);
  // Rows saved against a project before projects had their own calendar. Still
  // honoured, no longer editable here.
  const legacyOverrides = assignments.filter((a) => a.account_id);

  async function assign(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post(`/calendars/${calendarId}/assign`, { org_membership_id: membershipId, account_id: null });
      pushInfo('Default calendar saved');
      setCalendarId('');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save the calendar'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  const calendarOptions = calendars.map((c) => ({ value: c.id, label: c.name, hint: c.location?.name || c.kind }));

  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card">
      <h3 className="font-heading text-base font-semibold text-tertiary-900">Calendar</h3>
      <p className="mb-4 mt-1 text-xs text-tertiary-500">
        Timesheets for a project follow that project&apos;s calendar (set under People → HR Settings → Calendars). Everything else follows this employee&apos;s
        default, then the calendar of their office{locationName ? ` (${locationName})` : ' location'}, then the organization default.
      </p>

      <p className="text-sm text-tertiary-700">
        <span className="text-tertiary-500">Default calendar: </span>
        {defaultMapping ? (
          <span className="inline-flex items-center gap-2 font-medium text-tertiary-900">{defaultMapping.calendar.name} <Badge value={defaultMapping.calendar.kind} /></span>
        ) : (
          <span className="text-tertiary-500">not set — using the office or organization calendar</span>
        )}
      </p>

      {overview && (
        <div className="mt-3 rounded-xl bg-tertiary-50 px-3 py-2 text-sm">
          <p className="text-tertiary-700">
            <span className="text-tertiary-500">Calendar in effect: </span>
            <span className="font-medium text-tertiary-900">{overview.standard_calendar?.name || 'none'}</span>
            {!overview.per_project && <span className="ml-1 text-xs text-tertiary-500">(non-IT — this one calendar applies to all working days)</span>}
          </p>
          {overview.per_project && (
            overview.projects.length === 0 ? (
              <p className="mt-1 text-xs text-tertiary-500">IT employee with no assigned projects yet — once assigned, each project&apos;s calendar applies for that project.</p>
            ) : (
              <>
                <p className="mt-2 text-xs font-medium text-tertiary-500">Project-wise calendars (IT — each project follows its own calendar)</p>
                <ul className="mt-1 divide-y divide-tertiary-100">
                  {overview.projects.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span className="text-tertiary-800">{p.name}{p.client_name ? <span className="text-xs text-tertiary-500"> · {p.client_name}</span> : null}</span>
                      <span className="inline-flex items-center gap-2 text-tertiary-700">{p.calendar?.name || 'Standard'} {p.calendar && <Badge value={p.calendar.kind} />}</span>
                    </li>
                  ))}
                </ul>
              </>
            )
          )}
        </div>
      )}

      {legacyOverrides.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-tertiary-500">Earlier per-project overrides for this employee (still applied)</p>
          <ul className="mt-1 divide-y divide-tertiary-100 text-sm">
            {legacyOverrides.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="text-tertiary-800">{a.account?.name}</span>
                <span className="text-tertiary-600">{a.calendar.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canEdit && (
        <form onSubmit={assign} className="mt-4 grid gap-3 border-t border-tertiary-100 pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="text-xs font-medium text-tertiary-600">
            Default calendar
            <div className="mt-1">
              <SearchableSelect value={calendarId} onChange={setCalendarId} options={calendarOptions} placeholder="Select calendar" searchPlaceholder="Search calendars" />
            </div>
          </label>
          <button type="submit" className="btn-primary" disabled={saving || !calendarId}>{saving ? 'Saving...' : defaultMapping ? 'Change default' : 'Set default'}</button>
        </form>
      )}
    </section>
  );
}
