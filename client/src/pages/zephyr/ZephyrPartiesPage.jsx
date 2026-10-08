import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AlertTriangle, Building2, FileUp, Pencil, Plus, Trash2, Truck, Users } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { csvToObjects, downloadText } from '../../lib/zephyr/csv.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Modal from '../../components/ui/Modal.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import Pill from '../../components/ui/Pill.jsx';
import FilterBar from '../../components/zephyr/FilterBar.jsx';
import ZephyrDocuments from '../../components/zephyr/ZephyrDocuments.jsx';
import { rupees } from '../../lib/zephyr/projectMeta.js';
import { useServiceTypes } from '../../lib/zephyr/serviceMeta.js';

const TABS = [
  { key: 'all', label: 'All', icon: Users },
  { key: 'client', label: 'Clients', icon: Building2 },
  { key: 'vendor', label: 'Vendors', icon: Truck },
];
const KIND_OPTIONS = [
  { value: 'client', label: 'Client' },
  { value: 'vendor', label: 'Vendor / subcontractor' },
  { value: 'both', label: 'Client and vendor' },
];
const KIND_LABEL = { client: 'Client', vendor: 'Vendor', both: 'Client + Vendor' };
const KIND_TONE = { client: 'blue', vendor: 'amber', both: 'purple' };
const EMPTY = {
  kind: 'client', name: '', company_name: '', contact_name: '', phone: '', email: '', gstin: '', pan: '', address: '', city: '', state: '', country: '',
  payment_terms: '', status: 'active', vendor_category: '', materials_services: '', notes: '',
};
const CSV_HEADERS = ['name', 'kind', 'company_name', 'contact_name', 'phone', 'email', 'gstin', 'pan', 'address', 'city', 'state', 'country', 'interested_services', 'vendor_category', 'materials_services', 'payment_terms', 'status', 'notes'];
const STATUS_OPTIONS = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'hold', label: 'Hold' }];

const inputCls = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';

