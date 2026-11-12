import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useLeadClientOptions, useLocationOptions, useOrgMembershipOptions } from '../../lib/lookups.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import MultiSelectDropdown from '../../components/ui/MultiSelectDropdown.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';

// Suggestions only — the type is free text, so a new kind of device needs no code change.
const ASSET_TYPES = ['Windows Laptop', 'Mac Book', 'Cube', 'Monitor', 'Mobile', 'Accessory'];

const STATUS_FILTERS = [
  { key: 'issued', label: 'Issued' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'returned', label: 'Returned' },
  { key: 'all', label: 'All' },
];

const STATUS_LABEL = { issued: 'Issued', dispatched: 'Dispatched', returned: 'Returned' };
const STATUS_TONE = { issued: 'blue', dispatched: 'green', returned: 'gray' };
const OWNER_LABEL = { delphic: 'Delphic', client: 'Client', vendor: 'Vendor' };
const OWNER_TONE = { delphic: 'amber', client: 'purple', vendor: 'cyan' };

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(ymd) {
  return ymd ? new Date(`${ymd}T00:00:00`).toLocaleDateString() : '';
}

function muted(text = '—') {
  return <span className="text-tertiary-400">{text}</span>;
}

function emptyForm(asset) {
  return {
    serial_number: asset?.serial_number || '',
    asset_type: asset?.asset_type || '',
    status: asset?.status || 'issued',
    belongs_to: asset?.belongs_to || 'delphic',
    org_membership_id: asset?.org_membership_id || '',
    vendor_account_id: asset?.vendor_account_id || '',
    client_account_id: asset?.client_account_id || '',
    used_by_ids: asset?.used_by_ids || [],
    location_id: asset?.location_id || '',
    issue_date: asset?.issue_date || (asset ? '' : todayYmd()),
    return_date: asset?.return_date || '',
    device_details: asset?.device_details || '',
  };
}

/**
 * Add / edit one device. `asset` is null for a new one. A linked employee,
 * vendor or client that no longer shows in its picker (e.g. an account since
 * reclassified) is kept as a selectable option so the edit doesn't blank it.
 */
