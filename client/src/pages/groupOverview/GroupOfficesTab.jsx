import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, MapPin, Pencil, Plus, Trash2, Users } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Skeleton from '../../components/ui/Skeleton.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import { FIELD_INPUT } from '../../components/ui/formLayout.jsx';
import { ConfirmDialog } from '../../components/resignation/resignationShared.jsx';
import { KpiTile, SectionHeading } from './groupUi.jsx';

const STATUS_OPTIONS = [
  { value: 'working', label: 'Working now (incl. notice, on leave)' },
  { value: 'active', label: 'Active' },
  { value: 'notice_period', label: 'Serving notice' },
  { value: 'on_leave', label: 'On leave' },
  { value: 'pending_onboarding', label: 'New hire (not joined yet)' },
  { value: 'terminated', label: 'Exited' },
  { value: 'all', label: 'All statuses' },
];
const WORK_MODE_OPTIONS = [
  { value: 'onsite', label: 'On-site' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'remote', label: 'Remote' }, { value: 'not_set', label: 'Not set' },
];
const USER_TYPE_OPTIONS = [{ value: 'full_time_employee', label: 'Employee' }, { value: 'contractor', label: 'Contractor' }];
const STATUS_TEXT = { active: 'Active', notice_period: 'Serving notice', on_leave: 'On leave', pending_onboarding: 'New hire', terminated: 'Exited' };
const MODE_TEXT = { onsite: 'On-site', hybrid: 'Hybrid', remote: 'Remote' };
const BLANK = { name: '', city: '', country: '', address: '', is_default: false };

const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-tertiary-500';
const td = 'px-3 py-2';

/** A count that opens the people behind it. A zero is plain text: there is nothing to open. */
function Count({ value, onClick, label }) {
  if (!value) return <span className="text-tertiary-300">0</span>;
  return (
    <button type="button" data-testid="office-count" title="Click to see the employees" aria-label={label} onClick={onClick} className="min-w-[1.75rem] rounded-md px-1.5 py-0.5 font-semibold tabular-nums text-primary-700 hover:bg-primary-50 hover:underline">
      {value}
    </button>
  );
}