function PartyForm({ initial, kind, services, onSubmit, onCancel, saving }) {
  const [v, setV] = useState({ ...EMPTY, ...(kind ? { kind } : {}), ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, initial?.[k] ?? (k === 'kind' && kind ? kind : EMPTY[k])])) });
  const [interested, setInterested] = useState(initial?.interested_services || []);
  const toggleService = (key) => setInterested((cur) => (cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key]));
  const isClient = v.kind !== 'vendor';
  const isVendor = v.kind !== 'client';
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  return (
    <form
      id="zx-party-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, typeof v[k] === 'string' ? v[k].trim() : v[k]])), interested_services: isClient ? interested : [] });
      }}
      className="space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={`${labelCls} sm:col-span-2`}>Name<input className={inputCls} value={v.name} onChange={set('name')} required maxLength={200} autoFocus /></label>
        <label className={labelCls}>Type<select className={inputCls} value={v.kind} onChange={set('kind')}>{KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label className={labelCls}>Status<select className={inputCls} value={v.status} onChange={set('status')}>{STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label className={labelCls}>Company name<input className={inputCls} value={v.company_name} onChange={set('company_name')} maxLength={200} /></label>
        <label className={labelCls}>Contact person<input className={inputCls} value={v.contact_name} onChange={set('contact_name')} maxLength={200} /></label>
        <label className={labelCls}>Phone<input className={inputCls} value={v.phone} onChange={set('phone')} maxLength={40} /></label>
        <label className={labelCls}>Email<input type="email" className={inputCls} value={v.email} onChange={set('email')} maxLength={200} /></label>
        <label className={labelCls}>City<input className={inputCls} value={v.city} onChange={set('city')} maxLength={120} /></label>
        <label className={labelCls}>State<input className={inputCls} value={v.state} onChange={set('state')} maxLength={120} /></label>
        <label className={labelCls}>Country<input className={inputCls} value={v.country} onChange={set('country')} maxLength={120} placeholder="India" /></label>
        <label className={labelCls}>GSTIN<input className={`${inputCls} uppercase`} value={v.gstin} onChange={set('gstin')} maxLength={15} pattern="[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z]Z[0-9A-Za-z]|" title="15 characters, e.g. 22AAAAA0000A1Z5" /></label>
        <label className={labelCls}>PAN<input className={`${inputCls} uppercase`} value={v.pan} onChange={set('pan')} maxLength={10} pattern="[A-Za-z]{5}[0-9]{4}[A-Za-z]|" title="10 characters, e.g. ABCDE1234F" /></label>
        <label className={`${labelCls} sm:col-span-2`}>Address<input className={inputCls} value={v.address} onChange={set('address')} maxLength={500} /></label>
        {isClient && (
          <div className="sm:col-span-2">
            <div className={labelCls}>Interested services</div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {services.map((s) => (
                <label key={s.key} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm ${interested.includes(s.key) ? 'border-primary-600 bg-primary-50 text-primary-800' : 'text-tertiary-600 hover:border-primary-300'}`}>
                  <input type="checkbox" className="sr-only" checked={interested.includes(s.key)} onChange={() => toggleService(s.key)} />{s.label}
                </label>
              ))}
            </div>
          </div>
        )}
        {isVendor && (
          <>
            <label className={labelCls}>Vendor category<input className={inputCls} value={v.vendor_category} onChange={set('vendor_category')} maxLength={120} placeholder="Labour contractor, material supplier…" list="zx-vendor-categories" /><datalist id="zx-vendor-categories">{['Labour contractor', 'Civil contractor', 'Material supplier', 'Construction material vendor', 'Interior material supplier', 'Service provider'].map((c) => <option key={c} value={c} />)}</datalist></label>
            <label className={labelCls}>Materials / services provided<input className={inputCls} value={v.materials_services} onChange={set('materials_services')} maxLength={1000} /></label>
          </>
        )}
        <label className={`${labelCls} sm:col-span-2`}>Payment terms<input className={inputCls} value={v.payment_terms} onChange={set('payment_terms')} placeholder="e.g. Net 30, 20% advance" maxLength={200} /></label>
        <label className={`${labelCls} sm:col-span-2`}>Notes<textarea className={inputCls} rows={3} value={v.notes} onChange={set('notes')} maxLength={2000} /></label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

function Detail({ label, children }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div>
      <dt className="text-xs text-tertiary-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-tertiary-900">{children}</dd>
    </div>
  );
}

function Statement({ partyId }) {
  const [s, setS] = useState(null);
  useEffect(() => {
    setS(null);
    zephyrApi.partyStatement(partyId).then(setS, () => setS(false));
  }, [partyId]);
  if (s === false) return null;
  if (!s) return <div className="text-sm text-tertiary-500">Loading statement…</div>;
  const tiles = [['Received', s.received], ['Paid out', s.paid], ['Expected in', s.expected_in], ['Expected out', s.expected_out]];
  return (
    <section className="space-y-3">
      <h3 className="font-heading text-sm font-semibold text-tertiary-900">Money statement</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-2.5"><div className="text-[11px] text-tertiary-500">{label}</div><div className="text-sm font-semibold tabular-nums">{rupees(value)}</div></div>)}
      </div>
      {s.work_orders.length > 0 && (
        <ul className="divide-y rounded-xl border bg-white text-sm">
          {s.work_orders.map((w) => <li key={w.id} className="flex items-center justify-between gap-2 px-3 py-2"><span className="min-w-0 truncate">{w.wo_number} · {w.project.name}</span><span className="shrink-0 text-xs text-tertiary-500">{rupees(w.billed_to_date)} billed of {rupees(w.value)}</span></li>)}
        </ul>
      )}
      {s.entries.length === 0 ? <div className="rounded-xl border border-dashed p-3 text-center text-xs text-tertiary-400">No ledger entries for this party yet.</div> : (
        <ul className="max-h-56 divide-y overflow-y-auto rounded-xl border bg-white text-sm">
          {s.entries.map((e) => <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2"><span className="min-w-0 truncate text-tertiary-700">{e.entry_date} · {e.category?.name}{e.reference ? ` · ${e.reference}` : ''}{e.status === 'planned' ? ' (planned)' : ''}</span><span className={`shrink-0 tabular-nums ${e.type === 'revenue' ? 'text-green-700' : ''}`}>{e.type === 'revenue' ? '+' : '-'}{rupees(e.amount)}</span></li>)}
        </ul>
      )}
    </section>
  );
}
function ImportModal({ open, onClose, onDone }) {
  const { pushError, pushSuccess } = useAlerts();
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setRows(null);
    setFileName('');
    setResult(null);
  }

  async function pick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    const parsed = csvToObjects(await file.text());
    setRows(parsed);
  }

  async function run() {
    setBusy(true);
    try {
      const res = await zephyrApi.importParties(rows);
      setResult(res);
      pushSuccess(`${res.created} added, ${res.skipped.length} skipped`);
      if (res.created > 0) onDone();
    } catch (err) {
      pushError(zephyrError(err, 'Import failed'), 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} wide onClose={() => { reset(); onClose(); }} title="Import clients / vendors from CSV">
      <div className="space-y-4 text-sm">
        <p className="text-tertiary-600">
          Columns: <code className="text-xs">{CSV_HEADERS.join(', ')}</code>. Only <b>name</b> is required; <b>kind</b> is client, vendor or both. Names that already exist are skipped.
        </p>
        <button type="button" className="text-sm font-medium text-primary-700 hover:underline" onClick={() => downloadText('zephyr-parties-template.csv', `${CSV_HEADERS.join(',')}\nSkyline Builders,client,Anil Rao,9800000000,anil@skyline.test,,,,Pune,Net 30,active,\n`)}>
          Download template
        </button>
        <input type="file" accept=".csv,text/csv" onChange={pick} className={inputCls} />
        {rows && !result && <div className="rounded-xl bg-primary-50 px-3 py-2 text-primary-800">{fileName}: {rows.length} row{rows.length === 1 ? '' : 's'} ready.</div>}
        {result && (
          <div className="space-y-2">
            <div className="rounded-xl bg-primary-50 px-3 py-2 text-primary-800">{result.created} added, {result.skipped.length} skipped.</div>
            {result.skipped.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl border p-2 text-xs text-tertiary-600">
                {result.skipped.map((s) => <li key={`${s.row}-${s.reason}`}>Row {s.row}{s.name ? ` (${s.name})` : ''}: {s.reason}</li>)}
              </ul>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => { reset(); onClose(); }}>{result ? 'Close' : 'Cancel'}</button>
          {!result && <button type="button" className="btn-primary" disabled={!rows?.length || busy} onClick={run}>{busy ? 'Importing…' : 'Import'}</button>}
        </div>
      </div>
    </Modal>
  );
}

export default function ZephyrPartiesPage() {
  const { me, loading } = useZephyr();
  const { pushError, pushSuccess } = useAlerts();
  const { label: serviceLabel, active: activeServices } = useServiceTypes();
  const [tab, setTab] = useState('all');
  const [status, setStatus] = useState('all');
  const [service, setService] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [data, setData] = useState({ rows: [], summary: null });
  const [fetching, setFetching] = useState(true);
  const [drawer, setDrawer] = useState(null); // { mode: 'view' | 'edit' | 'create', party? }
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setFetching(true);
    try {
      const res = await zephyrApi.parties({ tab, status, ...(service ? { service } : {}), ...(category ? { vendor_category: category } : {}), ...(debouncedQ ? { q: debouncedQ } : {}), limit: 200 });
      if (id === reqId.current) setData({ rows: res.data, summary: res.summary });
    } catch (e) {
      if (id === reqId.current) pushError(zephyrError(e, 'Could not load the directory'), 'Load failed');
    } finally {
      if (id === reqId.current) setFetching(false);
    }
  }, [tab, status, service, category, debouncedQ, pushError]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!zxCan(me, 'parties')) return <Navigate to="/zephyr" replace />;
  const canDelete = zxCan(me, 'delete');

  async function save(values) {
    setSaving(true);
    try {
      const body = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === '' ? null : v]));
      body.name = values.name;
      if (drawer.mode === 'create') await zephyrApi.createParty(body);
      else await zephyrApi.updateParty(drawer.party.id, body);
      pushSuccess(drawer.mode === 'create' ? 'Added to the directory' : 'Saved');
      setDrawer(null);
      load();
    } catch (e) {
      pushError(zephyrError(e, 'Could not save'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function remove(party) {
    if (!window.confirm(`Delete ${party.name}? It will be removed from the directory.`)) return;
    try {
      await zephyrApi.deleteParty(party.id);
      pushSuccess('Deleted');
      setDrawer(null);
      load();
    } catch (e) {
      pushError(zephyrError(e, 'Could not delete'), 'Delete failed');
    }
  }

  const columns = [
    { key: 'name', header: 'Name', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span>{r.company_name && <span className="block text-xs text-tertiary-500">{r.company_name}</span>}</span> },
    { key: 'kind', header: 'Type', render: (r) => <Pill tone={KIND_TONE[r.kind]}>{KIND_LABEL[r.kind]}</Pill> },
    { key: 'contact', header: 'Contact', render: (r) => <span className="text-tertiary-600">{[r.contact_name, r.phone].filter(Boolean).join(' · ') || '—'}</span> },
    { key: 'city', header: 'City', render: (r) => [r.city, r.state].filter(Boolean).join(', ') || '—' },
    { key: 'focus', header: 'Services / category', render: (r) => (r.kind !== 'vendor' && r.interested_services?.length ? r.interested_services.map(serviceLabel).join(', ') : r.vendor_category || '—') },
    { key: 'gstin', header: 'GSTIN', render: (r) => <span className="font-mono text-xs">{r.gstin || '—'}</span> },
    { key: 'terms', header: 'Payment terms', render: (r) => r.payment_terms || '—' },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <span className="inline-flex items-center gap-2">
          <Pill value={r.status} />
          {r.docs_attention > 0 && (
            <span title={`${r.docs_attention} document(s) expired or expiring within 30 days`} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
              <AlertTriangle className="h-3 w-3" />{r.docs_attention}
            </span>
          )}
        </span>
      ),
    },
  ];

  const s = data.summary;
  const party = drawer?.party;

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Clients" value={s?.clients ?? '—'} hint="active, incl. both" />
        <StatCard label="Vendors / subcontractors" value={s?.vendors ?? '—'} hint="active, incl. both" />
        <StatCard label="Docs needing attention" value={data.rows.reduce((n, r) => n + (r.docs_attention || 0), 0)} hint="expired or due in 30 days (this list)" />
      </div>

      <div className="space-y-3">
        <SectionTabs tabs={TABS} value={tab} onChange={setTab} className="min-w-0" />
        <FilterBar
          q={q}
          onQ={setQ}
          searchPlaceholder="Search name, GSTIN, city…"
          fields={[
            { key: 'status', label: 'Status', type: 'select', any: 'All statuses', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'hold', label: 'Hold' }] },
            { key: 'service', label: 'Interested service', type: 'select', any: 'Any service', hidden: tab === 'vendor', options: activeServices.map((x) => ({ value: x.key, label: x.label })) },
            { key: 'category', label: 'Vendor category', type: 'select', any: 'Any category', hidden: tab === 'client' || !(data.summary?.vendor_categories || []).length, options: (data.summary?.vendor_categories || []).map((c) => ({ value: c, label: c })) },
          ]}
          values={{ status, service, category }}
          defaults={{ status: 'all', service: '', category: '' }}
          onChange={(key, value) => ({ status: setStatus, service: setService, category: setCategory })[key](value)}
          onReset={() => { setStatus('all'); setService(''); setCategory(''); setQ(''); }}
        >
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setImportOpen(true)}><FileUp className="h-4 w-4" />Import</button>
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setDrawer({ mode: 'create', kind: 'vendor' })}><Plus className="h-4 w-4" />Add vendor</button>
          <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ mode: 'create', kind: 'client' })}><Plus className="h-4 w-4" />Add client</button>
        </FilterBar>
      </div>

      <DataTable
        columns={columns}
        rows={data.rows}
        loading={fetching && data.rows.length === 0}
        emptyLabel={debouncedQ || status !== 'all' || service || category ? 'Nothing matches these filters' : 'No clients or vendors yet. Add one or import a CSV.'}
        onRowClick={(r) => setDrawer({ mode: 'view', party: r })}
        maxHeight="62vh"
      />

      <Drawer
        open={Boolean(drawer)}
        onClose={() => setDrawer(null)}
        size="xl"
        tone={drawer?.mode === 'create' ? 'create' : drawer?.mode === 'edit' ? 'edit' : 'default'}
        title={drawer?.mode === 'create' ? (drawer.kind === 'vendor' ? 'Add vendor' : 'Add client') : drawer?.mode === 'edit' ? `Edit ${party?.name}` : party?.name || ''}
      >
        {drawer && drawer.mode !== 'view' && (
          <PartyForm
            key={party?.id || 'new'}
            initial={drawer.mode === 'edit' ? party : null}
            kind={drawer.mode === 'create' ? drawer.kind : undefined}
            services={activeServices}
            saving={saving}
            onSubmit={save}
            onCancel={() => setDrawer(drawer.mode === 'edit' ? { mode: 'view', party } : null)}
          />
        )}
        {drawer?.mode === 'view' && party && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex gap-2"><Pill tone={KIND_TONE[party.kind]}>{KIND_LABEL[party.kind]}</Pill><Pill value={party.status} /></span>
              <span className="inline-flex gap-2">
                <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setDrawer({ mode: 'edit', party })}><Pencil className="h-4 w-4" />Edit</button>
                {canDelete && <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-danger-200 px-3 py-2 text-sm font-medium text-danger-600 hover:bg-danger-50" onClick={() => remove(party)}><Trash2 className="h-4 w-4" />Delete</button>}
              </span>
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Company">{party.company_name}</Detail>
              <Detail label="Contact person">{party.contact_name}</Detail>
              <Detail label="Phone">{party.phone}</Detail>
              <Detail label="Email">{party.email}</Detail>
              <Detail label="City">{[party.city, party.state, party.country].filter(Boolean).join(', ')}</Detail>
              {party.kind !== 'vendor' && <Detail label="Interested services">{party.interested_services?.length ? party.interested_services.map(serviceLabel).join(', ') : null}</Detail>}
              {party.kind !== 'client' && <Detail label="Vendor category">{party.vendor_category}</Detail>}
              {party.kind !== 'client' && <div className="sm:col-span-2"><Detail label="Materials / services provided">{party.materials_services}</Detail></div>}
              <Detail label="GSTIN"><span className="font-mono">{party.gstin}</span></Detail>
              <Detail label="PAN"><span className="font-mono">{party.pan}</span></Detail>
              <div className="sm:col-span-2"><Detail label="Address">{party.address}</Detail></div>
              <div className="sm:col-span-2"><Detail label="Payment terms">{party.payment_terms}</Detail></div>
              <div className="sm:col-span-2"><Detail label="Notes"><span className="whitespace-pre-wrap">{party.notes}</span></Detail></div>
            </dl>
            {zxCan(me, 'ledger') && <Statement partyId={party.id} />}
            <ZephyrDocuments ownerType="party" ownerId={party.id} onChanged={load} />
          </div>
        )}
      </Drawer>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={load} />
    </div>
  );
}
