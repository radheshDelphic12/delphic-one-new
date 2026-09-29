import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useLeadClientOptions, useOrgMembershipOptions, useVendorAccountOptions } from '../../lib/lookups.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';

// Suggestions only — the type is free text, so a new kind of device needs no code change.
const ASSET_TYPES = ['Windows Laptop', 'Mac Book', 'Cube', 'Monitor', 'Mobile', 'Accessory'];

const STATUS_FILTERS = [
  { key: 'issued', label: 'Issued' },
  { key: 'returned', label: 'Returned' },
  { key: 'all', label: 'All' },
];

const OWNER_LABEL = { delphic: 'Delphic', client: 'Client' };

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
  const vendors = useVendorAccountOptions(open);
  const clients = useLeadClientOptions(open);

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
      vendor_account_id: values.vendor_account_id || null,
      client_account_id: values.client_account_id || null,
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
          {asset?.status === 'issued' && (
            <button type="button" className="btn-secondary" onClick={() => save({ status: 'returned', return_date: form.return_date || todayYmd() })} disabled={saving}>
              Mark returned
            </button>
          )}
          <button type="submit" form="asset-form" className="btn-primary" disabled={saving || !form.asset_type.trim()}>
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
            <option value="returned">Returned</option>
          </select>
        </label>
        <label className={label}>
          Belongs to
          <select value={form.belongs_to} onChange={(e) => set('belongs_to', e.target.value)} className={input}>
            <option value="delphic">Delphic</option>
            <option value="client">Client</option>
          </select>
        </label>
        <div className={label}>
          Asset belongs to vendor
          <SearchableSelect value={form.vendor_account_id} onChange={(v) => set('vendor_account_id', v)} options={vendorOptions} allowClear className="mt-1" placeholder="None" searchPlaceholder="Search vendors…" noResultsMessage="No vendor accounts found" ariaLabel="Vendor" />
        </div>
        <div className={label}>
          Client name
          <SearchableSelect value={form.client_account_id} onChange={(v) => set('client_account_id', v)} options={clientOptions} allowClear className="mt-1" placeholder="None" searchPlaceholder="Search clients…" noResultsMessage="No client accounts found" ariaLabel="Client" />
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
  const [drawer, setDrawer] = useState({ open: false, asset: null });

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
    returned: rows.filter((r) => r.status === 'returned').length,
    all: rows.length,
  }), [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (!q) return true;
      return [r.serial_number, r.asset_type, r.org_membership?.name, r.org_membership?.employee_code, r.vendor_account?.name, r.client_account?.name, r.device_details]
        .some((v) => v && v.toLowerCase().includes(q));
    });
  }, [rows, status, query]);

  const open = (asset) => setDrawer({ open: true, asset });

  const columns = [
    { key: 'serial', header: 'Serial number', render: (r) => (r.serial_number ? <span className="font-medium text-tertiary-900">{r.serial_number}</span> : muted()) },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={r.status === 'issued' ? 'blue' : 'gray'}>{r.status === 'issued' ? 'Issued' : 'Returned'}</Pill> },
    { key: 'type', header: 'Type', render: (r) => r.asset_type },
    {
      key: 'employee',
      header: 'Employee',
      render: (r) => (r.org_membership ? (
        <span>{r.org_membership.name}{r.org_membership.employee_code && <span className="ml-1 text-xs text-tertiary-500">{r.org_membership.employee_code}</span>}</span>
      ) : muted()),
    },
    { key: 'owner', header: 'Belongs to', render: (r) => <Pill tone={r.belongs_to === 'delphic' ? 'amber' : 'purple'}>{OWNER_LABEL[r.belongs_to]}</Pill> },
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
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search serial, employee, client…" aria-label="Search assets" className="w-64 max-w-full rounded-xl border py-2 pl-9 pr-3 text-sm" />
          </label>
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => open(null)}>
            <Plus className="h-4 w-4" /> Add asset
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={visible}
        loading={loading}
        emptyLabel={query ? 'No assets match your search.' : status === 'returned' ? 'No returned assets yet.' : 'No assets yet — add the first one.'}
        onRowClick={open}
      />

      <AssetDrawer open={drawer.open} asset={drawer.asset} onClose={() => setDrawer({ open: false, asset: null })} onSaved={load} />
    </div>
  );
}
