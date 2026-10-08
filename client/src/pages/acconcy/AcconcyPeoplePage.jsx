import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Pencil, Plus, Trash2, UserCog, Users } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { acconcyApi, acconcyError } from '../../lib/acconcy/api.js';
import { useAcconcy, axCan } from '../../lib/acconcy/useAcconcy.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import FilterBar from '../../components/zephyr/FilterBar.jsx';
import { Area, DateInput, Detail, Num, Section, Select, Text, dayOf, toBody } from '../../components/acconcy/ui.jsx';

const KIND_OPTIONS = [{ value: 'employee', label: 'Employee' }, { value: 'contractor', label: 'Contractor' }];
const ACCESS = [
  { value: 'none', label: 'No login access' },
  { value: 'manager', label: 'Manager (leads, deals, expenses, tasks)' },
  { value: 'finance', label: 'Finance (money, payments, P&L, month close)' },
  { value: 'staff', label: 'Staff (assigned work only)' },
  { value: 'contractor', label: 'Contractor (assigned tasks only)' },
];
const ACCESS_LABEL = { none: 'No login', manager: 'Manager', finance: 'Finance', staff: 'Staff', contractor: 'Contractor' };
const FIELDS = ['name', 'kind', 'designation', 'phone', 'email', 'joining_date', 'leaving_date', 'notes', 'monthly_salary', 'access_role', 'user_id'];

function PersonForm({ initial, isAdmin, users, onSubmit, onCancel, saving }) {
  const [v, setV] = useState(() => ({ ...Object.fromEntries(FIELDS.map((k) => [k, initial?.[k] ?? (k === 'kind' ? 'employee' : k === 'access_role' ? 'none' : '')])), active: initial?.active ?? true }));
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const body = toBody(v, { numbers: ['monthly_salary'] });
        body.name = v.name.trim();
        if (!isAdmin) { delete body.access_role; delete body.user_id; delete body.monthly_salary; }
        onSubmit(body);
      }}
      className="space-y-4"
    >
      <Section title="Person">
        <Text label="Name" className="sm:col-span-2" value={v.name} onChange={set('name')} required maxLength={200} autoFocus />
        <Select label="Type" value={v.kind} onChange={set('kind')} options={KIND_OPTIONS} />
        <Text label="Designation" value={v.designation} onChange={set('designation')} maxLength={120} />
        <Text label="Phone" value={v.phone} onChange={set('phone')} maxLength={40} />
        <Text label="Email" type="email" value={v.email} onChange={set('email')} maxLength={200} />
        <DateInput label="Joining date" value={v.joining_date} onChange={set('joining_date')} />
        <DateInput label="Leaving date" value={v.leaving_date} onChange={set('leaving_date')} />
        <label className="flex items-center gap-2 text-sm text-tertiary-700 sm:col-span-2"><input type="checkbox" checked={v.active} onChange={(e) => set('active')(e.target.checked)} />Active (can be assigned work)</label>
        <Area label="Notes" className="sm:col-span-2" rows={2} value={v.notes} onChange={set('notes')} maxLength={2000} />
      </Section>
      {isAdmin && (
        <Section title="Pay" hint="Used to generate the monthly salary sheet (employees) or the monthly fee (contractors). Only admins can see or change it.">
          <Num label="Monthly salary / fee" value={v.monthly_salary} onChange={set('monthly_salary')} />
        </Section>
      )}
      {isAdmin && (
        <Section title="Login and access" hint="Link this person to a login to give them access. Roles decide what they can see and change.">
          <Select label="Linked login" value={v.user_id} onChange={set('user_id')} options={users.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))} blank="No login linked" />
          <Select label="Access role" value={v.access_role} onChange={set('access_role')} options={ACCESS} />
        </Section>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </form>
  );
}

