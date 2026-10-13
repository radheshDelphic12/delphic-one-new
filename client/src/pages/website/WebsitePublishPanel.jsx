import { useState } from 'react';
import { Globe } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { dateLabel } from '../../lib/format.js';
import FormDrawer from '../../components/ui/FormDrawer.jsx';
import Pill from '../../components/ui/Pill.jsx';

export const POSTING_FIELDS = [
  { name: 'title', label: 'Job title on the website', required: true },
  { name: 'department', label: 'Department', half: true },
  { name: 'employment_type', label: 'Employment type', half: true, hint: 'e.g. Full-time, Contract' },
  { name: 'location', label: 'Location', hint: 'e.g. Gurugram · Hybrid' },
  { name: 'public_description', label: 'Public description', type: 'textarea', hint: 'Shown on /career. Never include client names, budget or billing.' },
];

const CLOSED = ['closed', 'dropped'];

export function PostingStatus({ posting }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Pill tone={posting.status === 'published' ? 'green' : 'gray'}>{posting.status === 'published' ? 'Live on website' : 'Closed on website'}</Pill>
      {posting.sync_error ? <Pill tone="red">Sync failed</Pill> : null}
    </span>
  );
}

/** Requirement page card: publish this requirement to the website's /career page. */
export default function WebsitePublishPanel({ requirementId, requirementStatus }) {
  const { pushError, pushSuccess } = useAlerts();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = useLiveData(() => apiClient.get('/website/status').then((r) => r.data.data));
  const configured = Boolean(status.data?.configured);
  const state = useLiveData(() => apiClient.get(`/website/postings/requirement/${requirementId}`).then((r) => r.data.data), {
    deps: [requirementId, requirementStatus, configured],
    enabled: configured,
  });

  if (!status.data) return null;

  const posting = state.data?.posting;
  const requirementClosed = CLOSED.includes(requirementStatus);

  async function save(values) {
    try {
      if (posting) await apiClient.patch(`/website/postings/${posting.id}`, values);
      else await apiClient.post('/website/postings', { ...values, requirement_id: requirementId });
      pushSuccess(posting ? 'Website posting updated' : 'Published to the website');
      state.refresh();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not publish'), 'Website');
      throw err;
    }
  }

  async function act(path, message) {
    setBusy(true);
    try {
      await apiClient.post(`/website/postings/${posting.id}/${path}`);
      pushSuccess(message);
      state.refresh();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Website update failed'), 'Website');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-tertiary-800"><Globe className="h-4 w-4" />Website careers page</h2>
          {!configured ? (
            <p className="mt-1 text-sm text-tertiary-500">Website control is not configured on this server.</p>
          ) : posting ? (
            <div className="mt-1 space-y-1 text-sm text-tertiary-600">
              <PostingStatus posting={posting} />
              <p>Listed as <span className="font-medium text-tertiary-800">{posting.title}</span>{posting.last_synced_at ? ` · synced ${dateLabel(posting.last_synced_at)}` : ''}</p>
              {posting.sync_error ? <p className="text-xs text-red-600">{posting.sync_error}</p> : null}
            </div>
          ) : (
            <p className="mt-1 text-sm text-tertiary-500">{requirementClosed ? 'Closed requirements cannot be published.' : 'Not on the website.'}</p>
          )}
        </div>
        {configured && state.data && (
          <div className="flex flex-wrap gap-2">
            {!posting && !requirementClosed && <button type="button" className="btn-primary" onClick={() => setEditing(true)}>Publish to website</button>}
            {posting && <button type="button" className="btn-secondary" disabled={busy} onClick={() => setEditing(true)}>Edit listing</button>}
            {posting?.sync_error && <button type="button" className="btn-secondary" disabled={busy} onClick={() => act('retry', 'Website synced')}>Retry sync</button>}
            {posting?.status === 'published' && <button type="button" className="btn-secondary" disabled={busy} onClick={() => act('close', 'Removed from the website')}>Close on website</button>}
            {posting?.status === 'closed' && !requirementClosed && <button type="button" className="btn-secondary" disabled={busy} onClick={() => act('reopen', 'Back on the website')}>Reopen</button>}
          </div>
        )}
      </div>
      <FormDrawer
        open={editing}
        onClose={() => setEditing(false)}
        title={posting ? 'Edit website listing' : 'Publish to website'}
        submitLabel={posting ? 'Save and sync' : 'Publish'}
        intro="Only these fields are sent to the website. Budget, billing and client details stay in the platform."
        fields={POSTING_FIELDS}
        initial={posting || state.data?.defaults}
        onSubmit={save}
        size="lg"
      />
    </section>
  );
}
