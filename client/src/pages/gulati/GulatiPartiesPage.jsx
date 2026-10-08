import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Building2, FileUp, Pencil, Plus, Trash2, Truck, Users } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { gulatiApi, gulatiError } from '../../lib/gulati/api.js';
import { csvToObjects, downloadText } from '../../lib/zephyr/csv.js';
import { useGulati, gxCan } from '../../lib/gulati/useGulati.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Modal from '../../components/ui/Modal.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import Pill from '../../components/ui/Pill.jsx';
import FilterBar from '../../components/zephyr/FilterBar.jsx';
import GulatiDocuments from '../../components/gulati/GulatiDocuments.jsx';
import { Area, Detail, Money, Select, Text, inputCls } from '../../components/gulati/ui.jsx';

const TABS = [
  { key: 'all', label: 'All', icon: Users },
  { key: 'client', label: 'Clients', icon: Building2 },
  { key: 'vendor', label: 'Vendors', icon: Truck },
];
const KIND_OPTIONS = [
  { value: 'client', label: 'Client' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'both', label: 'Client and vendor' },
];
const KIND_LABEL = { client: 'Client', vendor: 'Vendor', both: 'Client + Vendor' };
const KIND_TONE = { client: 'blue', vendor: 'amber', both: 'purple' };
const STATUS_OPTIONS = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'hold', label: 'On hold' }];
const FIELDS = ['kind', 'name', 'company_name', 'contact_name', 'phone', 'email', 'gstin', 'pan', 'address', 'city', 'state', 'country', 'vendor_category', 'materials_services', 'payment_terms', 'status', 'notes'];
const CSV_HEADERS = FIELDS;

function PartyForm({ initial, kind, onSubmit, onCancel, saving }) {
  const [v, setV] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, initial?.[k] ?? (k === 'kind' ? kind || 'client' : k === 'status' ? 'active' : '')])));
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  const isVendor = v.kind !== 'client';
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(Object.fromEntries(FIELDS.map((k) => [k, typeof v[k] === 'string' ? v[k].trim() : v[k]])));
      }}
      className="space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Text label="Name" className="sm:col-span-2" value={v.name} onChange={set('name')} required maxLength={200} autoFocus />
        <Select label="Type" value={v.kind} onChange={set('kind')} options={KIND_OPTIONS} />
        <Select label="Status" value={v.status} onChange={set('status')} options={STATUS_OPTIONS} />
        <Text label="Company name" value={v.company_name} onChange={set('company_name')} maxLength={200} />
        <Text label="Contact person" value={v.contact_name} onChange={set('contact_name')} maxLength={200} />
        <Text label="Phone" value={v.phone} onChange={set('phone')} maxLength={40} />
        <Text label="Email" type="email" value={v.email} onChange={set('email')} maxLength={200} />
        <Text label="City" value={v.city} onChange={set('city')} maxLength={120} />
        <Text label="State" value={v.state} onChange={set('state')} maxLength={120} />
        <Text label="Country" value={v.country} onChange={set('country')} maxLength={120} placeholder="India" />
        <Text label="GSTIN" className="uppercase" value={v.gstin} onChange={set('gstin')} maxLength={15} title="15 characters, e.g. 22AAAAA0000A1Z5" />
        <Text label="PAN" value={v.pan} onChange={set('pan')} maxLength={10} title="10 characters, e.g. ABCDE1234F" />
        <Text label="Address" className="sm:col-span-2" value={v.address} onChange={set('address')} maxLength={500} />
        {isVendor && (
          <>
            <Text label="Vendor category" value={v.vendor_category} onChange={set('vendor_category')} maxLength={120} placeholder="Copper producer, trader, logistics..." />
            <Text label="Material / product supplied" value={v.materials_services} onChange={set('materials_services')} maxLength={1000} />
          </>
        )}
        <Text label="Payment terms" className="sm:col-span-2" value={v.payment_terms} onChange={set('payment_terms')} placeholder="e.g. 30 days, 20% advance" maxLength={200} />
        <Area label="Notes" className="sm:col-span-2" value={v.notes} onChange={set('notes')} maxLength={2000} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </form>
  );
}

