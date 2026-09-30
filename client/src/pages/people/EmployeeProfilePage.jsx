import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, UserRound } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import { PeekField } from '../../components/ui/PeekFields.jsx';
import CalendarMappingSection from './CalendarMappingSection.jsx';
import PersonalDetailsSection from '../../components/PersonalDetailsSection.jsx';
import ReportingSection from '../../components/ReportingSection.jsx';

const EMPTY_OPTIONS = {
  departments: [],
  designations: [],
  teams: [],
  vendors: [],
  locations: [],
  shifts: [],
  managerOptions: [],
  personOptions: [],
};

const WORK_MODE_OPTIONS = [
  { value: 'onsite', label: 'Onsite' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'remote', label: 'Remote' },
];

const WORKER_TYPE_OPTIONS = [
  { value: 'full_time_employee', label: 'Full-Time Employee' },
  { value: 'contractor', label: 'Contractor' },
];

function formatMoney(value, currency) {
  if (value === null || value === undefined) return 'Not set';
  return `${currency || 'INR'} ${Number(value).toLocaleString('en-IN')}`;
}

function workModeLabel(value) {
  return WORK_MODE_OPTIONS.find((option) => option.value === value)?.label || 'Not set';
}

const EMPLOYMENT_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'notice_period', label: 'Serving notice' },
  { value: 'on_leave', label: 'On long leave' },
  { value: 'pending_onboarding', label: 'Joining soon' },
  { value: 'terminated', label: 'Exited' },
];

// Calendar days from the notice date to the last working day, both included.
function noticeDays(start, end) {
  if (!start || !end) return null;
  const days = Math.round((new Date(String(end).slice(0, 10)) - new Date(String(start).slice(0, 10))) / 86400000) + 1;
  return days > 0 ? days : null;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : 'Not set';
}

function optionsFor(rows, label = 'name') {
  return rows.map((row) => ({ value: row.id, label: row[label] }));
}

