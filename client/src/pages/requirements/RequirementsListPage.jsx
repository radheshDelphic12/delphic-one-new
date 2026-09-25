import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Filter, Plus, X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { canCreateRequirement, canMutateRequirement } from '../../lib/requirementStages.js';
import { useClientAccountOptions, useUserOptions } from '../../lib/lookups.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import { PeekActions, PeekField } from '../../components/ui/PeekFields.jsx';
import { canAssignRecruiters } from '../profiles/profileUtils.js';
import AssignRecruiterDrawer from './AssignRecruiterDrawer.jsx';
import RequirementFormPage from './RequirementFormPage.jsx';

function reqKey(id) {
  return `REQ-${String(id).slice(0, 8).toUpperCase()}`;
}

const REQ_TYPE_OPTIONS = [
  { value: 'managed_services', label: 'Managed services' },
  { value: 'recruitment', label: 'Recruitment' },
  { value: 'project', label: 'Project' },
];

const SORT_OPTIONS = [
  { value: 'created_at', label: 'Newest' },
  { value: 'priority', label: 'Priority' },
  { value: 'budget_max', label: 'Budget' },
  { value: 'status', label: 'Status' },
];

function RequirementPeek({ row, onClose, onAssign }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(row);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get(`/requirements/${row.id}`)
      .then(({ data }) => setDetail(data.data || row))
      .catch(() => setDetail(row))
      .finally(() => setLoading(false));
  }, [row]);

  return (
    <div className="space-y-4">
      {loading && <p className="text-xs text-tertiary-400">Loading details…</p>}
      <dl className="grid gap-4 sm:grid-cols-2">
        <PeekField label="Key">
          <Link to={`/requirements/${detail.id}`} className="text-primary-700 hover:underline">
            {reqKey(detail.id)}
          </Link>
        </PeekField>
        <PeekField label="Title">{detail.title}</PeekField>
        <PeekField label="Client">{detail.account?.name || '—'}</PeekField>
        <PeekField label="Status">
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <Badge value={detail.status} />
            {detail.is_stuck && (
              <span className="rounded-full bg-danger-50 px-2 py-0.5 text-[10px] font-medium text-danger-700">
                Stuck
              </span>
            )}
          </span>
        </PeekField>
        <PeekField label="Priority"><Badge value={detail.priority} /></PeekField>
        <PeekField label="Type">{detail.req_type ? <Badge value={detail.req_type} /> : '—'}</PeekField>
        <PeekField label="Work mode"><span className="capitalize">{detail.work_mode || '—'}</span></PeekField>
        <PeekField label="Seats">{`${detail.seats_closed ?? 0}/${detail.seats_total ?? 0}`}</PeekField>
        <PeekField label="Client submissions">{detail.client_submissions_count ?? 0}</PeekField>
        <PeekField label="Sales owner">{detail.sales_owner?.name || '—'}</PeekField>
        <div className="sm:col-span-2">
          <PeekField label="Tech stack">
            <div className="mt-1 flex flex-wrap gap-1">
              {(detail.primary_tech_stack || []).length
                ? (detail.primary_tech_stack || []).map((t) => (
                    <span key={t} className="rounded-full bg-primary-50 px-1.5 py-0.5 text-xs text-primary-700">
                      {t}
                    </span>
                  ))
                : '—'}
            </div>
          </PeekField>
        </div>
      </dl>
      <PeekActions>
        <Link to={`/requirements/${detail.id}`} className="btn-primary">
          Job details
        </Link>
        <Link to={`/requirements/${detail.id}/board`} className="btn-secondary">
          Open board
        </Link>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            onAssign(detail);
            onClose();
          }}
        >
          {canAssignRecruiters(user, detail) ? 'Assign recruiters' : 'View assignments'}
        </button>
        {canMutateRequirement(detail, user) && (
          <button type="button" className="btn-secondary" onClick={() => navigate(`/requirements/${detail.id}?edit=1`)}>
            Edit
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </PeekActions>
    </div>
  );
}

