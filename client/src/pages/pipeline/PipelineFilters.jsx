import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Filter, X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import MultiSelectDropdown from '../../components/ui/MultiSelectDropdown.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import {
  applyFiltersToSearchParams,
  emptyPipelineFilters,
  filtersFromSearchParams,
  filtersToApiParams,
} from './usePipelineFilters.js';

const STATUS_OPTIONS = [
  { id: 'open', label: 'Open' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'on_hold', label: 'On hold' },
  { id: 'closed', label: 'Closed' },
  { id: 'dropped', label: 'Dropped' },
];

const PRIORITY_OPTIONS = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'urgent', label: 'Urgent' },
];

// Profile.source values; labels match the Badge (direct = Bench, linkedin = Market).
const PROFILE_SOURCE_OPTIONS = [
  { id: 'linkedin', label: 'Market' },
  { id: 'vendor', label: 'Vendor' },
  { id: 'direct', label: 'Bench' },
];

const REQ_TYPE_OPTIONS = [
  { id: 'managed_services', label: 'Managed Services' },
  { id: 'recruitment', label: 'Recruitment' },
  { id: 'project', label: 'Project' },
];

const STAGE_OPTIONS = [
  { id: 'sourced', label: 'Sourced' },
  { id: 'internal_screening', label: 'Internal screening' },
  { id: 'submitted_to_client', label: 'Submitted to client' },
  { id: 'interview_scheduled', label: 'Interview scheduled' },
  { id: 'interview_result', label: 'Interview result' },
  { id: 'offer_sent', label: 'Offer sent' },
  { id: 'bgv', label: 'BGV' },
  { id: 'closed', label: 'Closed' },
  { id: 'backout', label: 'Backout' },
  { id: 'rejected', label: 'Rejected' },
];

/**
 * Shared pipeline filter bar. Controlled through URL search params.
 *
 * Args:
 *   fields: string[] of filter keys to show for the current board.
 *   onChange: optional callback receiving API params when filters change.
 */