/** Group Dashboard > Offices: headcount per office location for every company, the employees behind each count, and add / edit / delete of a company's locations. */
export default function GroupOfficesTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [filters, setFilters] = useState({ status: '', work_mode: '', user_type: '' });
  const [data, setData] = useState(null);
  const [people, setPeople] = useState(null); // { title, loading, data, error }
  const [editor, setEditor] = useState(null); // { orgId, id?, form }
  const [removing, setRemoving] = useState(null); // { orgId, location }
  const [busy, setBusy] = useState(false);
  const [assign, setAssign] = useState(null); // { membershipId, locationId } while one employee's office is being chosen
  const [assigning, setAssigning] = useState(false);

  const params = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), [filters]);
  const load = useCallback(() => apiClient.get('/group-offices', { params }).then(({ data: res }) => setData(res.data)).catch((err) => pushError(apiErrorMessage(err, 'Failed to load the offices'), 'Something went wrong')), [params, pushError]);
  useEffect(() => { load(); }, [load]);

  async function showPeople(title, query) {
    setPeople({ title, query, loading: true });
    setAssign(null);
    try {
      const { data: res } = await apiClient.get('/group-offices/people', { params: { ...params, ...query } });
      setPeople({ title, query, data: res.data });
    } catch (err) {
      setPeople({ title, query, error: apiErrorMessage(err, 'Failed to load the employees') });
    }
  }

  // Place one employee in an office of their own company (by office id, never by name), then refresh the drawer list and every count.
  async function saveAssign() {
    if (!assign?.locationId) return pushError('Choose an office, or cancel.', 'Office needed');
    setAssigning(true);
    try {
      await apiClient.patch(`/group-offices/memberships/${assign.membershipId}/location`, { location_id: assign.locationId });
      const { title, query } = people;
      const [{ data: res }] = await Promise.all([apiClient.get('/group-offices/people', { params: { ...params, ...query } }), load()]);
      setPeople({ title, query, data: res.data });
      setAssign(null);
      pushSuccess('Office assigned.', 'Saved');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to assign the office'), 'Could not save');
    } finally {
      setAssigning(false);
    }
  }

  const companies = data?.companies || [];
  const companyOptions = companies.map((c) => ({ value: c.org.id, label: c.org.name }));
  const setField = (k) => (e) => setEditor((p) => ({ ...p, form: { ...p.form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } }));

  async function save() {
    const { orgId, id, form } = editor;
    if (!orgId) return pushError('Choose the company for this office.', 'Company needed');
    if (!form.name.trim()) return pushError('Give the office a name.', 'Name needed');
    setBusy(true);
    try {
      const body = { name: form.name.trim(), city: form.city.trim() || undefined, country: form.country.trim() || undefined, address: form.address.trim() || undefined, is_default: form.is_default };
      if (id) await apiClient.patch(`/group-offices/${orgId}/locations/${id}`, { ...body, city: form.city.trim() || null, country: form.country.trim() || null, address: form.address.trim() || null });
      else await apiClient.post('/group-offices/locations', { org_id: orgId, ...body });
      setEditor(null);
      await load();
      pushSuccess(id ? 'Office updated.' : 'Office added.', 'Saved');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save the office'), 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const { orgId, location } = removing;
    setBusy(true);
    try {
      await apiClient.delete(`/group-offices/${orgId}/locations/${location.id}`);
      setRemoving(null);
      await load();
      pushSuccess('Office deleted.', 'Deleted');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to delete the office'), 'Could not delete');
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  }

  const openAdd = (orgId = '') => setEditor({ orgId, form: BLANK });
  const openEdit = (orgId, l) => setEditor({ orgId, id: l.id, form: { name: l.name, city: l.city || '', country: l.country || '', address: l.address || '', is_default: l.is_default } });

  if (!data) return <Skeleton className="h-64 w-full" />;
  const { totals, by_office } = data;

  return (
    <div className="space-y-4" data-testid="group-offices">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Companies" value={totals.companies} icon={Building2} theme="blue" hint="in the group" />
        <KpiTile label="Office locations" value={totals.offices} icon={MapPin} theme="green" hint="across all companies" />
        <KpiTile label="People" value={totals.people} icon={Users} theme="purple" hint="matching the filters below" />
        <KpiTile label="With no office set" value={totals.no_office} icon={Users} theme="orange" hint="not placed in an office yet" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card">
        <div className="flex flex-wrap items-center gap-3" data-testid="office-filters">
          <SearchableSelect className="w-60" allowClear ariaLabel="Employee status" value={filters.status} onChange={(v) => setFilters((f) => ({ ...f, status: v }))} placeholder="Status: working now" searchPlaceholder="Search…" options={STATUS_OPTIONS} />
          <SearchableSelect className="w-44" allowClear ariaLabel="Work mode" value={filters.work_mode} onChange={(v) => setFilters((f) => ({ ...f, work_mode: v }))} placeholder="Work mode: all" searchPlaceholder="Search…" options={WORK_MODE_OPTIONS} />
          <SearchableSelect className="w-44" allowClear ariaLabel="User type" value={filters.user_type} onChange={(v) => setFilters((f) => ({ ...f, user_type: v }))} placeholder="User type: all" searchPlaceholder="Search…" options={USER_TYPE_OPTIONS} />
        </div>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" data-testid="add-office-top" onClick={() => openAdd()}><Plus className="h-4 w-4" /> Add office</button>
      </div>

      <SectionHeading title="By office, whole group" hint="Offices with the same name are added up across companies" />
      <div className="overflow-x-auto rounded-xl border border-tertiary-100 bg-white shadow-card" data-testid="office-rollup">
        <table className="min-w-full text-sm">
          <thead className="bg-canvas-muted"><tr><th className={th}>Office</th><th className={th}>People</th><th className={th}>By company</th></tr></thead>
          <tbody>
            {by_office.map((o) => (
              <tr key={o.name} className="border-t border-tertiary-100" data-testid="office-rollup-row">
                <td className={`${td} font-medium text-tertiary-900`}><MapPin className="mr-1 inline h-3.5 w-3.5 text-primary-600" />{o.name}</td>
                <td className={td}><Count value={o.people_count} label={`${o.name}: employees`} onClick={() => showPeople(`${o.name} · whole group`, { office_name: o.name })} /></td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1.5">
                    {o.companies.map((c) => (
                      <span key={c.org_id} className="inline-flex items-center gap-1 rounded-full border border-tertiary-200 bg-white px-2 py-0.5 text-xs text-tertiary-700">{c.org}<b className="tabular-nums text-tertiary-900">{c.people_count}</b></span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {!by_office.length && <tr><td colSpan={3} className="px-3 py-6 text-center text-sm text-tertiary-500">No office locations yet. Add the first one with the Add office button.</td></tr>}
          </tbody>
        </table>
      </div>

      <SectionHeading title="Company by company" hint="Add, edit or delete a company's offices here; the same list is used in its own Settings and Offices page" />
      <div className="space-y-4">
        {companies.map((c) => (
          <section key={c.org.id} className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="company-offices" data-company={c.org.name}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="font-heading text-base font-semibold text-tertiary-900">{c.org.name}</h3>
                {c.org.coming_soon && <Pill tone="amber">Coming soon</Pill>}
                <span className="text-xs text-tertiary-500">{c.total_people} people · {c.locations.length} office{c.locations.length === 1 ? '' : 's'}</span>
              </div>
              <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" data-testid="add-office-company" onClick={() => openAdd(c.org.id)}><Plus className="h-3.5 w-3.5" /> Add office</button>
            </div>
            <div className="mt-3 overflow-x-auto rounded-xl border border-tertiary-100">
              <table className="min-w-full text-sm">
                <thead className="bg-canvas-muted"><tr><th className={th}>Office</th><th className={th}>City, country</th><th className={th}>Address</th><th className={th}>People</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {c.locations.map((l) => (
                    <tr key={l.id} className="border-t border-tertiary-100" data-testid="office-row">
                      <td className={`${td} font-medium text-tertiary-900`}>{l.name}{l.is_default && <span className="ml-1.5"><Pill tone="blue">Default</Pill></span>}</td>
                      <td className={td}>{[l.city, l.country].filter(Boolean).join(', ') || '—'}</td>
                      <td className={`${td} whitespace-pre-line text-xs text-tertiary-600`}>{l.address || '—'}</td>
                      <td className={td}><Count value={l.people_count} label={`${c.org.name} ${l.name}: employees`} onClick={() => showPeople(`${c.org.name} · ${l.name}`, { org_id: c.org.id, location_id: l.id })} /></td>
                      <td className={`${td} whitespace-nowrap text-right`}>
                        <button type="button" aria-label={`Edit ${l.name}`} title="Edit" className="rounded p-1.5 text-tertiary-500 hover:bg-primary-50" onClick={() => openEdit(c.org.id, l)}><Pencil className="h-4 w-4" /></button>
                        <button type="button" aria-label={`Delete ${l.name}`} title="Delete" className="rounded p-1.5 text-danger-600 hover:bg-danger-50" onClick={() => setRemoving({ orgId: c.org.id, location: l })}><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                  {c.no_office_count > 0 && (
                    <tr className="border-t border-tertiary-100 bg-warning-50/40">
                      <td className={`${td} italic text-tertiary-700`}>No office set</td><td className={td}>—</td><td className={`${td} text-xs text-tertiary-500`}>People not placed in an office yet</td>
                      <td className={td}><Count value={c.no_office_count} label={`${c.org.name} no office: employees`} onClick={() => showPeople(`${c.org.name} · no office set`, { org_id: c.org.id, location_id: 'none' })} /></td><td />
                    </tr>
                  )}
                  {!c.locations.length && !c.no_office_count && <tr><td colSpan={5} className="px-3 py-5 text-center text-sm text-tertiary-500">No offices yet for this company.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      <Drawer open={Boolean(people)} onClose={() => setPeople(null)} title={people?.title || ''} size="xl" tone="info">
        {people?.loading && <p className="text-sm text-tertiary-500">Loading…</p>}
        {people?.error && <p className="text-sm text-danger-700">{people.error}</p>}
        {people?.data && (
          <div className="space-y-2" data-testid="office-people">
            <p className="text-xs text-tertiary-500">{people.data.total} employee{people.data.total === 1 ? '' : 's'}</p>
            <div className="overflow-x-auto rounded-xl border border-tertiary-100">
              <table className="min-w-full text-sm">
                <thead className="bg-canvas-muted"><tr><th className={th}>Name</th><th className={th}>Code</th><th className={th}>Company</th><th className={th}>Office</th><th className={th}>Designation</th><th className={th}>Department</th><th className={th}>Status</th><th className={th}>Work mode</th><th className={th}>Actions</th></tr></thead>
                <tbody>
                  {!people.data.items.length && <tr><td colSpan={9} className="px-3 py-6 text-center text-sm text-tertiary-500" data-testid="office-people-empty">No employees here{people.query?.location_id === 'none' ? ' - everyone has been placed in an office' : ''}.</td></tr>}
                  {people.data.items.map((p) => {
                    const offices = companies.find((c) => c.org.id === p.org_id)?.locations || [];
                    const editing = assign?.membershipId === p.membership_id;
                    return (
                    <tr key={p.membership_id} className="border-t border-tertiary-100" data-testid="office-person-row">
                      <td className={`${td} font-medium text-tertiary-900`}>{p.name}<span className="block text-[11px] font-normal text-tertiary-500">{p.email}</span></td>
                      <td className={td}>{p.employee_code || '—'}</td><td className={td}>{p.company}</td><td className={td}>{p.office || '—'}</td>
                      <td className={td}>{p.designation || '—'}</td><td className={td}>{p.department || '—'}</td>
                      <td className={td}>{STATUS_TEXT[p.employment_status] || p.employment_status}{p.worker_type === 'contractor' && <span className="ml-1 text-[11px] text-tertiary-500">(contractor)</span>}</td>
                      <td className={td}>{MODE_TEXT[p.work_mode] || '—'}</td>
                      <td className={`${td} whitespace-nowrap`}>
                        {editing ? (
                          <div className="flex items-center gap-1.5" data-testid="assign-office">
                            <SearchableSelect className="w-44" ariaLabel={`Office for ${p.name}`} value={assign.locationId} onChange={(v) => setAssign((a) => ({ ...a, locationId: v }))} placeholder="Choose an office" searchPlaceholder="Search offices…" options={offices.map((o) => ({ value: o.id, label: o.name }))} />
                            <button type="button" className="btn-primary text-xs" data-testid="assign-office-save" disabled={assigning || !assign.locationId} onClick={saveAssign}>{assigning ? 'Saving…' : 'Save'}</button>
                            <button type="button" className="btn-secondary text-xs" disabled={assigning} onClick={() => setAssign(null)}>Cancel</button>
                          </div>
                        ) : (
                          <button type="button" aria-label={`Assign office to ${p.name}`} title={offices.length ? 'Assign office' : 'Add an office to this company first'} disabled={!offices.length || assigning} className="rounded p-1.5 text-tertiary-500 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setAssign({ membershipId: p.membership_id, locationId: '' })}><Pencil className="h-4 w-4" /></button>
                        )}
                        {!editing && !offices.length && <span className="ml-1 text-[11px] text-tertiary-500">Add an office first</span>}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Drawer>

      <Drawer open={Boolean(editor)} onClose={() => setEditor(null)} title={editor?.id ? 'Edit office' : 'Add office'} tone={editor?.id ? 'edit' : 'create'}
        footer={<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setEditor(null)}>Cancel</button><button type="button" className="btn-primary" data-testid="save-office" disabled={busy} onClick={save}>{busy ? 'Saving…' : editor?.id ? 'Save changes' : 'Add office'}</button></div>}>
        {editor && (
          <div className="space-y-4" data-testid="office-form">
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Company *</label>
              {editor.id ? <p className="text-sm font-medium text-tertiary-900">{companyOptions.find((o) => o.value === editor.orgId)?.label}</p> : (
                <SearchableSelect ariaLabel="Company" value={editor.orgId} onChange={(v) => setEditor((p) => ({ ...p, orgId: v }))} placeholder="Choose the company" searchPlaceholder="Search companies…" options={companyOptions} />
              )}
            </div>
            <div><label className="mb-1 block text-xs font-medium text-tertiary-600">Office name *</label><input className={FIELD_INPUT} aria-label="Office name" value={editor.form.name} onChange={setField('name')} placeholder="e.g. Indore" maxLength={100} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="mb-1 block text-xs font-medium text-tertiary-600">City</label><input className={FIELD_INPUT} aria-label="City" value={editor.form.city} onChange={setField('city')} maxLength={100} /></div>
              <div><label className="mb-1 block text-xs font-medium text-tertiary-600">Country</label><input className={FIELD_INPUT} aria-label="Country" value={editor.form.country} onChange={setField('country')} maxLength={100} /></div>
            </div>
            <div><label className="mb-1 block text-xs font-medium text-tertiary-600">Address</label><textarea rows={3} className={FIELD_INPUT} aria-label="Address" value={editor.form.address} onChange={setField('address')} maxLength={500} /></div>
            <label className="flex items-center gap-2 text-sm text-tertiary-700"><input type="checkbox" checked={editor.form.is_default} onChange={setField('is_default')} /> Default office of this company</label>
            <p className="text-xs text-tertiary-500">The default moves if another office was the default before. People are placed in an office from their profile.</p>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={Boolean(removing)}
        danger
        busy={busy}
        title="Delete this office?"
        message={removing ? `${removing.location.name} will be removed. An office that employees, calendars or expense claims still use cannot be deleted; move them to another office first.` : ''}
        confirmLabel="Delete office"
        onConfirm={remove}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
