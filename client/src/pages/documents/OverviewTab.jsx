import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, HelpCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import apiClient, { downloadAuthenticatedFile } from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { allowed, isAdminUser } from '../../lib/access.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { confirmAction, promptAction } from '../../lib/confirmAction.js';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';

const KINDS = [['client', 'Clients'], ['vendor', 'Vendors'], ['employee', 'Employees']];
const ENTITY_TYPE = { client: 'account', vendor: 'account', employee: 'org_membership' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const label = 'block text-xs font-medium text-tertiary-600';
const inputCls = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm';

function Tile({ title, value, hint, tone = '' }) {
  return (
    <div className={`rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card ${tone}`}>
      <p className="text-xs text-tertiary-500">{title}</p>
      <p className="font-heading text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-tertiary-500">{hint}</p>}
    </div>
  );
}

/** Upload one missing document for one record, tagged with what it is (so it counts as on file). */
function UploadDrawer({ target, onClose, onDone }) {
  const { pushError, pushSuccess } = useAlerts();
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (target) { setFile(null); setName(`${target.docType}`); } }, [target]);
  async function submit(e) {
    e.preventDefault();
    if (!file) return;
    const body = new FormData();
    body.append('entity_type', ENTITY_TYPE[target.kind]);
    body.append('entity_id', target.id);
    body.append('label', name.trim() || target.docType);
    body.append('doc_type', target.docType);
    body.append('file', file);
    setBusy(true);
    try {
      await apiClient.post('/documents', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      pushSuccess(`${target.docType} added for ${target.entityName}`);
      onDone();
      onClose();
    } catch (err) { pushError(apiErrorMessage(err, 'Could not upload the document'), 'Not uploaded'); } finally { setBusy(false); }
  }
  return (
    <Drawer open={Boolean(target)} onClose={onClose} size="sm" tone="create" title={target ? `Upload ${target.docType}` : ''} footer={<><button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="doc-upload-form" className="btn-primary" disabled={busy || !file}>{busy ? 'Uploading…' : 'Upload'}</button></>}>
      <form id="doc-upload-form" onSubmit={submit} className="space-y-3" data-testid="doc-upload-form">
        <p className="text-sm text-tertiary-700">For <b>{target?.entityName}</b>. It will count as the <b>{target?.docType}</b> being on file.</p>
        <label className={label}>File (PDF, Word, image, up to 10 MB)<input type="file" className={inputCls} data-testid="doc-file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
        <label className={label}>Name of the file<input className={inputCls} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
      </form>
    </Drawer>
  );
}

