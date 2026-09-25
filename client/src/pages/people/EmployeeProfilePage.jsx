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

const EMPTY_OPTIONS = {
  departments: [],
  designations: [],
  locations: [],
  shifts: [],
  managerOptions: [],
  personOptions: [],
};

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : 'Not set';
}

function optionsFor(rows, label = 'name') {
  return rows.map((row) => ({ value: row.id, label: row[label] }));
}

function EditMembershipDrawer({ open, row, options, onClose, onSaved }) {
  const { pushError } = useAlerts();
  const [fields, setFields] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && row) {
      setFields({
        department_id: row.department?.id || '',
        designation_id: row.designation?.id || '',
        location_id: row.location?.id || '',
        shift_id: row.shift?.id || '',
        manager_id: row.manager?.id || '',
        hr_poc_id: row.hr_poc?.id || '',
        sourcing_poc_id: row.sourcing_poc?.id || '',
      });
    }
  }, [open, row]);

  function setField(key, value) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!fields || !row) return;
    const patch = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, value || null])
    );
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
      apiClient.get('/orgs/locations'),
      apiClient.get('/attendance/shifts'),
      apiClient.get('/orgs/memberships'),
    ])
      .then(([profile, departments, designations, locations, shifts, people]) => {
        if (cancelled) return;
        setRow(profile.data.data);
        setOptions({
          departments: departments.data.data || [],
          designations: designations.data.data || [],
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
          <PeekField label="Employee code">{row.employee_code || 'Not assigned'}</PeekField>
          <PeekField label="Department">{row.department?.name || 'Not assigned'}</PeekField>
          <PeekField label="Designation">{row.designation?.name || 'Not assigned'}</PeekField>
          <PeekField label="Location">{row.location?.name || 'Not assigned'}</PeekField>
          <PeekField label="Shift">{row.shift?.name || 'Not assigned'}</PeekField>
          <PeekField label="Manager">{row.manager?.person?.name || 'Not assigned'}</PeekField>
          <PeekField label="HR POC">{row.hr_poc?.name || 'Not assigned'}</PeekField>
          <PeekField label="Sourcing POC">{row.sourcing_poc?.name || 'Not assigned'}</PeekField>
          <PeekField label="Joined">{formatDate(row.joined_at)}</PeekField>
          <PeekField label="Notice end">{formatDate(row.notice_end_date)}</PeekField>
        </dl>
      </section>
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
