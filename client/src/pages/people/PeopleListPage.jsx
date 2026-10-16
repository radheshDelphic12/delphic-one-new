import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, UserRound, X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import { EMPLOYMENT_STATUS_OPTIONS, WORK_MODE_OPTIONS, employmentStatusLabel } from '../../lib/employeeOptions.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import { PeekActions, PeekField } from '../../components/ui/PeekFields.jsx';

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : 'Not set';
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
          <p className="truncate text-xs text-tertiary-500">{row.person.email}</p>
        </div>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <PeekField label="Role"><span className="capitalize">{row.role}</span></PeekField>
        <PeekField label="Status"><Badge value={row.employment_status} label={employmentStatusLabel(row.employment_status)} /></PeekField>
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
const EMPTY_FILTERS = { department: '', designation: '', role: '', location: '', status: '', workMode: '', manager: '', joinedFrom: '', joinedTo: '' };

const FILTER_FIELDS = [
  { key: 'department', label: 'Department', get: (r) => r.department?.name },
  { key: 'designation', label: 'Designation', get: (r) => r.designation?.name },
  { key: 'role', label: 'Role', get: (r) => r.role },
  { key: 'location', label: 'Location', get: (r) => r.location?.name },
  // Status and work mode list every value the system knows (from one shared source), not just the ones in the loaded rows.
  { key: 'status', label: 'Status', get: (r) => r.employment_status, fixed: EMPLOYMENT_STATUS_OPTIONS },
  { key: 'workMode', label: 'Work mode', get: (r) => r.work_mode, fixed: WORK_MODE_OPTIONS },
  { key: 'manager', label: 'Manager', get: (r) => r.manager?.person?.name },
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
  const activeCount = Object.values(filters).filter(Boolean).length;
  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

  const columns = [
    {
      key: 'employee',
      header: 'Employee',
      render: (row) => (
        <div className="min-w-48">
          <div className="font-medium text-tertiary-900">{row.person.name}</div>
          <div className="text-xs text-tertiary-500">{row.person.email}</div>
        </div>
      ),
    },
    { key: 'code', header: 'Employee code', render: (row) => row.employee_code || <span className="text-tertiary-400">—</span> },
    { key: 'role', header: 'Role', render: (row) => <span className="capitalize">{row.role}</span> },
    { key: 'department', header: 'Department', render: (row) => row.department?.name || 'Not assigned' },
    { key: 'location', header: 'Location', render: (row) => row.location?.name || 'Not assigned' },
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