/** Admin-editable: what must be on file for clients, vendors and employees. */
function RequirementsDrawer({ open, onClose, onChanged }) {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState({ client: '', vendor: '', employee: '' });
  const load = useCallback(() => apiClient.get('/document-centre/requirements').then(({ data }) => setRows(data.data || [])).catch(() => setRows([])), []);
  useEffect(() => { if (open) load(); }, [open, load]);
  const done = () => { load(); onChanged(); };
  async function add(kind) {
    const name = adding[kind].trim();
    if (!name) return;
    try { await apiClient.post('/document-centre/requirements', { kind, name }); setAdding((a) => ({ ...a, [kind]: '' })); done(); } catch (err) { pushError(apiErrorMessage(err, 'Could not add it'), 'Not added'); }
  }
  async function rename(r) {
    const name = await promptAction(`New name for "${r.name}":`, r.name);
    if (name === null || !name.trim() || name.trim() === r.name) return;
    try { await apiClient.patch(`/document-centre/requirements/${r.id}`, { name: name.trim() }); done(); } catch (err) { pushError(apiErrorMessage(err, 'Could not rename it'), 'Not renamed'); }
  }
  async function remove(r) {
    if (!await confirmAction(`Remove "${r.name}" from the list? Files already uploaded are kept.`)) return;
    try { await apiClient.delete(`/document-centre/requirements/${r.id}`); done(); } catch (err) { pushError(apiErrorMessage(err, 'Could not remove it'), 'Not removed'); }
  }
  return (
    <Drawer open={open} onClose={onClose} size="md" tone="edit" title="What must be on file" footer={<button type="button" className="btn-primary" onClick={onClose}>Done</button>}>
      <div className="space-y-5" data-testid="requirements-editor">
        <p className="text-xs text-tertiary-500">These are the documents the overview looks for. A record without one shows a ? until it is uploaded.</p>
        {KINDS.map(([kind, title]) => (
          <section key={kind}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">{title}</h3>
            <ul className="mt-2 divide-y divide-tertiary-100 rounded-xl border border-tertiary-100">
              {rows.filter((r) => r.kind === kind).map((r) => (
                <li key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>{r.name}</span>
                  <span className="flex gap-1">
                    <button type="button" aria-label={`Rename ${r.name}`} className="rounded p-1 text-tertiary-500 hover:bg-primary-50 hover:text-primary-700" onClick={() => rename(r)}><Pencil className="h-3.5 w-3.5" /></button>
                    <button type="button" aria-label={`Remove ${r.name}`} className="rounded p-1 text-tertiary-500 hover:bg-danger-50 hover:text-danger-600" onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5" /></button>
                  </span>
                </li>
              ))}
              {rows.filter((r) => r.kind === kind).length === 0 && <li className="px-3 py-2 text-xs text-tertiary-500">Nothing is required.</li>}
            </ul>
            <div className="mt-2 flex gap-2">
              <input className={`${inputCls} mt-0`} placeholder={`Add a document for ${title.toLowerCase()}`} aria-label={`Add for ${title}`} value={adding[kind]} maxLength={80} onChange={(e) => setAdding((a) => ({ ...a, [kind]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(kind); } }} />
              <button type="button" className="btn-secondary inline-flex items-center gap-1" onClick={() => add(kind)} disabled={!adding[kind].trim()}><Plus className="h-4 w-4" />Add</button>
            </div>
          </section>
        ))}
      </div>
    </Drawer>
  );
}

/** Documents > Overview: for every client, vendor and employee, is each required document on file? A ? means it is missing. */
export default function OverviewTab() {
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const admin = isAdminUser(user);
  const canUpload = allowed(user, 'documents.upload', admin);
  const canManage = allowed(user, 'documents.manage', admin);
  const now = new Date();
  const [kind, setKind] = useState('client');
  const [q, setQ] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [stage, setStage] = useState('active');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState(null);
  const [upload, setUpload] = useState(null);
  const [editReqs, setEditReqs] = useState(false);

  const load = useCallback(() => {
    apiClient.get('/document-centre/overview', { params: { kind, ...(q.trim() ? { q: q.trim() } : {}), missing_only: missingOnly, stage, month, year } })
      .then(({ data: res }) => setData(res.data))
      .catch((err) => { setData({ rows: [], requirements: [], summary: { total: 0, complete: 0, with_missing: 0, missing_items: 0 } }); pushError(apiErrorMessage(err, 'Could not load the documents'), 'Something went wrong'); });
  }, [kind, q, missingOnly, stage, month, year]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  const open = (doc) => {
    if (!doc?.url) return;
    if (/^https?:/i.test(doc.url)) { window.open(doc.url, '_blank', 'noopener'); return; }
    downloadAuthenticatedFile(doc.url, doc.label).catch((e) => pushError(apiErrorMessage(e, 'Could not open it'), 'Not opened'));
  };
  const s = data?.summary;
  return (
    <div className="space-y-4" data-testid="documents-overview">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card">
        <div className="inline-flex rounded-xl border border-tertiary-200 bg-white p-0.5" role="tablist" aria-label="Who">
          {KINDS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={kind === k} data-testid={`kind-${k}`} onClick={() => { setKind(k); setData(null); }} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${kind === k ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:text-tertiary-900'}`}>{l}</button>)}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className={label}>Search<input className={inputCls} style={{ width: '13rem' }} placeholder="Name" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          {kind !== 'employee' && <label className={label}>Show<select className={inputCls} value={stage} onChange={(e) => setStage(e.target.value)}><option value="active">Active only</option><option value="all">All stages</option></select></label>}
          {kind === 'vendor' && (
            <>
              <label className={label}>Invoices of<select className={inputCls} aria-label="Invoice month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
              <label className={label}>&nbsp;<select className={inputCls} aria-label="Invoice year" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
            </>
          )}
          <label className="flex items-center gap-2 pb-2 text-sm text-tertiary-700"><input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} data-testid="missing-only" />Only what is missing</label>
          {canManage && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" data-testid="edit-requirements" onClick={() => setEditReqs(true)}><Pencil className="h-4 w-4" />What must be on file</button>}
        </div>
      </div>

      {s && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="documents-summary">
          <Tile title={`${KINDS.find(([k]) => k === kind)[1]} listed`} value={s.total} />
          <Tile title="Everything on file" value={s.complete} tone={s.complete ? 'border-green-200 bg-green-50/40' : ''} />
          <Tile title="Something missing" value={s.with_missing} tone={s.with_missing ? 'border-amber-200 bg-amber-50/50' : ''} />
          <Tile title="Documents missing in all" value={s.missing_items} hint="Each ? below is one" />
        </div>
      )}

      {!data ? <p className="py-10 text-center text-sm text-tertiary-500">Loading…</p> : data.rows.length === 0 ? <EmptyState title="Nothing to show" description={missingOnly ? 'Nothing is missing here.' : 'No record matches.'} /> : (
        <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
          <table className="min-w-full text-sm">
            <thead className="bg-canvas-muted">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-tertiary-500">{kind === 'employee' ? 'Employee' : kind === 'vendor' ? 'Vendor' : 'Client'}</th>
                {data.requirements.map((r) => <th key={r} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-tertiary-500">{r}</th>)}
                {kind === 'vendor' && <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-tertiary-500">Invoices ({MONTHS[(data.month || month) - 1].slice(0, 3)} {data.year || year})</th>}
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-tertiary-500">Missing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-tertiary-100">
              {data.rows.map((row) => (
                <tr key={row.id} data-testid="doc-row" className={row.missing_count ? 'bg-amber-50/30' : ''}>
                  <td className="px-3 py-2"><span className="font-medium text-tertiary-900">{row.name}</span>{row.sub && <span className="block text-xs text-tertiary-500">{row.sub}</span>}</td>
                  {row.items.map((it) => (
                    <td key={it.name} className="px-3 py-2" data-testid={it.state === 'uploaded' ? 'doc-on-file' : 'doc-missing'}>
                      {it.state === 'uploaded' ? (
                        <button type="button" className="inline-flex items-center gap-1 text-xs text-green-700 hover:underline" title={it.document?.label} onClick={() => open(it.document)}><CheckCircle2 className="h-4 w-4" />On file{it.document?.uploaded_at ? ` · ${it.document.uploaded_at}` : ''}</button>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800" title="Not uploaded"><HelpCircle className="h-3.5 w-3.5" />?</span>
                          {canUpload && <button type="button" className="text-xs text-primary-700 hover:underline" onClick={() => setUpload({ kind, id: row.id, entityName: row.name, docType: it.name })}>Upload</button>}
                        </span>
                      )}
                    </td>
                  ))}
                  {kind === 'vendor' && (
                    <td className="px-3 py-2 text-xs" data-testid="vendor-invoices-cell">
                      {row.invoices.state === 'none' && <span className="text-tertiary-400">No invoice this month</span>}
                      {row.invoices.state === 'complete' && <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="h-4 w-4" />{row.invoices.with_file} of {row.invoices.total} uploaded</span>}
                      {row.invoices.state === 'missing' && <span className="inline-flex items-center gap-1.5"><span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800"><HelpCircle className="h-3.5 w-3.5" />?</span>{row.invoices.with_file} of {row.invoices.total} uploaded <span className="text-tertiary-500">(Finance &gt; Vendor Invoices &gt; Files)</span></span>}
                    </td>
                  )}
                  <td className="px-3 py-2 tabular-nums">{row.missing_count ? <span className="font-semibold text-amber-800">{row.missing_count}</span> : <span className="text-tertiary-400">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.truncated && <p className="border-t border-tertiary-100 px-3 py-2 text-xs text-tertiary-500">Only the first 400 are shown. Search by name to narrow it down.</p>}
        </div>
      )}
      <UploadDrawer target={upload} onClose={() => setUpload(null)} onDone={load} />
      <RequirementsDrawer open={editReqs} onClose={() => setEditReqs(false)} onChanged={load} />
    </div>
  );
}
