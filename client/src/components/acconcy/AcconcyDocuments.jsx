import { useCallback, useEffect, useState } from 'react';
import { Download, FileText, Pencil, Trash2, Upload } from 'lucide-react';
import { downloadAuthenticatedFile } from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { acconcyApi, acconcyError } from '../../lib/acconcy/api.js';

export const DOC_CATEGORIES = [
  { value: 'quotation', label: 'Quotation' },
  { value: 'purchase_order', label: 'Purchase order' },
  { value: 'sales_order', label: 'Sales order' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'test_certificate', label: 'Test certificate' },
  { value: 'weighment', label: 'Weighment slip' },
  { value: 'transport', label: 'Transport / e-way bill' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'gst', label: 'GST certificate' },
  { value: 'pan', label: 'PAN card' },
  { value: 'agreement', label: 'Agreement' },
  { value: 'other', label: 'Other' },
];
const CATEGORY_LABEL = Object.fromEntries(DOC_CATEGORIES.map((c) => [c.value, c.label]));
const inputCls = 'mt-1 w-full rounded-xl border px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';

/** 'expired' | 'soon' (within 30 days) | 'ok' | 'none' for an expiry date (YYYY-MM-DD or ISO). */
export function expiryState(expiry) {
  if (!expiry) return 'none';
  const days = Math.floor((new Date(String(expiry).slice(0, 10)).getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime()) / 86400000);
  if (days < 0) return 'expired';
  return days <= 30 ? 'soon' : 'ok';
}
const EXPIRY_STYLE = { expired: 'bg-red-50 text-red-700', soon: 'bg-amber-50 text-amber-700', ok: 'bg-green-50 text-green-700', none: 'bg-tertiary-100 text-tertiary-600' };
const EXPIRY_TEXT = { expired: 'Expired', soon: 'Expiring soon', ok: 'Valid', none: 'No expiry' };

/**
 * Documents for one Acconcy record (owner). Upload with category, reference number and
 * issue / expiry dates; expiring and expired files are flagged. `onChanged` lets the
 * parent refresh its own expiry badges.
 */
