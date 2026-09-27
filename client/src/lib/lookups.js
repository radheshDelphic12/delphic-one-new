import { useEffect, useState } from 'react';
import apiClient from './apiClient.js';

/**
 * Tiny shared cache for the small reference lists that filter bars need
 * (user rosters, client/vendor accounts, requirement titles). Keyed by URL +
 * params so the same list is fetched once per session instead of on every
 * list-page mount. Not a full query cache — that lands with react-query on a
 * separate branch.
 */
const cache = new Map();

function fetchCached(url, params) {
  const key = `${url}?${new URLSearchParams(params).toString()}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      apiClient
        .get(url, { params })
        .then(({ data }) => data.data || [])
        .catch(() => {
          cache.delete(key);
          return [];
        })
    );
  }
  return cache.get(key);
}

function useLookup(url, params, enabled) {
  const [rows, setRows] = useState([]);
  const key = enabled ? `${url}?${new URLSearchParams(params).toString()}` : '';

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    fetchCached(url, params).then((data) => {
      if (alive) setRows(data);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return rows;
}

const toOptions = (rows) => rows.map((row) => ({ value: row.id, label: row.name }));

const toPeopleOptions = (rows) =>
  rows.map((row) => ({
    value: row.id,
    label: row.active === false ? `${row.name} (inactive)` : row.name,
    hint: row.role,
  }));

/**
 * Team-directory options. `/users/directory` is readable by every authenticated
 * user (unlike `/users`, which is admin/sales/bda-only and clamps sales to
 * recruiters) and includes inactive users, so filter bars and owner / brought-by
 * / POC pickers show the whole roster regardless of the viewer's role.
 *
 * Pass a `role` to narrow (e.g. an "Assigned recruiter" filter); omit it for
 * cross-role pickers like account owner / brought-by.
 */
export function useUserOptions(role, enabled = true) {
  const rows = useLookup('/users/directory', role ? { role } : {}, enabled);
  return toPeopleOptions(rows);
}

export function useAllUserOptions(enabled = true) {
  return useUserOptions(undefined, enabled);
}

export function useClientAccountOptions(enabled = true) {
  const rows = useLookup(
    '/accounts',
    { type: 'client', limit: 100, sort_by: 'name', sort_order: 'asc' },
    enabled
  );
  return toOptions(rows);
}

// Projects (active client accounts) for the pickers that used to list clients.
// Not routed through the session cache above: projects are added while the app
// is open (People -> Calendars -> Add Project), and a stale list would hide them.
export function useProjectOptions(enabled = true, refreshKey = 0) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    apiClient
      .get('/calendars/projects')
      .then(({ data }) => { if (alive) setRows(data.data || []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [enabled, refreshKey]);
  return rows.map((row) => ({ value: row.id, label: row.name, hint: row.client_name || undefined }));
}

// "meeting_scheduled" -> "Meeting scheduled"; lead is the default, so no hint.
function clientHint(row) {
  const parts = [];
  if (row.stage && row.stage !== 'lead') {
    const label = row.stage.replace(/_/g, ' ');
    parts.push(label.charAt(0).toUpperCase() + label.slice(1));
  }
  if (!row.type) parts.push('Unclassified');
  return parts.join(' · ') || undefined;
}

// Client-name picker for Add / Edit Project: this org's client accounts, any
// stage. Uncached for the same reason as projects — accounts are added while
// the app is open.
export function useLeadClientOptions(enabled = true) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    apiClient
      .get('/calendars/projects/client-options')
      .then(({ data }) => { if (alive) setRows(data.data || []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [enabled]);
  return rows.map((row) => ({ value: row.id, label: row.name, hint: clientHint(row) }));
}

export function useVendorAccountOptions(enabled = true) {
  const rows = useLookup(
    '/accounts',
    { type: 'vendor', limit: 100, sort_by: 'name', sort_order: 'asc' },
    enabled
  );
  return toOptions(rows);
}

export function useRequirementOptions(enabled = true) {
  const rows = useLookup(
    '/requirements',
    { limit: 100, sort_by: 'created_at', sort_order: 'desc' },
    enabled
  );
  return rows.map((row) => ({ value: row.id, label: row.title }));
}

/**
 * Active org-membership options (id is `org_membership_id`, not `user.id`) —
 * needed anywhere the API keys off the membership rather than the person
 * (salary structures, payroll runs). `/orgs/memberships` is admin-visible
 * only (requireOrgMembership, no role gate today, but only rendered from
 * admin-only screens), unlike the `/users/directory` roster used elsewhere.
 */
export function useOrgMembershipOptions(enabled = true) {
  const rows = useLookup('/orgs/memberships', {}, enabled);
  return rows.map((row) => ({ value: row.id, label: row.person?.name || 'Unknown', hint: row.employee_code || undefined }));
}
