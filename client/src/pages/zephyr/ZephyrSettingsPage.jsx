import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Briefcase, Building2, History, Landmark, Plus, Tags, Trash2, Users } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { SERVICE_META, useServiceTypes } from '../../lib/zephyr/serviceMeta.js';
import { useAuth } from '../../lib/authContext.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';

const TABS = [
  { key: 'company', label: 'Company', icon: Building2 },
  { key: 'services', label: 'Services', icon: Briefcase },
  { key: 'valuation', label: 'Valuation', icon: Landmark },
  { key: 'categories', label: 'Categories', icon: Tags },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'audit', label: 'Audit log', icon: History },
];

const inputCls = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const card = 'rounded-2xl border bg-white p-4 shadow-soft md:p-5';

function ValuationTab() {
  const { pushError, pushInfo } = useAlerts();
  const [form, setForm] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    zephyrApi.settings().then(setForm, (e) => pushError(zephyrError(e), 'Could not load settings'));
  }, [pushError]);

  if (!form) return <div className="py-6 text-sm text-tertiary-500">Loading…</div>;
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const next = await zephyrApi.updateSettings({
        project_prefix: form.project_prefix,
        lead_prefix: form.lead_prefix,
        property_prefix: form.property_prefix,
        task_prefix: form.task_prefix,
        reason: reason || undefined,
      });
      setForm(next);
      setReason('');
      pushInfo('Settings saved');
    } catch (e) {
      pushError(zephyrError(e), 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className={`${card} max-w-xl space-y-4`}>
      <p className="text-xs text-tertiary-500">Valuation is fixed at (profit x 240) + (asset value x 3). Record asset values in Financials, Valuation tab. Here you set the code prefixes.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {[['project_prefix', 'Project code prefix'], ['lead_prefix', 'Lead code prefix'], ['property_prefix', 'Property code prefix'], ['task_prefix', 'Task code prefix']].map(([key, label]) => (
          <label key={key} className={labelCls}>
            {label}
            <input className={inputCls} maxLength={12} value={form[key] ?? ''} onChange={(e) => set(key, e.target.value)} required />
          </label>
        ))}
      </div>
      <p className="-mt-1 text-xs text-tertiary-500">A prefix only applies to records created from now on; existing codes stay as they are.</p>
      <label className={labelCls}>
        Reason for change <span className="font-normal text-tertiary-400">(kept in the audit log)</span>
        <input className={inputCls} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
    </form>
  );
}

function CategoryColumn({ kind, title, rows, reload }) {
  const { pushError } = useAlerts();
  const [name, setName] = useState('');

  async function run(action, fallback) {
    try {
      await action();
      await reload();
    } catch (e) {
      pushError(zephyrError(e, fallback), 'Category update failed');
    }
  }

  return (
    <div className={card}>
      <h3 className="font-heading text-sm font-semibold text-tertiary-900">{title}</h3>
      <ul className="mt-3 divide-y">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2 py-2">
            <input
              defaultValue={row.name}
              className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm hover:border-tertiary-200 focus:border-primary-500 focus:outline-none"
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== row.name && run(() => zephyrApi.updateCategory(row.id, { name: e.target.value.trim() }))}
              aria-label={`Rename ${row.name}`}
            />
            <label className="flex items-center gap-1 text-xs text-tertiary-500">
              <input type="checkbox" checked={row.active} onChange={(e) => run(() => zephyrApi.updateCategory(row.id, { active: e.target.checked }))} />
              Active
            </label>
            <button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" aria-label={`Delete ${row.name}`} onClick={() => run(() => zephyrApi.deleteCategory(row.id))}>
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          run(async () => {
            await zephyrApi.createCategory({ kind, name: name.trim() });
            setName('');
          }, 'Could not add category');
        }}
      >
        <input className="min-w-0 flex-1 rounded-xl border px-3 py-1.5 text-sm" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <button type="submit" className="btn-secondary inline-flex items-center gap-1"><Plus className="h-4 w-4" />Add</button>
      </form>
    </div>
  );
}

