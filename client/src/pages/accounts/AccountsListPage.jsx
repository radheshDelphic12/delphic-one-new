import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Filter, MoreVertical, Plus, X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import { PeekActions, PeekField } from '../../components/ui/PeekFields.jsx';
import { accountAccent } from '../../lib/accountAccent.js';
import AccountFormPage from './AccountFormPage.jsx';
import AccountStageMoveDrawer from './AccountStageMoveDrawer.jsx';
import AccountStageOverrideDrawer from './AccountStageOverrideDrawer.jsx';
import {
  ACCOUNT_TRANSITIONS,
  accountKey,
  apiErrorMessage,
  canCreateAccount,
  canMutateAccount,
  canOverrideStage,
} from './accountUtils.js';

function AccountPeek({ row, onClose, onChanged, onRequestStageMove, onRequestStageOverride }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(row);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get(`/accounts/${row.id}`)
      .then(({ data }) => setDetail(data.data || row))
      .catch(() => setDetail(row))
      .finally(() => setLoading(false));
  }, [row]);

  const canEdit = canMutateAccount(detail, user) && !detail.is_locked;
  const nextStages = ACCOUNT_TRANSITIONS[detail.stage] || [];
  const canOverride = canOverrideStage(user);

  return (
    <div className="space-y-4">
      {loading && <p className="text-xs text-tertiary-400">Loading details…</p>}
      <dl className="grid gap-4 sm:grid-cols-2">
        <PeekField label="Key">
          <Link to={`/accounts/${detail.id}`} className="text-primary-700 hover:underline">
            {accountKey(detail.id)}
          </Link>
        </PeekField>
        <PeekField label="Name">{detail.name}</PeekField>
        <PeekField label="Type"><span className="capitalize">{detail.type || 'Unclassified'}</span></PeekField>
        <PeekField label="Stage"><Badge value={detail.stage} /></PeekField>
        <PeekField label="Industry">{detail.industry || '—'}</PeekField>
        {detail.type === 'vendor' && (
          <>
            <PeekField label="Specializations">
              {(detail.vendor_specializations || []).join(', ') || '—'}
            </PeekField>
            <PeekField label="Rate range">
              {detail.vendor_rate_range
                ? `${detail.vendor_rate_range.currency} ${detail.vendor_rate_range.min}–${detail.vendor_rate_range.max}`
                : '—'}
            </PeekField>
            <PeekField label="Payment terms">{detail.vendor_payment_terms || '—'}</PeekField>
          </>
        )}
        <PeekField label="Owner">{detail.owner?.name || '—'}</PeekField>
        <PeekField label="Brought by">{detail.origin_owner?.name || '—'}</PeekField>
        <PeekField label="POC">{detail.poc_name || '—'}</PeekField>
        <PeekField label="POC email">{detail.poc_email || '—'}</PeekField>
        <PeekField label="City">{detail.location_city || '—'}</PeekField>
        <PeekField label="Created">
          {detail.created_at ? new Date(detail.created_at).toLocaleDateString() : '—'}
        </PeekField>
      </dl>
      <PeekActions>
        <Link to={`/accounts/${detail.id}`} className="btn-secondary">
          Open details
        </Link>
        {canEdit && (
          <button type="button" className="btn-secondary" onClick={() => navigate(`/accounts/${detail.id}?edit=1`)}>
            Edit account
          </button>
        )}
        {canEdit && nextStages.length > 0 && (
          <button type="button" className="btn-primary" onClick={() => onRequestStageMove(detail)}>
            Move stage
          </button>
        )}
        {canOverride && (
          <button type="button" className="btn-ghost" onClick={() => onRequestStageOverride(detail)}>
            Override stage
          </button>
        )}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            onClose();
            onChanged?.();
          }}
        >
          Close
        </button>
      </PeekActions>
    </div>
  );
}

