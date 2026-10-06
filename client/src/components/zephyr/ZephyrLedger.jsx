import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileUp, Plus, Search, Share2, Trash2, X } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { csvToObjects, downloadText } from '../../lib/zephyr/csv.js';
import { rupees } from '../../lib/zephyr/projectMeta.js';
import { dateLabel } from '../../lib/format.js';
import { useServiceTypes } from '../../lib/zephyr/serviceMeta.js';
import DataTable from '../ui/DataTable.jsx';
import Drawer from '../ui/Drawer.jsx';
import Modal from '../ui/Modal.jsx';
import Pill from '../ui/Pill.jsx';
import ZephyrDocuments from './ZephyrDocuments.jsx';

const inputCls = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const MODES = [['bank', 'Bank transfer'], ['upi', 'UPI'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['card', 'Card'], ['other', 'Other']];
const CSV_HEADERS = ['date', 'type', 'category', 'amount', 'tax', 'status', 'project', 'party', 'payment_mode', 'reference', 'description'];
const today = () => new Date().toISOString().slice(0, 10);

function EntryForm({ initial, fixedProject, isAdmin, categories, projects, parties, properties = [], services = [], saving, onSubmit, onCancel }) {
  const [v, setV] = useState(() => ({
    entry_date: initial?.entry_date || today(),
    type: initial?.type || 'expense',
    category_id: initial?.category_id || '',
    amount: initial?.amount ?? '',
    tax: initial?.tax ?? 0,
    status: initial?.status || 'actual',
    project_id: initial?.project_id || fixedProject || '',
    party_id: initial?.party_id || '',
    work_order_id: initial?.work_order_id || '',
    milestone_id: initial?.milestone_id || '',
    service_type: initial?.service_type || '',
    property_id: initial?.property_id || '',
    unit_id: initial?.unit_id || '',
    payment_mode: initial?.payment_mode || '',
    reference: initial?.reference || '',
    description: initial?.description || '',
  }));
  const [links, setLinks] = useState({ work_orders: [], milestones: [] });
  const [propertyUnits, setPropertyUnits] = useState([]);
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));

  useEffect(() => {
    if (!v.project_id) {
      setLinks({ work_orders: [], milestones: [] });
      return;
    }
    zephyrApi.project(v.project_id).then((p) => setLinks({ work_orders: p.work_orders.filter((w) => w.status !== 'cancelled'), milestones: p.milestones }), () => setLinks({ work_orders: [], milestones: [] }));
  }, [v.project_id]);

  useEffect(() => {
    if (!v.property_id) {
      setPropertyUnits([]);
      return;
    }
    zephyrApi.property(v.property_id).then((p) => setPropertyUnits(p.units || []), () => setPropertyUnits([]));
  }, [v.property_id]);

  const cats = categories.filter((c) => c.kind === v.type && (c.active || c.id === initial?.category_id));
  const partyOptions = parties.filter((p) => (v.type === 'revenue' ? p.kind !== 'vendor' : p.kind !== 'client'));

  function pickType(type) {
    setV((cur) => ({ ...cur, type, category_id: '', work_order_id: '', milestone_id: '', party_id: '' }));
  }
  function pickWorkOrder(e) {
    const wo = links.work_orders.find((w) => w.id === e.target.value);
    setV((cur) => ({ ...cur, work_order_id: e.target.value, party_id: wo ? wo.vendor_id : cur.party_id }));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          entry_date: v.entry_date, type: v.type, category_id: v.category_id, amount: Number(v.amount), tax: Number(v.tax || 0), status: v.status,
          project_id: v.project_id || null, party_id: v.party_id || null, work_order_id: v.type === 'expense' ? v.work_order_id || null : null,
          milestone_id: v.type === 'revenue' ? v.milestone_id || null : null, payment_mode: v.payment_mode || null,
          ...(isAdmin ? { service_type: v.service_type || null, property_id: v.property_id || null, unit_id: v.property_id ? v.unit_id || null : null } : {}),
          reference: v.reference.trim() || null, description: v.description.trim() || null,
        });
      }}
      className="space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <div className={labelCls}>Type</div>
          <div className="mt-1 inline-flex overflow-hidden rounded-xl border text-sm">
            {[['expense', 'Expense'], ['revenue', 'Revenue']].map(([key, label]) => (
              <button key={key} type="button" disabled={!isAdmin && key === 'revenue'} onClick={() => pickType(key)} className={`px-4 py-1.5 disabled:opacity-40 ${v.type === key ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-primary-50'}`}>{label}</button>
            ))}
          </div>
        </div>
        <label className={labelCls}>Date<input type="date" className={inputCls} value={v.entry_date} max={v.status === 'actual' ? today() : undefined} onChange={set('entry_date')} required /></label>
        <label className={labelCls}>Status<select className={inputCls} value={v.status} onChange={set('status')}><option value="actual">Actual (happened)</option><option value="planned">Planned (expected)</option></select></label>
        <label className={labelCls}>Category<select className={inputCls} value={v.category_id} onChange={set('category_id')} required><option value="">Select…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className={labelCls}>Payment mode<select className={inputCls} value={v.payment_mode} onChange={set('payment_mode')}><option value="">Not stated</option>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className={labelCls}>Amount, before tax (INR)<input type="number" min="0.01" step="0.01" className={inputCls} value={v.amount} onChange={set('amount')} required /></label>
        <label className={labelCls}>Tax / GST (INR)<input type="number" min="0" step="0.01" className={inputCls} value={v.tax} onChange={set('tax')} /></label>
        <label className={labelCls}>Project{!isAdmin && ' (required)'}<select className={inputCls} value={v.project_id} onChange={(e) => setV({ ...v, project_id: e.target.value, work_order_id: '', milestone_id: '' })} required={!isAdmin} disabled={Boolean(fixedProject)}><option value="">{isAdmin ? 'Company level (no project)' : 'Select…'}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
        <label className={labelCls}>{v.type === 'revenue' ? 'Client' : 'Vendor'}<select className={inputCls} value={v.party_id} onChange={set('party_id')} disabled={Boolean(v.work_order_id)}><option value="">None</option>{partyOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {v.type === 'expense' && v.project_id && (
          <label className={`${labelCls} sm:col-span-2`}>Against work order<select className={inputCls} value={v.work_order_id} onChange={pickWorkOrder}><option value="">None</option>{links.work_orders.map((w) => <option key={w.id} value={w.id}>{w.wo_number} · {w.vendor?.name}</option>)}</select></label>
        )}
        {v.type === 'revenue' && v.project_id && (
          <label className={`${labelCls} sm:col-span-2`}>Against milestone<select className={inputCls} value={v.milestone_id} onChange={set('milestone_id')}><option value="">None</option>{links.milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        )}
        {isAdmin && (
          <>
            <label className={labelCls}>Service<select className={inputCls} value={v.service_type} onChange={set('service_type')}><option value="">{v.project_id ? 'Same as the project' : 'Not assigned'}</option>{services.map((sv) => <option key={sv.key} value={sv.key}>{sv.label}</option>)}</select></label>
            <label className={labelCls}>Property<select className={inputCls} value={v.property_id} onChange={(e) => setV({ ...v, property_id: e.target.value, unit_id: '' })}><option value="">None</option>{properties.map((pr) => <option key={pr.id} value={pr.id}>{pr.code} · {pr.name}</option>)}</select></label>
            {v.property_id && <label className={`${labelCls} sm:col-span-2`}>Unit<select className={inputCls} value={v.unit_id} onChange={set('unit_id')}><option value="">Whole property</option>{propertyUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
          </>
        )}
        <label className={labelCls}>Reference / bill no.<input className={inputCls} value={v.reference} onChange={set('reference')} maxLength={120} /></label>
        <label className={labelCls}>Description<input className={inputCls} value={v.description} onChange={set('description')} maxLength={500} /></label>
      </div>
      {initial?.id && <ZephyrDocuments ownerType="entry" ownerId={initial.id} canEdit />}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

function GroupExpenseForm({ categories, projects, properties, parties, saving, onSubmit, onCancel }) {
  const [v, setV] = useState({ entry_date: today(), category_id: '', party_id: '', amount: '', tax: '', basis: 'equal', description: '', reference: '' });
  const [rows, setRows] = useState([{ target: '', share: 1 }, { target: '', share: 1 }]);
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  const setRow = (i, key) => (e) => setRows((cur) => cur.map((r, idx) => (idx === i ? { ...r, [key]: e.target.value } : r)));
  const cats = categories.filter((c) => c.kind === 'expense' && c.active);
  const total = Number(v.amount) || 0;
  const weights = rows.map((r) => (v.basis === 'equal' ? 1 : Number(r.share) || 0));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const parts = rows.map((r, i) => (v.basis === 'amount' ? Number(r.share) || 0 : weightSum ? Math.round((total * weights[i] * 100) / weightSum) / 100 : 0));
  const check = v.basis === 'amount' ? Math.abs(parts.reduce((a, b) => a + b, 0) - total) < 0.01 : v.basis === 'percent' ? Math.abs(weightSum - 100) < 0.01 : true;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          entry_date: v.entry_date, category_id: v.category_id, party_id: v.party_id || null, amount: Number(v.amount), tax: Number(v.tax || 0), basis: v.basis,
          description: v.description.trim() || null, reference: v.reference.trim() || null,
          allocations: rows.map((r) => {
            const [kind, id] = r.target.split(':');
            return { [kind === 'project' ? 'project_id' : 'property_id']: id, share: v.basis === 'equal' ? 1 : Number(r.share) };
          }),
        });
      }}
      className="space-y-4"
    >
      <p className="rounded-xl bg-primary-50 px-3 py-2 text-sm text-primary-900">One shared cost (for example site security or a vehicle) split across several projects or properties. Each share becomes its own expense entry, so every project and property P&amp;L stays correct.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>Date<input type="date" className={inputCls} max={today()} value={v.entry_date} onChange={set('entry_date')} required /></label>
        <label className={labelCls}>Category<select className={inputCls} value={v.category_id} onChange={set('category_id')} required><option value="">Select…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className={labelCls}>Total amount, before tax (₹)<input type="number" min="0.01" step="0.01" className={inputCls} value={v.amount} onChange={set('amount')} required /></label>
        <label className={labelCls}>Tax / GST (₹)<input type="number" min="0" step="0.01" className={inputCls} value={v.tax} onChange={set('tax')} /></label>
        <label className={labelCls}>Vendor<select className={inputCls} value={v.party_id} onChange={set('party_id')}><option value="">None</option>{parties.filter((p) => p.kind !== 'client').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className={labelCls}>Split<select className={inputCls} value={v.basis} onChange={set('basis')}><option value="equal">Equally</option><option value="percent">By percent</option><option value="amount">By fixed amount</option></select></label>
        <label className={labelCls}>Reference / bill no.<input className={inputCls} value={v.reference} onChange={set('reference')} maxLength={120} /></label>
        <label className={labelCls}>Description<input className={inputCls} value={v.description} onChange={set('description')} maxLength={500} /></label>
      </div>
      <div className="space-y-2">
        <div className={labelCls}>Shared between</div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_7rem_6rem_auto] items-center gap-2">
            <select className={inputCls.replace('mt-1 ', '')} value={r.target} onChange={setRow(i, 'target')} required aria-label="Project or property">
              <option value="">Project or property…</option>
              <optgroup label="Projects">{projects.map((p) => <option key={p.id} value={`project:${p.id}`}>{p.code} · {p.name}</option>)}</optgroup>
              <optgroup label="Properties">{properties.map((p) => <option key={p.id} value={`property:${p.id}`}>{p.code} · {p.name}</option>)}</optgroup>
            </select>
            {v.basis === 'equal' ? <span className="text-xs text-tertiary-400">equal share</span> : <input type="number" min="0.01" step="0.01" className={inputCls.replace('mt-1 ', '')} value={r.share} onChange={setRow(i, 'share')} aria-label={v.basis === 'percent' ? 'Percent' : 'Amount'} placeholder={v.basis === 'percent' ? '%' : '₹'} required />}
            <span className="text-right text-sm tabular-nums text-tertiary-700">{rupees(parts[i])}</span>
            <button type="button" className="rounded-lg p-2 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600 disabled:opacity-30" disabled={rows.length <= 2} aria-label="Remove share" onClick={() => setRows(rows.filter((_, idx) => idx !== i))}><X className="h-4 w-4" /></button>
          </div>
        ))}
        <button type="button" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline" onClick={() => setRows([...rows, { target: '', share: 1 }])}><Plus className="h-4 w-4" />Add another</button>
        {!check && <div className="text-xs text-red-600">{v.basis === 'percent' ? 'The percents must add up to 100.' : 'The amounts must add up to the total.'}</div>}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving || !check}>{saving ? 'Saving…' : 'Book shared expense'}</button>
      </div>
    </form>
  );
}