export default function RequirementsListPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [status, setStatus] = useState(() => searchParams.get('status') || '');
  const [priority, setPriority] = useState(() => searchParams.get('priority') || '');
  const [stuck, setStuck] = useState(() => searchParams.get('stuck') || '');
  // URL-only passthrough (dashboard "Closed this month" tile); no dropdown.
  const [closedFrom, setClosedFrom] = useState(() => searchParams.get('closed_from') || '');
  const [closedTo, setClosedTo] = useState(() => searchParams.get('closed_to') || '');
  const [reqType, setReqType] = useState(() => searchParams.get('req_type') || '');
  const [accountId, setAccountId] = useState(() => searchParams.get('account_id') || '');
  const [salesOwnerId, setSalesOwnerId] = useState(() => searchParams.get('sales_owner_id') || '');
  const [recruiterId, setRecruiterId] = useState(() => searchParams.get('recruiter_id') || '');
  const [workMode, setWorkMode] = useState(() => searchParams.get('work_mode') || '');
  const [techStack, setTechStack] = useState(() => searchParams.get('tech_stack') || '');
  const [appliedTechStack, setAppliedTechStack] = useState(() => searchParams.get('tech_stack') || '');
  const [sortBy, setSortBy] = useState(() => searchParams.get('sort_by') || 'created_at');
  const [sortOrder, setSortOrder] = useState(() => searchParams.get('sort_order') || 'desc');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [assignTarget, setAssignTarget] = useState(null);
  const [peek, setPeek] = useState(null);
  const [createOpen, setCreateOpen] = useState(searchParams.get('create') === '1');

  const clientOptions = useClientAccountOptions();
  const salesOptions = useUserOptions('sales');
  const adminOptions = useUserOptions('admin');
  const recruiterOptions = useUserOptions('recruiter');
  const salesOwnerOptions = useMemo(
    () => [...salesOptions, ...adminOptions],
    [salesOptions, adminOptions]
  );

  // Mirror the active filters into the URL so a filtered list is shareable.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const sync = (key, value, dflt = '') => {
      if (value && value !== dflt) next.set(key, value);
      else next.delete(key);
    };
    sync('status', status);
    sync('priority', priority);
    sync('stuck', stuck);
    sync('closed_from', closedFrom);
    sync('closed_to', closedTo);
    sync('req_type', reqType);
    sync('account_id', accountId);
    sync('sales_owner_id', salesOwnerId);
    sync('recruiter_id', recruiterId);
    sync('work_mode', workMode);
    sync('tech_stack', appliedTechStack);
    sync('sort_by', sortBy, 'created_at');
    sync('sort_order', sortOrder, 'desc');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, priority, stuck, closedFrom, closedTo, reqType, accountId, salesOwnerId, recruiterId, workMode, appliedTechStack, sortBy, sortOrder]);

  // Re-hydrate filter state FROM the URL (browser Back, shared link, new tab).
  // Guarded so it converges with the mirror effect above instead of looping.
  useEffect(() => {
    const g = (k, d = '') => searchParams.get(k) || d;
    const set = (setter, value) => setter((prev) => (prev === value ? prev : value));
    set(setStatus, g('status'));
    set(setPriority, g('priority'));
    set(setStuck, g('stuck'));
    set(setClosedFrom, g('closed_from'));
    set(setClosedTo, g('closed_to'));
    set(setReqType, g('req_type'));
    set(setAccountId, g('account_id'));
    set(setSalesOwnerId, g('sales_owner_id'));
    set(setRecruiterId, g('recruiter_id'));
    set(setWorkMode, g('work_mode'));
    set(setAppliedTechStack, g('tech_stack'));
    set(setTechStack, g('tech_stack'));
    set(setSortBy, g('sort_by', 'created_at'));
    set(setSortOrder, g('sort_order', 'desc'));
  }, [searchParams]);

  const hasActiveFilters = Boolean(
    status || priority || stuck || closedFrom || closedTo || reqType || accountId || salesOwnerId ||
      recruiterId || workMode || appliedTechStack || appliedSearch || sortBy !== 'created_at' || sortOrder !== 'desc'
  );

  function clearAllFilters() {
    setPage(1);
    setStatus('');
    setPriority('');
    setStuck('');
    setClosedFrom('');
    setClosedTo('');
    setReqType('');
    setAccountId('');
    setSalesOwnerId('');
    setRecruiterId('');
    setWorkMode('');
    setTechStack('');
    setAppliedTechStack('');
    setSortBy('created_at');
    setSortOrder('desc');
    setSearch('');
    setAppliedSearch('');
    const kept = new URLSearchParams();
    if (searchParams.get('create')) kept.set('create', searchParams.get('create'));
    setSearchParams(kept, { replace: true });
  }

  function reload() {
    setLoading(true);
    const params = { page, limit: 20, sort_by: sortBy, sort_order: sortOrder };
    if (status) params.status = status;
    if (priority) params.priority = priority;
    if (stuck) params.stuck = stuck;
    if (closedFrom) params.closed_from = closedFrom;
    if (closedTo) params.closed_to = closedTo;
    if (reqType) params.req_type = reqType;
    if (accountId) params.account_id = accountId;
    if (salesOwnerId) params.sales_owner_id = salesOwnerId;
    if (recruiterId) params.recruiter_id = recruiterId;
    if (workMode) params.work_mode = workMode;
    if (appliedTechStack) params.tech_stack = appliedTechStack;
    if (appliedSearch) params.search = appliedSearch;
    apiClient
      .get('/requirements', { params })
      .then(({ data }) => {
        setRows(data.data || []);
        setPagination(data.pagination || { page, total: data.data?.length || 0, totalPages: 1 });
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    appliedSearch, page, priority, status, stuck, closedFrom, closedTo, reqType, accountId,
    salesOwnerId, recruiterId, workMode, appliedTechStack, sortBy, sortOrder,
  ]);

  useEffect(() => {
    if (searchParams.get('create') === '1') setCreateOpen(true);
  }, [searchParams]);

  function resetToFirstPage(setter) {
    return (value) => {
      setPage(1);
      setter(value);
    };
  }

  function closeCreate() {
    setCreateOpen(false);
    if (searchParams.get('create')) {
      searchParams.delete('create');
      setSearchParams(searchParams, { replace: true });
    }
  }

  const columns = useMemo(
    () => [
      {
        key: 'work',
        header: 'Work',
        render: (row) => (
          <div className="min-w-0">
            <div className="text-sm font-medium text-primary-600">{reqKey(row.id)}</div>
            <div className="font-semibold text-tertiary-900">{row.title}</div>
          </div>
        ),
      },
      { key: 'client', header: 'Client', render: (row) => row.account?.name || '—' },
      {
        key: 'status',
        header: 'Status',
        render: (row) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge value={row.status} />
            {row.is_stuck && (
              <span className="rounded-full bg-danger-50 px-2 py-0.5 text-[10px] font-medium text-danger-700">
                Stuck
              </span>
            )}
          </div>
        ),
      },
      { key: 'priority', header: 'Priority', render: (row) => <Badge value={row.priority} /> },
      {
        key: 'work_mode',
        header: 'Work mode',
        render: (row) => (
          <span className="capitalize text-tertiary-700">{row.work_mode || '—'}</span>
        ),
      },
      {
        key: 'client_submissions',
        header: 'Client Submissions',
        render: (row) => row.client_submissions_count ?? 0,
      },
      {
        key: 'tech',
        header: 'Tech',
        render: (row) => (
          <div className="flex flex-wrap gap-1">
            {(row.primary_tech_stack || []).slice(0, 3).map((t) => (
              <span key={t} className="rounded-full bg-canvas-muted px-2 py-0.5 text-xs text-tertiary-600">
                {t}
              </span>
            ))}
          </div>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-2">
      {canCreateRequirement(user) && (
        <div className="flex justify-end">
          <button type="button" className="btn-primary shrink-0" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New requirement
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <div className="space-y-2 border-b border-tertiary-100 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-tertiary-100 bg-canvas-muted px-3 py-1.5 text-xs font-medium text-tertiary-700">
              <Filter className="h-3.5 w-3.5" />
              Filters
            </span>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setAppliedSearch(search.trim());
              }}
              className="flex"
            >
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search title or client"
                className="w-56 rounded-l-lg border border-tertiary-100 bg-canvas-muted px-3 py-1.5 text-sm text-tertiary-800 placeholder:text-tertiary-400 focus:border-primary-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
              <button
                type="submit"
                className="rounded-r-lg border border-l-0 border-tertiary-100 bg-[#EEF5FC] px-3 py-1.5 text-xs font-semibold text-[#105AA9] transition-colors hover:bg-[#D8E8F6]"
              >
                Search
              </button>
            </form>
            <SearchableSelect
              className="w-44"
              allowClear
              ariaLabel="Status"
              value={status}
              onChange={resetToFirstPage(setStatus)}
              placeholder="Status: All"
              searchPlaceholder="Search status…"
              options={[
                { value: 'open', label: 'Open' },
                { value: 'in_progress', label: 'In progress' },
                { value: 'on_hold', label: 'Hold' },
                { value: 'closed', label: 'Closed' },
                { value: 'dropped', label: 'Dropped' },
              ]}
            />
            <select
              value={priority}
              onChange={(event) => resetToFirstPage(setPriority)(event.target.value)}
              className="rounded-lg border border-tertiary-100 bg-white px-3 py-1.5 text-sm text-tertiary-700 shadow-soft"
              aria-label="Priority"
            >
              <option value="">Priority: All</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select
              value={reqType}
              onChange={(event) => resetToFirstPage(setReqType)(event.target.value)}
              className="rounded-lg border border-tertiary-100 bg-white px-3 py-1.5 text-sm text-tertiary-700 shadow-soft"
              aria-label="Type"
            >
              <option value="">Type: All</option>
              {REQ_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={workMode}
              onChange={(event) => resetToFirstPage(setWorkMode)(event.target.value)}
              className="rounded-lg border border-tertiary-100 bg-white px-3 py-1.5 text-sm text-tertiary-700 shadow-soft"
              aria-label="Work mode"
            >
              <option value="">Work mode: All</option>
              <option value="remote">Remote</option>
              <option value="onsite">Onsite</option>
              <option value="hybrid">Hybrid</option>
            </select>
            <select
              value={stuck}
              onChange={(event) => resetToFirstPage(setStuck)(event.target.value)}
              className="rounded-lg border border-tertiary-100 bg-white px-3 py-1.5 text-sm text-tertiary-700 shadow-soft"
              aria-label="Stuck"
            >
              <option value="">Stuck: All</option>
              <option value="stuck">Stuck only</option>
              <option value="not_stuck">Not stuck</option>
            </select>
            {hasActiveFilters && (
              <button type="button" className="btn-secondary px-2.5 py-1.5 text-xs" onClick={clearAllFilters}>
                <X className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                Clear all filters
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SearchableSelect
              className="w-48"
              allowClear
              ariaLabel="Client"
              value={accountId}
              onChange={resetToFirstPage(setAccountId)}
              placeholder="All clients"
              searchPlaceholder="Search clients…"
              options={clientOptions}
            />
            <SearchableSelect
              className="w-44"
              allowClear
              ariaLabel="Sales owner"
              value={salesOwnerId}
              onChange={resetToFirstPage(setSalesOwnerId)}
              placeholder="All sales owners"
              searchPlaceholder="Search people…"
              options={salesOwnerOptions}
            />
            <SearchableSelect
              className="w-44"
              allowClear
              ariaLabel="Assigned recruiter"
              value={recruiterId}
              onChange={resetToFirstPage(setRecruiterId)}
              placeholder="Any recruiter"
              searchPlaceholder="Search recruiters…"
              options={recruiterOptions}
            />
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setAppliedTechStack(techStack.trim());
              }}
              className="flex"
            >
              <input
                value={techStack}
                onChange={(event) => setTechStack(event.target.value)}
                placeholder="Tech stack (comma-sep)"
                className="w-52 rounded-l-lg border border-tertiary-100 bg-canvas-muted px-3 py-1.5 text-sm text-tertiary-800 placeholder:text-tertiary-400 focus:border-primary-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
              <button
                type="submit"
                className="rounded-r-lg border border-l-0 border-tertiary-100 bg-[#EEF5FC] px-3 py-1.5 text-xs font-semibold text-[#105AA9] transition-colors hover:bg-[#D8E8F6]"
              >
                Apply
              </button>
            </form>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-xs text-tertiary-500">Sort</span>
              <select
                value={sortBy}
                onChange={(event) => resetToFirstPage(setSortBy)(event.target.value)}
                className="rounded-lg border border-tertiary-100 bg-white px-2.5 py-1.5 text-sm text-tertiary-700 shadow-soft"
                aria-label="Sort by"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <select
                value={sortOrder}
                onChange={(event) => resetToFirstPage(setSortOrder)(event.target.value)}
                className="rounded-lg border border-tertiary-100 bg-white px-2.5 py-1.5 text-sm text-tertiary-700 shadow-soft"
                aria-label="Sort order"
              >
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
            </div>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          emptyLabel="No requirements match these filters."
          onRowClick={setPeek}
          headerClassName="bg-[#F9FAFB]"
          striped
          embedded
          maxHeight="calc(100dvh - 18rem)"
        />
      </section>

      <div className="flex items-center justify-between px-1 text-xs text-tertiary-500">
        <span>
          {rows.length} of {pagination.total}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((c) => c - 1)}
            className="rounded-lg border border-tertiary-100 bg-white px-2.5 py-1 shadow-soft disabled:opacity-40"
          >
            Previous
          </button>
          <span>
            Page {pagination.page} of {Math.max(pagination.totalPages, 1)}
          </span>
          <button
            type="button"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((c) => c + 1)}
            className="rounded-lg border border-tertiary-100 bg-white px-2.5 py-1 shadow-soft disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      {assignTarget && <AssignRecruiterDrawer requirement={assignTarget} onClose={() => setAssignTarget(null)} />}

      <Drawer open={Boolean(peek)} title={peek?.title || 'Requirement'} onClose={() => setPeek(null)} size="md" tone="info">
        {peek && (
          <RequirementPeek
            row={peek}
            onClose={() => setPeek(null)}
            onAssign={setAssignTarget}
          />
        )}
      </Drawer>

      <Drawer open={createOpen} title="Create requirement" onClose={closeCreate} size="xl" tone="create">
        {createOpen && (
          <RequirementFormPage
            asPanel
            onCancel={closeCreate}
            onDone={(newId) => {
              closeCreate();
              reload();
              if (newId) setPeek({ id: newId, title: 'Requirement' });
            }}
          />
        )}
      </Drawer>
    </div>
  );
}
