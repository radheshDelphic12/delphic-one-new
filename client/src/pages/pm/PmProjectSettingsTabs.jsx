import { useCallback, useEffect, useState } from 'react';
import { Copy, Plus, ShieldOff } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { pmApi, pmError } from '../../lib/pm/api.js';
import { dateLabel } from '../../lib/format.js';
import Pill from '../../components/ui/Pill.jsx';

const INPUT = 'rounded-xl border px-3 py-2 text-sm';
const Empty = ({ children }) => <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-tertiary-500">{children}</p>;
const TYPE_LABEL = { text: 'Text', number: 'Number', date: 'Date', select: 'Pick one' };

/** Project > Fields: extra fields this project's tickets carry (text / number / date / pick one). Managers only edit. */
export function FieldsTab({ project, reload }) {
  const { pushError, pushSuccess } = useAlerts();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ label: '', type: 'text', options: '', required: false });
  async function run(fn, ok) {
    setBusy(true);
    try { await fn(); pushSuccess(ok); await reload(); } catch (e) { pushError(pmError(e, 'Could not save'), 'Save failed'); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-tertiary-600">Extra fields for this project&apos;s tickets, for example Environment, Story points or Go-live date. A switched-off field stays on old tickets but is no longer asked for.</p>
      {project.fields.length === 0 ? <Empty>No custom fields yet.</Empty> : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full min-w-[34rem] text-sm" data-testid="pm-fields">
            <thead className="bg-primary-50/60 text-xs text-tertiary-500"><tr><th className="px-3 py-2 text-left font-medium">Name</th><th className="px-3 py-2 text-left font-medium">Type</th><th className="px-3 py-2 text-left font-medium">Options</th><th className="px-3 py-2 text-left font-medium">Required</th><th className="px-3 py-2 text-left font-medium">Active</th></tr></thead>
            <tbody>
              {project.fields.map((f) => (
                <tr key={f.id} className="border-t">
                  <td className="px-3 py-2"><input className={`${INPUT} w-44`} defaultValue={f.label} disabled={!project.can_manage || busy} onBlur={(e) => e.target.value.trim() && e.target.value !== f.label && run(() => pmApi.updateField(project.id, f.id, { label: e.target.value.trim() }), 'Renamed')} /><div className="mt-0.5 text-[11px] text-tertiary-400">{f.key}</div></td>
                  <td className="px-3 py-2">{TYPE_LABEL[f.type]}</td>
                  <td className="px-3 py-2">{f.type === 'select' ? <input className={`${INPUT} w-56`} defaultValue={(f.options || []).join(', ')} disabled={!project.can_manage || busy} onBlur={(e) => { const list = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); if (list.length && list.join(',') !== (f.options || []).join(',')) run(() => pmApi.updateField(project.id, f.id, { options: list }), 'Options saved'); }} /> : <span className="text-tertiary-400">-</span>}</td>
                  <td className="px-3 py-2"><input type="checkbox" checked={f.required} disabled={!project.can_manage || busy} onChange={(e) => run(() => pmApi.updateField(project.id, f.id, { required: e.target.checked }), 'Updated')} aria-label={`${f.label} required`} /></td>
                  <td className="px-3 py-2"><input type="checkbox" checked={f.is_active} disabled={!project.can_manage || busy} onChange={(e) => run(() => pmApi.updateField(project.id, f.id, { is_active: e.target.checked }), e.target.checked ? 'Switched on' : 'Switched off')} aria-label={`${f.label} active`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {project.can_manage && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { await pmApi.createField(project.id, { label: draft.label, type: draft.type, required: draft.required, ...(draft.type === 'select' ? { options: draft.options.split(',').map((x) => x.trim()).filter(Boolean) } : {}) }); setDraft({ label: '', type: 'text', options: '', required: false }); }, 'Field added'); }}>
          <label className="text-xs text-tertiary-500">Name<input className={`${INPUT} mt-1 block w-44`} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} required data-testid="pm-field-name" /></label>
          <label className="text-xs text-tertiary-500">Type
            <select className={`${INPUT} mt-1 block`} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} data-testid="pm-field-type">{Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          {draft.type === 'select' && <label className="text-xs text-tertiary-500">Options (comma separated)<input className={`${INPUT} mt-1 block w-56`} value={draft.options} onChange={(e) => setDraft({ ...draft, options: e.target.value })} required data-testid="pm-field-options" /></label>}
          <label className="flex items-center gap-1.5 pb-2 text-xs text-tertiary-600"><input type="checkbox" checked={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })} />Required</label>
          <button type="submit" className="btn-primary inline-flex items-center gap-1.5" disabled={busy}><Plus className="h-4 w-4" />Add field</button>
        </form>
      )}
    </div>
  );
}