// Local calendar day as YYYY-MM-DD.
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function EditMembershipDrawer({ open, row, options, onClose, onSaved }) {
  const { pushError } = useAlerts();
  const [fields, setFields] = useState(null);
  const [saving, setSaving] = useState(false);
  // Team moves are effective-dated: the old team keeps the days before it.
  const [todayKey] = useState(localToday);
  const [teamEffective, setTeamEffective] = useState(localToday);
  const teamChanged = Boolean(fields && row && fields.team_id !== (row.team?.id || ''));

  useEffect(() => {
    if (open && row) {
      setTeamEffective(localToday());
      setFields({
        employee_code: row.employee_code || '',
        employment_status: row.employment_status || 'active',
        notice_start_date: row.notice_start_date ? String(row.notice_start_date).slice(0, 10) : '',
        notice_end_date: row.notice_end_date ? String(row.notice_end_date).slice(0, 10) : '',
        department_id: row.department?.id || '',
        designation_id: row.designation?.id || '',
        team_id: row.team?.id || '',
        work_mode: row.work_mode || '',
        location_id: row.location?.id || '',
        shift_id: row.shift?.id || '',
        manager_id: row.manager?.id || '',
        hr_poc_id: row.hr_poc?.id || '',
        sourcing_poc_id: row.sourcing_poc?.id || '',
        worker_type: row.worker_type || 'full_time_employee',
        vendor_account_id: row.vendor_account?.id || '',
        vendor_rate: row.vendor_rate ?? '',
      });
    }
  }, [open, row]);

  function setField(key, value) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!fields || !row) return;
    const { worker_type, vendor_account_id, vendor_rate, ...rest } = fields;
    const patch = Object.fromEntries(
      Object.entries(rest).map(([key, value]) => [key, value || null])
    );
    if (teamChanged) patch.team_effective_date = teamEffective;
    else delete patch.team_id;
    // Only send the worker fields when something about them changed, so a
    // plain profile edit never trips the contractor validation.
    const workerChanged = worker_type !== (row.worker_type || 'full_time_employee')
      || vendor_account_id !== (row.vendor_account?.id || '')
      || String(vendor_rate) !== String(row.vendor_rate ?? '');
    if (workerChanged) {
      patch.worker_type = worker_type;
      if (worker_type === 'contractor') {
        patch.vendor_account_id = vendor_account_id || null;
        patch.vendor_rate = vendor_rate === '' ? null : Number(vendor_rate);
      }
    }
    setSaving(true);
    try {
      const { data } = await apiClient.patch(`/orgs/memberships/${row.id}`, patch);
      onSaved(data.data);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update employee profile'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  const fieldsConfig = [
    ['department_id', 'Department', options.departments],
    ['designation_id', 'Designation', options.designations],
    ['team_id', 'Team', options.teams],
    ['work_mode', 'Work mode', WORK_MODE_OPTIONS],
    ['location_id', 'Location', options.locations],
    ['shift_id', 'Shift', options.shifts],
      ['manager_id', 'Manager', options.managerOptions.filter((person) => person.value !== row?.id)],
      ['hr_poc_id', 'HR POC', options.personOptions],
      ['sourcing_poc_id', 'Sourcing POC', options.personOptions],
  ];

  return (
    <Drawer
      open={open}
      title={row ? `Edit ${row.person.name}` : 'Edit employee'}
      onClose={onClose}
      size="lg"
      tone="edit"
      footer={(
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="edit-membership-form" className="btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </>
      )}
    >
      {fields && (
        <form id="edit-membership-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-medium text-tertiary-600">
            Employee code
            <input
              value={fields.employee_code}
              onChange={(event) => setField('employee_code', event.target.value.toUpperCase())}
              placeholder="e.g. E0174"
              maxLength={20}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            />
            <span className="mt-1 block font-normal text-tertiary-400">New employees get the next number automatically; change it to match HR records.</span>
          </label>
          <label className="text-xs font-medium text-tertiary-600">
            Employment status
            <select value={fields.employment_status} onChange={(event) => setField('employment_status', event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
              {EMPLOYMENT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {(fields.employment_status === 'notice_period' || fields.employment_status === 'terminated' || fields.notice_end_date) && (
            <>
              <label className="text-xs font-medium text-tertiary-600">
                Notice given on
                <input type="date" value={fields.notice_start_date} onChange={(event) => setField('notice_start_date', event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-medium text-tertiary-600">
                Last working day (LWD)
                <input type="date" min={fields.notice_start_date || undefined} value={fields.notice_end_date} onChange={(event) => setField('notice_end_date', event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
                {noticeDays(fields.notice_start_date, fields.notice_end_date) !== null && (
                  <span className="mt-1 block font-normal text-tertiary-400">Notice period: {noticeDays(fields.notice_start_date, fields.notice_end_date)} days</span>
                )}
              </label>
            </>
          )}
          <label className="text-xs font-medium text-tertiary-600">
            User type
            <select value={fields.worker_type} onChange={(event) => setField('worker_type', event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
              {WORKER_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {fields.worker_type === 'contractor' ? (
            <>
              <label className="text-xs font-medium text-tertiary-600">
                Vendor
                <div className="mt-1">
                  <SearchableSelect value={fields.vendor_account_id} onChange={(value) => setField('vendor_account_id', value)} options={options.vendors} placeholder="Select vendor" searchPlaceholder="Search vendors" />
                </div>
              </label>
              <label className="text-xs font-medium text-tertiary-600">
                Vendor rate (per month)
                <input type="number" min="0" step="0.01" value={fields.vendor_rate} onChange={(event) => setField('vendor_rate', event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
              </label>
            </>
          ) : <div className="hidden sm:block" />}
          {teamChanged && (
            <label className="text-xs font-medium text-tertiary-600 sm:col-span-2">
              Team change effective from
              <input type="date" required max={todayKey} value={teamEffective} onChange={(event) => setTeamEffective(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm sm:w-56" />
              <span className="mt-1 block font-normal text-tertiary-400">Before this date they stay on their previous team in capacity, salary and history reports.</span>
            </label>
          )}
          {fieldsConfig.map(([key, label, selectOptions]) => (
            <label key={key} className="text-xs font-medium text-tertiary-600">
              {label}
              <div className="mt-1">
                <SearchableSelect
                  value={fields[key]}
                  onChange={(value) => setField(key, value)}
                  options={selectOptions}
                  allowClear
                  placeholder={`Select ${label.toLowerCase()}`}
                  searchPlaceholder={`Search ${label.toLowerCase()}`}
                />
              </div>
            </label>
          ))}
        </form>
      )}
    </Drawer>
  );
}

export default function EmployeeProfilePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const [row, setRow] = useState(null);
  const [options, setOptions] = useState(EMPTY_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiClient.get(`/orgs/memberships/${id}`),
      user?.role === 'admin' ? apiClient.get('/departments') : Promise.resolve({ data: { data: [] } }),
      user?.role === 'admin' ? apiClient.get('/designations') : Promise.resolve({ data: { data: [] } }),
      user?.role === 'admin' ? apiClient.get('/teams') : Promise.resolve({ data: { data: [] } }),
      user?.role === 'admin' ? apiClient.get('/billing/vendors') : Promise.resolve({ data: { data: [] } }),
      apiClient.get('/orgs/locations'),
      apiClient.get('/attendance/shifts'),
      apiClient.get('/orgs/memberships'),
    ])
      .then(([profile, departments, designations, teams, vendors, locations, shifts, people]) => {
        if (cancelled) return;
        setRow(profile.data.data);
        setOptions({
          departments: departments.data.data || [],
          designations: designations.data.data || [],
          teams: teams.data.data || [],
          vendors: vendors.data.data || [],
          locations: locations.data.data || [],
          shifts: shifts.data.data || [],
          managerOptions: (people.data.data || []).map((membership) => ({
            value: membership.id,
            label: membership.person.name,
          })),
          personOptions: (people.data.data || []).map((membership) => ({
            value: membership.person.id,
            label: membership.person.name,
          })),
        });
      })
      .catch((err) => {
        if (!cancelled) pushError(apiErrorMessage(err, 'Failed to load employee profile'), 'Something went wrong');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, pushError, user?.role]);

  function handleSaved(updated) {
    setRow(updated);
    setEditOpen(false);
  }

  if (loading) return <div className="rounded-2xl border border-tertiary-100 bg-white p-8 text-sm text-tertiary-500">Loading employee profile...</div>;
  if (!row) return <div className="rounded-2xl border border-danger-100 bg-danger-50 p-6 text-sm text-danger-700">Employee profile could not be found.</div>;

  const canEdit = user?.role === 'admin';
  const selectOptions = {
    departments: optionsFor(options.departments),
    designations: optionsFor(options.designations),
    teams: optionsFor(options.teams),
    vendors: optionsFor(options.vendors),
    locations: optionsFor(options.locations),
    shifts: optionsFor(options.shifts),
    managerOptions: options.managerOptions,
    personOptions: options.personOptions,
  };

  return (
    <div className="space-y-4">
      <Link to="/people" className="inline-flex items-center gap-2 text-sm font-medium text-primary-700 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to People
      </Link>
      <section className="rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-50 text-primary-700">
              <UserRound className="h-6 w-6" />
            </div>
            <div>
              <h2 className="font-heading text-2xl font-semibold text-tertiary-900">{row.person.name}</h2>
              <p className="text-sm text-tertiary-500">{row.person.email}</p>
            </div>
          </div>
          {canEdit && (
            <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" /> Edit organization details
            </button>
          )}
        </div>
      </section>
      <section className="rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card">
        <h3 className="mb-4 font-heading text-base font-semibold text-tertiary-900">Employment details</h3>
        <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <PeekField label="Role"><span className="capitalize">{row.role}</span></PeekField>
          <PeekField label="Employment status"><Badge value={row.employment_status} /></PeekField>
          <PeekField label="User type">{row.worker_type === 'contractor' ? 'Contractor' : 'Full-Time Employee'}</PeekField>
          {row.worker_type === 'contractor' && (
            <>
              <PeekField label="Vendor">{row.vendor_account?.name || 'Not set'}</PeekField>
              <PeekField label="Vendor rate (monthly)">{formatMoney(row.vendor_rate, row.vendor_rate_currency)}</PeekField>
            </>
          )}
          <PeekField label="Employee code">{row.employee_code || 'Not assigned'}</PeekField>
          <PeekField label="Department">{row.department?.name || 'Not assigned'}</PeekField>
          <PeekField label="Designation">{row.designation?.name || 'Not assigned'}</PeekField>
          <PeekField label="Team">{row.team?.name || 'Not assigned'}</PeekField>
          <PeekField label="Work mode">{workModeLabel(row.work_mode)}</PeekField>
          <PeekField label="Location">{row.location?.name || 'Not assigned'}</PeekField>
          <PeekField label="Shift">{row.shift?.name || 'Not assigned'}</PeekField>
          <PeekField label="Manager">{row.manager?.person?.name || 'Not assigned'}</PeekField>
          <PeekField label="HR POC">{row.hr_poc?.name || 'Not assigned'}</PeekField>
          <PeekField label="Sourcing POC">{row.sourcing_poc?.name || 'Not assigned'}</PeekField>
          <PeekField label="Joined">{formatDate(row.joined_at)}</PeekField>
          {(row.employment_status === 'notice_period' || row.notice_end_date) && (
            <>
              <PeekField label="Notice given on">{formatDate(row.notice_start_date)}</PeekField>
              <PeekField label="Last working day (LWD)">
                {formatDate(row.notice_end_date)}
                {noticeDays(row.notice_start_date, row.notice_end_date) !== null && (
                  <span className="ml-1.5 text-xs text-tertiary-500">· {noticeDays(row.notice_start_date, row.notice_end_date)}-day notice</span>
                )}
              </PeekField>
            </>
          )}
        </dl>
      </section>
      {/* Bank, emergency contact, documents — renders only for an admin or the employee themselves. */}
      <ReportingSection membershipId={row.id} />
      <PersonalDetailsSection membershipId={row.id} />
      <CalendarMappingSection membershipId={row.id} locationName={row.location?.name} canEdit={canEdit} />
      <EditMembershipDrawer
        open={editOpen}
        row={row}
        options={selectOptions}
        onClose={() => setEditOpen(false)}
        onSaved={handleSaved}
      />
    </div>
  );
}
