import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Filter, MoreVertical, Plus, X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { canCreateSubmission } from '../../lib/submissionStages.js';
import { useClientAccountOptions, useRequirementOptions, useUserOptions } from '../../lib/lookups.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import MultiSelectDropdown from '../../components/ui/MultiSelectDropdown.jsx';
import ProgressRing from '../../components/ui/ProgressRing.jsx';
import { PeekActions, PeekField } from '../../components/ui/PeekFields.jsx';
import SubmissionCreatePage from './SubmissionCreatePage.jsx';

function subKey(id) {
  return `SUB-${String(id).slice(0, 8).toUpperCase()}`;
}

const STAGE_OPTIONS = [
  'sourced',
  'internal_screening',
  'submitted_to_client',
  'interview_scheduled',
  'interview_result',
  'offer_sent',
  'bgv',
  'closed',
  'backout',
  'rejected',
].map((s) => ({ id: s, label: s.replace(/_/g, ' ') }));

const SORT_OPTIONS = [
  { value: 'created_at', label: 'Newest' },
  { value: 'stage', label: 'Stage' },
  { value: 'margin', label: 'Margin' },
];

function csvToList(value) {
  return value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

function SubmissionPeek({ row, onClose }) {
  const [detail, setDetail] = useState(row);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get(`/submissions/${row.id}`)
      .then(({ data }) => setDetail(data.data || row))
      .catch(() => setDetail(row))
      .finally(() => setLoading(false));
  }, [row]);

  return (
    <div className="space-y-4">
      {loading && <p className="text-xs text-tertiary-400">Loading details…</p>}
      <dl className="grid gap-4 sm:grid-cols-2">
        <PeekField label="Key">
          <Link to={`/submissions/${detail.id}`} className="text-primary-700 hover:underline">
            {subKey(detail.id)}
          </Link>
        </PeekField>
        <PeekField label="Candidate">{detail.profile?.name || '—'}</PeekField>
        <PeekField label="Job">{detail.requirement?.title || '—'}</PeekField>
        <PeekField label="Stage"><Badge value={detail.stage} /></PeekField>
        <PeekField label="Closure probability">
          <ProgressRing percent={detail.progress?.percent ?? null} size="md" />
        </PeekField>
        <PeekField label="Proposed rate">
          {detail.proposed_rate ? `${detail.proposed_rate_currency} ${detail.proposed_rate}` : '—'}
        </PeekField>
        <PeekField label="Margin">{detail.margin != null ? detail.margin : '—'}</PeekField>
        <PeekField label="Recruiter">{detail.submitted_by?.name || '—'}</PeekField>
        <PeekField label="Relevancy">{detail.relevancy_score ?? '—'}</PeekField>
      </dl>
      {detail.submission_notes && (
        <PeekField label="Notes">{detail.submission_notes}</PeekField>
      )}
      <PeekActions>
        <Link to={`/submissions/${detail.id}`} className="btn-primary">
          Manage interviews
        </Link>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </PeekActions>
      <p className="text-xs text-tertiary-400">
        Stage changes and interview rounds stay on the submission workspace when you need the full timeline.
      </p>
    </div>
  );
}