export default function AccountsListPage() {
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [type, setType] = useState(() => searchParams.get('type') || '');
  const [stage, setStage] = useState(() => searchParams.get('stage') || '');
  // URL-only convenience filter (set by the dashboard "Stuck leads" tile); no dropdown.
  const [stuck, setStuck] = useState(() => searchParams.get('stuck') || '');
  const [ownerId, setOwnerId] = useState(() => searchParams.get('owner_id') || '');
  const [broughtById, setBroughtById] = useState(() => searchParams.get('origin_owner_id') || '');
  const [specialization, setSpecialization] = useState(() => searchParams.get('specialization') || '');
  const [people, setPeople] = useState([]);
  const [specializationOptions, setSpecializationOptions] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [createOpen, setCreateOpen] = useState(searchParams.get('create') === '1');
  const [peek, setPeek] = useState(null);
  const [stageTarget, setStageTarget] = useState(null);
  const [overrideTarget, setOverrideTarget] = useState(null);
  const [movingStage, setMovingStage] = useState(false);

  function reload() {
    setLoading(true);
    const params = { page, limit: 20 };
    if (type) params.type = type;
    if (stage) params.stage = stage;
    if (stuck) params.stuck = stuck;
    if (ownerId) params.owner_id = ownerId;
    if (broughtById) params.origin_owner_id = broughtById;
    if (specialization) params.specialization = specialization;
    if (appliedSearch) params.search = appliedSearch;
    apiClient
      .get('/accounts', { params })
      .then(({ data }) => {
        setRows(data.data || []);
        setPagination(data.pagination || { page, total: data.data?.length || 0, totalPages: 1 });
      })
      .catch((requestError) => pushError(apiErrorMessage(requestError, 'Failed to load accounts'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedSearch, page, stage, stuck, type, ownerId, broughtById, specialization]);

  useEffect(() => {
    // /users/directory is readable by every role and includes inactive users, so
    // the Owner / Brought-by filters show the whole roster (BDAs included) no
    // matter who is signed in.
    apiClient
      .get('/users/directory')
      .then(({ data }) =>
        setPeople(
          (data.data || []).map((u) => ({
            value: u.id,
            label: u.active === false ? `${u.name} (inactive)` : u.name,
            hint: u.role,
          }))
        )
      )
      .catch(() => setPeople([]));
  }, []);

  useEffect(() => {
    apiClient
      .get('/accounts/specializations')
      .then(({ data }) =>
        setSpecializationOptions((data.data || []).map((tag) => ({ value: tag, label: tag })))
      )
      .catch(() => setSpecializationOptions([]));
  }, []);

  useEffect(() => {
    if (searchParams.get('create') === '1') setCreateOpen(true);
    setStage(searchParams.get('stage') || '');
    setStuck(searchParams.get('stuck') || '');
    setType(searchParams.get('type') || '');
    setOwnerId(searchParams.get('owner_id') || '');
    setBroughtById(searchParams.get('origin_owner_id') || '');
    setSpecialization(searchParams.get('specialization') || '');
  }, [searchParams]);

  // Keep the active filters shareable via the URL.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const sync = (key, value) => {
      if (value) next.set(key, value);
      else next.delete(key);
    };
    sync('type', type);
    sync('stage', stage);
    sync('stuck', stuck);
    sync('owner_id', ownerId);
    sync('origin_owner_id', broughtById);
    sync('specialization', specialization);
    if (searchParams.get('create') === '1') next.set('create', '1');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, stage, stuck, ownerId, broughtById, specialization]);

  const hasActiveFilters = Boolean(
    type || stage || stuck || ownerId || broughtById || specialization || appliedSearch
  );

  function clearAllFilters() {
    setPage(1);
    setType('');
    setStage('');
    setStuck('');
    setOwnerId('');
    setBroughtById('');
    setSpecialization('');
    setSearch('');
    setAppliedSearch('');
    const kept = new URLSearchParams();
    if (searchParams.get('create')) kept.set('create', searchParams.get('create'));
    setSearchParams(kept, { replace: true });
  }

  function closeCreate() {
    setCreateOpen(false);
    if (searchParams.get('create')) {
      searchParams.delete('create');
      setSearchParams(searchParams, { replace: true });
    }
  }

  async function moveStage(body) {
    if (!stageTarget) return;
    setMovingStage(true);
    try {
      const { data } = await apiClient.post(`/accounts/${stageTarget.id}/stage`, body);
      setStageTarget(null);
      setPeek(data.data || stageTarget);
      reload();
    } catch (requestError) {
      pushError(apiErrorMessage(requestError, 'Failed to move account stage'), 'Something went wrong');
    } finally {
      setMovingStage(false);
    }
  }

  async function moveStageOverride(body) {
    if (!overrideTarget) return;
    setMovingStage(true);
    try {
      const { data } = await apiClient.post(`/accounts/${overrideTarget.id}/stage/override`, body);
      setOverrideTarget(null);
      setPeek(data.data || overrideTarget);
      reload();
    } catch (requestError) {
      pushError(apiErrorMessage(requestError, 'Failed to override account stage'), 'Something went wrong');
    } finally {
      setMovingStage(false);
    }
  }

  const columns = useMemo(
    () => [
      {
        key: 'account',
        header: 'Account',
        render: (row) => (
          <div className="flex items-start gap-2.5">
            <span
              className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${accountAccent(row.id).dot}`}
              aria-hidden="true"
              title="Account color"
            />
            <div className="min-w-0 leading-snug">
              <div className="text-sm font-medium text-primary-600">{accountKey(row.id)}</div>
              <div className="font-semibold text-tertiary-900">{row.name}</div>
              {row.poc_name && <div className="text-xs text-tertiary-500">{row.poc_name}</div>}
            </div>
          </div>
        ),
      },
      { key: 'type', header: 'Type', render: (row) => <span className="capitalize text-tertiary-700">{row.type || 'Unclassified'}</span> },
      { key: 'industry', header: 'Industry', render: (row) => row.industry || '—' },
      {
        key: 'specialization',
        header: 'Specialization',
        render: (row) => {
          if (row.type !== 'vendor') return '—';
          const tags = row.vendor_specializations || [];
          if (tags.length === 0) return '—';
          return (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span key={tag} className="rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700">
                  {tag}
                </span>
              ))}
            </div>
          );
        },
      },
      { key: 'stage', header: 'Stage', render: (row) => <Badge value={row.stage} /> },
      {
        key: 'owner',
        header: 'Owner',
        render: (row) => row.owner?.name || '—',
      },
      {
        key: 'origin_owner',
        header: 'Brought by',
        render: (row) => row.origin_owner?.name || '—',
      },
      {
        key: 'created',
        header: 'Created',
        render: (row) => new Date(row.created_at).toLocaleDateString(),
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
      {canCreateAccount(user) && (
        <div className="flex justify-end">
          <button type="button" className="btn-primary shrink-0" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Create account
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <div className="border-b border-tertiary-100 px-4 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
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
                  placeholder="Search name or contact"
                  className="w-56 rounded-l-lg border border-tertiary-100 bg-canvas-muted px-3 py-1.5 text-sm text-tertiary-800 placeholder:text-tertiary-400 focus:border-primary-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
                />
                <button
                  type="submit"
                  className="rounded-r-lg border border-l-0 border-tertiary-100 bg-[#EEF5FC] px-3 py-1.5 text-xs font-semibold text-[#105AA9] transition-colors hover:bg-[#D8E8F6]"
                >
                  Search
                </button>
              </form>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={type}
                onChange={(event) => {
                  setPage(1);
                  setType(event.target.value);
                }}
                className="rounded-lg border border-tertiary-100 bg-white px-3 py-1.5 text-sm text-tertiary-700 shadow-soft"
              >
                <option value="">Type: All</option>
                <option value="client">Client</option>
                <option value="vendor">Vendor</option>
                <option value="unclassified">Unclassified</option>
              </select>
              <SearchableSelect
                className="w-44"
                allowClear
                value={stage}
                onChange={(next) => {
                  setPage(1);
                  setStage(next);
                }}
                placeholder="Stage: All"
                searchPlaceholder="Search stage…"
                options={[
                  { value: 'lead', label: 'Lead' },
                  { value: 'meeting_scheduled', label: 'Meeting scheduled' },
                  { value: 'active', label: 'Active' },
                  { value: 'rescheduled', label: 'Rescheduled' },
                  { value: 'dropped', label: 'Dropped' },
                ]}
              />
              <SearchableSelect
                className="w-48"
                allowClear
                ariaLabel="Filter by vendor specialization"
                value={specialization}
                onChange={(next) => {
                  setPage(1);
                  setSpecialization(next);
                }}
                placeholder="Specialization: All"
                searchPlaceholder="Search specialization…"
                options={specializationOptions}
              />
              <SearchableSelect
                className="w-44"
                allowClear
                ariaLabel="Filter by owner"
                value={ownerId}
                onChange={(next) => {
                  setPage(1);
                  setOwnerId(next);
                }}
                placeholder="Owner: All"
                searchPlaceholder="Search people…"
                options={people}
              />
              <SearchableSelect
                className="w-44"
                allowClear
                ariaLabel="Filter by brought by"
                value={broughtById}
                onChange={(next) => {
                  setPage(1);
                  setBroughtById(next);
                }}
                placeholder="Brought by: All"
                searchPlaceholder="Search people…"
                options={people}
              />
              {hasActiveFilters && (
                <button type="button" className="btn-secondary px-2.5 py-1.5 text-xs" onClick={clearAllFilters}>
                  <X className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                  Clear all filters
                </button>
              )}
            </div>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          emptyLabel="No accounts match these filters."
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

      <Drawer open={Boolean(peek)} title={peek?.name || 'Account'} onClose={() => setPeek(null)} size="md" tone="info">
        {peek && (
          <AccountPeek
            row={peek}
            onClose={() => setPeek(null)}
            onChanged={reload}
            onRequestStageMove={(account) => {
              setStageTarget(account);
            }}
            onRequestStageOverride={(account) => {
              setOverrideTarget(account);
            }}
          />
        )}
      </Drawer>

      <AccountStageMoveDrawer
        account={stageTarget}
        open={Boolean(stageTarget)}
        saving={movingStage}
        onClose={() => setStageTarget(null)}
        onMove={moveStage}
      />

      <AccountStageOverrideDrawer
        account={overrideTarget}
        open={Boolean(overrideTarget)}
        saving={movingStage}
        onClose={() => setOverrideTarget(null)}
        onMove={moveStageOverride}
      />

      <Drawer open={createOpen} title="Create client or vendor" onClose={closeCreate} size="xl" tone="create">
        {createOpen && (
          <AccountFormPage
            asPanel
            onCancel={closeCreate}
            onDone={(newId) => {
              closeCreate();
              reload();
              if (newId) setPeek({ id: newId, name: 'Account' });
            }}
          />
        )}
      </Drawer>
    </div>
  );
}
