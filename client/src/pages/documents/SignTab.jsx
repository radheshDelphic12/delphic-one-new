import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { FileSignature, Plus, Upload } from 'lucide-react';
import apiClient, { downloadAuthenticatedFile } from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { allowed, isAdminUser } from '../../lib/access.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { confirmAction } from '../../lib/confirmAction.js';
import { useClientAccountOptions, useVendorAccountOptions, useOrgMembershipOptions } from '../../lib/lookups.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import SignaturePad from './SignaturePad.jsx';

const SigningStudio = lazy(() => import('./SigningStudio.jsx'));
const API = '/api/v1/document-centre';
const TAGS = [['client', 'Client'], ['vendor', 'Vendor'], ['employee', 'Employee'], ['invoice', 'Invoice'], ['other', 'Something else']];
const STATUS = { pending: ['amber', 'Waiting for signature'], signed: ['green', 'Signed'], declined: ['red', 'Not signed'], cancelled: ['gray', 'Cancelled'] };
const label = 'block text-xs font-medium text-tertiary-600';
const input = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm';
const size = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((b || 0) / 1024))} KB`);
const when = (d) => (d ? String(d).slice(0, 10) : '');

/** The company stamp (seal): uploaded once by whoever manages documents; signers drag it onto a document next to their signature. */
function StampCard({ stamp, reload, canManage }) {
  const { pushError, pushSuccess } = useAlerts();
  const [busy, setBusy] = useState(false);
  if (!canManage && !stamp?.has_stamp) return null;
  function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) { pushError('Use a PNG (best with a transparent background) or JPEG picture of the stamp', 'Not a picture'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      setBusy(true);
      try { await apiClient.put('/document-centre/stamp', { image: reader.result }); pushSuccess('Company stamp saved'); reload(); } catch (err) { pushError(apiErrorMessage(err, 'Could not save the stamp'), 'Not saved'); } finally { setBusy(false); }
    };
    reader.readAsDataURL(file);
  }
  async function remove() {
    if (!await confirmAction('Remove the company stamp? Documents can then be signed without it until a new one is added.')) return;
    try { await apiClient.delete('/document-centre/stamp'); reload(); } catch (err) { pushError(apiErrorMessage(err, 'Could not remove it'), 'Not removed'); }
  }
  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="stamp-card">
      <h3 className="font-heading text-sm font-semibold text-tertiary-900">Company stamp</h3>
      <p className="mt-0.5 text-xs text-tertiary-500">The company seal, placed on a document next to the signature while signing. Upload a clear PNG, ideally with a transparent background.</p>
      {stamp?.has_stamp ? <div className="mt-3 inline-block rounded-xl border border-tertiary-100 bg-canvas-muted p-3"><img src={stamp.image} alt="Company stamp" className="max-h-24" data-testid="company-stamp" /></div> : <p className="mt-2 text-sm text-tertiary-500">No stamp yet.</p>}
      {canManage && (
        <div className="mt-3 flex flex-wrap gap-2">
          <label className={`btn-secondary inline-flex cursor-pointer items-center gap-1.5 ${busy ? 'pointer-events-none opacity-60' : ''}`}><Upload className="h-4 w-4" />{stamp?.has_stamp ? 'Replace stamp' : 'Upload stamp'}<input type="file" accept="image/png,image/jpeg" className="hidden" onChange={pick} data-testid="stamp-file" /></label>
          {stamp?.has_stamp && <button type="button" className="btn-ghost text-xs text-danger-600" onClick={remove}>Remove</button>}
        </div>
      )}
      {stamp?.has_stamp && (
        <label className="mt-3 flex items-center gap-2 text-sm text-tertiary-700">
          <input
            type="checkbox"
            checked={stamp.on_invoices !== false}
            disabled={!canManage || busy}
            data-testid="stamp-on-invoices"
            onChange={async (e) => {
              setBusy(true);
              try { await apiClient.patch('/document-centre/stamp', { on_invoices: e.target.checked }); pushSuccess(e.target.checked ? 'The stamp now prints on invoices' : 'The stamp no longer prints on invoices'); reload(); } catch (err) { pushError(apiErrorMessage(err, 'Could not save'), 'Not saved'); } finally { setBusy(false); }
            }}
          />
          Also print it on our invoice PDFs (client invoices and Book Keeping invoices), next to the signature
        </label>
      )}
    </section>
  );
}

/** Your own signature: drawn or uploaded once, kept private, used only when you sign. */
function SignatureCard({ signature, reload, canSign }) {
  const { pushError, pushSuccess } = useAlerts();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save(image) {
    setBusy(true);
    try { await apiClient.put('/document-centre/signatures/me', { image }); pushSuccess('Signature saved'); setEditing(false); reload(); } catch (err) { pushError(apiErrorMessage(err, 'Could not save the signature'), 'Not saved'); } finally { setBusy(false); }
  }
  async function remove() {
    if (!await confirmAction('Remove your signature? Nobody can sign with it until you add one again.')) return;
    try { await apiClient.delete('/document-centre/signatures/me'); reload(); } catch (err) { pushError(apiErrorMessage(err, 'Could not remove it'), 'Not removed'); }
  }
  if (!canSign) return null;
  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="signature-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-sm font-semibold text-tertiary-900">My signature</h3>
          <p className="mt-0.5 text-xs text-tertiary-500">Only you can sign with it, and only when you open a document sent to you. It is never shown to anyone else.</p>
        </div>
        {signature?.has_signature && !editing && (
          <div className="flex gap-2"><button type="button" className="btn-secondary" onClick={() => setEditing(true)}>Replace</button><button type="button" className="btn-ghost text-danger-600" onClick={remove}>Remove</button></div>
        )}
      </div>
      {signature?.has_signature && !editing ? (
        <div className="mt-3 inline-block rounded-xl border border-tertiary-100 bg-canvas-muted p-3"><img src={signature.image} alt="Your signature" className="max-h-24" data-testid="my-signature" /></div>
      ) : (
        <div className="mt-3">
          {!signature?.has_signature && <p className="mb-2 text-sm text-warning-700">You have not added a signature yet.</p>}
          <SignaturePad onSave={save} busy={busy} />
          {editing && <button type="button" className="mt-2 text-xs text-tertiary-600 underline" onClick={() => setEditing(false)}>Keep the current one</button>}
        </div>
      )}
    </section>
  );
}

/** Ask someone to sign a PDF, and tag it: which client, vendor or employee it belongs to and what kind of document it is. */
function NewRequestDrawer({ open, signers, onClose, onCreated }) {
  const { pushError, pushSuccess } = useAlerts();
  const [file, setFile] = useState(null);
  const [f, setF] = useState({ title: '', tag_kind: 'client', entity_id: '', doc_type: '', signer_user_id: '', note: '' });
  const [reqs, setReqs] = useState([]);
  const [busy, setBusy] = useState(false);
  const clients = useClientAccountOptions(open);
  const vendors = useVendorAccountOptions(open);
  const people = useOrgMembershipOptions(open);
  useEffect(() => {
    if (!open) return;
    setFile(null); setF({ title: '', tag_kind: 'client', entity_id: '', doc_type: '', signer_user_id: signers[0]?.id || '', note: '' });
    apiClient.get('/document-centre/requirements').then(({ data }) => setReqs(data.data || [])).catch(() => setReqs([]));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value, ...(k === 'tag_kind' ? { entity_id: '', doc_type: '' } : {}) }));
  const entityOptions = f.tag_kind === 'client' ? clients : f.tag_kind === 'vendor' ? vendors : f.tag_kind === 'employee' ? people : [];
  const entityType = f.tag_kind === 'employee' ? 'org_membership' : 'account';
  const types = reqs.filter((r) => r.kind === f.tag_kind);
  async function submit(e) {
    e.preventDefault();
    if (!file) { pushError('Choose the PDF to be signed', 'Missing file'); return; }
    const body = new FormData();
    body.append('file', file);
    body.append('title', f.title.trim());
    body.append('tag_kind', f.tag_kind);
    if (f.entity_id) { body.append('entity_type', entityType); body.append('entity_id', f.entity_id); }
    if (f.doc_type) body.append('doc_type', f.doc_type);
    body.append('signer_user_id', f.signer_user_id);
    if (f.note.trim()) body.append('note', f.note.trim());
    setBusy(true);
    try {
      await apiClient.post('/document-centre/sign-requests', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      pushSuccess('Sent for signature');
      onCreated();
      onClose();
    } catch (err) { pushError(apiErrorMessage(err, 'Could not send the document'), 'Not sent'); } finally { setBusy(false); }
  }
  return (
    <Drawer open={open} onClose={onClose} size="md" tone="create" title="Send a document for signature" footer={<><button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="sign-request-form" className="btn-primary" disabled={busy || !f.title.trim() || !f.signer_user_id || !file} data-testid="send-for-signature">{busy ? 'Sending…' : 'Send for signature'}</button></>}>
      <form id="sign-request-form" onSubmit={submit} className="space-y-3" data-testid="sign-request-form">
        <label className={label}>PDF to sign (up to 15 MB)
          <input type="file" accept="application/pdf,.pdf" className={input} data-testid="sign-file" onChange={(e) => { const x = e.target.files?.[0] || null; setFile(x); if (x && !f.title) setF((c) => ({ ...c, title: x.name.replace(/\.pdf$/i, '') })); }} />
          <span className="mt-0.5 block text-[11px] text-tertiary-500">Only PDF can be signed here. A Word file: save it as PDF first.</span>
        </label>
        <label className={label}>Title<input required className={input} value={f.title} maxLength={200} onChange={set('title')} placeholder="e.g. Agreement with Alpha Tech" /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>What is it for?<select className={input} value={f.tag_kind} onChange={set('tag_kind')} data-testid="sign-tag">{TAGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          {['client', 'vendor', 'employee'].includes(f.tag_kind) ? (
            <label className={label}>{f.tag_kind === 'employee' ? 'Employee' : f.tag_kind === 'vendor' ? 'Vendor' : 'Client'}
              <SearchableSelect className="mt-1" allowClear ariaLabel="Tagged record" value={f.entity_id} onChange={(v) => setF((c) => ({ ...c, entity_id: v }))} placeholder="Choose…" searchPlaceholder="Search…" options={entityOptions} />
            </label>
          ) : <span />}
        </div>
        {types.length > 0 && (
          <label className={label}>Kind of document
            <select className={input} value={f.doc_type} onChange={set('doc_type')}><option value="">Not specified</option>{types.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}</select>
            <span className="mt-0.5 block text-[11px] text-tertiary-500">When you attach the signed copy, it counts as this document being on file.</span>
          </label>
        )}
        <label className={label}>Who signs it?
          <select required className={input} value={f.signer_user_id} onChange={set('signer_user_id')} data-testid="sign-signer"><option value="">Choose…</option>{signers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          {signers.length === 0 && <span className="mt-0.5 block text-[11px] text-warning-700">Nobody has added a signature yet. The signer opens Documents &gt; Sign &gt; My signature first.</span>}
        </label>
        <label className={label}>Note for the signer (optional)<textarea rows={2} className={input} maxLength={1000} value={f.note} onChange={set('note')} /></label>
      </form>
    </Drawer>
  );
}

export default function SignTab() {
  const { user } = useAuth();
  const { pushError, pushSuccess } = useAlerts();
  const admin = isAdminUser(user);
  const canSign = allowed(user, 'documents.sign', admin);
  const canUpload = allowed(user, 'documents.upload', admin);
  const canManage = allowed(user, 'documents.manage', admin);
  const [signature, setSignature] = useState(null);
  const [stamp, setStamp] = useState(null);
  const [signers, setSigners] = useState([]);
  const [toSign, setToSign] = useState(null);
  const [mine, setMine] = useState(null);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const [studio, setStudio] = useState(null);

  const load = useCallback(() => {
    if (canSign) apiClient.get('/document-centre/signatures/me').then(({ data }) => setSignature(data.data)).catch(() => setSignature({ has_signature: false }));
    apiClient.get('/document-centre/stamp').then(({ data }) => setStamp(data.data)).catch(() => setStamp({ has_stamp: false }));
    apiClient.get('/document-centre/signers').then(({ data }) => setSigners(data.data || [])).catch(() => setSigners([]));
    apiClient.get('/document-centre/sign-requests', { params: { scope: 'to_sign', status: 'pending' } }).then(({ data }) => setToSign(data.data || [])).catch(() => setToSign([]));
    apiClient.get('/document-centre/sign-requests', { params: { scope: 'mine', ...(status ? { status } : {}) } }).then(({ data }) => setMine(data.data || [])).catch(() => setMine([]));
  }, [canSign, status]);
  useEffect(() => { load(); }, [load]);

  const dl = (path, name) => downloadAuthenticatedFile(`${API}${path}`, name).catch((e) => pushError(apiErrorMessage(e, 'Could not download'), 'Download failed'));
  async function attach(r) {
    try { await apiClient.post(`/document-centre/sign-requests/${r.id}/attach`); pushSuccess(`Attached to ${r.entity_name}`); load(); } catch (err) { pushError(apiErrorMessage(err, 'Could not attach it'), 'Not attached'); }
  }
  async function cancel(r) {
    if (!await confirmAction(`Cancel the request "${r.title}"? ${r.signer?.name || 'The signer'} will no longer see it.`)) return;
    try { await apiClient.post(`/document-centre/sign-requests/${r.id}/cancel`); load(); } catch (err) { pushError(apiErrorMessage(err, 'Could not cancel'), 'Not cancelled'); }
  }

  if (studio) {
    return (
      <Suspense fallback={<p className="py-10 text-center text-sm text-tertiary-500">Opening the signing page…</p>}>
        <SigningStudio request={studio} signature={signature?.image} stamp={stamp?.has_stamp ? stamp.image : null} onClose={() => { setStudio(null); load(); }} onDone={load} />
      </Suspense>
    );
  }

  const mustAddSignature = canSign && signature && !signature.has_signature;
  return (
    <div className="space-y-4" data-testid="sign-tab">
      <SignatureCard signature={signature} reload={load} canSign={canSign} />
      <StampCard stamp={stamp} reload={load} canManage={canManage} />

      {toSign && toSign.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4" data-testid="to-sign">
          <h3 className="font-heading text-sm font-semibold text-tertiary-900">Waiting for your signature ({toSign.length})</h3>
          <ul className="mt-2 divide-y divide-amber-100">
            {toSign.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-testid="to-sign-row">
                <span><span className="font-medium text-tertiary-900">{r.title}</span><span className="block text-xs text-tertiary-500">{[r.entity_name, r.doc_type, `from ${r.requested_by?.name || ''}`, when(r.created_at)].filter(Boolean).join(' · ')}{r.stale ? ' · waiting for a long time' : ''}</span></span>
                <span className="flex gap-2">
                  {r.original_available && <button type="button" className="btn-ghost text-xs" onClick={() => dl(`/sign-requests/${r.id}/original`, `${r.title}.pdf`)}>View original</button>}
                  <button type="button" className="btn-primary inline-flex items-center gap-1.5 text-xs" data-testid="open-to-sign" disabled={mustAddSignature} title={mustAddSignature ? 'Add your signature first' : undefined} onClick={() => setStudio(r)}><FileSignature className="h-3.5 w-3.5" />Open to sign</button>
                </span>
              </li>
            ))}
          </ul>
          {mustAddSignature && <p className="mt-2 text-xs text-warning-700">Add your signature above to be able to sign.</p>}
        </section>
      )}

      <section className="space-y-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-heading text-sm font-semibold text-tertiary-900">Documents I sent or am signing</h3>
            <p className="text-xs text-tertiary-500">Upload a PDF, choose who signs it and tag it to a client, vendor or employee. When it is signed, download it or attach it to the record.</p>
          </div>
          <div className="flex items-center gap-2">
            <select className="rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>{Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {canUpload && <button type="button" className="btn-primary inline-flex items-center gap-2" data-testid="new-sign-request" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Send for signature</button>}
          </div>
        </div>
        {!mine ? <p className="py-6 text-center text-sm text-tertiary-500">Loading…</p> : mine.length === 0 ? <EmptyState icon={Upload} title="Nothing here yet" description={canUpload ? 'Choose "Send for signature" to upload the first document.' : 'No document has been sent to you.'} /> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-canvas-muted"><tr>{['Document', 'Tagged to', 'Signer', 'Status', 'Date', ''].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-tertiary-500">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-tertiary-100">
                {mine.map((r) => {
                  const [tone, text] = STATUS[r.status] || ['gray', r.status];
                  return (
                    <tr key={r.id} data-testid="sign-row">
                      <td className="px-3 py-2"><span className="font-medium text-tertiary-900">{r.title}</span><span className="block text-xs text-tertiary-500">{size(r.original_size)}{r.original_available ? '' : ' · original removed to save space'}</span></td>
                      <td className="px-3 py-2">{r.entity_name || <span className="text-tertiary-400">—</span>}{r.doc_type && <span className="block text-xs text-tertiary-500">{r.doc_type}</span>}</td>
                      <td className="px-3 py-2">{r.signer?.name}</td>
                      <td className="px-3 py-2"><Pill tone={tone}>{text}</Pill>{r.decline_reason && <span className="block text-[11px] text-tertiary-500">{r.decline_reason}</span>}{r.stale && <span className="block text-[11px] text-warning-700">waiting for more than 2 weeks</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-tertiary-500">{r.status === 'signed' ? when(r.signed_at) : when(r.created_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          {r.original_available && <button type="button" className="btn-ghost text-xs" onClick={() => dl(`/sign-requests/${r.id}/original`, `${r.title}.pdf`)}>Original</button>}
                          {r.status === 'signed' && <button type="button" className="btn-ghost text-xs" data-testid="download-signed-row" onClick={() => dl(`/sign-requests/${r.id}/signed`, `${r.title}-signed.pdf`)}>Signed PDF</button>}
                          {r.status === 'signed' && r.entity_id && !r.attached && canUpload && <button type="button" className="btn-ghost text-xs text-primary-700" data-testid="attach-signed" onClick={() => attach(r)}>Attach to {r.entity_name}</button>}
                          {r.attached && <span className="px-2 text-[11px] text-green-700">Attached</span>}
                          {r.status === 'pending' && canUpload && <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => cancel(r)}>Cancel</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <NewRequestDrawer open={open} signers={signers} onClose={() => setOpen(false)} onCreated={load} />
    </div>
  );
}