function UserForm({ initial, onSubmit, onCancel, saving }) {
  const [v, setV] = useState({ name: initial?.name || '', email: initial?.email || '', phone: initial?.phone || '', password: '', access_role: 'staff' });
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const body = toBody(v);
        if (initial) { delete body.password; delete body.access_role; }
        onSubmit(body);
      }}
      className="space-y-4"
    >
      <Section title={initial ? 'Edit login' : 'New login'} hint={initial ? undefined : 'Creates a sign-in for this company. Share the email and password with the person.'}>
        <Text label="Name" value={v.name} onChange={set('name')} required maxLength={200} autoFocus />
        <Text label="Email" type="email" value={v.email} onChange={set('email')} required maxLength={200} />
        <Text label="Phone" value={v.phone} onChange={set('phone')} maxLength={40} />
        {!initial && <Text label="Password" type="password" value={v.password} onChange={set('password')} required minLength={8} />}
        {!initial && <Select label="Access role" value={v.access_role} onChange={set('access_role')} options={[{ value: 'admin', label: 'Admin (full access)' }, ...ACCESS.filter((a) => a.value !== 'none')]} />}
      </Section>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </form>
  );
}

export default function AcconcyPeoplePage() {
  const { me, loading } = useAcconcy();
  const { pushError, pushSuccess } = useAlerts();
  const [tab, setTab] = useState('roster');
  const [kind, setKind] = useState('all');
  const [active, setActive] = useState('all');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [drawer, setDrawer] = useState(null);
  const [saving, setSaving] = useState(false);
  const isAdmin = me?.role === 'admin';

  const loadPeople = useCallback(() => acconcyApi.people({ kind, active, ...(q.trim() ? { q: q.trim() } : {}) }).then(setRows, (e) => pushError(acconcyError(e, 'Could not load'), 'Load failed')), [kind, active, q, pushError]);
  const loadUsers = useCallback(() => acconcyApi.users({}).then(setUsers, () => setUsers([])), []);
  useEffect(() => { if (me && axCan(me, 'people')) loadPeople(); }, [me, loadPeople]);
  useEffect(() => { if (isAdmin) loadUsers(); }, [isAdmin, loadUsers]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!axCan(me, 'people')) return <Navigate to="/acconcy" replace />;

  async function savePerson(body) {
    setSaving(true);
    try {
      if (drawer.person) await acconcyApi.updatePerson(drawer.person.id, body);
      else await acconcyApi.createPerson(body);
      pushSuccess('Saved');
      setDrawer(null);
      loadPeople();
    } catch (e) {
      pushError(acconcyError(e, 'Could not save'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  async function saveUser(body) {
    setSaving(true);
    try {
      if (drawer.user) await acconcyApi.updateUser(drawer.user.id, body);
      else await acconcyApi.createUser(body);
      pushSuccess('Saved');
      setDrawer(null);
      loadUsers();
      loadPeople();
    } catch (e) {
      pushError(acconcyError(e, 'Could not save'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  async function removePerson(p) {
    if (!window.confirm(`Remove ${p.name} from the roster?`)) return;
    try { await acconcyApi.deletePerson(p.id); loadPeople(); } catch (e) { pushError(acconcyError(e, 'Could not delete'), 'Delete failed'); }
  }
  async function toggleUser(u) {
    let reason;
    if (u.active) { reason = window.prompt(`Reason for deactivating ${u.name} (optional):`) ?? undefined; if (reason === undefined) return; }
    try { await acconcyApi.setUserActive(u.id, { active: !u.active, ...(reason ? { reason } : {}) }); loadUsers(); loadPeople(); } catch (e) { pushError(acconcyError(e, 'Could not update'), 'Could not update'); }
  }

  const columns = [
    { key: 'name', header: 'Name', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span>{r.designation && <span className="block text-xs text-tertiary-500">{r.designation}</span>}</span> },
    { key: 'kind', header: 'Type', render: (r) => <Pill tone={r.kind === 'contractor' ? 'amber' : 'blue'}>{r.kind === 'contractor' ? 'Contractor' : 'Employee'}</Pill> },
    { key: 'contact', header: 'Contact', render: (r) => [r.phone, r.email].filter(Boolean).join(' · ') || '-' },
    { key: 'access', header: 'Access', render: (r) => <Pill tone={r.access_role === 'none' ? 'gray' : 'green'}>{ACCESS_LABEL[r.access_role]}</Pill> },
    { key: 'status', header: 'Status', render: (r) => <Pill value={r.active ? 'active' : 'inactive'} /> },
    { key: 'actions', header: '', render: (r) => (
      <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <button type="button" title="Edit" className="rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => setDrawer({ person: r })}><Pencil className="h-4 w-4" /></button>
        {axCan(me, 'delete') && <button type="button" title="Remove" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => removePerson(r)}><Trash2 className="h-4 w-4" /></button>}
      </span>
    ) },
  ];
  const userCols = [
    { key: 'name', header: 'Name', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{r.email}</span></span> },
    { key: 'role', header: 'Role', render: (r) => <Pill tone="green">{r.role === 'admin' ? 'Admin' : ACCESS_LABEL[r.acconcy_person?.access_role] || 'No access'}</Pill> },
    { key: 'status', header: 'Status', render: (r) => <Pill value={r.active ? 'active' : 'inactive'} /> },
    { key: 'actions', header: '', render: (r) => (
      <span className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="text-xs font-medium text-primary-700 hover:underline" onClick={() => setDrawer({ user: r })}>Edit</button>
        <button type="button" className="text-xs font-medium text-tertiary-600 hover:underline" onClick={() => toggleUser(r)}>{r.active ? 'Deactivate' : 'Reactivate'}</button>
      </span>
    ) },
  ];

  const tabs = [{ key: 'roster', label: 'Roster', icon: Users }, ...(isAdmin ? [{ key: 'logins', label: 'Logins', icon: UserCog }] : [])];
  const person = drawer?.person;
  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={tabs} value={tab} onChange={setTab} className="min-w-0" />
      {tab === 'roster' && (
        <>
          <FilterBar
            q={q}
            onQ={setQ}
            searchPlaceholder="Search name, designation, phone..."
            fields={[
              { key: 'kind', label: 'Type', type: 'select', any: 'All', options: KIND_OPTIONS },
              { key: 'active', label: 'Status', type: 'select', any: 'All', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }] },
            ]}
            values={{ kind, active }}
            defaults={{ kind: 'all', active: 'all' }}
            onChange={(k, v) => ({ kind: setKind, active: setActive })[k](v)}
            onReset={() => { setKind('all'); setActive('all'); setQ(''); }}
          >
            <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ person: null, create: true })}><Plus className="h-4 w-4" />Add person</button>
          </FilterBar>
          <DataTable columns={columns} rows={rows} emptyLabel="No people yet. Add employees and contractors to assign them to leads, deals and tasks." onRowClick={(r) => setDrawer({ person: r })} maxHeight="62vh" />
        </>
      )}
      {tab === 'logins' && isAdmin && (
        <>
          <div className="flex justify-end"><button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ user: null, createUser: true })}><Plus className="h-4 w-4" />New login</button></div>
          <DataTable columns={userCols} rows={users} emptyLabel="No logins." />
        </>
      )}
      <Drawer open={Boolean(drawer)} onClose={() => setDrawer(null)} size="xl" tone={drawer?.person || drawer?.user ? 'edit' : 'create'} title={drawer?.user || drawer?.createUser ? (drawer.user ? `Edit ${drawer.user.name}` : 'New login') : person ? `Edit ${person.name}` : 'Add person'}>
        {drawer && (drawer.user || drawer.createUser) && <UserForm key={drawer.user?.id || 'new'} initial={drawer.user} saving={saving} onSubmit={saveUser} onCancel={() => setDrawer(null)} />}
        {drawer && !(drawer.user || drawer.createUser) && (
          <div className="space-y-4">
            {person && <dl className="grid gap-3 sm:grid-cols-2"><Detail label="Joined">{dayOf(person.joining_date)}</Detail><Detail label="Created">{dayOf(person.created_at)}</Detail></dl>}
            <PersonForm key={person?.id || 'new'} initial={person} isAdmin={isAdmin} users={users} saving={saving} onSubmit={savePerson} onCancel={() => setDrawer(null)} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
