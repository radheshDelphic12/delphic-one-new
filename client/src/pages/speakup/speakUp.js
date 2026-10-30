import { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';

// Speak Up - Confidential Reporting (the API is /whistleblower). Shared helpers for the pages and the dashboard card.

export const STATUS_STYLE = {
  new: 'bg-blue-50 text-blue-700',
  in_review: 'bg-amber-50 text-amber-700',
  investigating: 'bg-violet-50 text-violet-700',
  action_taken: 'bg-cyan-50 text-cyan-700',
  closed: 'bg-green-50 text-green-700',
};
export const STATUS_OPTIONS = [['new', 'New'], ['in_review', 'In review'], ['investigating', 'Investigating'], ['action_taken', 'Action taken'], ['closed', 'Closed']];

export const MAX_FILES = 5;
export const FILE_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv';

export const dateTime = (v) => (v ? new Date(v).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const dayText = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
export const fileSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * An anonymous reporter follows a complaint without signing in, so these calls carry no token at all:
 * nothing in the request ties it to a person. `body` is a plain object or a FormData (when files are attached).
 */
export async function publicCall(path, body) {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(`/api/v1/public/whistleblower${path}`, { method: 'POST', headers: isForm ? undefined : { 'Content-Type': 'application/json' }, body: isForm ? body : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(json.message || 'Something went wrong');
    error.status = res.status;
    throw error;
  }
  return json.data;
}

/**
 * What the menu and the dashboard card need: is the module on, how many complaints are mine / waiting on me.
 * Only the master workspace has it, so nothing is asked anywhere else.
 */
export function useSpeakUpSummary(enabled = true, refreshKey = 0) {
  const [summary, setSummary] = useState(null);
  useEffect(() => {
    if (!enabled) { setSummary(null); return undefined; }
    let live = true;
    apiClient.get('/whistleblower/summary').then(({ data }) => { if (live) setSummary(data.data); }).catch(() => { if (live) setSummary(null); });
    return () => { live = false; };
  }, [enabled, refreshKey]);
  return summary;
}
