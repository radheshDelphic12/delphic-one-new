import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Filter, MoreVertical, Plus, SlidersHorizontal, X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { useUserOptions, useVendorAccountOptions } from '../../lib/lookups.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import ProgressRing from '../../components/ui/ProgressRing.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import { PeekActions, PeekField } from '../../components/ui/PeekFields.jsx';
import ProfileFormPage from './ProfileFormPage.jsx';
import { apiErrorMessage, canCreateProfile, canEditProfile, profileKey } from './profileUtils.js';

const SORT_OPTIONS = [
  { value: 'created_at', label: 'Newest' },
  { value: 'total_experience_years', label: 'Experience' },
  { value: 'expected_ctc', label: 'Expected CTC' },
];

const MORE_KEYS = [
  'vendor_id',
  'added_by',
  'experience_min',
  'experience_max',
  'expected_ctc_min',
  'expected_ctc_max',
  'notice_period_max',
  'preferred_work_mode',
  'willing_to_relocate',
  'is_active',
  'primary_skills',
  'sort_by',
  'sort_order',
];

function ProfilePeek({ row, onClose }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(row);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get(`/profiles/${row.id}`)
      .then(({ data }) => setDetail(data.data || row))
      .catch(() => setDetail(row))
      .finally(() => setLoading(false));
  }, [row]);

  return (
    <div className="space-y-4">
      {loading && <p className="text-xs text-tertiary-400">Loading details…</p>}
      <dl className="grid gap-4 sm:grid-cols-2">
        <PeekField label="Key">
          <Link to={`/profiles/${detail.id}`} className="text-primary-700 hover:underline">
            {profileKey(detail.id)}
          </Link>
        </PeekField>
        <PeekField label="Name">{detail.name}</PeekField>
        <PeekField label="Company">{detail.current_company || '—'}</PeekField>
        <PeekField label="Experience">{detail.total_experience_years ?? '—'}</PeekField>
        <PeekField label="Source"><Badge value={detail.source} /></PeekField>
        <PeekField label="Closure probability">
          <ProgressRing percent={detail.progress?.percent ?? null} size="md" />
        </PeekField>
        {detail.source === 'direct' && (
          <PeekField label="On bench">{detail.on_bench ? 'Yes' : 'No'}</PeekField>
        )}
        <PeekField label="Expected CTC">
          {detail.expected_ctc != null ? `${detail.expected_ctc_currency} ${detail.expected_ctc}` : '—'}
        </PeekField>
        <PeekField label="Email">{detail.email || '—'}</PeekField>
        <PeekField label="Phone">{detail.phone || '—'}</PeekField>
        <PeekField label="Added by">{detail.added_by?.name || '—'}</PeekField>
        <div className="sm:col-span-2">
          <PeekField label="Primary skills">
            <div className="mt-1 flex flex-wrap gap-1">
              {(detail.primary_skills || []).length
                ? (detail.primary_skills || []).map((skill) => (
                    <span key={skill} className="rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700">
                      {skill}
                    </span>
                  ))
                : '—'}
            </div>
          </PeekField>
        </div>
      </dl>
      <PeekActions>
        <Link to={`/profiles/${detail.id}`} className="btn-primary">
          View full details
        </Link>
        {canEditProfile(user) && (
          <button type="button" className="btn-secondary" onClick={() => navigate(`/profiles/${detail.id}?edit=1`)}>
            Edit candidate
          </button>
        )}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            navigate(`/submissions?create=1&profile_id=${detail.id}`);
          }}
        >
          Put forward
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </PeekActions>
    </div>
  );
}

