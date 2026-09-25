/**
 * Encode and decode shared pipeline filter state from URL search params.
 */

const FILTER_KEYS = [
  'search',
  'account_id',
  'account_ids',
  'profile_source',
  'req_type',
  'bda_id',
  'sales_id',
  'admin_id',
  'recruiter_id',
  'recruiter_ids',
  'submitted_by_ids',
  'status',
  'priority',
  'submission_stage',
  'stuck',
  'past_sla_only',
  'date_from',
  'date_to',
];

export function emptyPipelineFilters() {
  return {
    search: '',
    account_id: '',
    account_ids: [],
    profile_source: [],
    req_type: [],
    bda_id: '',
    sales_id: '',
    admin_id: '',
    recruiter_id: '',
    recruiter_ids: [],
    submitted_by_ids: [],
    status: [],
    priority: [],
    submission_stage: [],
    stuck: 'all',
    past_sla_only: false,
    date_from: '',
    date_to: '',
  };
}

export function filtersFromSearchParams(searchParams) {
  const next = emptyPipelineFilters();
  next.search = searchParams.get('search') || '';
  next.account_id = searchParams.get('account_id') || '';
  next.account_ids = csvToList(searchParams.get('account_ids'));
  next.profile_source = csvToList(searchParams.get('profile_source'));
  next.req_type = csvToList(searchParams.get('req_type'));
  next.bda_id = searchParams.get('bda_id') || '';
  next.sales_id = searchParams.get('sales_id') || '';
  next.admin_id = searchParams.get('admin_id') || '';
  next.recruiter_id = searchParams.get('recruiter_id') || '';
  next.recruiter_ids = csvToList(searchParams.get('recruiter_ids'));
  next.submitted_by_ids = csvToList(searchParams.get('submitted_by_ids'));
  next.status = csvToList(searchParams.get('status'));
  next.priority = csvToList(searchParams.get('priority'));
  next.submission_stage = csvToList(searchParams.get('submission_stage'));
  next.stuck = searchParams.get('stuck') || 'all';
  next.past_sla_only = searchParams.get('past_sla_only') === 'true';
  next.date_from = searchParams.get('date_from') || '';
  next.date_to = searchParams.get('date_to') || '';
  return next;
}

export function applyFiltersToSearchParams(searchParams, filters) {
  const next = new URLSearchParams(searchParams);
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (key === 'stuck') {
      if (value && value !== 'all') next.set(key, value);
      else next.delete(key);
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length) next.set(key, value.join(','));
      else next.delete(key);
      continue;
    }
    if (typeof value === 'boolean') {
      if (value) next.set(key, 'true');
      else next.delete(key);
      continue;
    }
    if (value) next.set(key, String(value));
    else next.delete(key);
  }
  return next;
}

export function filtersToApiParams(filters, fields = null) {
  const allowed = fields ? new Set(fields) : null;
  const params = {};
  const include = (key) => !allowed || allowed.has(key);

  if (include('search') && filters.search?.trim()) params.search = filters.search.trim();
  if (include('account_id') && filters.account_id) params.account_id = filters.account_id;
  if (include('account_ids') && filters.account_ids?.length) params.account_ids = filters.account_ids.join(',');
  if (include('profile_source') && filters.profile_source?.length) params.profile_source = filters.profile_source.join(',');
  if (include('req_type') && filters.req_type?.length) params.req_type = filters.req_type.join(',');
  if (include('bda_id') && filters.bda_id) params.bda_id = filters.bda_id;
  if (include('sales_id') && filters.sales_id) params.sales_id = filters.sales_id;
  if (include('admin_id') && filters.admin_id) params.admin_id = filters.admin_id;
  if (include('recruiter_id') && filters.recruiter_id) params.recruiter_id = filters.recruiter_id;
  if (include('recruiter_ids') && filters.recruiter_ids?.length) {
    params.recruiter_ids = filters.recruiter_ids.join(',');
  }
  if (include('submitted_by_ids') && filters.submitted_by_ids?.length) {
    params.submitted_by_ids = filters.submitted_by_ids.join(',');
  }
  if (include('status') && filters.status?.length) params.status = filters.status.join(',');
  if (include('priority') && filters.priority?.length) params.priority = filters.priority.join(',');
  if (include('submission_stage') && filters.submission_stage?.length) {
    params.submission_stage = filters.submission_stage.join(',');
  }
  if (include('stuck') && filters.stuck && filters.stuck !== 'all') params.stuck = filters.stuck;
  if (include('past_sla_only') && filters.past_sla_only) params.past_sla_only = 'true';
  if (include('date_range') && filters.date_from) params.date_from = filters.date_from;
  if (include('date_range') && filters.date_to) params.date_to = filters.date_to;
  return params;
}

function csvToList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}