export default function SubmissionsListPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [stages, setStages] = useState(() => csvToList(searchParams.get('stage')));
  const [submittedBy, setSubmittedBy] = useState(() => searchParams.get('submitted_by') || '');
  const [accountId, setAccountId] = useState(() => searchParams.get('account_id') || '');
  const [requirementId, setRequirementId] = useState(() => searchParams.get('requirement_id') || '');
  // URL-only passthrough filters (set by dashboard KPI tiles; no dropdown, cleared via "Clear all").
  const [salesOwnerId, setSalesOwnerId] = useState(() => searchParams.get('sales_owner_id') || '');
  const [joinedFrom, setJoinedFrom] = useState(() => searchParams.get('joined_from') || '');
  const [joinedTo, setJoinedTo] = useState(() => searchParams.get('joined_to') || '');
  const [sortBy, setSortBy] = useState(() => searchParams.get('sort_by') || 'created_at');
  const [sortOrder, setSortOrder] = useState(() => searchParams.get('sort_order') || 'desc');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(searchParams.get('create') === '1');
  const [createProfileId, setCreateProfileId] = useState(searchParams.get('profile_id') || '');
  const [peek, setPeek] = useState(null);

  const recruiterOptions = useUserOptions('recruiter');
  const clientOptions = useClientAccountOptions();
  const requirementOptions = useRequirementOptions();

  const stageCsv = stages.join(',');

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const sync = (key, value, dflt = '') => {
      if (value && value !== dflt) next.set(key, value);
      else next.delete(key);
    };
    sync('stage', stageCsv);
    sync('submitted_by', submittedBy);
    sync('account_id', accountId);
    sync('requirement_id', requirementId);
    sync('sales_owner_id', salesOwnerId);
    sync('joined_from', joinedFrom);
    sync('joined_to', joinedTo);
    sync('sort_by', sortBy, 'created_at');
    sync('sort_order', sortOrder, 'desc');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageCsv, submittedBy, accountId, requirementId, salesOwnerId, joinedFrom, joinedTo, sortBy, sortOrder]);

  // Re-hydrate filter state FROM the URL (browser Back, shared link, new tab).
  useEffect(() => {
    const g = (k, d = '') => searchParams.get(k) || d;
    const set = (setter, value) => setter((prev) => (prev === value ? prev : value));
    setStages((prev) => {
      const nextCsv = g('stage');
      return prev.join(',') === nextCsv ? prev : csvToList(nextCsv);
    });
    set(setSubmittedBy, g('submitted_by'));
    set(setAccountId, g('account_id'));
    set(setRequirementId, g('requirement_id'));
    set(setSalesOwnerId, g('sales_owner_id'));
    set(setJoinedFrom, g('joined_from'));
    set(setJoinedTo, g('joined_to'));
    set(setSortBy, g('sort_by', 'created_at'));
    set(setSortOrder, g('sort_order', 'desc'));
  }, [searchParams]);

  const hasActiveFilters = Boolean(
    stageCsv || submittedBy || accountId || requirementId || salesOwnerId || joinedFrom || joinedTo ||
      appliedSearch || sortBy !== 'created_at' || sortOrder !== 'desc'
  );

  function clearAllFilters() {
    setPage(1);
    setStages([]);
    setSubmittedBy('');
    setAccountId('');
    setRequirementId('');
    setSalesOwnerId('');
    setJoinedFrom('');
    setJoinedTo('');
    setSortBy('created_at');
    setSortOrder('desc');
    setSearch('');
    setAppliedSearch('');
    const kept = new URLSearchParams();
    ['create', 'profile_id'].forEach((k) => {
      if (searchParams.get(k)) kept.set(k, searchParams.get(k));
    });
    setSearchParams(kept, { replace: true });
  }

  function reload() {
    setLoading(true);
    const params = { page, limit: 20, sort_by: sortBy, sort_order: sortOrder };
    if (stageCsv) params.stage = stageCsv;
    if (submittedBy) params.submitted_by = submittedBy;
    if (accountId) params.account_id = accountId;
    if (requirementId) params.requirement_id = requirementId;
    if (salesOwnerId) params.sales_owner_id = salesOwnerId;
    if (joinedFrom) params.joined_from = joinedFrom;
    if (joinedTo) params.joined_to = joinedTo;
    if (appliedSearch) params.search = appliedSearch;
    apiClient
      .get('/submissions', { params })
      .then(({ data }) => {
        setRows(data.data || []);
        setPagination(data.pagination || { page, total: data.data?.length || 0, totalPages: 1 });
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedSearch, page, stageCsv, submittedBy, accountId, requirementId, salesOwnerId, joinedFrom, joinedTo, sortBy, sortOrder]);

  useEffect(() => {
    if (searchParams.get('create') === '1') setCreateOpen(true);
    setCreateProfileId(searchParams.get('profile_id') || '');
  }, [searchParams]);

  function resetToFirstPage(setter) {
    return (value) => {
      setPage(1);
      setter(value);
    };
  }

  function closeCreate() {
    setCreateOpen(false);
    setCreateProfileId('');
    if (searchParams.get('create') || searchParams.get('profile_id')) {
      searchParams.delete('create');
      searchParams.delete('profile_id');
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
            <div className="text-sm font-medium text-primary-600">{subKey(row.id)}</div>
            <div className="font-semibold text-tertiary-900">{row.profile?.name || '—'}</div>
          </div>
        ),
      },
      { key: 'job', header: 'Job', render: (row) => row.requirement?.title || '—' },
      { key: 'stage', header: 'Stage', render: (row) => <Badge value={row.stage} /> },
      {
        key: 'closure',
        header: 'Closure %',
        render: (row) => <ProgressRing percent={row.progress?.percent ?? null} size="sm" />,
      },
      {
        key: 'rate',
        header: 'Rate',
        render: (row) => (row.proposed_rate ? `${row.proposed_rate_currency} ${row.proposed_rate}` : '—'),
      },
      { key: 'margin', header: 'Margin', render: (row) => (row.margin != null ? row.margin : '—') },
      { key: 'recruiter', header: 'Recruiter', render: (row) => row.submitted_by?.name || '—' },
      {
        key: 'actions',
        header: '',
        render: (row) => (
          <button
            type="button"
            className="rounded-lg p-1.5 text-tertiary-400 transition-colors hover:bg-tertiary-50 hover:text-tertiary-700"
            aria-label={`Actions for ${row.profile?.name || 'submission'}`}
            onClick={(event) => {
              event.stopPropagation();
              setPeek(row);
            }}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-2">
      {canCreateSubmission(user) && (
        <div className="flex justify-end">
          <button type="button" className="btn-primary shrink-0" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Put forward
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
                placeholder="Search candidate or job"
                className="w-56 rounded-l-lg border border-tertiary-100 bg-canvas-muted px-3 py-1.5 text-sm text-tertiary-800 placeholder:text-tertiary-400 focus:border-primary-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
              <button
                type="submit"
                className="rounded-r-lg border border-l-0 border-tertiary-100 bg-[#EEF5FC] px-3 py-1.5 text-xs font-semibold text-[#105AA9] transition-colors hover:bg-[#D8E8F6]"
              >
                Search
              </button>
            </form>
            <div className="min-w-[220px]">
              <MultiSelectDropdown
                value={stages}
                onChange={resetToFirstPage(setStages)}
                options={STAGE_OPTIONS}
                placeholder="Stages: All"
                searchPlaceholder="Search stage…"
              />
            </div>
            {hasActiveFilters && (
              <button type="button" className="btn-secondary px-2.5 py-1.5 text-xs" onClick={clearAllFilters}>
                <X className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                Clear all filters
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SearchableSelect
              className="w-44"
              allowClear
              ariaLabel="Recruiter"
              value={submittedBy}
              onChange={resetToFirstPage(setSubmittedBy)}
              placeholder="Any recruiter"
              searchPlaceholder="Search recruiters…"
              options={recruiterOptions}
            />
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
              className="w-52"
              allowClear
              ariaLabel="Requirement"
              value={requirementId}
              onChange={resetToFirstPage(setRequirementId)}
              placeholder="Any requirement"
              searchPlaceholder="Search requirements…"
              options={requirementOptions}
            />
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
          emptyLabel="No submissions match these filters."
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

      <Drawer open={Boolean(peek)} title={peek?.profile?.name || 'Submission'} onClose={() => setPeek(null)} size="md" tone="info">
        {peek && <SubmissionPeek row={peek} onClose={() => setPeek(null)} />}
      </Drawer>

      <Drawer open={createOpen} title="Put a candidate forward" onClose={closeCreate} size="xl" tone="create">
        <SubmissionCreatePage
          asPanel
          initialProfileId={createProfileId}
          onCancel={closeCreate}
          onDone={(id) => {
            closeCreate();
            reload();
            setPeek({ id, profile: { name: 'Submission' } });
          }}
        />
      </Drawer>
    </div>
  );
}
