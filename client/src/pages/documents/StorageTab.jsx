import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { allowed, isAdminUser } from '../../lib/access.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { confirmAction } from '../../lib/confirmAction.js';

const fmt = (b) => {
  const n = Number(b || 0);
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(n / 1024))} KB`;
};
const LEVEL = { ok: ['border-green-200 bg-green-50/40', 'bg-green-500', 'Enough space'], warning: ['border-amber-200 bg-amber-50/50', 'bg-amber-500', 'Space is getting low'], critical: ['border-danger-200 bg-danger-50/40', 'bg-danger-500', 'Almost full: uploads are blocked'] };

/** Documents > Storage: how much room documents take, what can be cleaned up safely, and the rules that keep the disk from filling. */
export default function StorageTab() {
  const { user } = useAuth();
  const { pushError, pushSuccess } = useAlerts();
  const canManage = allowed(user, 'documents.manage', isAdminUser(user));
  const [info, setInfo] = useState(null);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const load = useCallback((fresh = false) => apiClient.get('/document-centre/storage', { params: fresh ? { fresh: 1 } : {} }).then(({ data }) => setInfo(data.data)).catch((err) => pushError(apiErrorMessage(err, 'Could not load the storage'), 'Something went wrong')), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  async function cleanup() {
    if (!await confirmAction(`Remove the unsigned originals of documents that were signed, declined or cancelled more than ${days} days ago? The signed copies stay.`)) return;
    setBusy(true);
    try {
      const { data } = await apiClient.post('/document-centre/cleanup', { days });
      pushSuccess(data.data.files ? `${data.data.files} file${data.data.files === 1 ? '' : 's'} removed, ${fmt(data.data.bytes)} freed` : 'Nothing to remove');
      load(true);
    } catch (err) { pushError(apiErrorMessage(err, 'Could not clean up'), 'Not cleaned'); } finally { setBusy(false); }
  }

  if (!info) return <p className="py-10 text-center text-sm text-tertiary-500">Loading…</p>;
  const disk = info.disk;
  const [tone, bar, levelText] = LEVEL[disk?.level] || LEVEL.ok;
  const usedPct = disk?.available && disk.total_bytes ? Math.min(100, Math.round((disk.used_bytes / disk.total_bytes) * 100)) : null;
  return (
    <div className="space-y-4" data-testid="documents-storage">
      {disk?.available && (
        <section className={`rounded-2xl border p-4 ${tone}`} data-testid="disk-meter">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-heading text-sm font-semibold text-tertiary-900">Server disk</h3><span className="text-xs font-medium text-tertiary-700">{levelText}</span></div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white"><div className={`h-full ${bar}`} style={{ width: `${usedPct}%` }} /></div>
          <p className="mt-1 text-xs text-tertiary-600">{fmt(disk.used_bytes)} used of {fmt(disk.total_bytes)} · {fmt(disk.free_bytes)} free ({disk.free_percent}%)</p>
        </section>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card"><p className="text-xs text-tertiary-500">All uploaded files</p><p className="font-heading text-xl font-semibold">{fmt(info.uploads.total_bytes)}</p><p className="text-[11px] text-tertiary-500">{info.uploads.total_files} files</p></div>
        <div className="rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card"><p className="text-xs text-tertiary-500">Documents for signing</p><p className="font-heading text-xl font-semibold" data-testid="signing-bytes">{fmt(info.signing.bytes)}</p><p className="text-[11px] text-tertiary-500">{info.signing.requests} requests, {info.signing.pending} waiting</p></div>
        <div className="rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card"><p className="text-xs text-tertiary-500">Can be cleaned up now</p><p className="font-heading text-xl font-semibold" data-testid="cleanup-bytes">{fmt(info.cleanup.bytes)}</p><p className="text-[11px] text-tertiary-500">{info.cleanup.files} unsigned originals older than {info.cleanup.older_than_days} days</p></div>
      </div>
      <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">How storage is kept under control</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-tertiary-700">
          <li>A document to sign must be a PDF of at most {info.rules.max_pdf_mb} MB. Other uploads are limited to 10 MB.</li>
          <li>The signed copy is always kept. Only the unsigned original of a finished request is removed by the clean-up.</li>
          <li>New uploads are stopped when {info.rules.upload_blocked_when}, so the server never runs out of space during work.</li>
          <li>Documents already attached to a client, vendor or employee are never touched by the clean-up.</li>
        </ul>
        {canManage && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-xs text-tertiary-600">Older than
              <select className="ml-2 rounded-xl border border-tertiary-200 px-2 py-1 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Older than days"><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select>
            </label>
            <button type="button" className="btn-secondary" disabled={busy} onClick={cleanup} data-testid="run-cleanup">{busy ? 'Cleaning…' : 'Free up space'}</button>
          </div>
        )}
      </section>
    </div>
  );
}