function ImportModal({ open, onClose, onDone }) {
  const { pushError, pushSuccess } = useAlerts();
  const [rows, setRows] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const reset = () => { setRows(null); setResult(null); };
  async function run() {
    setBusy(true);
    try {
      const res = await zephyrApi.importEntries(rows);
      setResult(res);
      pushSuccess(`${res.created} added, ${res.skipped.length} skipped`);
      if (res.created) onDone();
    } catch (e) {
      pushError(zephyrError(e, 'Import failed'), 'Import failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} wide title="Import ledger entries from CSV" onClose={() => { reset(); onClose(); }}>
      <div className="space-y-4 text-sm">
        <p className="text-tertiary-600">Columns: <code className="text-xs">{CSV_HEADERS.join(', ')}</code>. Category must match an active category by name, project by its code (e.g. ZX-P-001), party by name. Status defaults to actual.</p>
        <button type="button" className="font-medium text-primary-700 hover:underline" onClick={() => downloadText('zephyr-ledger-template.csv', `${CSV_HEADERS.join(',')}\n2026-10-01,expense,Materials,12000,2160,actual,ZX-P-001,Steel Supplier,bank,BILL-77,Cement bags\n`)}>Download template</button>
        <input type="file" accept=".csv,text/csv" className={inputCls} onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setResult(null); setRows(csvToObjects(await f.text())); } }} />
        {rows && !result && <div className="rounded-xl bg-primary-50 px-3 py-2 text-primary-800">{rows.length} row(s) ready.</div>}
        {result && (
          <div className="space-y-2">
            <div className="rounded-xl bg-primary-50 px-3 py-2 text-primary-800">{result.created} added, {result.skipped.length} skipped.</div>
            {result.skipped.length > 0 && <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl border p-2 text-xs text-tertiary-600">{result.skipped.map((s) => <li key={`${s.row}-${s.reason}`}>Row {s.row}: {s.reason}</li>)}</ul>}
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

/**
 * The money ledger: revenue and expense entries with filters, totals, add / edit and CSV import.
 * `projectId` pins the list to one project (the project's Money tab). Managers record project expenses only.
 */
export default function ZephyrLedger({ projectId, isAdmin, canDelete, onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [filters, setFilters] = useState({ type: '', status: '', project_id: '', party_id: '', category_id: '', service_type: '', property_id: '', from: '', to: '', q: '' });
  const [dq, setDq] = useState('');
  const [data, setData] = useState({ rows: [], totals: null });
  const [fetching, setFetching] = useState(true);
  const [categories, setCategories] = useState([]);
  const [projects, setProjects] = useState([]);
  const [parties, setParties] = useState([]);
  const [properties, setProperties] = useState([]);
  const { services, label: serviceLabel, active: activeServices } = useServiceTypes();
  const [drawer, setDrawer] = useState(null); // { entry? } or { group: true }
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDq(filters.q.trim()), 250);
    return () => clearTimeout(t);
  }, [filters.q]);

  const params = useMemo(() => {
    const p = { limit: 200 };
    for (const k of ['type', 'status', 'party_id', 'category_id', 'service_type', 'property_id', 'from', 'to']) if (filters[k]) p[k] = filters[k];
    if (projectId || filters.project_id) p.project_id = projectId || filters.project_id;
    if (dq) p.q = dq;
    return p;
  }, [filters, dq, projectId]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setFetching(true);
    try {
      const res = await zephyrApi.ledger(params);
      if (id === reqId.current) setData({ rows: res.data, totals: res.totals });
    } catch (e) {
      if (id === reqId.current) pushError(zephyrError(e, 'Could not load the ledger'), 'Load failed');
    } finally {
      if (id === reqId.current) setFetching(false);
    }
  }, [params, pushError]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    zephyrApi.categories().then(setCategories, () => setCategories([]));
    zephyrApi.projects({}).then(setProjects, () => setProjects([]));
    zephyrApi.parties({ status: 'active', limit: 200 }).then((r) => setParties(r.data), () => setParties([]));
    if (isAdmin) zephyrApi.properties({}).then(setProperties, () => setProperties([]));
  }, [isAdmin]);

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));

  async function save(body) {
    setSaving(true);
    try {
      if (drawer.entry) await zephyrApi.updateEntry(drawer.entry.id, body);
      else await zephyrApi.createEntry(body);
      pushSuccess(drawer.entry ? 'Entry saved' : 'Entry added');
      setDrawer(null);
      await load();
      onChanged?.();
    } catch (e) {
      pushError(zephyrError(e, 'Could not save'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  async function saveGroup(body) {
    setSaving(true);
    try {
      await zephyrApi.createGroupExpense(body);
      pushSuccess('Shared expense booked');
      setDrawer(null);
      await load();
      onChanged?.();
    } catch (e) {
      pushError(zephyrError(e, 'Could not book the shared expense'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  async function removeGroup(entry) {
    if (!window.confirm('Delete the whole shared expense, every share of it?')) return;
    try {
      await zephyrApi.deleteGroupExpense(entry.source_id);
      pushSuccess('Shared expense deleted');
      setDrawer(null);
      await load();
      onChanged?.();
    } catch (e) {
      pushError(zephyrError(e, 'Could not delete'), 'Delete failed');
    }
  }
  async function remove(entry) {
    if (!window.confirm('Delete this entry?')) return;
    try {
      await zephyrApi.deleteEntry(entry.id);
      pushSuccess('Entry deleted');
      setDrawer(null);
      await load();
      onChanged?.();
    } catch (e) {
      pushError(zephyrError(e, 'Could not delete'), 'Delete failed');
    }
  }

  const t = data.totals;
  const columns = [
    { key: 'date', header: 'Date', render: (r) => dateLabel(r.entry_date) },
    { key: 'type', header: 'Type', render: (r) => <Pill tone={r.type === 'revenue' ? 'green' : 'amber'}>{r.type === 'revenue' ? 'Revenue' : 'Expense'}</Pill> },
    { key: 'category', header: 'Category', render: (r) => r.category?.name },
    { key: 'project', header: 'Project / property', render: (r) => (r.project ? <span title={r.project.name}>{r.project.code}</span> : r.property_id ? 'Property' : '—') },
    ...(isAdmin ? [{ key: 'service', header: 'Service', render: (r) => (r.service_type ? serviceLabel(r.service_type) : '—') }] : []),
    { key: 'party', header: 'Client / vendor', render: (r) => r.party?.name || '—' },
    { key: 'amount', header: 'Amount', render: (r) => <span className={`tabular-nums ${r.type === 'revenue' ? 'text-green-700' : 'text-tertiary-900'}`}>{rupees(r.amount)}</span> },
    { key: 'tax', header: 'Tax', render: (r) => (r.tax ? rupees(r.tax) : '—') },
    { key: 'ref', header: 'Reference', render: (r) => r.reference || (r.source_type === 'group_expense' ? 'Shared expense' : r.source_type === 'rent_payment' ? 'Rent' : r.source_type === 'property_sale' ? 'Property sale' : r.source_type === 'consulting_commission' ? 'Commission' : '—') },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={r.status === 'actual' ? 'green' : 'gray'}>{r.status === 'actual' ? 'Actual' : 'Planned'}</Pill> },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Revenue (actual)', t?.revenue], ['Expense (actual)', t?.expense], ['Revenue expected', t?.planned_revenue], ['Expense expected', t?.planned_expense]].map(([label, value]) => (
          <div key={label} className="rounded-2xl border bg-white p-3 shadow-soft"><div className="text-xs text-tertiary-500">{label}</div><div className="mt-1 text-lg font-semibold tabular-nums text-tertiary-900">{rupees(value)}</div></div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && <select value={filters.type} onChange={set('type')} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Type"><option value="">Revenue + expense</option><option value="revenue">Revenue</option><option value="expense">Expense</option></select>}
          <select value={filters.status} onChange={set('status')} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Status"><option value="">Actual + planned</option><option value="actual">Actual</option><option value="planned">Planned</option></select>
          {!projectId && <select value={filters.project_id} onChange={set('project_id')} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Project"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select>}
          {isAdmin && !projectId && <select value={filters.service_type} onChange={set('service_type')} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Service"><option value="">All services</option>{services.map((sv) => <option key={sv.key} value={sv.key}>{sv.label}</option>)}</select>}
          {isAdmin && !projectId && properties.length > 0 && <select value={filters.property_id} onChange={set('property_id')} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Property"><option value="">All properties</option>{properties.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}</select>}
          <select value={filters.category_id} onChange={set('category_id')} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Category"><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input type="date" value={filters.from} onChange={set('from')} className="rounded-xl border px-2 py-1.5 text-sm" aria-label="From date" />
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={set('to')} className="rounded-xl border px-2 py-1.5 text-sm" aria-label="To date" />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary-400" />
            <input value={filters.q} onChange={set('q')} placeholder="Search bill no., notes…" aria-label="Search ledger" className="w-48 rounded-xl border py-1.5 pl-9 pr-3 text-sm" />
          </div>
          {isAdmin && !projectId && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setImportOpen(true)}><FileUp className="h-4 w-4" />Import CSV</button>}
          {isAdmin && !projectId && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setDrawer({ group: true })}><Share2 className="h-4 w-4" />Shared expense</button>}
          <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({})}><Plus className="h-4 w-4" />Add entry</button>
        </div>
      </div>

      <DataTable columns={columns} rows={data.rows} loading={fetching && data.rows.length === 0} emptyLabel="No entries match. Add revenue or expense as it happens." onRowClick={(entry) => setDrawer({ entry })} maxHeight="56vh" />

      <Drawer open={Boolean(drawer)} onClose={() => setDrawer(null)} size="xl" tone={drawer?.entry ? 'edit' : 'create'} title={drawer?.group ? 'Shared expense' : drawer?.entry ? 'Edit entry' : 'New entry'}>
        {drawer?.group && <GroupExpenseForm categories={categories} projects={projects} properties={properties} parties={parties} saving={saving} onSubmit={saveGroup} onCancel={() => setDrawer(null)} />}
        {drawer && !drawer.group && drawer.entry?.source_type ? (
          <div className="space-y-4">
            <div className="rounded-xl border bg-primary-50/50 p-3 text-sm text-tertiary-800">
              {{ rent_payment: 'This entry is a rent receipt. To change it, reverse the payment on the Rent page.', property_sale: 'This entry was booked by a property sale. To change it, reverse the sale on the property.', consulting_commission: 'This entry is the consulting commission of a project. It follows the project details.', group_expense: 'This entry is one share of a shared expense. Delete the shared expense to change it.' }[drawer.entry.source_type] || 'This entry was created by another part of Zephyr.'}
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-tertiary-500">Date</dt><dd>{dateLabel(drawer.entry.entry_date)}</dd></div>
              <div><dt className="text-xs text-tertiary-500">Amount</dt><dd className="tabular-nums">{rupees(drawer.entry.amount)}</dd></div>
              <div><dt className="text-xs text-tertiary-500">Category</dt><dd>{drawer.entry.category?.name}</dd></div>
              <div><dt className="text-xs text-tertiary-500">Service</dt><dd>{drawer.entry.service_type ? serviceLabel(drawer.entry.service_type) : '—'}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-tertiary-500">Description</dt><dd>{drawer.entry.description || '—'}</dd></div>
            </dl>
            {drawer.entry.source_type === 'group_expense' && canDelete && <div className="flex justify-end"><button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-danger-200 px-3 py-1.5 text-sm font-medium text-danger-600 hover:bg-danger-50" onClick={() => removeGroup(drawer.entry)}><Trash2 className="h-4 w-4" />Delete shared expense</button></div>}
          </div>
        ) : null}
        {drawer && !drawer.group && !drawer.entry?.source_type && (
          <div className="space-y-4">
            {drawer.entry && canDelete && (
              <div className="flex justify-end"><button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-danger-200 px-3 py-1.5 text-sm font-medium text-danger-600 hover:bg-danger-50" onClick={() => remove(drawer.entry)}><Trash2 className="h-4 w-4" />Delete</button></div>
            )}
            <EntryForm key={drawer.entry?.id || 'new'} initial={drawer.entry} fixedProject={projectId} isAdmin={isAdmin} categories={categories} projects={projects} parties={parties} properties={properties} services={activeServices} saving={saving} onSubmit={save} onCancel={() => setDrawer(null)} />
          </div>
        )}
      </Drawer>
      {isAdmin && <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={() => { load(); onChanged?.(); }} />}
    </div>
  );
}
