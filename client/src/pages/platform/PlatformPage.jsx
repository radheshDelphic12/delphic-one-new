import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import Pill from '../../components/ui/Pill.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { inputCls, labelCls, th, td, useSave } from '../delphicone/ui.jsx';

// SaaS platform administration (SaaS launch plan, phase 1.4). Only people on the platform-admin list get past the first call; everyone else sees a
// short "not available" message. Everything on the product's catalogue is edited here: modules, what each needs, dated price books, the numbers
// (trial days, trial users, grace days...), who may administer the platform, and the customer list.
const TABS = [['modules', 'Modules'], ['books', 'Price books'], ['settings', 'Settings'], ['routes', 'Screen mapping'], ['switches', 'Switches'], ['customers', 'Customers'], ['admins', 'Platform admins'], ['audit', 'Audit trail']];
const rupee = (n) => (n == null ? '-' : `Rs ${Number(n).toLocaleString('en-IN')}`);
const get = (path) => apiClient.get(`/platform${path}`).then((r) => r.data.data);

function useData(path) {
  const [data, setData] = useState(null);
  const reload = useCallback(() => get(path).then(setData).catch(() => setData(false)), [path]);
  useEffect(() => { reload(); }, [reload]);
  return [data, reload];
}

function Modules() {
  const [data, reload] = useData('/modules');
  const save = useSave();
  const [edit, setEdit] = useState(null); // { code, needs: 'EMPM, ATLV' }
  if (data === null) return <Skeleton className="h-64" />;
  if (data === false) return <p className="text-sm text-tertiary-500">The catalogue could not be loaded.</p>;
  const patch = (code, body, ok) => save(() => apiClient.patch(`/platform/modules/${code}`, body), ok, 'Could not save the module').then((r) => r && reload());
  const saveNeeds = async () => {
    // "EMPM, ATLV" = both needed; "CLHR|INHR" = either one is enough
    const needs = edit.needs.split(',').map((s) => s.trim()).filter(Boolean).flatMap((part, i) => part.split('|').map((c) => ({ code: c.trim().toUpperCase(), group: i + 1 })));
    const r = await save(() => apiClient.put(`/platform/modules/${edit.code}/dependencies`, { needs }), 'Dependencies saved', 'Could not save the dependencies');
    if (r) { setEdit(null); reload(); }
  };
  const needsText = (m) => Object.values(m.needs.reduce((g, n) => ({ ...g, [n.group]: [...(g[n.group] || []), n.code] }), {})).map((c) => c.join('|')).join(', ');
  return (
    <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white">
      <p className="px-3 pt-3 text-xs text-tertiary-500">Prices from the book in force today ({data.price_book?.name}). A code never changes; a module is retired by switching it off.</p>
      <table className="min-w-full text-sm">
        <thead><tr><th className={th}>Code</th><th className={th}>Module</th><th className={th}>Rs / 30 days</th><th className={th}>Needs</th><th className={th}>Status</th><th className={th} /></tr></thead>
        <tbody>
          {data.modules.map((m) => (
            <tr key={m.code} className="border-t border-tertiary-100" data-testid={`module-${m.code}`}>
              <td className={`${td} font-mono text-xs`}>{m.code}</td>
              <td className={td}>{m.name}{m.is_basic && <span className="ml-2"><Pill tone="blue">Every user</Pill></span>}</td>
              <td className={td}>{rupee(m.price_30d)}</td>
              <td className={td}>
                {edit?.code === m.code ? (
                  <span className="flex items-center gap-2">
                    <input className={inputCls} aria-label={`Needs of ${m.code}`} value={edit.needs} onChange={(e) => setEdit({ ...edit, needs: e.target.value })} placeholder="EMPM, ATLV  or  CLHR|INHR" />
                    <button type="button" className="btn-primary text-xs" onClick={saveNeeds}>Save</button>
                    <button type="button" className="btn-secondary text-xs" onClick={() => setEdit(null)}>Cancel</button>
                  </span>
                ) : (
                  <button type="button" className="text-left text-xs text-primary-700 hover:underline" onClick={() => setEdit({ code: m.code, needs: needsText(m) })}>{needsText(m) || 'none'}</button>
                )}
              </td>
              <td className={td}>
                <label className="mr-3 text-xs"><input type="checkbox" checked={m.active} onChange={(e) => patch(m.code, { active: e.target.checked }, 'Saved')} /> On</label>
                <label className="text-xs"><input type="checkbox" checked={m.coming_soon} onChange={(e) => patch(m.code, { coming_soon: e.target.checked }, 'Saved')} /> Coming soon</label>
              </td>
              <td className={td} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Books() {
  const [books, reload] = useData('/price-books');
  const [mods] = useData('/modules');
  const save = useSave();
  const [form, setForm] = useState({ name: '', effective_from: '' });
  const [draft, setDraft] = useState({}); // bookId -> { admin_price, prices: {code: value} }
  if (books === null || mods === null) return <Skeleton className="h-64" />;
  if (books === false) return <p className="text-sm text-tertiary-500">The price books could not be loaded.</p>;
  const create = async (e) => {
    e.preventDefault();
    const r = await save(() => apiClient.post('/platform/price-books', form), 'Price book created as a copy of the latest', 'Could not create the price book');
    if (r) { setForm({ name: '', effective_from: '' }); reload(); }
  };
  const persist = async (b) => {
    const d = draft[b.id] || {};
    const prices = Object.fromEntries(Object.entries(d.prices || {}).map(([k, v]) => [k, Number(v)]));
    const r = await save(() => apiClient.patch(`/platform/price-books/${b.id}`, { ...(d.admin_price !== undefined ? { admin_price: Number(d.admin_price) } : {}), prices }), 'Price book saved', 'Could not save the price book');
    if (r) { setDraft((x) => ({ ...x, [b.id]: undefined })); reload(); }
  };
  return (
    <div className="space-y-4">
      <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-2xl border border-tertiary-100 bg-white p-4">
        <label className={labelCls}>New price book<input required className={inputCls} aria-label="Price book name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. April 2027" /></label>
        <label className={labelCls}>Applies from<input required type="date" className={inputCls} aria-label="Effective from" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} /></label>
        <button type="submit" className="btn-primary">Create (copy of the latest)</button>
      </form>
      {books.map((b) => (
        <section key={b.id} className="rounded-2xl border border-tertiary-100 bg-white p-4" data-testid={`book-${b.id}`}>
          <h3 className="font-heading text-sm font-semibold">{b.name} <span className="font-normal text-tertiary-500">applies from {String(b.effective_from).slice(0, 10)}</span></h3>
          <p className="mt-1 text-xs text-tertiary-500">Every amount is yours to set and can change with the season: make a new book (a copy of the latest) with its start date. New subscriptions use the book with the latest start date that has already begun; older subscriptions keep their price. Per user per 30 days, before GST.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <label className={labelCls}>Admin slot<input type="number" min="0" className={inputCls} value={draft[b.id]?.admin_price ?? b.admin_price} onChange={(e) => setDraft((x) => ({ ...x, [b.id]: { ...x[b.id], admin_price: e.target.value } }))} /></label>
            {mods.modules.map((m) => (
              <label key={m.code} className={labelCls}>{m.code} <span className="font-normal text-tertiary-400">{m.name.slice(0, 22)}</span>
                <input type="number" min="0" className={inputCls} value={draft[b.id]?.prices?.[m.code] ?? b.prices[m.code] ?? ''} onChange={(e) => setDraft((x) => ({ ...x, [b.id]: { ...x[b.id], prices: { ...(x[b.id]?.prices || {}), [m.code]: e.target.value } } }))} />
              </label>
            ))}
          </div>
          <button type="button" className="btn-primary mt-3" disabled={!draft[b.id]} onClick={() => persist(b)}>Save changes</button>
        </section>
      ))}
    </div>
  );
}

function Settings() {
  const [rows, reload] = useData('/settings');
  const save = useSave();
  const [draft, setDraft] = useState({});
  if (rows === null) return <Skeleton className="h-40" />;
  if (rows === false) return <p className="text-sm text-tertiary-500">The settings could not be loaded.</p>;
  const persist = async (key) => {
    const r = await save(() => apiClient.patch(`/platform/settings/${key}`, { value: Number(draft[key]) }), 'Saved', 'Could not save the setting');
    if (r) { setDraft((d) => ({ ...d, [key]: undefined })); reload(); }
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.key} className="rounded-2xl border border-tertiary-100 bg-white p-4">
          <label className={labelCls}>{r.note}
            <span className="mt-1 flex gap-2">
              <input type="number" min="0" className={inputCls} aria-label={r.key} value={draft[r.key] ?? r.value} onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))} />
              <button type="button" className="btn-primary" disabled={draft[r.key] === undefined} onClick={() => persist(r.key)}>Save</button>
            </span>
          </label>
          <p className="mt-1 font-mono text-[11px] text-tertiary-400">{r.key}</p>
        </div>
      ))}
    </div>
  );
}