/** Project > Sharing: a read-only link for a client or vendor. The link is shown once when it is created. */
export function SharingTab({ project }) {
  const { pushError, pushSuccess } = useAlerts();
  const [shares, setShares] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [draft, setDraft] = useState({ email: '', label: '', days: 30, can_comment: false });
  const load = useCallback(() => pmApi.shares(project.id).then(setShares).catch((e) => { pushError(pmError(e, 'Could not load the shared links'), 'Load failed'); setShares([]); }), [project.id, pushError]);
  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e.preventDefault();
    try {
      const expires = new Date(Date.now() + Number(draft.days) * 86400000).toISOString();
      const r = await pmApi.createShare(project.id, { email: draft.email, label: draft.label, expires_at: expires, can_comment: draft.can_comment });
      setFresh({ label: draft.label, url: `${window.location.origin}/guest-project#token=${r.token}` });
      setDraft({ email: '', label: '', days: 30, can_comment: false });
      await load();
    } catch (err) { pushError(pmError(err, 'Could not create the link'), 'Failed'); }
  }
  async function revoke(s) {
    if (!window.confirm(`Revoke the link for ${s.label}? They lose access immediately.`)) return;
    try { await pmApi.revokeShare(project.id, s.id); pushSuccess('Link revoked'); await load(); } catch (err) { pushError(pmError(err, 'Could not revoke'), 'Failed'); }
  }

  if (!project.can_manage) return <Empty>Only an admin or the project lead can share a project.</Empty>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-tertiary-600">Give a client or vendor a link to follow this project. They see its tickets (not assignees, internal comments, contracts or money), and can comment if you allow it. Tick &quot;Hide from shared links&quot; on a ticket to keep it out.</p>
      {fresh && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm" data-testid="pm-share-fresh">
          <div className="font-medium text-amber-900">Link for {fresh.label}. Copy it now, it is not shown again.</div>
          <div className="mt-2 flex items-center gap-2"><input readOnly className={`${INPUT} w-full bg-white`} value={fresh.url} onFocus={(e) => e.target.select()} /><button type="button" className="inline-flex items-center gap-1 rounded-xl border bg-white px-3 py-2 text-sm" onClick={() => { navigator.clipboard?.writeText(fresh.url); pushSuccess('Link copied'); }}><Copy className="h-4 w-4" />Copy</button></div>
        </div>
      )}
      <form className="flex flex-wrap items-end gap-2" onSubmit={create}>
        <label className="text-xs text-tertiary-500">Who is it for (name)<input className={`${INPUT} mt-1 block w-44`} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} required data-testid="pm-share-label" /></label>
        <label className="text-xs text-tertiary-500">Their email<input type="email" className={`${INPUT} mt-1 block w-56`} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} required data-testid="pm-share-email" /></label>
        <label className="text-xs text-tertiary-500">Valid for (days)<input type="number" min="1" max="365" className={`${INPUT} mt-1 block w-24`} value={draft.days} onChange={(e) => setDraft({ ...draft, days: e.target.value })} required /></label>
        <label className="flex items-center gap-1.5 pb-2 text-xs text-tertiary-600"><input type="checkbox" checked={draft.can_comment} onChange={(e) => setDraft({ ...draft, can_comment: e.target.checked })} data-testid="pm-share-comment" />They can comment</label>
        <button type="submit" className="btn-primary" data-testid="pm-share-create">Create link</button>
      </form>
      {shares === null ? null : shares.length === 0 ? <Empty>No links created yet.</Empty> : (
        <ul className="divide-y rounded-xl border bg-white" data-testid="pm-shares">
          {shares.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span><span className="font-medium">{s.label}</span> <span className="text-xs text-tertiary-500">{s.email}</span> {s.can_comment ? <Pill tone="blue">Can comment</Pill> : <Pill tone="gray">View only</Pill>} {s.active ? <Pill tone="green">Active</Pill> : <Pill tone="red">{s.revoked_at ? 'Revoked' : 'Expired'}</Pill>}</span>
              <span className="flex items-center gap-3 text-xs text-tertiary-500">{s.active ? `expires ${dateLabel(s.expires_at)}` : ''}{s.use_count ? ` · opened ${s.use_count}×` : ' · not opened yet'}{s.active && <button type="button" className="inline-flex items-center gap-1 text-danger-600 hover:underline" onClick={() => revoke(s)}><ShieldOff className="h-3.5 w-3.5" />Revoke</button>}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