export default function AcconcyDocuments({ ownerType, ownerId, canEdit = true, onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [docs, setDocs] = useState(null);
  const [form, setForm] = useState({ title: '', category: 'agreement', ref_no: '', issue_date: '', expiry_date: '' });
  const [file, setFile] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(
    () => acconcyApi.documents(ownerType, ownerId).then(setDocs, (e) => pushError(acconcyError(e), 'Could not load documents')),
    [ownerType, ownerId, pushError]
  );
  useEffect(() => {
    setDocs(null);
    load();
  }, [load]);

  async function submit(event) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append('owner_type', ownerType);
      body.append('owner_id', ownerId);
      Object.entries(form).forEach(([k, v]) => v !== '' && body.append(k, v));
      body.append('file', file);
      await acconcyApi.uploadDocument(body);
      setForm({ title: '', category: 'agreement', ref_no: '', issue_date: '', expiry_date: '' });
      setFile(null);
      setFileKey((k) => k + 1);
      pushSuccess('Document uploaded');
      await load();
      onChanged?.();
    } catch (e) {
      pushError(acconcyError(e, 'Upload failed'), 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveMeta(e) {
    e.preventDefault();
    try {
      await acconcyApi.updateDocument(editing.id, { title: editing.title.trim(), category: editing.category, ref_no: editing.ref_no.trim() || null, issue_date: editing.issue_date || null, expiry_date: editing.expiry_date || null });
      setEditing(null);
      await load();
      onChanged?.();
    } catch (err) {
      pushError(acconcyError(err, 'Could not save'), 'Could not save');
    }
  }

  async function remove(doc) {
    try {
      await acconcyApi.deleteDocument(doc.id);
      await load();
      onChanged?.();
    } catch (e) {
      pushError(acconcyError(e, 'Could not delete'), 'Delete failed');
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="font-heading text-sm font-semibold text-tertiary-900">Documents</h3>
      {docs === null && <div className="text-sm text-tertiary-500">Loading…</div>}
      {docs?.length === 0 && <div className="rounded-xl border border-dashed p-4 text-center text-sm text-tertiary-400">No documents yet.</div>}
      <ul className="space-y-2">
        {docs?.map((doc) => {
          const state = expiryState(doc.expiry_date);
          return (
            <li key={doc.id} className="flex items-start gap-3 rounded-xl border bg-white p-3">
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-tertiary-900">{doc.title}</div>
                <div className="mt-0.5 text-xs text-tertiary-500">
                  {CATEGORY_LABEL[doc.category] || doc.category}
                  {doc.ref_no ? ` · Ref ${doc.ref_no}` : ''}
                  {doc.expiry_date ? ` · Expires ${String(doc.expiry_date).slice(0, 10)}` : ''}
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${EXPIRY_STYLE[state]}`}>{EXPIRY_TEXT[state]}</span>
              <button type="button" className="rounded-lg p-1.5 text-tertiary-500 hover:bg-primary-50 hover:text-primary-700" aria-label={`Download ${doc.title}`} onClick={() => downloadAuthenticatedFile(doc.file_url, doc.file_name).catch((e) => pushError(acconcyError(e, 'Download failed'), 'Download failed'))}>
                <Download className="h-4 w-4" />
              </button>
              {canEdit && <button type="button" className="rounded-lg p-1.5 text-tertiary-500 hover:bg-primary-50 hover:text-primary-700" aria-label={`Edit ${doc.title}`} onClick={() => setEditing({ id: doc.id, title: doc.title, category: doc.category, ref_no: doc.ref_no || '', issue_date: doc.issue_date ? String(doc.issue_date).slice(0, 10) : '', expiry_date: doc.expiry_date ? String(doc.expiry_date).slice(0, 10) : '' })}><Pencil className="h-4 w-4" /></button>}
              {canEdit && (
                <button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" aria-label={`Delete ${doc.title}`} onClick={() => remove(doc)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {editing && (
        <form onSubmit={saveMeta} className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelCls}>Title<input className={inputCls} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} required maxLength={200} /></label>
            <label className={labelCls}>Category<select className={inputCls} value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>{DOC_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
            <label className={labelCls}>Reference no.<input className={inputCls} value={editing.ref_no} onChange={(e) => setEditing({ ...editing, ref_no: e.target.value })} maxLength={120} /></label>
            <label className={labelCls}>Issue date<input type="date" className={inputCls} value={editing.issue_date} onChange={(e) => setEditing({ ...editing, issue_date: e.target.value })} /></label>
            <label className={labelCls}>Expiry date<input type="date" className={inputCls} value={editing.expiry_date} min={editing.issue_date || undefined} onChange={(e) => setEditing({ ...editing, expiry_date: e.target.value })} /></label>
          </div>
          <div className="flex gap-2"><button type="submit" className="btn-primary">Save changes</button><button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button></div>
        </form>
      )}

      {canEdit && (
        <form onSubmit={submit} className="space-y-3 rounded-xl border bg-primary-50/40 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelCls}>Title<input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} /></label>
            <label className={labelCls}>
              Category
              <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {DOC_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            <label className={labelCls}>Reference no.<input className={inputCls} value={form.ref_no} onChange={(e) => setForm({ ...form, ref_no: e.target.value })} maxLength={120} /></label>
            <label className={labelCls}>File<input key={fileKey} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.csv" className={inputCls} onChange={(e) => setFile(e.target.files?.[0] || null)} required /></label>
            <label className={labelCls}>Issue date<input type="date" className={inputCls} value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} /></label>
            <label className={labelCls}>Expiry date<input type="date" className={inputCls} value={form.expiry_date} min={form.issue_date || undefined} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} /></label>
          </div>
          <button type="submit" className="btn-primary inline-flex items-center gap-1.5" disabled={busy || !file}><Upload className="h-4 w-4" />{busy ? 'Uploading…' : 'Upload document'}</button>
        </form>
      )}
    </section>
  );
}
