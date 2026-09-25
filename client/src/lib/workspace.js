import apiClient from './apiClient';

/**
 * Workspace (tenant) helpers for the sign-in screen.
 *
 * A workspace is an Org's `slug`. It can come from, in priority order:
 *   1. `?workspace=acme`                     (shareable link)
 *   2. a subdomain, `acme.<VITE_TENANT_BASE_DOMAIN>`  (only when that env var is
 *      set — wildcard DNS must exist for this to matter, so it is off by default)
 *   3. the user typing / picking it.
 */

const RECENT_KEY = 'delphic_recent_workspaces';
const MAX_RECENT = 4;
const BASE_DOMAIN = (import.meta.env.VITE_TENANT_BASE_DOMAIN || '').toLowerCase();
const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'api', 'login', 'staging', 'admin']);

/** "https://Acme.delphic.one/x" -> "acme"; anything that isn't a valid slug fragment is dropped. */
export function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split(/[./:?#]/)[0]
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '');
}

export function detectWorkspaceSlug(loc = window.location) {
  const fromQuery = new URLSearchParams(loc.search).get('workspace');
  if (fromQuery) return normalizeSlug(fromQuery) || null;

  if (BASE_DOMAIN) {
    const host = loc.hostname.toLowerCase();
    if (host.endsWith(`.${BASE_DOMAIN}`)) {
      const sub = host.slice(0, -(BASE_DOMAIN.length + 1));
      if (sub && !sub.includes('.') && !RESERVED_SUBDOMAINS.has(sub)) return sub;
    }
  }
  return null;
}

/** The suffix shown after the input, e.g. ".delphic.one" (empty when no base domain is configured). */
export const workspaceDomainSuffix = BASE_DOMAIN ? `.${BASE_DOMAIN}` : '';

/** Public branding lookup — resolves to { name, slug, logo_url } or throws (404 = unknown workspace). */
export async function resolveWorkspace(slug) {
  const { data } = await apiClient.get(`/auth/workspace/${encodeURIComponent(slug)}`);
  return data.data;
}

export function getRecentWorkspaces() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((w) => w && w.slug && w.name) : [];
  } catch {
    return [];
  }
}

export function rememberWorkspace(workspace) {
  if (!workspace?.slug) return;
  const entry = { slug: workspace.slug, name: workspace.name, logo_url: workspace.logo_url || null };
  const next = [entry, ...getRecentWorkspaces().filter((w) => w.slug !== entry.slug)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked (private mode) — remembering workspaces is a convenience only.
  }
}

export function forgetWorkspace(slug) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(getRecentWorkspaces().filter((w) => w.slug !== slug)));
  } catch {
    // ignore, see rememberWorkspace
  }
}