function RouteMap() {
  const [rows, reload] = useData('/route-modules');
  const [mods] = useData('/modules');
  const save = useSave();
  const [form, setForm] = useState({ path_prefix: '', module_code: '', menu_prefix: '' });
  if (rows === null || mods === null) return <Skeleton className="h-40" />;
  if (rows === false) return <p className="text-sm text-tertiary-500">The mapping could not be loaded.</p>;
  const put = async (body, ok) => { const r = await save(() => apiClient.put('/platform/route-modules', body), ok, 'Could not save the mapping'); if (r) reload(); return r; };
  const add = async (e) => {
    e.preventDefault();
    const r = await put({ path_prefix: form.path_prefix.trim(), module_code: form.module_code, menu_prefix: form.menu_prefix.trim() || null }, 'Mapping saved');
    if (r) setForm({ path_prefix: '', module_code: '', menu_prefix: '' });
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-tertiary-500">Which module each part of the product belongs to. Used only while &ldquo;Module access checks&rdquo; is ON and only for customer companies. The longest matching address wins; an address with no row is open to everyone.</p>
      <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-2xl border border-tertiary-100 bg-white p-4">
        <label className={labelCls}>API address<input required className={inputCls} aria-label="API address" placeholder="/accounts" value={form.path_prefix} onChange={(e) => setForm({ ...form, path_prefix: e.target.value })} /></label>
        <label className={labelCls}>Module<select required className={inputCls} aria-label="Module" value={form.module_code} onChange={(e) => setForm({ ...form, module_code: e.target.value })}><option value="">Choose</option>{mods.modules.map((m) => <option key={m.code} value={m.code}>{m.code} {m.name}</option>)}</select></label>
        <label className={labelCls}>Menu path (optional)<input className={inputCls} placeholder="/accounts" value={form.menu_prefix} onChange={(e) => setForm({ ...form, menu_prefix: e.target.value })} /></label>
        <button type="submit" className="btn-primary">Add or change</button>
      </form>
      <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white">
        <table className="min-w-full text-sm"><thead><tr><th className={th}>API address</th><th className={th}>Module</th><th className={th}>Menu</th><th className={th}>On</th><th className={th} /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="border-t border-tertiary-100">
              <td className={`${td} font-mono text-xs`}>{r.path_prefix}</td>
              <td className={td}><select className={inputCls} aria-label={`Module of ${r.path_prefix}`} value={r.module_code} onChange={(e) => put({ path_prefix: r.path_prefix, module_code: e.target.value, menu_prefix: r.menu_prefix, active: r.active }, 'Saved')}>{mods.modules.map((m) => <option key={m.code} value={m.code}>{m.code}</option>)}</select></td>
              <td className={`${td} font-mono text-xs`}>{r.menu_prefix || '-'}</td>
              <td className={td}><input type="checkbox" checked={r.active} aria-label={`On ${r.path_prefix}`} onChange={(e) => put({ path_prefix: r.path_prefix, module_code: r.module_code, menu_prefix: r.menu_prefix, active: e.target.checked }, 'Saved')} /></td>
              <td className={td}><button type="button" className="btn-secondary text-xs" onClick={async () => { if (window.confirm(`Remove ${r.path_prefix} from the mapping? It will then be open to everyone.`) && await save(() => apiClient.delete(`/platform/route-modules/${r.id}`), 'Removed', 'Could not remove')) reload(); }}>Remove</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function Switches() {
  const [rows, reload] = useData('/switches');
  const save = useSave();
  if (rows === null) return <Skeleton className="h-40" />;
  if (rows === false) return <p className="text-sm text-tertiary-500">The switches could not be loaded.</p>;
  const flip = async (s) => {
    const next = !s.on;
    if (!window.confirm(`Turn "${s.label}" ${next ? 'ON' : 'OFF'}?\n\n${s.help}\n\nThis is recorded in the audit trail.`)) return;
    const r = await save(() => apiClient.put(`/platform/switches/${s.name}`, { on: next, confirm: true }), `${s.label} is now ${next ? 'on' : 'off'}`, 'Could not change the switch');
    if (r) reload();
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-tertiary-500">All three are off until you turn them on here. A value set here wins over the server setting, which is only the starting value.</p>
      {rows.map((s) => (
        <div key={s.name} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4" data-testid={`switch-${s.name}`}>
          <div>
            <p className="font-heading text-sm font-semibold">{s.label} <Pill tone={s.on ? 'green' : 'gray'}>{s.on ? 'ON' : 'OFF'}</Pill></p>
            <p className="text-xs text-tertiary-500">{s.help}</p>
            <p className="text-[11px] text-tertiary-400">Set by: {s.source}</p>
          </div>
          <button type="button" className={s.on ? 'btn-secondary' : 'btn-primary'} onClick={() => flip(s)}>{s.on ? 'Turn off' : 'Turn on'}</button>
        </div>
      ))}
    </div>
  );
}

function Audit() {
  const [rows] = useData('/audit');
  if (rows === null) return <Skeleton className="h-40" />;
  if (rows === false) return <p className="text-sm text-tertiary-500">The audit trail could not be loaded.</p>;
  if (!rows.length) return <p className="text-sm text-tertiary-500">No changes recorded yet.</p>;
  const show = (v) => (v == null ? '' : JSON.stringify(v));
  return (
    <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white">
      <table className="min-w-full text-sm"><thead><tr><th className={th}>When</th><th className={th}>Who</th><th className={th}>What</th><th className={th}>Before</th><th className={th}>After</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-tertiary-100 align-top"><td className={`${td} whitespace-nowrap text-xs`}>{new Date(r.at).toLocaleString()}</td><td className={td}>{r.actor?.name || '-'}</td><td className={td}>{r.action.replace(/_/g, ' ')} <span className="font-mono text-xs text-tertiary-500">{r.entity_id}</span></td><td className={`${td} max-w-xs break-words font-mono text-[11px]`}>{show(r.before)}</td><td className={`${td} max-w-xs break-words font-mono text-[11px]`}>{show(r.after)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Customers() {
  const [rows] = useData('/customers');
  if (rows === null) return <Skeleton className="h-40" />;
  if (rows === false) return <p className="text-sm text-tertiary-500">The customers could not be loaded.</p>;
  if (!rows.length) return <p className="rounded-2xl border border-dashed border-tertiary-200 p-6 text-sm text-tertiary-500">No customer workspaces yet. They are created from Delphic One &gt; Customers once customer workspaces are switched on.</p>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white">
      <table className="min-w-full text-sm"><thead><tr><th className={th}>Customer</th><th className={th}>Status</th><th className={th}>Trial ends</th><th className={th}>Users</th></tr></thead>
        <tbody>{rows.map((c) => <tr key={c.id} className="border-t border-tertiary-100"><td className={td}>{c.name}</td><td className={td}><Pill tone={c.status === 'active' ? 'green' : c.status === 'trial' ? 'blue' : 'gray'}>{c.status}</Pill></td><td className={td}>{c.trial_ends_on ? String(c.trial_ends_on).slice(0, 10) : '-'}</td><td className={td}>{c.slots} of {c.max_users}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Admins() {
  const [data, reload] = useData('/admins');
  const save = useSave();
  const [email, setEmail] = useState('');
  if (data === null) return <Skeleton className="h-40" />;
  if (data === false) return <p className="text-sm text-tertiary-500">The list could not be loaded.</p>;
  const add = async (e) => {
    e.preventDefault();
    const r = await save(() => apiClient.post('/platform/admins', { email }), 'Platform admin added', 'Could not add that person (they need an existing login)');
    if (r) { setEmail(''); reload(); }
  };
  return (
    <div className="space-y-4">
      <p className="text-xs text-tertiary-500">Platform admins run the SaaS product (customers, prices, modules). This is separate from being an admin of a company. Keep the list short.</p>
      <form onSubmit={add} className="flex items-end gap-3"><label className={labelCls}>Add by email<input required type="email" className={inputCls} aria-label="Admin email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><button type="submit" className="btn-primary">Add</button></form>
      <ul className="divide-y divide-tertiary-100 rounded-2xl border border-tertiary-100 bg-white">
        {data.admins.map((a) => (
          <li key={a.id} className="flex items-center justify-between px-4 py-2 text-sm"><span>{a.name} <span className="text-tertiary-500">{a.email}</span></span>
            <button type="button" className="btn-secondary text-xs" onClick={async () => { if (await save(() => apiClient.delete(`/platform/admins/${a.id}`), 'Removed', 'Could not remove')) reload(); }}>Remove</button></li>
        ))}
        {data.env_emails.map((e) => <li key={e} className="px-4 py-2 text-sm text-tertiary-500">{e} <span className="text-xs">(named in the server settings)</span></li>)}
      </ul>
    </div>
  );
}

export default function PlatformPage() {
  const [allowed, setAllowed] = useState(null);
  const [tab, setTab] = useState('modules');
  useEffect(() => { get('/me').then(() => setAllowed(true)).catch(() => setAllowed(false)); }, []);
  if (allowed === null) return <div className="p-6"><Skeleton className="h-40" /></div>;
  if (!allowed) return <div className="p-6 text-sm text-tertiary-500" data-testid="platform-denied">This area is only for the platform administrators.</div>;
  const Body = { modules: Modules, books: Books, settings: Settings, routes: RouteMap, switches: Switches, customers: Customers, admins: Admins, audit: Audit }[tab];
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6" data-testid="platform-page">
      <div>
        <h1 className="font-heading text-xl font-semibold text-tertiary-900">Platform</h1>
        <p className="text-sm text-tertiary-500">The SaaS product: modules and prices, trial and credit rules, customers.</p>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      <Body />
    </div>
  );
}