function CategoriesTab() {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState(null);
  const reload = useCallback(
    () => zephyrApi.categories().then(setRows, (e) => pushError(zephyrError(e), 'Could not load categories')),
    [pushError]
  );
  useEffect(() => {
    reload();
  }, [reload]);

  if (!rows) return <div className="py-6 text-sm text-tertiary-500">Loading…</div>;
  return (
    <div className="max-w-xl">
      <CategoryColumn kind="revenue" title="Revenue categories" rows={rows.filter((r) => r.kind === 'revenue')} reload={reload} />
      <CategoryColumn kind="expense" title="Expense categories" rows={rows.filter((r) => r.kind === 'expense')} reload={reload} />
    </div>
  );
}

// Downsizes a picked image to <= 256px and returns a PNG data URL (small enough to store on the company row).
function readLogo(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error('Choose a PNG, JPEG or WebP image'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 256 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const candidates = [canvas.toDataURL('image/png'), canvas.toDataURL('image/webp', 0.85), canvas.toDataURL('image/webp', 0.6)];
      const fit = candidates.find((d) => d.startsWith('data:image/') && d.length <= 90000);
      if (fit) resolve(fit);
      else reject(new Error('That logo is too detailed — try a simpler or smaller image'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}

function CompanyTab() {
  const { pushError, pushInfo } = useAlerts();
  const { patchSession } = useAuth();
  const [company, setCompany] = useState(null);
  const [saving, setSaving] = useState('');

  useEffect(() => {
    zephyrApi.company().then(
      setCompany,
      (e) => pushError(zephyrError(e), 'Could not load settings')
    );
  }, [pushError]);

  if (!company) return <div className="py-6 text-sm text-tertiary-500">Loading…</div>;

  async function saveCompany(patch, message) {
    setSaving('company');
    try {
      const next = await zephyrApi.updateCompany(patch);
      setCompany(next);
      patchSession({ org: { name: next.name, logo_url: next.logo_url, timezone: next.timezone } });
      pushInfo(message);
    } catch (e) {
      pushError(zephyrError(e), 'Save failed');
    } finally {
      setSaving('');
    }
  }

  async function pickLogo(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      await saveCompany({ logo_url: await readLogo(file) }, 'Logo updated');
    } catch (e) {
      pushError(e.message, 'Logo not changed');
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className={`${card} space-y-4`}>
        <h3 className="text-sm font-semibold text-tertiary-800">Company</h3>
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-32 items-center justify-center rounded-xl border bg-primary-50/40 p-2">
            <img src={company.logo_url || '/zephyr-logo.png'} alt="Company logo" className="max-h-full max-w-full object-contain" />
          </div>
          <div className="space-y-2">
            <label className="btn-secondary inline-block cursor-pointer">
              Upload new logo
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pickLogo} disabled={saving === 'company'} />
            </label>
            {company.logo_url && (
              <button type="button" className="block text-xs text-red-600 hover:underline" onClick={() => saveCompany({ logo_url: null }, 'Logo reset to default')}>Remove (use default)</button>
            )}
            <p className="text-xs text-tertiary-500">PNG, JPEG or WebP. Resized automatically.</p>
          </div>
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); saveCompany({ name: company.name, timezone: company.timezone }, 'Company details saved'); }}
        >
          <label className={labelCls}>Company name<input className={inputCls} required value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} /></label>
          <label className={labelCls}>Timezone<input className={inputCls} required value={company.timezone} onChange={(e) => setCompany({ ...company, timezone: e.target.value })} placeholder="Asia/Kolkata" /></label>
          <button type="submit" className="btn-primary" disabled={saving === 'company'}>{saving === 'company' ? 'Saving…' : 'Save company'}</button>
        </form>
      </section>
    </div>
  );
}

