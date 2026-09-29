import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Users } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Badge from '../../components/ui/Badge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { DrillDownDrawer, StatCard } from './TeamMonitoringTab.jsx';
import RejectReasonModal from './RejectReasonModal.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STATUS_LABEL = { submitted: 'Pending', approved: 'Approved', rejected: 'Rejected' };
const PAGE_SIZE = 50;

function monthRange({ month, year }) {
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${lastDay}` };
}

const SCOPES = {
  it: { people: 'IT members', team: 'IT team', all: 'All IT members', empty: 'No one is in the IT department yet.' },
  non_it: { people: 'Non-IT members', team: 'Non-IT team', all: 'All non-IT members', empty: 'Everyone is in the IT department.' },
};

/**
 * Admin read/manage view of a group's timesheets — who logged today, hours and
 * project split per person, every entry for the month with approve/reject, and
 * a per-person drill-down + Excel export. `scope` picks the group: 'it' (the
 * IT Timesheet tab — IT staff themselves get ItTimesheetPage instead) or
 * 'non_it' (everyone outside the IT department, incl. people with none). Same
 * endpoints as Team Monitoring, pre-scoped by department.
 */
export default function ItTimesheetAdminView({ scope = 'it' }) {
  const text = SCOPES[scope];
  const { pushError, pushSuccess } = useAlerts();
  const now = new Date();
  const [period, setPeriod] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });
  const [itDept, setItDept] = useState(undefined); // undefined = loading, null = no IT department
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [memberFilter, setMemberFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [drillMember, setDrillMember] = useState(null);
  const [rejecting, setRejecting] = useState(null);

  useEffect(() => {
    apiClient
      .get('/departments')
      .then(({ data }) => setItDept((data.data || []).find((d) => d.name?.toLowerCase() === 'it') || null))
      .catch(() => setItDept(null));
  }, []);

  // IT: only the IT department. Non-IT: everyone outside it — everyone at all
  // when there is no IT department.
  const deptParams = scope === 'it' ? { department_id: itDept?.id } : { exclude_department_id: itDept?.id || undefined };
  const ready = scope === 'it' ? Boolean(itDept) : itDept !== undefined;

  function loadOverview() {
    if (!ready) return;
    setOverviewLoading(true);
    apiClient
      .get('/timesheets/overview', { params: { ...deptParams, month: period.month, year: period.year } })
      .then(({ data }) => setOverview(data.data))
      .catch((err) => pushError(apiErrorMessage(err, `Failed to load the ${text.team} overview`), 'Something went wrong'))
      .finally(() => setOverviewLoading(false));
  }

  function loadEntries() {
    if (!ready) return;
    setEntriesLoading(true);
    apiClient
      .get('/timesheets/entries', {
        params: {
          ...monthRange(period),
          ...deptParams,
          org_membership_id: memberFilter || undefined,
          status: statusFilter || undefined,
          page,
          limit: PAGE_SIZE,
        },
      })
      .then(({ data }) => {
        setEntries(data.data || []);
        setTotal(data.pagination?.total ?? 0);
      })
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load timesheet entries'), 'Something went wrong'))
      .finally(() => setEntriesLoading(false));
  }

  useEffect(() => { loadOverview(); }, [itDept, period.month, period.year]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [period.month, period.year, memberFilter, statusFilter]);
  useEffect(() => { loadEntries(); }, [itDept, period.month, period.year, memberFilter, statusFilter, page]); // eslint-disable-line react-hooks/exhaustive-deps

  async function decideEntry(id, status, reason) {
    try {
      await apiClient.post(`/timesheets/entries/${id}/decision`, { status, reason });
      pushSuccess(`Entry ${status}`);
      loadEntries();
      loadOverview();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to record the decision'), 'Something went wrong');
      throw err;
    }
  }

  const members = overview?.members || [];
  const memberRows = useMemo(() => members.map((m) => ({ id: m.org_membership_id, ...m })), [members]);
  const monthHours = useMemo(() => members.reduce((sum, m) => sum + m.month_hours, 0), [members]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const memberColumns = [
    { key: 'name', header: 'Name', render: (row) => <span className="font-medium text-tertiary-900">{row.name}</span> },
    {
      key: 'logged_today',
      header: 'Logged today',
      render: (row) => (row.logged_today ? <Badge value="active" label="Logged" /> : <Badge value="rejected" label="Missing" />),
    },
    { key: 'month_hours', header: 'Hours this month', render: (row) => `${row.month_hours} hrs` },
    {
      key: 'allocation',
      header: 'Projects',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.allocation.length === 0 && <span className="text-tertiary-400">—</span>}
          {row.allocation.slice(0, 3).map((a) => (
            <span key={a.name} className="rounded-full bg-tertiary-100 px-2 py-0.5 text-[11px] text-tertiary-600">
              {a.name} · {a.hours}h
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <button type="button" className="btn-ghost text-xs" onClick={() => setDrillMember(row)}>
          View log
        </button>
      ),
    },
  ];

  const entryColumns = [
    { key: 'date', header: 'Date', render: (row) => row.date?.slice(0, 10) },
    { key: 'member', header: 'Employee', render: (row) => <span className="font-medium text-tertiary-900">{row.org_membership?.person?.name || '—'}</span> },
    { key: 'project', header: 'Project', render: (row) => row.account?.name || 'General' },
    { key: 'hours', header: 'Hours', render: (row) => row.hours },
    { key: 'notes', header: 'Description', render: (row) => <span className="text-tertiary-500">{row.notes || '—'}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div>
          <Badge value={row.status} label={STATUS_LABEL[row.status] || row.status} />
          {row.status === 'rejected' && row.decision_reason && <p className="mt-0.5 text-xs text-danger-600">{row.decision_reason}</p>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        row.status === 'submitted' ? (
          <span className="flex justify-end gap-2">
            <button type="button" className="btn-secondary text-xs" onClick={() => decideEntry(row.id, 'approved')}>Approve</button>
            <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => setRejecting(row)}>Reject</button>
          </span>
        ) : null,
    },
  ];

  if (scope === 'it' && itDept === null) {
    return (
      <EmptyState
        icon={Users}
        title="No IT department set up"
        description="Create a department named “IT” and add people to it — their timesheets will show up here."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <select value={period.month} onChange={(e) => setPeriod((p) => ({ ...p, month: Number(e.target.value) }))} className="rounded-xl border px-3 py-1.5 text-sm">
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select value={period.year} onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))} className="rounded-xl border px-3 py-1.5 text-sm">
          {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {overview && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label={text.people} value={overview.summary.total_members} />
          <StatCard label="Logged today" value={overview.summary.logged_today} />
          <StatCard label="Missing today" value={overview.summary.missing_today} />
          <StatCard label="Hours this month" value={Math.round(monthHours * 100) / 100} />
          <StatCard label="Pending approvals" value={overview.summary.pending_approvals} hint="All months" />
        </div>
      )}

      <section>
        <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">{text.team}</h3>
        <DataTable columns={memberColumns} rows={memberRows} loading={overviewLoading} emptyLabel={text.empty} />
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-heading text-sm font-semibold text-tertiary-900">Timesheet records</h3>
          <div className="flex flex-wrap items-center gap-2">
            <select value={memberFilter} onChange={(e) => setMemberFilter(e.target.value)} className="rounded-xl border px-2 py-1 text-xs">
              <option value="">{text.all}</option>
              {members.map((m) => <option key={m.org_membership_id} value={m.org_membership_id}>{m.name}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border px-2 py-1 text-xs">
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </div>
        {!entriesLoading && entries.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No entries for this period" description="Nothing matches these filters yet." />
        ) : (
          <DataTable columns={entryColumns} rows={entries} loading={entriesLoading} emptyLabel="No entries." />
        )}
        {totalPages > 1 && (
          <div className="mt-2 flex items-center justify-end gap-2 text-xs text-tertiary-600">
            <button type="button" className="btn-ghost text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span>Page {page} of {totalPages}</span>
            <button type="button" className="btn-ghost text-xs" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}
      </section>

      <RejectReasonModal
        open={Boolean(rejecting)}
        title="Reject timesheet entry"
        subject={rejecting?.org_membership?.person?.name || ''}
        onClose={() => setRejecting(null)}
        onConfirm={(reason) => decideEntry(rejecting.id, 'rejected', reason)}
      />
      <DrillDownDrawer member={drillMember} period={period} onClose={() => setDrillMember(null)} />
    </div>
  );
}