export default function ProfilesListPage() {
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [source, setSource] = useState(() => searchParams.get('source') || '');
  const [onBench, setOnBench] = useState(() => searchParams.get('on_bench') === 'true');
  const [vendorId, setVendorId] = useState(() => searchParams.get('vendor_id') || '');
  const [addedBy, setAddedBy] = useState(() => searchParams.get('added_by') || '');
  const [expMin, setExpMin] = useState(() => searchParams.get('experience_min') || '');
  const [expMax, setExpMax] = useState(() => searchParams.get('experience_max') || '');
  const [ctcMin, setCtcMin] = useState(() => searchParams.get('expected_ctc_min') || '');
  const [ctcMax, setCtcMax] = useState(() => searchParams.get('expected_ctc_max') || '');
  const [noticeMax, setNoticeMax] = useState(() => searchParams.get('notice_period_max') || '');
  const [workMode, setWorkMode] = useState(() => searchParams.get('preferred_work_mode') || '');
  const [relocate, setRelocate] = useState(() => searchParams.get('willing_to_relocate') || '');
  const [activeState, setActiveState] = useState(() => searchParams.get('is_active') || '');
  const [skills, setSkills] = useState(() => searchParams.get('primary_skills') || '');
  const [appliedSkills, setAppliedSkills] = useState(() => searchParams.get('primary_skills') || '');
  const [sortBy, setSortBy] = useState(() => searchParams.get('sort_by') || 'created_at');
  const [sortOrder, setSortOrder] = useState(() => searchParams.get('sort_order') || 'desc');
  const [showMore, setShowMore] = useState(() => MORE_KEYS.some((k) => searchParams.get(k)));
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [createOpen, setCreateOpen] = useState(searchParams.get('create') === '1');
  const [peek, setPeek] = useState(null);

  const vendorOptions = useVendorAccountOptions();
  const recruiterOptions = useUserOptions('recruiter');

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const sync = (key, value, dflt = '') => {
      if (value && value !== dflt) next.set(key, value);
      else next.delete(key);
    };
    sync('source', source);
    sync('on_bench', onBench ? 'true' : '');
    sync('vendor_id', vendorId);
    sync('added_by', addedBy);
    sync('experience_min', expMin);
    sync('experience_max', expMax);
    sync('expected_ctc_min', ctcMin);
    sync('expected_ctc_max', ctcMax);
    sync('notice_period_max', noticeMax);
    sync('preferred_work_mode', workMode);
    sync('willing_to_relocate', relocate);
    sync('is_active', activeState);
    sync('primary_skills', appliedSkills);
    sync('sort_by', sortBy, 'created_at');
    sync('sort_order', sortOrder, 'desc');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    source, onBench, vendorId, addedBy, expMin, expMax, ctcMin, ctcMax, noticeMax,
    workMode, relocate, activeState, appliedSkills, sortBy, sortOrder,
  ]);

  function reload() {
    setLoading(true);
    const params = { page, limit: 20, sort_by: sortBy, sort_order: sortOrder };
    if (appliedSearch) params.search = appliedSearch;
    if (source) params.source = source;
    if (onBench) params.on_bench = 'true';
    if (vendorId) params.vendor_id = vendorId;
    if (addedBy) params.added_by = addedBy;
    if (expMin) params.experience_min = expMin;
    if (expMax) params.experience_max = expMax;
    if (ctcMin) params.expected_ctc_min = ctcMin;
    if (ctcMax) params.expected_ctc_max = ctcMax;
    if (noticeMax) params.notice_period_max = noticeMax;
    if (workMode) params.preferred_work_mode = workMode;
    if (relocate) params.willing_to_relocate = relocate;
    if (activeState) params.is_active = activeState;
    if (appliedSkills) params.primary_skills = appliedSkills;
    apiClient
      .get('/profiles', { params })
      .then(({ data }) => {
        setRows(data.data || []);
        setPagination(data.pagination || { page, total: data.data?.length || 0, totalPages: 1 });
      })
      .catch((requestError) => pushError(apiErrorMessage(requestError, 'Failed to load profiles'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    appliedSearch, page, source, onBench, vendorId, addedBy, expMin, expMax, ctcMin, ctcMax,
    noticeMax, workMode, relocate, activeState, appliedSkills, sortBy, sortOrder,
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

  function clearMore() {
    setPage(1);
    setVendorId('');
    setAddedBy('');
    setExpMin('');
    setExpMax('');
    setCtcMin('');
    setCtcMax('');
    setNoticeMax('');
    setWorkMode('');
    setRelocate('');
    setActiveState('');
    setSkills('');
    setAppliedSkills('');
    setSortBy('created_at');
    setSortOrder('desc');
  }

  function closeCreate() {
    setCreateOpen(false);
    if (searchParams.get('create')) {
      searchParams.delete('create');
      setSearchParams(searchParams, { replace: true });
    }
  }

  // Re-hydrate filter state FROM the URL (browser Back, shared link, new tab).
  useEffect(() => {
    const g = (k, d = '') => searchParams.get(k) || d;
    const set = (setter, value) => setter((prev) => (prev === value ? prev : value));
    set(setSource, g('source'));
    setOnBench((prev) => {
      const v = g('on_bench') === 'true';
      return prev === v ? prev : v;
    });
    set(setVendorId, g('vendor_id'));
    set(setAddedBy, g('added_by'));
    set(setExpMin, g('experience_min'));
    set(setExpMax, g('experience_max'));
    set(setCtcMin, g('expected_ctc_min'));
    set(setCtcMax, g('expected_ctc_max'));
    set(setNoticeMax, g('notice_period_max'));
    set(setWorkMode, g('preferred_work_mode'));
    set(setRelocate, g('willing_to_relocate'));
    set(setActiveState, g('is_active'));
    set(setAppliedSkills, g('primary_skills'));
    set(setSkills, g('primary_skills'));
    set(setSortBy, g('sort_by', 'created_at'));
    set(setSortOrder, g('sort_order', 'desc'));
  }, [searchParams]);

  const hasActiveFilters = Boolean(
    appliedSearch || source || onBench || vendorId || addedBy || expMin || expMax || ctcMin ||
      ctcMax || noticeMax || workMode || relocate || activeState || appliedSkills ||
      sortBy !== 'created_at' || sortOrder !== 'desc'
  );

  function clearAllFilters() {
    setPage(1);
    setSearch('');
    setAppliedSearch('');
    setSource('');
    setOnBench(false);
    clearMore();
    const kept = new URLSearchParams();
    if (searchParams.get('create')) kept.set('create', searchParams.get('create'));
    setSearchParams(kept, { replace: true });
  }

  const numberInput =
    'w-20 rounded-lg border border-tertiary-100 bg-white px-2 py-1.5 text-sm text-tertiary-700 shadow-soft';
  const selectInput =
    'rounded-lg border border-tertiary-100 bg-white px-3 py-1.5 text-sm text-tertiary-700 shadow-soft';

  const columns = useMemo(
    () => [
      {
        key: 'candidate',
        header: 'Candidate',
        render: (row) => (
          <div className="min-w-0">
            <div className="text-sm font-medium text-primary-600">{profileKey(row.id)}</div>
            <div className="font-semibold text-tertiary-900">{row.name}</div>
          </div>
        ),
      },
      {
        key: 'closure',
        header: 'Closure %',
        render: (row) => <ProgressRing percent={row.progress?.percent ?? null} size="sm" />,
      },
      { key: 'company', header: 'Company', render: (row) => row.current_company || '—' },
      { key: 'exp', header: 'Exp', render: (row) => row.total_experience_years },
      {
        key: 'skills',
        header: 'Skills',
        render: (row) => (
          <div className="flex flex-wrap gap-1">
            {(row.primary_skills || []).slice(0, 3).map((skill) => (
              <span key={skill} className="rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700">
                {skill}
              </span>
            ))}
          </div>
        ),
      },
      {
        key: 'ctc',
        header: 'Expected CTC',
        render: (row) => (row.expected_ctc != null ? `${row.expected_ctc_currency} ${row.expected_ctc}` : '—'),
      },
      { key: 'source', header: 'Source', render: (row) => <Badge value={row.source} /> },
      { key: 'added_by', header: 'Added by', render: (row) => row.added_by?.name || '—' },
      {
        key: 'bench',
        header: 'Bench',
        render: (row) =>
          row.source === 'direct' && row.on_bench ? (
            <span className="rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-success-700">On bench</span>
          ) : (
            '—'
          ),
      },
      {
        key: 'actions',
        header: '',
        render: (row) => (
          <button
            type="button"
            className="rounded-lg p-1.5 text-tertiary-400 transition-colors hover:bg-tertiary-50 hover:text-tertiary-700"
            aria-label={`Actions for ${row.name}`}
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
      {canCreateProfile(user) && (
        <div className="flex justify-end">
          <button type="button" className="btn-primary shrink-0" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add candidate
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
                placeholder="Search name, company, skills…"
                className="w-64 rounded-l-lg border border-tertiary-100 bg-canvas-muted px-3 py-1.5 text-sm text-tertiary-800 placeholder:text-tertiary-400 focus:border-primary-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
              <button
                type="submit"
                className="rounded-r-lg border border-l-0 border-tertiary-100 bg-[#EEF5FC] px-3 py-1.5 text-xs font-semibold text-[#105AA9] transition-colors hover:bg-[#D8E8F6]"
              >
                Search
              </button>
            </form>
            <select
              value={source}
              onChange={(event) => resetToFirstPage(setSource)(event.target.value)}
              className={selectInput}
              aria-label="Source"
            >
              <option value="">Source: All</option>
              <option value="direct">Bench</option>
              <option value="vendor">Vendor</option>
              <option value="linkedin">Market</option>
            </select>
            <label className="flex shrink-0 items-center gap-1.5 rounded-lg border border-tertiary-100 bg-white px-3 py-1.5 text-sm text-tertiary-700 shadow-soft">
              <input
                type="checkbox"
                checked={onBench}
                onChange={(event) => resetToFirstPage(setOnBench)(event.target.checked)}
              />
              On bench only
            </label>
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-tertiary-100 bg-white px-3 py-1.5 text-sm text-tertiary-700 shadow-soft"
              aria-expanded={showMore}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {showMore ? 'Fewer filters' : 'More filters'}
            </button>
            {hasActiveFilters && (
              <button type="button" className="btn-secondary px-2.5 py-1.5 text-xs" onClick={clearAllFilters}>
                <X className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                Clear all filters
              </button>
            )}
          </div>

          {showMore && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-canvas-muted/60 p-2">
              <SearchableSelect
                className="w-44"
                allowClear
                ariaLabel="Vendor"
                value={vendorId}
                onChange={resetToFirstPage(setVendorId)}
                placeholder="Any vendor"
                searchPlaceholder="Search vendors…"
                options={vendorOptions}
              />
              <SearchableSelect
                className="w-44"
                allowClear
                ariaLabel="Added by"
                value={addedBy}
                onChange={resetToFirstPage(setAddedBy)}
                placeholder="Added by anyone"
                searchPlaceholder="Search recruiters…"
                options={recruiterOptions}
              />
              <label className="flex items-center gap-1 text-xs text-tertiary-600">
                Exp
                <input
                  type="number"
                  min="0"
                  value={expMin}
                  onChange={(event) => resetToFirstPage(setExpMin)(event.target.value)}
                  placeholder="min"
                  className={numberInput}
                  aria-label="Experience min"
                />
                <span>–</span>
                <input
                  type="number"
                  min="0"
                  value={expMax}
                  onChange={(event) => resetToFirstPage(setExpMax)(event.target.value)}
                  placeholder="max"
                  className={numberInput}
                  aria-label="Experience max"
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-tertiary-600">
                CTC
                <input
                  type="number"
                  min="0"
                  value={ctcMin}
                  onChange={(event) => resetToFirstPage(setCtcMin)(event.target.value)}
                  placeholder="min"
                  className={numberInput}
                  aria-label="Expected CTC min"
                />
                <span>–</span>
                <input
                  type="number"
                  min="0"
                  value={ctcMax}
                  onChange={(event) => resetToFirstPage(setCtcMax)(event.target.value)}
                  placeholder="max"
                  className={numberInput}
                  aria-label="Expected CTC max"
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-tertiary-600">
                Notice ≤
                <input
                  type="number"
                  min="0"
                  value={noticeMax}
                  onChange={(event) => resetToFirstPage(setNoticeMax)(event.target.value)}
                  placeholder="days"
                  className={numberInput}
                  aria-label="Notice period max days"
                />
              </label>
              <select
                value={workMode}
                onChange={(event) => resetToFirstPage(setWorkMode)(event.target.value)}
                className={selectInput}
                aria-label="Preferred work mode"
              >
                <option value="">Work mode: Any</option>
                <option value="remote">Remote</option>
                <option value="onsite">Onsite</option>
                <option value="hybrid">Hybrid</option>
              </select>
              <select
                value={relocate}
                onChange={(event) => resetToFirstPage(setRelocate)(event.target.value)}
                className={selectInput}
                aria-label="Willing to relocate"
              >
                <option value="">Relocate: Any</option>
                <option value="true">Will relocate</option>
                <option value="false">Will not relocate</option>
              </select>
              <select
                value={activeState}
                onChange={(event) => resetToFirstPage(setActiveState)(event.target.value)}
                className={selectInput}
                aria-label="Active"
              >
                <option value="">Active: Any</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setPage(1);
                  setAppliedSkills(skills.trim());
                }}
                className="flex"
              >
                <input
                  value={skills}
                  onChange={(event) => setSkills(event.target.value)}
                  placeholder="Skills (comma-sep)"
                  className="w-48 rounded-l-lg border border-tertiary-100 bg-white px-3 py-1.5 text-sm text-tertiary-800 placeholder:text-tertiary-400"
                />
                <button
                  type="submit"
                  className="rounded-r-lg border border-l-0 border-tertiary-100 bg-[#EEF5FC] px-3 py-1.5 text-xs font-semibold text-[#105AA9] hover:bg-[#D8E8F6]"
                >
                  Apply
                </button>
              </form>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-tertiary-500">Sort</span>
                <select
                  value={sortBy}
                  onChange={(event) => resetToFirstPage(setSortBy)(event.target.value)}
                  className={selectInput}
                  aria-label="Sort by"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <select
                  value={sortOrder}
                  onChange={(event) => resetToFirstPage(setSortOrder)(event.target.value)}
                  className={selectInput}
                  aria-label="Sort order"
                >
                  <option value="desc">Desc</option>
                  <option value="asc">Asc</option>
                </select>
              </div>
              <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={clearMore}>
                Clear
              </button>
            </div>
          )}
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          emptyLabel="No candidates match these filters."
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

      <Drawer open={Boolean(peek)} title={peek?.name || 'Candidate'} onClose={() => setPeek(null)} size="md" tone="info">
        {peek && <ProfilePeek row={peek} onClose={() => setPeek(null)} />}
      </Drawer>

      <Drawer open={createOpen} title="Add candidate" onClose={closeCreate} size="xl" tone="create">
        <ProfileFormPage
          asPanel
          onCancel={closeCreate}
          onDone={(id) => {
            closeCreate();
            reload();
            setPeek({ id, name: 'Candidate' });
          }}
        />
      </Drawer>
    </div>
  );
}
