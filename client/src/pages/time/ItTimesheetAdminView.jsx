import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, FileUp, Plus, Users } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Badge from '../../components/ui/Badge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { DrillDownDrawer, StatCard } from './TeamMonitoringTab.jsx';
import RejectReasonModal from './RejectReasonModal.jsx';
import NoteText from '../../components/NoteText.jsx';
import AdminEntryDrawer, { adminDeleteEntry } from './AdminEntryDrawer.jsx';
import { AddTimesheetEntryDrawer, BulkTimesheetDrawer } from './TimesheetBackfill.jsx';
import { useProjectOptions } from '../../lib/lookups.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STATUS_LABEL = { submitted: 'Pending', approved: 'Approved', rejected: 'Rejected' };
const PAGE_SIZE = 50;

function monthRange({ month, year }) {
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${lastDay}` };
}

const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shortDay = (d) => d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });

// Monday-to-Sunday weeks touching the month, clipped to it: { key, label, from, to }.
function monthWeeks({ month, year }) {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const weeks = [];
  let start = new Date(first);
  while (start <= last) {
    const end = new Date(start);
    end.setDate(end.getDate() + (7 - ((start.getDay() + 6) % 7)) - 1); // through Sunday
    const clippedEnd = end > last ? last : end;
    weeks.push({ key: ymdLocal(start), label: `${shortDay(start)} – ${shortDay(clippedEnd)}`, from: ymdLocal(start), to: ymdLocal(clippedEnd) });
    start = new Date(clippedEnd);
    start.setDate(start.getDate() + 1);
  }
  return weeks;
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
  const [projectFilter, setProjectFilter] = useState('');
  const [correcting, setCorrecting] = useState(null);
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [weekFilter, setWeekFilter] = useState('');
  const projectOptions = useProjectOptions(true);
  const weeks = useMemo(() => monthWeeks(period), [period]);
  const range = weeks.find((w) => w.key === weekFilter) || monthRange(period);
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
          from: range.from,
          to: range.to,
          account_id: projectFilter || undefined,
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
  useEffect(() => { setWeekFilter(''); }, [period.month, period.year]);
  useEffect(() => { setPage(1); }, [period.month, period.year, memberFilter, statusFilter, projectFilter, weekFilter]);
  useEffect(() => { loadEntries(); }, [itDept, period.month, period.year, memberFilter, statusFilter, projectFilter, weekFilter, page]); // eslint-disable-line react-hooks/exhaustive-deps

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
    { key: 'notes', header: 'Description', render: (row) => <NoteText text={row.notes} className="text-tertiary-500" /> },
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
      render: (row) => (
        <span className="flex flex-wrap justify-end gap-2">
          {row.status === 'submitted' && (
            <>
              <button type="button" className="btn-secondary text-xs" onClick={() => decideEntry(row.id, 'approved')}>Approve</button>
              <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => setRejecting(row)}>Reject</button>
            </>
          )}
          {/* Admin correction at any stage — approved entries and locked days included. */}
          <button type="button" className="btn-ghost text-xs" onClick={() => setCorrecting(row)}>Edit</button>
          <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => adminDeleteEntry(row, { pushError, pushSuccess, onDone: () => { loadEntries(); loadOverview(); } })}>Delete</button>
        </span>
      ),
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
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add entry</button>
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" onClick={() => setUploading(true)}><FileUp className="h-3.5 w-3.5" /> Bulk upload CSV</button>
        </div>
      </div>

      {overview && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label={text.people} value={overview.summary.total_members} />
          <StatCard label="Logged today" value={overview.summary.logged_today} />
          <StatCard label="Missing today" value={overview.summary.missing_today} />
          <StatCard label="Hours this month" value={Math.round(monthHours * 100) / 100} />
          <StatCard label="Overtime this month" value={overview.summary.overtime_hours} hint="Hours beyond each day's shift" />
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
            <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} aria-label="Project" className="max-w-[12rem] rounded-xl border px-2 py-1 text-xs">
              <option value="">All projects</option>
              {projectOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <select value={weekFilter} onChange={(e) => setWeekFilter(e.target.value)} aria-label="Week" className="rounded-xl border px-2 py-1 text-xs">
              <option value="">Whole month</option>
              {weeks.map((w) => <option key={w.key} value={w.key}>Week {w.label}</option>)}
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
      <AdminEntryDrawer entry={correcting} onClose={() => setCorrecting(null)} onSaved={() => { loadEntries(); loadOverview(); }} />
      <AddTimesheetEntryDrawer open={adding} onClose={() => setAdding(false)} onSaved={() => { loadEntries(); loadOverview(); }} />
      <BulkTimesheetDrawer open={uploading} onClose={() => setUploading(false)} onApplied={() => { loadEntries(); loadOverview(); }} />
    </div>
  );
}
