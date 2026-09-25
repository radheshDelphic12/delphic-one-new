import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, UserRound } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
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
        <PeekField label="Status"><Badge value={row.employment_status} /></PeekField>
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

export default function PeopleListPage() {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [includeTerminated, setIncludeTerminated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [peek, setPeek] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiClient
      .get('/orgs/memberships', {
        params: { search: search.trim() || undefined, include_terminated: includeTerminated },
      })
      .then(({ data }) => {
        if (!cancelled) setRows(data.data || []);
      })
      .catch((err) => {
        if (!cancelled) pushError(apiErrorMessage(err, 'Failed to load employee directory'), 'Something went wrong');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [includeTerminated, pushError, search]);

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
    { key: 'role', header: 'Role', render: (row) => <span className="capitalize">{row.role}</span> },
    { key: 'department', header: 'Department', render: (row) => row.department?.name || 'Not assigned' },
    { key: 'location', header: 'Location', render: (row) => row.location?.name || 'Not assigned' },
    { key: 'status', header: 'Status', render: (row) => <Badge value={row.employment_status} /> },
    { key: 'joined', header: 'Joined', render: (row) => formatDate(row.joined_at) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card md:flex-row md:items-end md:justify-between">
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
            <input type="checkbox" checked={includeTerminated} onChange={(event) => setIncludeTerminated(event.target.checked)} />
            Include terminated
          </label>
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        maxHeight="calc(100dvh - 16rem)"
        emptyLabel="No employees match the current filters."
        onRowClick={setPeek}
      />
      <Drawer open={Boolean(peek)} title={peek?.person?.name || 'Employee'} onClose={() => setPeek(null)} size="md" tone="info">
        {peek && <EmployeePeek row={peek} onClose={() => setPeek(null)} />}
      </Drawer>
    </div>
  );
}