function UsersTab() {
  const { pushError, pushInfo } = useAlerts();
  const { me } = useZephyr();
  const [adding, setAdding] = useState(null);
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    zephyrApi.users({ status, q: q || undefined }).then((list) => setRows(list.filter((u) => u.id !== me?.user?.id)), (e) => pushError(zephyrError(e), 'Could not load users'));
  }, [status, q, me, pushError]);
  useEffect(() => { load(); }, [load]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await zephyrApi.updateUser(editing.id, { name: editing.name, email: editing.email, phone: editing.phone || null });
      setEditing(null);
      pushInfo('User updated');
      load();
    } catch (e) {
      pushError(zephyrError(e), 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function create(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await zephyrApi.createUser({ ...adding, phone: adding.phone || null });
      setAdding(null);
      pushInfo('User added');
      load();
    } catch (e) {
      pushError(zephyrError(e), 'Could not add user');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(user) {
    const active = !user.active;
    let reason;
    if (!active) {
      reason = window.prompt(`Deactivate ${user.name}? They will no longer be able to sign in to this company.
Reason (optional):`);
      if (reason === null) return;
    }
    try {
      await zephyrApi.setUserActive(user.id, { active, reason: reason || undefined });
      pushInfo(active ? 'User reactivated' : 'User deactivated');
      load();
    } catch (e) {
      pushError(zephyrError(e), 'Could not change status');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className={`${inputCls} mt-0 max-w-xs`} placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${inputCls} mt-0 w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="inactive">Deactivated</option>
        </select>
        <button type="button" className="btn-primary ml-auto inline-flex items-center gap-1" onClick={() => setAdding({ name: '', email: '', password: '', phone: '', access_role: 'staff' })}>
          <Plus className="h-4 w-4" /> Add user
        </button>
      </div>
      {adding && (
        <form onSubmit={create} className={`${card} grid max-w-3xl gap-3 sm:grid-cols-3`}>
          <label className={labelCls}>Name<input className={inputCls} required value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} /></label>
          <label className={labelCls}>Email (login)<input type="email" className={inputCls} required value={adding.email} onChange={(e) => setAdding({ ...adding, email: e.target.value })} /></label>
          <label className={labelCls}>Phone<input className={inputCls} value={adding.phone} onChange={(e) => setAdding({ ...adding, phone: e.target.value })} /></label>
          <label className={labelCls}>Password (min 8)<input type="text" minLength={8} className={`${inputCls} font-mono`} required value={adding.password} onChange={(e) => setAdding({ ...adding, password: e.target.value })} /></label>
          <label className={labelCls}>Zephyr access
            <select className={inputCls} value={adding.access_role} onChange={(e) => setAdding({ ...adding, access_role: e.target.value })}>
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="finance">Finance</option>
              <option value="staff">Staff</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add user'}</button>
            <button type="button" className="btn-secondary" onClick={() => setAdding(null)}>Cancel</button>
          </div>
        </form>
      )}
      {editing && (
        <form onSubmit={save} className={`${card} grid max-w-2xl gap-3 sm:grid-cols-3`}>
          <label className={labelCls}>Name<input className={inputCls} required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
          <label className={labelCls}>Email<input type="email" className={inputCls} required value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></label>
          <label className={labelCls}>Phone<input className={inputCls} value={editing.phone || ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></label>
          <div className="flex gap-2 sm:col-span-3">
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}
      <div className={`${card} overflow-x-auto p-0 md:p-0`}>
        {!rows ? (
          <div className="px-4 py-6 text-sm text-tertiary-500">Loading…</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-primary-50/60 text-xs uppercase tracking-wide text-tertiary-500">
              <tr><th className="px-4 py-2.5">Name</th><th className="px-4 py-2.5">Email</th><th className="px-4 py-2.5">Phone</th><th className="px-4 py-2.5">Zephyr access</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5" /></tr>
            </thead>
            <tbody className="divide-y">
              {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-tertiary-400">No users found.</td></tr>}
              {rows.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2.5 font-medium">{u.name}</td>
                  <td className="px-4 py-2.5 text-tertiary-600">{u.email}</td>
                  <td className="px-4 py-2.5 text-tertiary-600">{u.phone || '—'}</td>
                  <td className="px-4 py-2.5 capitalize">{u.role === 'admin' ? 'admin' : u.zephyr_person?.access_role || 'none'}</td>
                  <td className="px-4 py-2.5">{u.active ? 'Active' : <span className="text-red-600">Deactivated</span>}</td>
                  <td className="space-x-3 px-4 py-2.5 text-right">
                    <button type="button" className="text-primary-600 hover:underline" onClick={() => setEditing({ id: u.id, name: u.name, email: u.email, phone: u.phone })}>Edit</button>
                    <button type="button" className={u.active ? 'text-red-600 hover:underline' : 'text-primary-600 hover:underline'} onClick={() => toggle(u)}>{u.active ? 'Deactivate' : 'Reactivate'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function AuditTab() {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    zephyrApi.audit({ limit: 100 }).then(setRows, (e) => pushError(zephyrError(e), 'Could not load audit log'));
  }, [pushError]);
  if (!rows) return <div className="py-6 text-sm text-tertiary-500">Loading…</div>;
  return (
    <div className={`${card} overflow-x-auto p-0 md:p-0`}>
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-primary-50/60 text-xs uppercase tracking-wide text-tertiary-500">
          <tr><th className="px-4 py-2.5">When</th><th className="px-4 py-2.5">Entity</th><th className="px-4 py-2.5">Action</th><th className="px-4 py-2.5">Reason</th></tr>
        </thead>
        <tbody className="divide-y">
          {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-tertiary-400">Nothing recorded yet.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-2.5 text-tertiary-500">{new Date(r.created_at).toLocaleString()}</td>
              <td className="px-4 py-2.5 capitalize">{r.entity}</td>
              <td className="px-4 py-2.5 capitalize">{r.action}</td>
              <td className="px-4 py-2.5 text-tertiary-500">{r.reason || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ServicesTab() {
  const { pushError, pushSuccess } = useAlerts();
  const { services, refresh } = useServiceTypes();
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState('');
  const [newLabel, setNewLabel] = useState('');

  async function add(event) {
    event.preventDefault();
    setBusy('new');
    try {
      await zephyrApi.createServiceType({ label: newLabel.trim() });
      refresh();
      setNewLabel('');
      pushSuccess('Service added. Reload the page to see it everywhere.');
    } catch (e) {
      pushError(zephyrError(e, 'Could not add the service'), 'Could not add');
    } finally {
      setBusy('');
    }
  }

  async function save(service, patch) {
    setBusy(service.key);
    try {
      await zephyrApi.updateServiceType(service.key, patch);
      refresh();
      setDrafts((d) => ({ ...d, [service.key]: undefined }));
      pushSuccess('Saved. Reload the page to see the new name everywhere.');
    } catch (e) {
      pushError(zephyrError(e, 'Could not save'), 'Could not save');
    } finally {
      setBusy('');
    }
  }

  return (
    <section className={card}>
      <h3 className="font-heading text-sm font-semibold text-tertiary-900">Zephyr services</h3>
      <p className="mt-1 text-xs text-tertiary-500">Every lead and project belongs to one of these services. You can rename or hide a service, or add your own; history and reports are not affected.</p>
      <ul className="mt-4 divide-y">
        {services.map((s) => {
          const Icon = SERVICE_META[s.key].icon;
          const draft = drafts[s.key] ?? s.label;
          return (
            <li key={s.key} className="flex flex-wrap items-center gap-3 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600"><Icon className="h-4 w-4" /></span>
              <input className="min-w-[14rem] flex-1 rounded-xl border px-3 py-2 text-sm" value={draft} maxLength={80} aria-label={`${s.label} name`} onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))} />
              <button type="button" className="btn-secondary" disabled={busy === s.key || !draft.trim() || draft.trim() === s.label} onClick={() => save(s, { label: draft.trim() })}>Rename</button>
              <label className="inline-flex items-center gap-2 text-sm text-tertiary-700">
                <input type="checkbox" checked={s.active} disabled={busy === s.key} onChange={(e) => save(s, { active: e.target.checked })} />
                Offered
              </label>
            </li>
          );
        })}
      </ul>
      <form onSubmit={add} className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
        <input className="min-w-[14rem] flex-1 rounded-xl border px-3 py-2 text-sm" value={newLabel} maxLength={80} placeholder="New service name, e.g. Architecture" aria-label="New service name" onChange={(e) => setNewLabel(e.target.value)} />
        <button type="submit" className="btn-primary inline-flex items-center gap-1" disabled={busy === 'new' || !newLabel.trim()}><Plus className="h-4 w-4" /> Add service</button>
      </form>
    </section>
  );
}

export default function ZephyrSettingsPage() {
  const { me, loading } = useZephyr();
  const [tab, setTab] = useState('company');
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!zxCan(me, 'settings')) return <Navigate to="/zephyr" replace />;

  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'services' && <ServicesTab />}
      {tab === 'valuation' && <ValuationTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'company' && <CompanyTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}
