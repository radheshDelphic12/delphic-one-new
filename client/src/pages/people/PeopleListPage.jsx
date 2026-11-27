import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, UserRound, X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import { EMPLOYMENT_STATUS_OPTIONS, WORKER_TYPE_OPTIONS, WORK_MODE_OPTIONS, employmentStatusLabel, workerTypeLabel } from '../../lib/employeeOptions.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import { PeekActions, PeekField } from '../../components/ui/PeekFields.jsx';
import EmailLink from '../../components/ui/EmailLink.jsx';

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : 'Not set';
}

const money = (value, currency) => `${currency || 'INR'} ${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/** What the contractors (vendor resources) in this list cost per month: their vendor rate, added up per currency and in rupees where a rate is set. */
function vendorCostSummary(rows, rates) {
  const contractors = rows.filter((r) => r.worker_type === 'contractor');
  const byCurrency = {};
  let withoutRate = 0;
  for (const r of contractors) {
    if (r.vendor_rate === null || r.vendor_rate === undefined) { withoutRate += 1; continue; }
    const cur = r.vendor_rate_currency || 'INR';
    byCurrency[cur] = (byCurrency[cur] || 0) + Number(r.vendor_rate);
  }
  let inr = 0;
  let unconverted = [];
  for (const [cur, amount] of Object.entries(byCurrency)) {
    const rate = cur === 'INR' ? 1 : Number(rates[cur]);
    if (rate) inr += amount * rate; else unconverted.push(cur);
  }
  return { count: contractors.length, withoutRate, byCurrency, inr, unconverted };
}

function EmployeePeek({ row, onClose }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 border-b border-tertiary-100 pb-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-700">
          <UserRound className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate font-heading text-base font-semibold text-tertiary-900">{row.person.name}</h2>
          <p className="truncate text-xs text-tertiary-500"><EmailLink email={row.person.email} /></p>
        </div>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <PeekField label="Role"><span className="capitalize">{row.role}</span></PeekField>
        <PeekField label="Status"><Badge value={row.employment_status} label={employmentStatusLabel(row.employment_status)} /></PeekField>
        <PeekField label="User type">{workerTypeLabel(row.worker_type)}</PeekField>
        <PeekField label="Department">{row.department?.name || 'Not assigned'}</PeekField>
        <PeekField label="Designation">{row.designation?.name || 'Not assigned'}</PeekField>
        <PeekField label="Location">{row.location?.name || 'Not assigned'}</PeekField>
        <PeekField label="Shift">{row.shift?.name || 'Not assigned'}</PeekField>
        <PeekField label="Manager">{row.manager?.person?.name || 'Not assigned'}</PeekField>
        <PeekField label="Joined">{formatDate(row.joined_at)}</PeekField>
      </dl>
      <PeekActions>
        <Link to={`/people/${row.id}`} className="btn-primary" onClick={onClose}>Open profile</Link>
        <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
      </PeekActions>
    </div>
  );
}

// Department A→Z, then name A→Z within it; people with no department last.
/** The permission set a person holds now; the plain role they had before the move stays only as a read-only note while the restore window is open. */
function RoleCell({ row }) {
  const set = row.custom_role?.name;
  if (!set) return <span className="capitalize">{row.role}</span>;
  const until = row.legacy_locked_until && new Date(row.legacy_locked_until) > new Date() ? formatDate(row.legacy_locked_until) : null;
  return (
    <div>
      <span>{set}</span>
      {row.legacy_role && until && <div className="text-[11px] text-tertiary-400">Earlier role: <span className="capitalize">{row.legacy_role}</span> (kept read-only until {until})</div>}
    </div>
  );
}

function sortByDepartment(rows) {
  return [...rows].sort((a, b) => {
    const da = a.department?.name;
    const db = b.department?.name;
    if (da && !db) return -1;
    if (!da && db) return 1;
    return (da || '').localeCompare(db || '') || (a.person?.name || '').localeCompare(b.person?.name || '');
  });
}

const NONE = '__none__';
const EMPTY_FILTERS = { department: '', designation: '', role: '', location: '', status: '', userType: '', workMode: '', manager: '', clientSite: '', joinedFrom: '', joinedTo: '' };
// Deployed at a client site today (Group Travel > Deployments: an approved / active deployment, at the client's office or hybrid)
const CLIENT_SITE_OPTIONS = [{ value: 'yes', label: 'At a client site' }, { value: 'no', label: 'Not at a client site' }];

const FILTER_FIELDS = [
  { key: 'department', label: 'Department', get: (r) => r.department?.name },
  { key: 'designation', label: 'Designation', get: (r) => r.designation?.name },
  { key: 'role', label: 'Role', get: (r) => r.role },
  { key: 'location', label: 'Location', get: (r) => r.location?.name },
  // Status and work mode list every value the system knows (from one shared source), not just the ones in the loaded rows.
  { key: 'status', label: 'Status', get: (r) => r.employment_status, fixed: EMPLOYMENT_STATUS_OPTIONS },
  // User type: Full-Time Employee or Contractor. A row with no stored value counts as a full-time employee (the column default).
  { key: 'userType', label: 'User type', get: (r) => r.worker_type || 'full_time_employee', fixed: WORKER_TYPE_OPTIONS },
  { key: 'workMode', label: 'Work mode', get: (r) => r.work_mode, fixed: WORK_MODE_OPTIONS },
  { key: 'manager', label: 'Manager', get: (r) => r.manager?.person?.name },
  { key: 'clientSite', label: 'Client site', get: (r) => (r.client_site ? 'yes' : 'no'), fixed: CLIENT_SITE_OPTIONS },
];

const humanize = (v) => String(v).replace(/_/g, ' ');

function matchesFilters(row, filters) {
  for (const f of FILTER_FIELDS) {
    const wanted = filters[f.key];
    if (!wanted) continue;
    const value = f.get(row);
    if (wanted === NONE ? Boolean(value) : value !== wanted) return false;
  }
  if (filters.joinedFrom || filters.joinedTo) {
    if (!row.joined_at) return false;
    const day = new Date(row.joined_at).toISOString().slice(0, 10);
    if (filters.joinedFrom && day < filters.joinedFrom) return false;
    if (filters.joinedTo && day > filters.joinedTo) return false;
  }
  return true;
}

export default function PeopleListPage() {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [includeTerminated, setIncludeTerminated] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  // Exited people are terminated memberships, which the list leaves out unless asked: choosing Status = Exited asks for them by itself.
  const exitedChosen = filters.status === 'terminated';
  const withTerminated = includeTerminated || exitedChosen;
  const [loading, setLoading] = useState(true);
  const [peek, setPeek] = useState(null);
  const [rates, setRates] = useState({});

  // Finance exchange rates (to INR), only used to turn a USD/AED... vendor rate into rupees for the total.
  useEffect(() => {
    apiClient.get('/billing/exchange-rates')
      .then(({ data }) => setRates(Object.fromEntries((data.data || []).map((x) => [x.currency, x.rate_to_inr ?? x.rate]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiClient
      .get('/orgs/memberships', {
        params: { search: search.trim() || undefined, include_terminated: withTerminated },
      })
      .then(({ data }) => {
        if (!cancelled) setRows(sortByDepartment(data.data || []));
      })
      .catch((err) => {
        if (!cancelled) pushError(apiErrorMessage(err, 'Failed to load employee directory'), 'Something went wrong');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [withTerminated, pushError, search]);

  // Dropdown options come from the live rows (only values that really exist), except status and work mode,
  // which always list everything the system knows.
  const options = useMemo(() => {
    const out = {};
    for (const f of FILTER_FIELDS) {
      const values = new Set();
      let hasNone = false;
      for (const row of rows) {
        const v = f.get(row);
        if (v) values.add(v);
        else hasNone = true;
      }
      const items = f.fixed
        ? f.fixed
        : [...values].sort((a, b) => String(a).localeCompare(String(b))).map((v) => ({ value: v, label: f.key === 'role' ? humanize(v) : v }));
      out[f.key] = { items, hasNone: f.fixed ? f.key === 'workMode' && hasNone : hasNone };
    }
    return out;
  }, [rows]);

  const filteredRows = useMemo(() => rows.filter((row) => matchesFilters(row, filters)), [rows, filters]);
  const vendorCost = useMemo(() => vendorCostSummary(filteredRows, rates), [filteredRows, rates]);
  const activeCount = Object.values(filters).filter(Boolean).length;
  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

  const columns = [
    {
      key: 'employee',
      header: 'Employee',
      render: (row) => (
        <div className="min-w-48">
          <div className="font-medium text-tertiary-900">{row.person.name}</div>
          <div className="text-xs text-tertiary-500"><EmailLink email={row.person.email} /></div>
        </div>
      ),
    },
    { key: 'code', header: 'Employee code', render: (row) => row.employee_code || <span className="text-tertiary-400">—</span> },
    { key: 'role', header: 'Role', render: (row) => <RoleCell row={row} /> },
    { key: 'department', header: 'Department', render: (row) => row.department?.name || 'Not assigned' },
    { key: 'userType', header: 'User type', render: (row) => workerTypeLabel(row.worker_type) },
    {
      key: 'vendorCost',
      header: 'Vendor cost / month',
      render: (row) => (row.worker_type === 'contractor'
        ? (row.vendor_rate === null || row.vendor_rate === undefined ? <span className="text-warning-700">Not set</span> : money(row.vendor_rate, row.vendor_rate_currency))
        : <span className="text-tertiary-400">�</span>),
    },
    { key: 'location', header: 'Location', render: (row) => row.location?.name || 'Not assigned' },
    { key: 'client_site', header: 'Client site', render: (row) => (row.client_site ? <span className="text-xs" data-testid="client-site-cell" title={`${row.client_site.code} ${row.client_site.title}${row.client_site.until ? ` until ${row.client_site.until}` : ''}`}><span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800">At {row.client_site.client_name}</span>{row.client_site.location ? <span className="block text-tertiary-500">{row.client_site.location}</span> : null}</span> : <span className="text-tertiary-400">-</span>) },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span>
          <Badge value={row.employment_status} label={employmentStatusLabel(row.employment_status)} />
          {row.employment_status === 'notice_period' && row.notice_end_date && (
            <span className="mt-0.5 block text-xs text-warning-700">LWD {formatDate(row.notice_end_date)}</span>
          )}
        </span>
      ),
    },
    { key: 'joined', header: 'Joined', render: (row) => formatDate(row.joined_at) },
  ];

  return (
    <div className="space-y-4">
      <div className="ta-head flex flex-col gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">People</p>
          <h2 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Employee directory</h2>
          <p className="mt-1 text-sm text-tertiary-500">Browse people and their current organization assignments.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-tertiary-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search employees"
              className="w-full rounded-xl border border-tertiary-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary-400 sm:w-60"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-tertiary-700">
            <input type="checkbox" checked={withTerminated} disabled={exitedChosen} onChange={(event) => setIncludeTerminated(event.target.checked)} />
            <span title={exitedChosen ? 'Always on while Status is Exited' : undefined}>Include terminated</span>
          </label>
        </div>
      </div>
      <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FILTER_FIELDS.map((f) => (
            <label key={f.key} className="block text-xs font-medium text-tertiary-600">
              {f.label}
              <select
                value={filters[f.key]}
                onChange={(event) => setFilter(f.key, event.target.value)}
                className="mt-1 w-full rounded-xl border border-tertiary-200 bg-white px-3 py-2 text-sm text-tertiary-900 outline-none focus:border-primary-400"
              >
                <option value="">All</option>
                {options[f.key].items.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
                {options[f.key].hasNone && <option value={NONE}>{f.key === 'workMode' ? 'Not set' : 'Not assigned'}</option>}
              </select>
            </label>
          ))}
          <label className="block text-xs font-medium text-tertiary-600">
            Joined from
            <input
              type="date"
              value={filters.joinedFrom}
              max={filters.joinedTo || undefined}
              onChange={(event) => setFilter('joinedFrom', event.target.value)}
              className="mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm outline-none focus:border-primary-400"
            />
          </label>
          <label className="block text-xs font-medium text-tertiary-600">
            Joined to
            <input
              type="date"
              value={filters.joinedTo}
              min={filters.joinedFrom || undefined}
              onChange={(event) => setFilter('joinedTo', event.target.value)}
              className="mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm outline-none focus:border-primary-400"
            />
          </label>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-tertiary-500">
          <span>Showing {filteredRows.length} of {rows.length} employees</span>
          {activeCount > 0 && (
            <button type="button" className="inline-flex items-center gap-1 font-medium text-primary-700 hover:underline" onClick={() => setFilters(EMPTY_FILTERS)}>
              <X className="h-3 w-3" /> Clear filters ({activeCount})
            </button>
          )}
        </div>
      </div>
      {vendorCost.count > 0 && (
        <div className="rounded-2xl border border-tertiary-200 bg-white px-4 py-3 text-sm" data-testid="vendor-cost-summary">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div>
              <span className="text-xs uppercase tracking-wide text-tertiary-500">Vendor (contractor) cost per month</span>
              <div className="text-lg font-semibold text-tertiary-900">
                {money(vendorCost.inr, 'INR')}
                {vendorCost.unconverted.length > 0 && <span className="ml-2 text-xs font-normal text-warning-700">+ {vendorCost.unconverted.join(', ')} not converted (set Finance exchange rates)</span>}
              </div>
            </div>
            <div className="text-xs text-tertiary-600">
              {vendorCost.count} contractor{vendorCost.count === 1 ? '' : 's'} in this list
              {vendorCost.withoutRate > 0 && <span className="text-warning-700"> � {vendorCost.withoutRate} with no vendor rate set</span>}
              {Object.keys(vendorCost.byCurrency).some((c) => c !== 'INR') && (
                <span> � {Object.entries(vendorCost.byCurrency).map(([c, a]) => money(a, c)).join(' + ')}</span>
              )}
            </div>
          </div>
        </div>
      )}
      <DataTable
        columns={columns}
        rows={filteredRows}
        loading={loading}
        maxHeight="calc(100dvh - 24rem)"
        emptyLabel="No employees match the current filters."
        onRowClick={setPeek}
      />
      <Drawer open={Boolean(peek)} title={peek?.person?.name || 'Employee'} onClose={() => setPeek(null)} size="md" tone="info">
        {peek && <EmployeePeek row={peek} onClose={() => setPeek(null)} />}
      </Drawer>
    </div>
  );
}
