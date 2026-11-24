import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Download, ExternalLink, KeyRound, Share2, UserPlus, X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { promptAction } from '../../lib/confirmAction.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Modal from '../../components/ui/Modal.jsx';

// The company's side of the vendor portal (docs/features/VENDOR-PORTAL.md): vendor logins and resources on the vendor account, sharing a
// requirement with vendors, the inbox of candidates vendors put forward, and invoice files vendors uploaded (shown in Finance).
const A = '/vendor-portal-admin';
const money = (n, c = 'INR') => (n == null ? '-' : `${c} ${Number(n).toLocaleString('en-IN')}`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pill = { pending_review: 'bg-amber-50 text-amber-800', approved: 'bg-emerald-50 text-emerald-800', rejected: 'bg-rose-50 text-rose-800', withdrawn: 'bg-slate-100 text-slate-600', uploaded: 'bg-sky-50 text-sky-800', accepted: 'bg-emerald-50 text-emerald-800' };
const label = { pending_review: 'Waiting for review', approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn', uploaded: 'Uploaded by vendor', accepted: 'Accepted' };
const Pill = ({ s }) => <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${pill[s] || 'bg-slate-100 text-slate-600'}`}>{label[s] || s}</span>;

async function saveBlob(path, name) {
  const { data } = await apiClient.get(path, { responseType: 'blob' });
  const url = URL.createObjectURL(data); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

/** On a vendor account: who can sign in to the portal, and the vendor's resources with both rates. */
export function VendorPortalCard({ accountId }) {
  const { pushError, pushSuccess } = useAlerts();
  const [data, setData] = useState(null); const [denied, setDenied] = useState(false); const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', email: '', password: '' }); const [busy, setBusy] = useState(false);
  const load = useCallback(() => apiClient.get(`${A}/vendors/${accountId}`).then(({ data: d }) => setData(d.data)).catch(() => setDenied(true)), [accountId]);
  useEffect(() => { load(); }, [load]);
  if (denied || !data) return null;
  async function add(e) {
    e.preventDefault(); setBusy(true);
    try { await apiClient.post(`${A}/vendors/${accountId}/users`, f); pushSuccess('Login created. Share the portal link and password with the vendor.'); setAdding(false); setF({ name: '', email: '', password: '' }); load(); } catch (err) { pushError(apiErrorMessage(err)); } finally { setBusy(false); }
  }
  async function patch(u, body, msg) { try { await apiClient.patch(`${A}/users/${u.id}`, body); pushSuccess(msg); load(); } catch (err) { pushError(apiErrorMessage(err)); } }
  async function reset(u) { const pw = await promptAction(`New password for ${u.name} (required, at least 8 characters):`, ''); if (pw) patch(u, { password: pw }, 'Password changed'); }
  const link = `${window.location.origin}/vendor-portal`;
  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="vendor-portal-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="font-heading text-sm font-semibold text-tertiary-900">Vendor portal</h3><p className="mt-0.5 text-xs text-tertiary-500">The vendor signs in at <a className="text-primary-700 underline" href={link} target="_blank" rel="noreferrer">{link}</a> to see the requirements you share, put candidates forward and send invoices.</p></div>
        <button type="button" className="btn-secondary text-xs" onClick={() => setAdding(true)} data-testid="vp-add-login"><UserPlus className="h-3.5 w-3.5" /> Add login</button>
      </div>
      <div className="mt-3 space-y-1.5">
        {data.users.length === 0 && <p className="text-xs text-tertiary-500">No one at this vendor can sign in yet.</p>}
        {data.users.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-canvas-muted px-3 py-1.5 text-sm" data-testid="vp-login-row">
            <span><span className="font-medium text-tertiary-900">{u.name}</span> <span className="text-tertiary-500">{u.email}</span>{!u.active && <span className="ml-2 rounded bg-rose-50 px-1.5 text-xs text-rose-700">Switched off</span>}</span>
            <span className="flex gap-1"><button type="button" className="btn-ghost text-xs" onClick={() => reset(u)}><KeyRound className="h-3 w-3" /> Reset password</button><button type="button" className="btn-ghost text-xs" onClick={() => patch(u, { active: !u.active }, u.active ? 'Login switched off' : 'Login switched on')}>{u.active ? 'Switch off' : 'Switch on'}</button></span>
          </div>
        ))}
      </div>
      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Resources placed with us</h4>
      {data.resources.length === 0 ? <p className="mt-1 text-xs text-tertiary-500">None yet.</p> : (
        <div className="mt-1 overflow-x-auto"><table className="min-w-full text-sm" data-testid="vp-resources-table"><thead className="text-left text-xs text-tertiary-500"><tr><th className="py-1 pr-3">Resource</th><th className="py-1 pr-3">Vendor rate (we pay)</th><th className="py-1">Client billing rate (we charge)</th></tr></thead>
          <tbody>{data.resources.map((r) => (<tr key={r.id} className="border-t border-tertiary-100"><td className="py-1.5 pr-3 font-medium text-tertiary-900">{r.name}</td><td className="py-1.5 pr-3">{money(r.vendor_rate, r.vendor_currency)}</td><td className="py-1.5">{r.billing.length ? r.billing.map((b) => <div key={b.client}>{b.client}: {money(b.rate, b.currency)} <span className="text-xs text-tertiary-500">{String(b.rate_type).replace('_', ' ')}</span></div>) : '-'}</td></tr>))}</tbody></table></div>
      )}
      <Modal open={adding} title="Add a vendor portal login" onClose={() => setAdding(false)}>
        <form onSubmit={add} className="space-y-3">
          {[['name', 'Name', 'text'], ['email', 'Email', 'email'], ['password', 'Password (at least 8 characters)', 'text']].map(([k, l, t]) => (
            <label key={k} className="block text-sm font-medium text-tertiary-700">{l}<input className="input mt-1 w-full" type={t} required value={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} data-testid={`vp-login-${k}`} /></label>
          ))}
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setAdding(false)}>Cancel</button><button className="btn-primary" disabled={busy} type="submit" data-testid="vp-login-save">{busy ? 'Saving...' : 'Create login'}</button></div>
        </form>
      </Modal>
    </section>
  );
}

/** On a requirement: choose the vendors who can see it in their portal. */
export function ShareWithVendors({ requirementId }) {
  const { pushError, pushSuccess } = useAlerts();
  const [open, setOpen] = useState(false); const [list, setList] = useState(null); const [denied, setDenied] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { apiClient.get(`${A}/requirements/${requirementId}/vendors`).then(({ data }) => setList(data.data)).catch(() => setDenied(true)); }, [requirementId]);
  if (denied) return null;
  const sharedCount = (list || []).filter((v) => v.shared).length;
  const toggle = (id) => setList((l) => l.map((v) => (v.id === id ? { ...v, shared: !v.shared } : v)));
  async function save() {
    setBusy(true);
    try { const { data } = await apiClient.put(`${A}/requirements/${requirementId}/vendors`, { vendor_ids: list.filter((v) => v.shared).map((v) => v.id) }); setList(data.data); pushSuccess('Vendor access saved'); setOpen(false); } catch (err) { pushError(apiErrorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)} data-testid="share-with-vendors"><Share2 className="h-4 w-4" /> Vendors{sharedCount ? ` (${sharedCount})` : ''}</button>
      <Modal open={open} title="Share with vendors" onClose={() => setOpen(false)} footer={<><button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn-primary" disabled={busy} onClick={save} data-testid="share-save">{busy ? 'Saving...' : 'Save'}</button></>}>
        <p className="mb-2 text-xs text-tertiary-500">The chosen vendors see this requirement in their portal (not the client name or the budget) and can put candidates forward. Nothing reaches the pipeline until you approve a candidate.</p>
        {!list || list.length === 0 ? <p className="text-sm text-tertiary-500">There are no vendors yet.</p> : (
          <div className="space-y-1">{list.map((v) => (<label key={v.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-canvas-muted"><input type="checkbox" checked={v.shared} onChange={() => toggle(v.id)} data-testid="share-vendor" /><span className="text-sm">{v.name}</span></label>))}</div>
        )}
      </Modal>
    </>
  );
}

/** Candidates vendors put forward: the point of contact (or someone permitted) approves into a normal Profile, or rejects with a reason. */
export function VendorSubmissionsInbox() {
  const { pushError, pushSuccess } = useAlerts();
  const [rows, setRows] = useState(null); const [all, setAll] = useState(false);
  const load = useCallback(() => apiClient.get(`${A}/submissions`, { params: all ? {} : { status: 'pending_review' } }).then(({ data }) => setRows(data.data)).catch(() => setRows([])), [all]);
  useEffect(() => { load(); }, [load]);
  if (!rows || (rows.length === 0 && !all)) return null;
  async function approve(r) {
    try { const { data } = await apiClient.post(`${A}/submissions/${r.id}/approve`); pushSuccess(data.data.already_on_file ? 'Approved. The person was already on file, so no duplicate was made.' : 'Approved. The profile is now in Profiles.'); load(); } catch (err) { pushError(apiErrorMessage(err)); }
  }
  async function reject(r) {
    const note = await promptAction(`Reject ${r.candidate_name}? Reason (required, the vendor will see it):`, '');
    if (!note) return;
    try { await apiClient.post(`${A}/submissions/${r.id}/reject`, { note }); pushSuccess('Rejected'); load(); } catch (err) { pushError(apiErrorMessage(err)); }
  }
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4" data-testid="vendor-inbox">
      <div className="flex items-center justify-between"><h3 className="font-heading text-sm font-semibold text-tertiary-900">Candidates from vendors {rows.filter((r) => r.status === 'pending_review').length > 0 && <span className="ml-1 rounded-full bg-amber-200 px-2 text-xs">{rows.filter((r) => r.status === 'pending_review').length} waiting</span>}</h3>
        <label className="flex items-center gap-1 text-xs text-tertiary-600"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show decided too</label></div>
      <div className="mt-2 overflow-x-auto"><table className="min-w-full text-sm"><thead className="text-left text-xs text-tertiary-500"><tr><th className="py-1 pr-3">Candidate</th><th className="py-1 pr-3">Vendor</th><th className="py-1 pr-3">Requirement</th><th className="py-1 pr-3">Exp.</th><th className="py-1 pr-3">Vendor rate</th><th className="py-1 pr-3">Status</th><th /></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className="border-t border-amber-100 align-top" data-testid="vendor-inbox-row">
            <td className="py-1.5 pr-3"><div className="font-medium text-tertiary-900">{r.candidate_name}</div><div className="text-xs text-tertiary-500">{[r.email, r.phone].filter(Boolean).join(' · ')}</div>{r.skills?.length > 0 && <div className="text-xs text-tertiary-500">{r.skills.join(', ')}</div>}</td>
            <td className="py-1.5 pr-3">{r.vendor_name}</td><td className="py-1.5 pr-3">{r.requirement_title}</td><td className="py-1.5 pr-3">{r.total_experience_years} yrs</td><td className="py-1.5 pr-3">{money(r.vendor_rate, r.vendor_rate_currency)}</td>
            <td className="py-1.5 pr-3"><Pill s={r.status} />{r.decision_note && <div className="text-xs text-tertiary-500">{r.decision_note}</div>}</td>
            <td className="py-1.5 text-right"><span className="flex flex-wrap justify-end gap-1">
              {r.has_cv_file && <button type="button" className="btn-ghost text-xs" onClick={() => saveBlob(`${A}/submissions/${r.id}/cv`, r.cv_file_name || 'cv').catch((e) => pushError(apiErrorMessage(e)))}><Download className="h-3 w-3" /> CV</button>}
              {r.cv_url && <a className="btn-ghost text-xs" href={r.cv_url} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" /> CV link</a>}
              {r.status === 'pending_review' && <><button type="button" className="btn-primary text-xs" onClick={() => approve(r)} data-testid="vendor-approve"><Check className="h-3 w-3" /> Approve</button><button type="button" className="btn-secondary text-xs" onClick={() => reject(r)} data-testid="vendor-reject"><X className="h-3 w-3" /> Reject</button></>}
              {r.status === 'approved' && r.profile_id && <Link className="btn-ghost text-xs" to="/profiles">Open Profiles</Link>}
            </span></td>
          </tr>))}</tbody></table></div>
    </section>
  );
}

/** Finance > Vendor Invoices > Uploaded by vendor. Files only: nothing here is an invoice until the team raises one. */
export function VendorUploadedInvoices() {
  const { pushError, pushSuccess } = useAlerts();
  const [rows, setRows] = useState(null);
  const load = useCallback(() => apiClient.get(`${A}/invoices`).then(({ data }) => setRows(data.data)).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  async function review(r, status) {
    let note;
    if (status === 'rejected') { note = await promptAction(`Reject this invoice file from ${r.vendor_name}? Reason (required, the vendor will see it):`, ''); if (!note) return; }
    try { await apiClient.patch(`${A}/invoices/${r.id}`, { status, note }); pushSuccess(status === 'accepted' ? 'Marked accepted' : 'Rejected'); load(); } catch (err) { pushError(apiErrorMessage(err)); }
  }
  return (
    <section className="space-y-3" data-testid="vendor-uploaded-invoices">
      <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card"><p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Finance</p><h2 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Uploaded by vendor</h2><p className="mt-1 text-sm text-tertiary-500">Invoice files vendors sent through the vendor portal. They are only files: check each one here, then raise the invoice in Vendor invoices as usual.</p></div>
      <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
        {!rows ? <p className="p-4 text-sm text-tertiary-500">Loading...</p> : rows.length === 0 ? <p className="p-6 text-center text-sm text-tertiary-500">No vendor has uploaded an invoice yet.</p> : (
          <table className="min-w-full text-sm"><thead className="bg-canvas-muted text-left text-xs uppercase text-tertiary-500"><tr><th className="px-3 py-2">Vendor</th><th className="px-3 py-2">Period</th><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-t border-tertiary-100" data-testid="vendor-upload-row">
                <td className="px-3 py-2 font-medium text-tertiary-900">{r.vendor_name}</td><td className="px-3 py-2">{MONTHS[r.period_month - 1]} {r.period_year}</td><td className="px-3 py-2">{r.invoice_number || r.file_name}</td><td className="px-3 py-2">{money(r.amount, r.currency)}</td>
                <td className="px-3 py-2"><Pill s={r.status} />{r.review_note && <div className="text-xs text-tertiary-500">{r.review_note}</div>}</td>
                <td className="px-3 py-2 text-right"><span className="flex flex-wrap justify-end gap-1"><button type="button" className="btn-ghost text-xs" onClick={() => saveBlob(`${A}/invoices/${r.id}/file`, r.file_name).catch((e) => pushError(apiErrorMessage(e)))}><Download className="h-3 w-3" /> Open</button>
                  {r.status === 'uploaded' && <><button type="button" className="btn-secondary text-xs" onClick={() => review(r, 'accepted')} data-testid="vendor-upload-accept">Accept</button><button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => review(r, 'rejected')}>Reject</button></>}</span></td>
              </tr>))}</tbody></table>
        )}
      </div>
    </section>
  );
}