export default function PipelineFilters({
  fields = ['search', 'stuck', 'past_sla_only', 'status', 'sales_id', 'bda_id', 'admin_id', 'recruiter_id', 'account_id'],
  onChange,
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);
  const [draftSearch, setDraftSearch] = useState(filters.search);
  const [accounts, setAccounts] = useState([]);
  const [bdas, setBdas] = useState([]);
  const [salesUsers, setSalesUsers] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [recruiters, setRecruiters] = useState([]);
  const lastApiParamsKey = useRef('');

  // Content key so inline fields={[...]} from parents does not retrigger fetches every render.
  const fieldsKey = Array.isArray(fields) ? fields.join(',') : '';
  const fieldList = useMemo(() => (fieldsKey ? fieldsKey.split(',') : []), [fieldsKey]);
  const fieldSet = useMemo(() => new Set(fieldList), [fieldList]);
  const apiParams = useMemo(() => filtersToApiParams(filters, fieldList), [filters, fieldList]);

  useEffect(() => {
    setDraftSearch(filters.search);
  }, [filters.search]);

  useEffect(() => {
    const key = JSON.stringify(apiParams);
    if (key === lastApiParamsKey.current) return;
    lastApiParamsKey.current = key;
    onChange?.(apiParams);
  }, [apiParams, onChange]);

  useEffect(() => {
    let cancelled = false;
    if (fieldSet.has('account_id') || fieldSet.has('account_ids')) {
      apiClient
        .get('/accounts', { params: { type: 'client', limit: 100, sort_by: 'name', sort_order: 'asc' } })
        .then(({ data }) => {
          if (!cancelled) setAccounts((data.data || []).map((row) => ({ id: row.id, label: row.name })));
        })
        .catch(() => {
          if (!cancelled) setAccounts([]);
        });
    }
    if (fieldSet.has('bda_id')) {
      apiClient
        .get('/users/directory', { params: { role: 'bda' } })
        .then(({ data }) => {
          if (!cancelled) setBdas((data.data || []).map((row) => ({ id: row.id, label: row.name })));
        })
        .catch(() => {
          if (!cancelled) setBdas([]);
        });
    }
    if (fieldSet.has('sales_id')) {
      apiClient
        .get('/users/directory', { params: { role: 'sales' } })
        .then(({ data }) => {
          if (!cancelled) setSalesUsers((data.data || []).map((row) => ({ id: row.id, label: row.name })));
        })
        .catch(() => {
          if (!cancelled) setSalesUsers([]);
        });
    }
    if (fieldSet.has('admin_id')) {
      apiClient
        .get('/users/directory', { params: { role: 'admin' } })
        .then(({ data }) => {
          if (!cancelled) setAdmins((data.data || []).map((row) => ({ id: row.id, label: row.name })));
        })
        .catch(() => {
          if (!cancelled) setAdmins([]);
        });
    }
    if (fieldSet.has('recruiter_id') || fieldSet.has('recruiter_ids') || fieldSet.has('submitted_by_ids')) {
      apiClient
        .get('/users/directory', { params: { role: 'recruiter' } })
        .then(({ data }) => {
          if (!cancelled) setRecruiters((data.data || []).map((row) => ({ id: row.id, label: row.name })));
        })
        .catch(() => {
          if (!cancelled) setRecruiters([]);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [fieldsKey, fieldSet]);

  function patchFilters(patch) {
    const nextFilters = { ...filters, ...patch };
    setSearchParams(applyFiltersToSearchParams(searchParams, nextFilters), { replace: true });
  }

  function clearFilters() {
    setDraftSearch('');
    setSearchParams(applyFiltersToSearchParams(searchParams, emptyPipelineFilters()), { replace: true });
  }

  const hasActiveFilters = Object.keys(apiParams).length > 0 || Boolean(draftSearch.trim());

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-tertiary-100 bg-canvas-muted px-3 py-1.5 text-xs font-medium text-tertiary-700">
        <Filter className="h-3.5 w-3.5" />
        Filters
      </span>

      {fieldSet.has('search') && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            patchFilters({ search: draftSearch.trim() });
          }}
          className="flex"
        >
          <input
            value={draftSearch}
            onChange={(event) => setDraftSearch(event.target.value)}
            placeholder="Search…"
            className="w-56 rounded-l-lg border border-tertiary-100 bg-canvas-muted px-3 py-1.5 text-sm text-tertiary-800 placeholder:text-tertiary-400 focus:border-primary-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
          />
          <button
            type="submit"
            className="rounded-r-lg border border-l-0 border-tertiary-100 bg-[#EEF5FC] px-3 py-1.5 text-xs font-semibold text-[#105AA9] transition-colors hover:bg-[#D8E8F6]"
          >
            Search
          </button>
        </form>
      )}

      {fieldSet.has('account_id') && (
        <SearchableSelect
          className="w-48"
          allowClear
          ariaLabel="Client"
          value={filters.account_id}
          onChange={(account_id) => patchFilters({ account_id })}
          placeholder="All clients"
          searchPlaceholder="Search clients…"
          options={accounts.map((account) => ({ value: account.id, label: account.label }))}
        />
      )}

      {fieldSet.has('account_ids') && (
        <div className="min-w-[200px]">
          <MultiSelectDropdown
            value={filters.account_ids}
            onChange={(account_ids) => patchFilters({ account_ids })}
            options={accounts}
            placeholder="Clients…"
            searchPlaceholder="Search clients…"
          />
        </div>
      )}

      {fieldSet.has('profile_source') && (
        <div className="min-w-[180px]">
          <MultiSelectDropdown
            value={filters.profile_source}
            onChange={(profile_source) => patchFilters({ profile_source })}
            options={PROFILE_SOURCE_OPTIONS}
            placeholder="Candidate source…"
            searchPlaceholder="Search source…"
          />
        </div>
      )}

      {fieldSet.has('req_type') && (
        <div className="min-w-[180px]">
          <MultiSelectDropdown
            value={filters.req_type}
            onChange={(req_type) => patchFilters({ req_type })}
            options={REQ_TYPE_OPTIONS}
            placeholder="Type…"
            searchPlaceholder="Search type…"
          />
        </div>
      )}

      {fieldSet.has('bda_id') && (
        <SearchableSelect
          className="w-44"
          allowClear
          ariaLabel="BDA"
          value={filters.bda_id}
          onChange={(bda_id) => patchFilters({ bda_id })}
          placeholder="All BDAs"
          searchPlaceholder="Search BDAs…"
          options={bdas.map((user) => ({ value: user.id, label: user.label }))}
        />
      )}

      {fieldSet.has('sales_id') && (
        <SearchableSelect
          className="w-44"
          allowClear
          ariaLabel="Sales"
          value={filters.sales_id}
          onChange={(sales_id) => patchFilters({ sales_id })}
          placeholder="All sales"
          searchPlaceholder="Search sales…"
          options={salesUsers.map((user) => ({ value: user.id, label: user.label }))}
        />
      )}

      {fieldSet.has('admin_id') && (
        <SearchableSelect
          className="w-44"
          allowClear
          ariaLabel="Admin"
          value={filters.admin_id}
          onChange={(admin_id) => patchFilters({ admin_id })}
          placeholder="All admins"
          searchPlaceholder="Search admins…"
          options={admins.map((user) => ({ value: user.id, label: user.label }))}
        />
      )}

      {fieldSet.has('recruiter_id') && (
        <SearchableSelect
          className="w-44"
          allowClear
          ariaLabel="Recruiter"
          value={filters.recruiter_id}
          onChange={(recruiter_id) => patchFilters({ recruiter_id })}
          placeholder="All recruiters"
          searchPlaceholder="Search recruiters…"
          options={recruiters.map((user) => ({ value: user.id, label: user.label }))}
        />
      )}

      {fieldSet.has('recruiter_ids') && (
        <div className="min-w-[200px]">
          <MultiSelectDropdown
            value={filters.recruiter_ids}
            onChange={(recruiter_ids) => patchFilters({ recruiter_ids })}
            options={recruiters.map((user) => ({ id: user.id, label: user.label }))}
            placeholder="Assigned recruiters…"
            searchPlaceholder="Search recruiters…"
          />
        </div>
      )}

      {fieldSet.has('submitted_by_ids') && (
        <div className="min-w-[200px]">
          <MultiSelectDropdown
            value={filters.submitted_by_ids}
            onChange={(submitted_by_ids) => patchFilters({ submitted_by_ids })}
            options={recruiters.map((user) => ({ id: user.id, label: user.label }))}
            placeholder="Submitted by…"
            searchPlaceholder="Search recruiters…"
          />
        </div>
      )}

      {fieldSet.has('status') && (
        <div className="min-w-[180px]">
          <MultiSelectDropdown
            value={filters.status}
            onChange={(status) => patchFilters({ status })}
            options={STATUS_OPTIONS}
            placeholder="Statuses…"
            searchPlaceholder="Search status…"
          />
        </div>
      )}

      {fieldSet.has('priority') && (
        <div className="min-w-[160px]">
          <MultiSelectDropdown
            value={filters.priority}
            onChange={(priority) => patchFilters({ priority })}
            options={PRIORITY_OPTIONS}
            placeholder="Priority…"
            searchPlaceholder="Search priority…"
          />
        </div>
      )}

      {fieldSet.has('submission_stage') && (
        <div className="min-w-[200px]">
          <MultiSelectDropdown
            value={filters.submission_stage}
            onChange={(submission_stage) => patchFilters({ submission_stage })}
            options={STAGE_OPTIONS}
            placeholder="Candidate stages…"
            searchPlaceholder="Search stage…"
          />
        </div>
      )}

      {fieldSet.has('date_range') && (
        <label className="flex shrink-0 items-center gap-1.5 rounded-lg border border-tertiary-100 bg-white px-2.5 py-1 text-xs text-tertiary-600 shadow-soft">
          Created
          <input
            type="date"
            value={filters.date_from}
            max={filters.date_to || undefined}
            onChange={(event) => patchFilters({ date_from: event.target.value })}
            className="rounded border border-tertiary-100 px-1.5 py-0.5 text-xs text-tertiary-800"
            aria-label="Created from"
          />
          <span>–</span>
          <input
            type="date"
            value={filters.date_to}
            min={filters.date_from || undefined}
            onChange={(event) => patchFilters({ date_to: event.target.value })}
            className="rounded border border-tertiary-100 px-1.5 py-0.5 text-xs text-tertiary-800"
            aria-label="Created to"
          />
        </label>
      )}

      {fieldSet.has('stuck') && (
        <select
          value={filters.stuck}
          onChange={(event) => patchFilters({ stuck: event.target.value })}
          className="rounded-lg border border-tertiary-100 bg-white px-3 py-1.5 text-sm text-tertiary-700 shadow-soft"
          aria-label="Stuck"
        >
          <option value="all">Stuck: All</option>
          <option value="stuck">Stuck only</option>
          <option value="not_stuck">Not stuck</option>
        </select>
      )}

      {fieldSet.has('past_sla_only') && (
        <label className="flex shrink-0 items-center gap-1.5 rounded-lg border border-tertiary-100 bg-white px-3 py-1.5 text-sm text-tertiary-700 shadow-soft">
          <input
            type="checkbox"
            checked={filters.past_sla_only}
            onChange={(event) => patchFilters({ past_sla_only: event.target.checked })}
          />
          Past SLA
        </label>
      )}

      {hasActiveFilters && (
        <button type="button" className="btn-secondary px-2.5 py-1.5 text-xs" onClick={clearFilters}>
          <X className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
          Clear all filters
        </button>
      )}
    </div>
  );
}