function AssetDrawer({ open, asset, onClose, onSaved }) {
  const { pushError, pushInfo } = useAlerts();
  const [form, setForm] = useState(emptyForm(null));
  const [saving, setSaving] = useState(false);
  const members = useOrgMembershipOptions(open);
  // Every vendor account of this company (Finance's vendor list) — the
  // /accounts lookup only answers in the master workspace and caps at 100.
  const [vendors, setVendors] = useState([]);
  useEffect(() => {
    if (!open) return;
    apiClient.get('/billing/vendors').then(({ data }) => setVendors((data.data || []).map((v) => ({ value: v.id, label: v.name })))).catch(() => setVendors([]));
  }, [open]);
  const clients = useLeadClientOptions(open);
  // Who uses the asset: every employee of the company, active or exited. The office: the company's locations (HR settings).
  const everyone = useOrgMembershipOptions(open, { includeExited: true });
  const userOptions = useMemo(() => everyone.map((o) => ({ id: o.value, label: o.label, hint: o.hint })), [everyone]);
  const locations = useLocationOptions(open);

  useEffect(() => { if (open) setForm(emptyForm(asset)); }, [open, asset]);

  const withCurrent = (options, current) =>
    current && !options.some((o) => o.value === current.id) ? [{ value: current.id, label: current.name }, ...options] : options;
  const memberOptions = withCurrent(members, asset?.org_membership);
  const vendorOptions = withCurrent(vendors, asset?.vendor_account);
  const clientOptions = withCurrent(clients, asset?.client_account);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  function setStatus(status) {
    setForm((f) => ({ ...f, status, return_date: status === 'returned' ? f.return_date || todayYmd() : '' }));
  }

  async function save(overrides = {}) {
    const values = { ...form, ...overrides };
    const body = {
      ...values,
      org_membership_id: values.org_membership_id || null,
      // The vendor that supplied it — recorded for any asset, required when it belongs to the vendor.
      vendor_account_id: values.vendor_account_id || null,
      client_account_id: values.client_account_id || null,
      used_by_ids: values.used_by_ids || [],
      location_id: values.location_id || null,
      issue_date: values.issue_date || null,
      return_date: values.return_date || null,
    };
    setSaving(true);
    try {
      if (asset) await apiClient.patch(`/assets/${asset.id}`, body);
      else await apiClient.post('/assets', body);
      pushInfo(asset ? 'Asset updated' : 'Asset added');
      onSaved();
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save the asset'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${asset.asset_type}${asset.serial_number ? ` ${asset.serial_number}` : ''} from the register? This can't be undone.`)) return;
    setSaving(true);
    try {
      await apiClient.delete(`/assets/${asset.id}`);
      pushInfo('Asset deleted');
      onSaved();
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to delete the asset'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  const input = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm';
  const label = 'block text-xs font-medium text-tertiary-600';

  return (
    <Drawer
      open={open}
      title={asset ? `${asset.asset_type}${asset.serial_number ? ` · ${asset.serial_number}` : ''}` : 'Add asset'}
      onClose={onClose}
      size="lg"
      tone={asset ? 'edit' : 'default'}
      footer={
        <>
          {asset && (
            <button type="button" className="btn-ghost mr-auto text-red-600" onClick={remove} disabled={saving}>Delete</button>
          )}
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          {['issued', 'dispatched'].includes(asset?.status) && (
            <button type="button" className="btn-secondary" onClick={() => save({ status: 'returned', return_date: form.return_date || todayYmd() })} disabled={saving}>
              Mark returned
            </button>
          )}
          <button type="submit" form="asset-form" className="btn-primary" disabled={saving || !form.asset_type.trim() || (form.belongs_to === 'vendor' && !form.vendor_account_id)}>
            {saving ? 'Saving…' : asset ? 'Save asset' : 'Add asset'}
          </button>
        </>
      }
    >
      <form id="asset-form" onSubmit={(e) => { e.preventDefault(); save(); }} className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Serial number
          <input value={form.serial_number} onChange={(e) => set('serial_number', e.target.value)} className={input} />
        </label>
        <label className={label}>
          Type
          <input required list="asset-type-options" value={form.asset_type} onChange={(e) => set('asset_type', e.target.value)} placeholder="e.g. Windows Laptop" className={input} />
          <datalist id="asset-type-options">
            {ASSET_TYPES.map((t) => <option key={t} value={t} />)}
          </datalist>
        </label>
        <div className={`${label} sm:col-span-2`}>
          Employee
          <SearchableSelect value={form.org_membership_id} onChange={(v) => set('org_membership_id', v)} options={memberOptions} allowClear className="mt-1" placeholder="Not assigned" searchPlaceholder="Search people…" ariaLabel="Employee" />
        </div>
        <label className={label}>
          Status
          <select value={form.status} onChange={(e) => setStatus(e.target.value)} className={input}>
            <option value="issued">Issued</option>
            <option value="dispatched">Dispatched</option>
            <option value="returned">Returned</option>
          </select>
        </label>
        <label className={label}>
          Belongs to
          <select value={form.belongs_to} onChange={(e) => set('belongs_to', e.target.value)} className={input}>
            <option value="delphic">Delphic</option>
            <option value="client">Client</option>
            <option value="vendor">Vendor</option>
          </select>
        </label>
        <div className={label}>
          Vendor name {form.belongs_to === 'vendor' && <span className="text-danger-600">*</span>}
          <SearchableSelect
            value={form.vendor_account_id}
            onChange={(v) => set('vendor_account_id', v)}
            options={vendorOptions}
            allowClear={form.belongs_to !== 'vendor'}
            className="mt-1"
            placeholder={form.belongs_to === 'vendor' ? 'Select vendor' : 'None'}
            searchPlaceholder="Search vendors…"
            noResultsMessage="No vendor accounts found — add one under Accounts (type: Vendor)"
            ariaLabel="Vendor name"
            required={form.belongs_to === 'vendor'}
          />
        </div>
        <div className={label}>
          Client name
          <SearchableSelect value={form.client_account_id} onChange={(v) => set('client_account_id', v)} options={clientOptions} allowClear className="mt-1" placeholder="None" searchPlaceholder="Search clients…" noResultsMessage="No client accounts found" ariaLabel="Client" />
        </div>
        <div className={`${label} sm:col-span-2`} data-testid="asset-used-by">
          Used by
          <div className="mt-1">
            <MultiSelectDropdown value={form.used_by_ids} onChange={(ids) => set('used_by_ids', ids)} options={userOptions} placeholder="Select one or more employees" searchPlaceholder="Search employees…" emptyMessage="No employees found." />
          </div>
        </div>
        <div className={`${label} sm:col-span-2`} data-testid="asset-office">
          Office location
          <SearchableSelect value={form.location_id} onChange={(v) => set('location_id', v)} options={locations} allowClear className="mt-1" placeholder="Not set" searchPlaceholder="Search offices…" noResultsMessage="No office locations found" ariaLabel="Office location" />
        </div>
        <label className={label}>
          Issue date
          <input type="date" value={form.issue_date} onChange={(e) => set('issue_date', e.target.value)} className={input} />
        </label>
        <label className={label}>
          Return date
          <input type="date" value={form.return_date} onChange={(e) => set('return_date', e.target.value)} disabled={form.status !== 'returned'} className={`${input} disabled:bg-tertiary-50`} />
        </label>
        <label className={`${label} sm:col-span-2`}>
          Device details
          <textarea rows={3} value={form.device_details} onChange={(e) => set('device_details', e.target.value)} placeholder="Model, specs, accessories…" className={input} />
        </label>
      </form>
    </Drawer>
  );
}

/**
 * People → Assets: the hardware register — which device is with whom, who owns
 * it, the vendor that supplied it and the client it is used for. Admin only.
 */
export default function AssetsPage() {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('issued');
  const [query, setQuery] = useState('');
  const [officeFilter, setOfficeFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [drawer, setDrawer] = useState({ open: false, asset: null });

  const offices = useLocationOptions(true);
  const everyone = useOrgMembershipOptions(true, { includeExited: true });

  const load = useCallback(() => {
    setLoading(true);
    apiClient.get('/assets')
      .then(({ data }) => setRows(data.data || []))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load assets'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [pushError]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    issued: rows.filter((r) => r.status === 'issued').length,
    dispatched: rows.filter((r) => r.status === 'dispatched').length,
    returned: rows.filter((r) => r.status === 'returned').length,
    all: rows.length,
  }), [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (officeFilter && r.location_id !== officeFilter) return false;
      if (userFilter && !(r.used_by_ids || []).includes(userFilter)) return false;
      if (!q) return true;
      return [r.serial_number, r.asset_type, r.org_membership?.name, r.org_membership?.employee_code, r.vendor_account?.name, r.client_account?.name, r.location?.name, r.device_details, ...(r.used_by || []).map((u) => u.name)]
        .some((v) => v && v.toLowerCase().includes(q));
    });
  }, [rows, status, query, officeFilter, userFilter]);

  const open = (asset) => setDrawer({ open: true, asset });

  const columns = [
    { key: 'serial', header: 'Serial number', render: (r) => (r.serial_number ? <span className="font-medium text-tertiary-900">{r.serial_number}</span> : muted()) },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={STATUS_TONE[r.status] || 'gray'}>{STATUS_LABEL[r.status] || r.status}</Pill> },
    { key: 'type', header: 'Type', render: (r) => r.asset_type },
    {
      key: 'employee',
      header: 'Employee',
      render: (r) => (r.org_membership ? (
        <span>{r.org_membership.name}{r.org_membership.employee_code && <span className="ml-1 text-xs text-tertiary-500">{r.org_membership.employee_code}</span>}</span>
      ) : muted()),
    },
    {
      key: 'used_by',
      header: 'Used by',
      render: (r) => ((r.used_by || []).length ? (
        <span data-testid="asset-used-by-cell" className="line-clamp-2 max-w-[14rem]" title={r.used_by.map((u) => u.name).join(', ')}>{r.used_by.map((u) => u.name).join(', ')}</span>
      ) : muted()),
    },
    { key: 'office', header: 'Office location', render: (r) => (r.location?.name ? <span data-testid="asset-office-cell">{r.location.name}</span> : muted()) },
    { key: 'owner', header: 'Belongs to', render: (r) => <Pill tone={OWNER_TONE[r.belongs_to] || 'gray'}>{OWNER_LABEL[r.belongs_to] || r.belongs_to}</Pill> },
    { key: 'vendor', header: 'Vendor', render: (r) => r.vendor_account?.name || muted() },
    { key: 'client', header: 'Client name', render: (r) => r.client_account?.name || muted() },
    { key: 'issued_on', header: 'Issue date', render: (r) => formatDate(r.issue_date) || muted() },
    { key: 'returned_on', header: 'Return date', render: (r) => formatDate(r.return_date) || muted() },
    { key: 'details', header: 'Device details', render: (r) => (r.device_details ? <span className="line-clamp-1 max-w-[16rem]" title={r.device_details}>{r.device_details}</span> : muted()) },
    { key: 'open', header: '', render: (r) => <button type="button" className="btn-ghost text-xs" onClick={(e) => { e.stopPropagation(); open(r); }}>Open</button> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={status === key}
              onClick={() => setStatus(key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                status === key ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-tertiary-200 bg-white text-tertiary-600 hover:border-tertiary-300'
              }`}
            >
              {label}
              <span className={`rounded-full px-1.5 tabular-nums ${status === key ? 'bg-primary-100' : 'bg-tertiary-100'}`}>{loading ? '…' : counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search serial, employee, client, office…" aria-label="Search assets" className="w-64 max-w-full rounded-xl border py-2 pl-9 pr-3 text-sm" />
          </label>
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => open(null)}>
            <Plus className="h-4 w-4" /> Add asset
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3" data-testid="asset-filters">
        <div className="w-56 text-xs font-medium text-tertiary-600">
          Office location
          <SearchableSelect value={officeFilter} onChange={setOfficeFilter} options={offices} allowClear className="mt-1" placeholder="All offices" searchPlaceholder="Search offices…" ariaLabel="Filter by office location" />
        </div>
        <div className="w-64 text-xs font-medium text-tertiary-600">
          Used by
          <SearchableSelect value={userFilter} onChange={setUserFilter} options={everyone} allowClear className="mt-1" placeholder="All employees" searchPlaceholder="Search employees…" ariaLabel="Filter by user" />
        </div>
        {(officeFilter || userFilter) && <button type="button" className="btn-ghost text-xs" onClick={() => { setOfficeFilter(''); setUserFilter(''); }}>Clear filters</button>}
      </div>

      <DataTable
        columns={columns}
        rows={visible}
        loading={loading}
        emptyLabel={query || officeFilter || userFilter ? 'No assets match your search or filters.' : status === 'returned' ? 'No returned assets yet.' : 'No assets yet — add the first one.'}
        onRowClick={open}
      />

      <AssetDrawer open={drawer.open} asset={drawer.asset} onClose={() => setDrawer({ open: false, asset: null })} onSaved={load} />
    </div>
  );
}