function Statement({ partyId }) {
  const [s, setS] = useState(null);
  useEffect(() => {
    setS(null);
    gulatiApi.partyStatement(partyId).then(setS, () => setS(false));
  }, [partyId]);
  if (s === false) return null;
  if (!s) return <div className="text-sm text-tertiary-500">Loading statement...</div>;
  const rows = [
    s.as_client.count > 0 && ['As client', [['Total sales', s.as_client.total_sales], ['Received', s.as_client.received], ['Outstanding', s.as_client.outstanding]]],
    s.as_vendor.count > 0 && ['As vendor', [['Total purchases', s.as_vendor.total_purchases], ['Paid', s.as_vendor.paid], ['Outstanding', s.as_vendor.outstanding]]],
  ].filter(Boolean);
  return (
    <section className="space-y-3">
      <h3 className="font-heading text-sm font-semibold text-tertiary-900">Account statement</h3>
      {rows.length === 0 && <div className="rounded-xl border border-dashed p-3 text-center text-xs text-tertiary-400">No sales or purchases with this party yet.</div>}
      {rows.map(([title, tiles]) => (
        <div key={title}>
          <div className="mb-1 text-xs font-medium text-tertiary-500">{title}</div>
          <div className="grid grid-cols-3 gap-2">
            {tiles.map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-2.5"><div className="text-[11px] text-tertiary-500">{label}</div><div className="text-sm font-semibold"><Money v={value} /></div></div>)}
          </div>
        </div>
      ))}
      {s.deals.length > 0 && <div className="text-xs text-tertiary-500">Deals: {s.deals.map((d) => `${d.code} ${d.name}`).join(', ')}</div>}
    </section>
  );
}

function ImportModal({ open, onClose, onDone }) {
  const { pushError, pushSuccess } = useAlerts();
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const reset = () => { setRows(null); setFileName(''); setResult(null); };

  async function pick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setRows(csvToObjects(await file.text()));
  }
  async function run() {
    setBusy(true);
    try {
      const res = await gulatiApi.importParties(rows);
      setResult(res);
      pushSuccess(`${res.created} added, ${res.skipped.length} skipped`);
      if (res.created > 0) onDone();
    } catch (err) {
      pushError(gulatiError(err, 'Import failed'), 'Import failed');
    } finally {
      setBusy(false);
    }
  }
  const close = () => { reset(); onClose(); };
  return (
    <Modal open={open} wide onClose={close} title="Import clients / vendors from CSV">
      <div className="space-y-4 text-sm">
        <p className="text-tertiary-600">Columns: <code className="text-xs">{CSV_HEADERS.join(', ')}</code>. Only <b>name</b> is required; <b>kind</b> is client, vendor or both. Names that already exist are skipped.</p>
        <button type="button" className="text-sm font-medium text-primary-700 hover:underline" onClick={() => downloadText('gulati-parties-template.csv', `${CSV_HEADERS.join(',')}\nABC Industries,client,,,,,,,,Mumbai\n`)}>Download template</button>
        <input type="file" accept=".csv,text/csv" onChange={pick} className={inputCls} />
        {rows && !result && <div className="rounded-xl bg-primary-50 px-3 py-2 text-primary-800">{fileName}: {rows.length} row{rows.length === 1 ? '' : 's'} ready.</div>}
        {result && (
          <div className="space-y-2">
            <div className="rounded-xl bg-primary-50 px-3 py-2 text-primary-800">{result.created} added, {result.skipped.length} skipped.</div>
            {result.skipped.length > 0 && <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl border p-2 text-xs text-tertiary-600">{result.skipped.map((s) => <li key={`${s.row}-${s.reason}`}>Row {s.row}{s.name ? ` (${s.name})` : ''}: {s.reason}</li>)}</ul>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={close}>{result ? 'Close' : 'Cancel'}</button>
          {!result && <button type="button" className="btn-primary" disabled={!rows?.length || busy} onClick={run}>{busy ? 'Importing...' : 'Import'}</button>}
        </div>
      </div>
    </Modal>
  );
}

export default function GulatiPartiesPage() {
  const { me, loading } = useGulati();
  const { pushError, pushSuccess } = useAlerts();
  const [tab, setTab] = useState('all');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [data, setData] = useState({ rows: [], summary: null });
  const [fetching, setFetching] = useState(true);
  const [drawer, setDrawer] = useState(null);
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
      const res = await gulatiApi.parties({ tab, status, ...(category ? { vendor_category: category } : {}), ...(debouncedQ ? { q: debouncedQ } : {}), limit: 200 });
      if (id === reqId.current) setData({ rows: res.data, summary: res.summary });
    } catch (e) {
      if (id === reqId.current) pushError(gulatiError(e, 'Could not load the directory'), 'Load failed');
    } finally {
      if (id === reqId.current) setFetching(false);
    }
  }, [tab, status, category, debouncedQ, pushError]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!gxCan(me, 'parties')) return <Navigate to="/gulati" replace />;
  const canDelete = gxCan(me, 'delete');

  async function save(values) {
    setSaving(true);
    try {
      const body = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === '' ? null : v]));
      body.name = values.name;
      if (drawer.mode === 'create') await gulatiApi.createParty(body);
      else await gulatiApi.updateParty(drawer.party.id, body);
      pushSuccess(drawer.mode === 'create' ? 'Added to the directory' : 'Saved');
      setDrawer(null);
      load();
    } catch (e) {
      pushError(gulatiError(e, 'Could not save'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  async function remove(party) {
    if (!window.confirm(`Delete ${party.name}? It will be removed from the directory.`)) return;
    try {
      await gulatiApi.deleteParty(party.id);
      pushSuccess('Deleted');
      setDrawer(null);
      load();
    } catch (e) {
      pushError(gulatiError(e, 'Could not delete'), 'Delete failed');
    }
  }

  const columns = [
    { key: 'name', header: 'Name', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span>{r.company_name && <span className="block text-xs text-tertiary-500">{r.company_name}</span>}</span> },
    { key: 'kind', header: 'Type', render: (r) => <Pill tone={KIND_TONE[r.kind]}>{KIND_LABEL[r.kind]}</Pill> },
    { key: 'contact', header: 'Contact', render: (r) => <span className="text-tertiary-600">{[r.contact_name, r.phone].filter(Boolean).join(' · ') || '-'}</span> },
    { key: 'city', header: 'Location', render: (r) => [r.city, r.state, r.country].filter(Boolean).join(', ') || '-' },
    { key: 'focus', header: 'Category / material', render: (r) => r.vendor_category || r.materials_services || '-' },
    { key: 'gstin', header: 'GSTIN', render: (r) => <span className="font-mono text-xs">{r.gstin || '-'}</span> },
    { key: 'status', header: 'Status', render: (r) => <Pill value={r.status} /> },
  ];
  const s = data.summary;
  const party = drawer?.party;

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Clients" value={s?.clients ?? '-'} hint="active, incl. both" />
        <StatCard label="Vendors" value={s?.vendors ?? '-'} hint="active, incl. both" />
      </div>
      <div className="space-y-3">
        <SectionTabs tabs={TABS} value={tab} onChange={setTab} className="min-w-0" />
        <FilterBar
          q={q}
          onQ={setQ}
          searchPlaceholder="Search name, GSTIN, city..."
          fields={[
            { key: 'status', label: 'Status', type: 'select', any: 'All statuses', options: STATUS_OPTIONS },
            { key: 'category', label: 'Vendor category', type: 'select', any: 'Any category', hidden: tab === 'client' || !(s?.vendor_categories || []).length, options: (s?.vendor_categories || []).map((c) => ({ value: c, label: c })) },
          ]}
          values={{ status, category }}
          defaults={{ status: 'all', category: '' }}
          onChange={(key, value) => ({ status: setStatus, category: setCategory })[key](value)}
          onReset={() => { setStatus('all'); setCategory(''); setQ(''); }}
        >
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setImportOpen(true)}><FileUp className="h-4 w-4" />Import</button>
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setDrawer({ mode: 'create', kind: 'vendor' })}><Plus className="h-4 w-4" />Add vendor</button>
          <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ mode: 'create', kind: 'client' })}><Plus className="h-4 w-4" />Add client</button>
        </FilterBar>
      </div>
      <DataTable columns={columns} rows={data.rows} loading={fetching && data.rows.length === 0} emptyLabel={debouncedQ || status !== 'all' || category ? 'Nothing matches these filters' : 'No clients or vendors yet. Add one or import a CSV.'} onRowClick={(r) => setDrawer({ mode: 'view', party: r })} maxHeight="62vh" />

      <Drawer
        open={Boolean(drawer)}
        onClose={() => setDrawer(null)}
        size="xl"
        tone={drawer?.mode === 'create' ? 'create' : drawer?.mode === 'edit' ? 'edit' : 'default'}
        title={drawer?.mode === 'create' ? (drawer.kind === 'vendor' ? 'Add vendor' : 'Add client') : drawer?.mode === 'edit' ? `Edit ${party?.name}` : party?.name || ''}
      >
        {drawer && drawer.mode !== 'view' && (
          <PartyForm key={party?.id || 'new'} initial={drawer.mode === 'edit' ? party : null} kind={drawer.mode === 'create' ? drawer.kind : undefined} saving={saving} onSubmit={save} onCancel={() => setDrawer(drawer.mode === 'edit' ? { mode: 'view', party } : null)} />
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
              <Detail label="Location">{[party.city, party.state, party.country].filter(Boolean).join(', ')}</Detail>
              {party.kind !== 'client' && <Detail label="Vendor category">{party.vendor_category}</Detail>}
              {party.kind !== 'client' && <div className="sm:col-span-2"><Detail label="Material / product supplied">{party.materials_services}</Detail></div>}
              <Detail label="GSTIN"><span className="font-mono">{party.gstin}</span></Detail>
              <Detail label="PAN"><span className="font-mono">{party.pan}</span></Detail>
              <div className="sm:col-span-2"><Detail label="Address">{party.address}</Detail></div>
              <div className="sm:col-span-2"><Detail label="Payment terms">{party.payment_terms}</Detail></div>
              <div className="sm:col-span-2"><Detail label="Notes"><span className="whitespace-pre-wrap">{party.notes}</span></Detail></div>
            </dl>
            <Statement partyId={party.id} />
            <GulatiDocuments ownerType="party" ownerId={party.id} onChanged={load} />
          </div>
        )}
      </Drawer>
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={load} />
    </div>
  );
}
