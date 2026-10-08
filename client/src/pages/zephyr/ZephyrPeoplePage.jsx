import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Banknote, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import apiClient from '../../lib/apiClient.js';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { rupees } from '../../lib/zephyr/projectMeta.js';
import { dateLabel } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import ZephyrSalaries from '../../components/zephyr/ZephyrSalaries.jsx';

const inputCls = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const KIND_LABEL = { employee: 'Employee', contractor: 'Contractor' };
const ACCESS_LABEL = { none: 'No login access', manager: 'Manager', staff: 'Staff', finance: 'Finance' };
const PAY_LABEL = { monthly: 'Monthly salary', daily: 'Daily rate' };
const EMPTY = { name: '', kind: 'employee', designation: '', phone: '', email: '', joining_date: '', leaving_date: '', vendor_party_id: '', notes: '', active: true, pay_basis: '', rate: '', user_id: '', access_role: 'none' };
const dayOf = (v) => (v ? String(v).slice(0, 10) : '');

function PersonForm({ initial, isAdmin, vendors, users, takenUsers, saving, onSubmit, onCancel }) {
  const [v, setV] = useState(() => ({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, initial?.[k] ?? EMPTY[k]])), joining_date: dayOf(initial?.joining_date), leaving_date: dayOf(initial?.leaving_date) }));
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const body = {
          name: v.name.trim(), kind: v.kind, designation: v.designation.trim() || null, phone: v.phone.trim() || null, email: v.email.trim() || null,
          joining_date: v.joining_date || null, leaving_date: v.leaving_date || null, notes: v.notes?.trim() || null, active: v.active,
          vendor_party_id: v.kind === 'contractor' ? v.vendor_party_id || null : null,
        };
        if (isAdmin) {
          body.pay_basis = v.pay_basis || null;
          body.rate = v.pay_basis ? Number(v.rate) : null;
          body.user_id = v.user_id || null;
          body.access_role = v.user_id ? v.access_role : 'none';
        }
        onSubmit(body);
      }}
      className="space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={`${labelCls} sm:col-span-2`}>Full name<input className={inputCls} value={v.name} onChange={set('name')} required maxLength={200} autoFocus /></label>
        <label className={labelCls}>Type<select className={inputCls} value={v.kind} onChange={set('kind')}><option value="employee">Employee</option><option value="contractor">Contractor</option></select></label>
        <label className={labelCls}>Designation / trade<input className={inputCls} value={v.designation ?? ''} onChange={set('designation')} placeholder="Site engineer, mason…" maxLength={120} /></label>
        <label className={labelCls}>Phone<input className={inputCls} value={v.phone ?? ''} onChange={set('phone')} maxLength={40} /></label>
        <label className={labelCls}>Email<input type="email" className={inputCls} value={v.email ?? ''} onChange={set('email')} maxLength={200} /></label>
        <label className={labelCls}>Joining date<input type="date" className={inputCls} value={v.joining_date} onChange={set('joining_date')} /></label>
        <label className={labelCls}>Leaving date<input type="date" className={inputCls} min={v.joining_date || undefined} value={v.leaving_date} onChange={set('leaving_date')} /></label>
        {v.kind === 'contractor' && (
          <label className={`${labelCls} sm:col-span-2`}>Contractor firm (optional)<select className={inputCls} value={v.vendor_party_id ?? ''} onChange={set('vendor_party_id')}><option value="">Individual, no firm</option>{vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        )}
        <label className={`${labelCls} sm:col-span-2`}>Notes<input className={inputCls} value={v.notes ?? ''} onChange={set('notes')} maxLength={1000} /></label>
        <label className="flex items-center gap-2 text-sm text-tertiary-700 sm:col-span-2"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />Active</label>
      </div>

      {isAdmin && (
        <fieldset className="space-y-3 rounded-xl border bg-primary-50/40 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-primary-700">Admin only</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelCls}>Pay basis<select className={inputCls} value={v.pay_basis ?? ''} onChange={set('pay_basis')}><option value="">Not paid through Zephyr</option>{Object.entries(PAY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className={labelCls}>{v.pay_basis === 'daily' ? 'Rate per day (INR)' : 'Monthly salary (INR)'}<input type="number" min="0" className={inputCls} value={v.rate ?? ''} onChange={set('rate')} disabled={!v.pay_basis} required={Boolean(v.pay_basis)} /></label>
            <label className={labelCls}>Login (optional)<select className={inputCls} value={v.user_id ?? ''} onChange={set('user_id')}><option value="">No login</option>{users.filter((u) => u.id === initial?.user_id || !takenUsers.has(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}</select></label>
            <label className={labelCls}>Access<select className={inputCls} value={v.user_id ? v.access_role : 'none'} onChange={set('access_role')} disabled={!v.user_id}>{Object.entries(ACCESS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          </div>
          <p className="text-xs text-tertiary-500">A manager can edit the roster and projects; staff only see their own work and slips.</p>
        </fieldset>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

function AssignmentsPanel({ person, projects, canEdit, onChanged }) {
  const { pushError } = useAlerts();
  const [form, setForm] = useState({ project_id: '', role: '', from_date: '', to_date: '', allocation_pct: 100 });
  const [busy, setBusy] = useState(false);
  const live = projects.filter((p) => p.status !== 'completed' && p.status !== 'cancelled');

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await zephyrApi.addAssignment(person.id, { project_id: form.project_id, role: form.role.trim() || null, from_date: form.from_date || null, to_date: form.to_date || null, allocation_pct: Number(form.allocation_pct) });
      setForm({ project_id: '', role: '', from_date: '', to_date: '', allocation_pct: 100 });
      await onChanged();
    } catch (err) {
      pushError(zephyrError(err, 'Could not assign'), 'Could not assign');
    } finally {
      setBusy(false);
    }
  }
  async function remove(a) {
    try {
      await zephyrApi.deleteAssignment(person.id, a.id);
      await onChanged();
    } catch (err) {
      pushError(zephyrError(err), 'Could not remove');
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="font-heading text-sm font-semibold text-tertiary-900">Project assignments</h3>
      {person.assignments.length === 0 && <div className="rounded-xl border border-dashed p-4 text-center text-sm text-tertiary-400">Not assigned to any project.</div>}
      <ul className="space-y-2">
        {person.assignments.map((a) => (
          <li key={a.id} className="flex items-center gap-3 rounded-xl border bg-white p-3">
            <div className="min-w-0 flex-1">
              <Link to={`/zephyr/projects/${a.project.id}`} className="text-sm font-medium text-primary-700 hover:underline">{a.project.code} · {a.project.name}</Link>
              <div className="text-xs text-tertiary-500">{[a.role, `${a.allocation_pct}% of time`, a.from_date ? `from ${dateLabel(a.from_date)}` : null, a.to_date ? `to ${dateLabel(a.to_date)}` : null].filter(Boolean).join(' · ')}</div>
            </div>
            {canEdit && <button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" aria-label="Remove assignment" onClick={() => remove(a)}><Trash2 className="h-4 w-4" /></button>}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form onSubmit={add} className="grid gap-3 rounded-xl border bg-primary-50/40 p-3 sm:grid-cols-2">
          <label className={`${labelCls} sm:col-span-2`}>Project<select className={inputCls} value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} required><option value="">Select…</option>{live.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
          <label className={labelCls}>Role on the project<input className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} maxLength={120} /></label>
          <label className={labelCls}>Share of time (%)<input type="number" min="1" max="100" className={inputCls} value={form.allocation_pct} onChange={(e) => setForm({ ...form, allocation_pct: e.target.value })} /></label>
          <label className={labelCls}>From<input type="date" className={inputCls} value={form.from_date} onChange={(e) => setForm({ ...form, from_date: e.target.value })} /></label>
          <label className={labelCls}>To<input type="date" className={inputCls} min={form.from_date || undefined} value={form.to_date} onChange={(e) => setForm({ ...form, to_date: e.target.value })} /></label>
          <div className="sm:col-span-2"><button type="submit" className="btn-primary" disabled={busy || !form.project_id}>Assign</button></div>
        </form>
      )}
    </section>
  );
}

export default function ZephyrPeoplePage() {
  const { me, loading } = useZephyr();
  const { pushError, pushSuccess } = useAlerts();
  const [tab, setTab] = useState('roster');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [rows, setRows] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [drawer, setDrawer] = useState(null); // { mode: view | edit | create, person? }
  const [saving, setSaving] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setFetching(true);
    try {
      const list = await zephyrApi.people({ ...(kind ? { kind } : {}), status, ...(dq ? { q: dq } : {}) });
      if (id === reqId.current) setRows(list);
    } catch (e) {
      if (id === reqId.current) pushError(zephyrError(e, 'Could not load people'), 'Load failed');
    } finally {
      if (id === reqId.current) setFetching(false);
    }
  }, [kind, status, dq, pushError]);

  useEffect(() => {
    load();
  }, [load]);

  const isAdmin = zxCan(me, 'peoplePay');
  useEffect(() => {
    zephyrApi.parties({ status: 'active', limit: 200 }).then((r) => setVendors(r.data.filter((p) => p.kind !== 'client')), () => setVendors([]));
    zephyrApi.projects({ status: 'open' }).then(setProjects, () => setProjects([]));
  }, []);
  useEffect(() => {
    if (isAdmin) apiClient.get('/users/directory').then((res) => setUsers(res.data.data || []), () => setUsers([]));
  }, [isAdmin]);

  const stats = useMemo(() => ({
    employees: rows.filter((r) => r.kind === 'employee' && r.active).length,
    contractors: rows.filter((r) => r.kind === 'contractor' && r.active).length,
    unassigned: rows.filter((r) => r.active && r.assignment_count === 0).length,
  }), [rows]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!zxCan(me, 'people')) return <Navigate to="/zephyr" replace />;
  const canDelete = zxCan(me, 'delete');
  const person = drawer?.person;
  const takenUsers = new Set(rows.map((r) => r.user_id).filter(Boolean));
  const tabs = [{ key: 'roster', label: 'Roster', icon: Users }, ...(zxCan(me, 'salaries') ? [{ key: 'salaries', label: 'Salaries', icon: Banknote }] : [])];

  async function openPerson(row) {
    try {
      setDrawer({ mode: 'view', person: await zephyrApi.person(row.id) });
    } catch (e) {
      pushError(zephyrError(e), 'Could not open');
    }
  }
  async function reloadPerson() {
    await load();
    setDrawer({ mode: 'view', person: await zephyrApi.person(person.id) });
  }

  async function save(body) {
    setSaving(true);
    try {
      const saved = drawer.mode === 'create' ? await zephyrApi.createPerson(body) : await zephyrApi.updatePerson(person.id, body);
      pushSuccess(drawer.mode === 'create' ? 'Person added' : 'Saved');
      await load();
      setDrawer({ mode: 'view', person: await zephyrApi.person(saved.id) });
    } catch (e) {
      pushError(zephyrError(e, 'Could not save'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!window.confirm(`Delete ${person.name} from the roster?`)) return;
    try {
      await zephyrApi.deletePerson(person.id);
      pushSuccess('Removed');
      setDrawer(null);
      load();
    } catch (e) {
      pushError(zephyrError(e), 'Could not delete');
    }
  }

  const columns = [
    { key: 'name', header: 'Name', render: (r) => <span className="font-medium text-tertiary-900">{r.name}</span> },
    { key: 'kind', header: 'Type', render: (r) => <Pill tone={r.kind === 'contractor' ? 'amber' : 'blue'}>{KIND_LABEL[r.kind]}</Pill> },
    { key: 'designation', header: 'Designation', render: (r) => r.designation || '—' },
    { key: 'firm', header: 'Firm', render: (r) => r.vendor_party?.name || '—' },
    { key: 'contact', header: 'Contact', render: (r) => <span className="text-tertiary-600">{[r.phone, r.email].filter(Boolean).join(' · ') || '—'}</span> },
    { key: 'projects', header: 'Projects', render: (r) => r.assignment_count },
    ...(isAdmin ? [{ key: 'pay', header: 'Pay', render: (r) => (r.pay_basis ? `${rupees(r.rate)} / ${r.pay_basis === 'daily' ? 'day' : 'month'}` : '—') }] : []),
    { key: 'access', header: 'Login', render: (r) => (r.user_email ? <Pill tone="green">{ACCESS_LABEL[r.access_role]}</Pill> : '—') },
    { key: 'status', header: 'Status', render: (r) => <Pill value={r.active ? 'active' : 'inactive'} /> },
  ];

  return (
    <div className="mt-4 space-y-4">
      {tabs.length > 1 && <SectionTabs tabs={tabs} value={tab} onChange={setTab} />}

      {tab === 'salaries' && zxCan(me, 'salaries') ? (
        <ZephyrSalaries projects={projects} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Employees" value={stats.employees} hint="active" />
            <StatCard label="Contractors" value={stats.contractors} hint="active" />
            <StatCard label="Not on a project" value={stats.unassigned} hint="active people" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Type"><option value="">All types</option><option value="employee">Employees</option><option value="contractor">Contractors</option></select>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Status"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, trade, phone…" aria-label="Search people" className="w-56 rounded-xl border py-1.5 pl-9 pr-3 text-sm" />
              </div>
              <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ mode: 'create' })}><Plus className="h-4 w-4" />Add person</button>
            </div>
          </div>
          <DataTable columns={columns} rows={rows} loading={fetching && rows.length === 0} emptyLabel="No people yet. Add your employees and contractors." onRowClick={openPerson} maxHeight="62vh" />
        </>
      )}

      <Drawer
        open={Boolean(drawer)}
        onClose={() => setDrawer(null)}
        size="xl"
        tone={drawer?.mode === 'create' ? 'create' : drawer?.mode === 'edit' ? 'edit' : 'default'}
        title={drawer?.mode === 'create' ? 'Add person' : drawer?.mode === 'edit' ? `Edit ${person?.name}` : person?.name || ''}
      >
        {drawer && drawer.mode !== 'view' && (
          <PersonForm key={person?.id || 'new'} initial={drawer.mode === 'edit' ? person : null} isAdmin={isAdmin} vendors={vendors} users={users} takenUsers={takenUsers} saving={saving} onSubmit={save} onCancel={() => setDrawer(drawer.mode === 'edit' ? { mode: 'view', person } : null)} />
        )}
        {drawer?.mode === 'view' && person && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex gap-2"><Pill tone={person.kind === 'contractor' ? 'amber' : 'blue'}>{KIND_LABEL[person.kind]}</Pill><Pill value={person.active ? 'active' : 'inactive'} />{person.user_email && <Pill tone="green">{ACCESS_LABEL[person.access_role]}</Pill>}</span>
              <span className="inline-flex gap-2">
                <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setDrawer({ mode: 'edit', person })}><Pencil className="h-4 w-4" />Edit</button>
                {canDelete && <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-danger-200 px-3 py-2 text-sm font-medium text-danger-600 hover:bg-danger-50" onClick={remove}><Trash2 className="h-4 w-4" />Delete</button>}
              </span>
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              {[
                ['Designation', person.designation], ['Contractor firm', person.vendor_party?.name], ['Phone', person.phone], ['Email', person.email],
                ['Joined', person.joining_date ? dateLabel(person.joining_date) : null], ['Left', person.leaving_date ? dateLabel(person.leaving_date) : null],
                ['Login', person.user_email],
                ...(isAdmin ? [['Pay', person.pay_basis ? `${rupees(person.rate)} ${person.pay_basis === 'daily' ? 'per day' : 'per month'}` : null]] : []),
                ['Notes', person.notes],
              ].filter(([, val]) => val).map(([label, val]) => (
                <div key={label}><dt className="text-xs text-tertiary-500">{label}</dt><dd className="mt-0.5 text-sm text-tertiary-900">{val}</dd></div>
              ))}
            </dl>
            <AssignmentsPanel person={person} projects={projects} canEdit onChanged={reloadPerson} />
            {isAdmin && person.salaries && (
              <section className="space-y-2">
                <h3 className="font-heading text-sm font-semibold text-tertiary-900">Salary history</h3>
                {person.salaries.length === 0 ? <div className="rounded-xl border border-dashed p-4 text-center text-sm text-tertiary-400">No slips yet.</div> : (
                  <ul className="divide-y rounded-xl border bg-white">
                    {person.salaries.map((s) => (
                      <li key={s.id} className="flex items-center justify-between px-3 py-2 text-sm"><span className="font-mono text-xs text-tertiary-500">{s.month}</span><span className="tabular-nums">{rupees(s.net)}</span><Pill value={s.status === 'draft' ? 'draft' : s.status === 'paid' ? 'paid' : 'active'}>{s.status[0].toUpperCase() + s.status.slice(1)}</Pill></li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
