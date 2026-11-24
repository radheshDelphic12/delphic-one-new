import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Pencil, Plus } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { downloadFile } from '../../lib/downloadFile.js';
import { useAuth } from '../../lib/authContext.jsx';
import { allowed, isAdminUser } from '../../lib/access.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Pill from '../../components/ui/Pill.jsx';
import RichTextEditor from '../../components/ui/RichTextEditor.jsx';
import RichTextView from '../../components/ui/RichTextView.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { confirmAction } from '../../lib/confirmAction.js';

// People > Letters: HR issues offer, appointment, appraisal, relieving ... letters to employees, past employees, candidates, vendors and anyone else.
// Every letter has a unique serial number; the templates and the serial number format are edited here by whoever may manage them.

const input = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const label = 'block text-xs font-medium text-tertiary-600';
const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-tertiary-500';
const td = 'px-3 py-2 align-top';
const KIND_LABEL = { offer: 'Offer', appointment: 'Appointment', appraisal: 'Appraisal', relieving: 'Relieving', experience: 'Experience', warning: 'Warning', other: 'Other' };
const AUDIENCE_LABEL = { any: 'Anyone', employee: 'Employees', new_joiner: 'New joiners', left_employee: 'Left employees', vendor: 'Vendors', other: 'Others' };
const today = () => new Date().toLocaleDateString('en-CA');
const kindLabel = (k) => KIND_LABEL[k] || k;

function useApi(path, deps = [], params) {
  const { pushError } = useAlerts();
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    apiClient.get(path, { params }).then(({ data: res }) => { if (live) setData(res.data); }).catch((err) => { if (live) setData([]); pushError(apiErrorMessage(err, 'Could not load'), 'Load failed'); });
    return () => { live = false; };
  }, [...deps, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return [data, () => setTick((t) => t + 1)];
}

// ---------------------------------------------------------------------------------------------------------------------------
function GenerateDrawer({ open, templates, onClose, onIssued }) {
  const { pushError, pushSuccess } = useAlerts();
  const [templateId, setTemplateId] = useState('');
  const [type, setType] = useState('employee');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState([]);
  const [picked, setPicked] = useState(null);
  const [free, setFree] = useState({ name: '', email: '', address: '' });
  const [issuedOn, setIssuedOn] = useState(today());
  const [typed, setTyped] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [offices, setOffices] = useState([]);
  const [officeId, setOfficeId] = useState('');

  // the company's offices: the letter is issued for one of them (the default one is picked first)
  useEffect(() => {
    if (!open) return;
    apiClient.get('/orgs/locations').then(({ data }) => {
      const list = data.data || [];
      setOffices(list);
      setOfficeId((cur) => cur || (list.find((o) => o.is_default) || list[0])?.id || '');
    }).catch(() => setOffices([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setTemplateId(''); setType('employee'); setQuery(''); setFound([]); setPicked(null); setFree({ name: '', email: '', address: '' }); setIssuedOn(today()); setTyped({}); setPreview(null);
  }, [open]);

  useEffect(() => {
    if (!open || !['employee', 'vendor'].includes(type)) { setFound([]); return undefined; }
    const timer = setTimeout(() => {
      apiClient.get('/letters/recipients', { params: { type, q: query } }).then(({ data }) => setFound(data.data || [])).catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [open, type, query]);

  const recipient = useMemo(() => {
    if (type === 'employee') return picked ? { type, org_membership_id: picked.org_membership_id } : null;
    if (type === 'vendor') return picked ? { type, account_id: picked.account_id, email: free.email || undefined, address: free.address || undefined } : null;
    return free.name.trim() ? { type, name: free.name.trim(), email: free.email || undefined, address: free.address || undefined } : null;
  }, [type, picked, free]);

  const body = useMemo(() => (templateId && recipient ? { template_id: templateId, recipient, fields: typed, issued_on: issuedOn, ...(officeId ? { location_id: officeId } : {}) } : null), [templateId, recipient, typed, issuedOn, officeId]);

  useEffect(() => {
    if (!open || !body) { setPreview(null); return undefined; }
    const timer = setTimeout(() => {
      apiClient.post('/letters/preview', body).then(({ data }) => setPreview(data.data)).catch((err) => { setPreview(null); pushError(apiErrorMessage(err, 'Could not preview the letter'), 'Preview failed'); });
    }, 350);
    return () => clearTimeout(timer);
  }, [open, body]); // eslint-disable-line react-hooks/exhaustive-deps

  async function issue() {
    setBusy(true);
    try {
      const { data } = await apiClient.post('/letters', body);
      pushSuccess(`Letter ${data.data.serial_number} issued`);
      onIssued(data.data);
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not issue the letter'), 'Not issued');
    } finally { setBusy(false); }
  }

  const template = templates.find((t) => t.id === templateId);
  const toType = preview?.field_info || (preview?.fields_to_type || []).map((k) => ({ key: k, label: k.replace(/_/g, ' '), hint: null }));
  return (
    <Drawer open={open} onClose={onClose} size="xl" tone="create" title="New letter" footer={
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn-primary" data-testid="issue-letter" disabled={busy || !preview || preview.missing.length > 0} onClick={issue}>{busy ? 'Issuing…' : 'Issue letter'}</button>
      </>
    }>
      <div className="grid gap-4 lg:grid-cols-2" data-testid="generate-letter">
        <div className="space-y-3">
          <label className={label}>Template
            <select className={input} aria-label="Template" value={templateId} onChange={(e) => { setTemplateId(e.target.value); setTyped({}); }}>
              <option value="">Choose a template…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({kindLabel(t.kind)})</option>)}
            </select>
          </label>
          {template && <p className="text-xs text-tertiary-500">For: {AUDIENCE_LABEL[template.audience]}. The serial number will look like <span className="font-mono">{template.example_serial}</span>.</p>}

          <div>
            <p className={label}>Who is it for?</p>
            <div className="mt-1 flex flex-wrap gap-1.5" role="tablist" aria-label="Recipient type">
              {[['employee', 'Employee (current or past)'], ['candidate', 'Candidate'], ['vendor', 'Vendor'], ['other', 'Someone else']].map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={type === k} onClick={() => { setType(k); setPicked(null); }} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${type === k ? 'border-primary-600 bg-primary-600 text-white' : 'border-tertiary-200 bg-white text-tertiary-700 hover:bg-primary-50'}`}>{l}</button>
              ))}
            </div>
          </div>

          {['employee', 'vendor'].includes(type) && (
            <div>
              <input className={input} aria-label="Search" placeholder={type === 'employee' ? 'Search by name or employee code' : 'Search vendors'} value={query} onChange={(e) => setQuery(e.target.value)} />
              {picked && <p className="mt-1 text-sm">Selected: <b>{picked.name}</b> <button type="button" className="text-xs text-primary-700 hover:underline" onClick={() => setPicked(null)}>change</button></p>}
              {!picked && (
                <ul className="mt-1 max-h-44 overflow-auto rounded-xl border border-tertiary-100">
                  {found.map((r) => (
                    <li key={r.org_membership_id || r.account_id}>
                      <button type="button" data-testid="recipient-option" className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-primary-50" onClick={() => setPicked(r)}>
                        <span>{r.name}{r.employee_code && <span className="ml-1 text-xs text-tertiary-500">{r.employee_code}</span>}{r.designation && <span className="block text-[11px] text-tertiary-500">{r.designation}</span>}</span>
                        {r.status && <Pill tone={r.status === 'left' ? 'gray' : 'green'}>{r.status === 'left' ? 'Left' : 'Working'}</Pill>}
                      </button>
                    </li>
                  ))}
                  {found.length === 0 && <li className="px-3 py-3 text-xs text-tertiary-500">No match.</li>}
                </ul>
              )}
            </div>
          )}
          {['candidate', 'other'].includes(type) && <label className={label}>Name<input className={input} aria-label="Recipient name" value={free.name} onChange={(e) => setFree((f) => ({ ...f, name: e.target.value }))} /></label>}
          {type !== 'employee' && (
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>Email (optional)<input className={input} value={free.email} onChange={(e) => setFree((f) => ({ ...f, email: e.target.value }))} /></label>
              <label className={label}>Address (optional)<input className={input} value={free.address} onChange={(e) => setFree((f) => ({ ...f, address: e.target.value }))} /></label>
            </div>
          )}
          {offices.length > 0 && (
            <label className={label}>Issued for office
              <select className={input} aria-label="Issued for office" data-testid="letter-office" value={officeId} onChange={(e) => setOfficeId(e.target.value)}>
                {offices.map((o) => <option key={o.id} value={o.id}>{o.name}{o.legal_name ? ` - ${o.legal_name}` : ''}</option>)}
              </select>
              <span className="mt-0.5 block text-[11px] text-tertiary-500">The office and its company name go at the top of the letter, and every office at the foot. {offices.find((o) => o.id === officeId)?.legal_name ? '' : 'This office has no company name set (People > HR Settings > Locations): the company name is used.'}</span>
            </label>
          )}
          <label className={label}>Date of the letter<input type="date" className={input} value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} /></label>

          {toType.length > 0 && (
            <div className="space-y-2 rounded-xl border border-primary-100 bg-primary-50/30 p-3">
              <p className="text-xs font-semibold text-tertiary-700">Fill these in <span className="font-normal text-tertiary-500">(typed by you; they go into the letter and the PDF)</span></p>
              {toType.map((fld) => (
                <label key={fld.key} className={label}>{fld.label}{fld.hint && <span className="block text-[11px] font-normal text-tertiary-500">{fld.hint}</span>}<input className={input} aria-label={fld.key} data-testid={`type-field-${fld.key}`} value={typed[fld.key] || ''} onChange={(e) => setTyped((t) => ({ ...t, [fld.key]: e.target.value }))} /></label>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-tertiary-100 bg-white p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Preview</p>
          {!preview ? <p className="text-sm text-tertiary-500">Choose a template and who it is for to see the letter.</p> : (
            <div className="space-y-2 text-sm" data-testid="letter-preview">
              <p className="text-xs text-tertiary-500">Ref {preview.example_serial} · {preview.issued_on}{preview.office ? ` · ${preview.office.name}${preview.office.legal_name ? ` (${preview.office.legal_name})` : ''}` : ''}</p>
              {preview.subject && <p className="font-semibold">{preview.subject}</p>}
              <RichTextView value={preview.body} className="leading-relaxed" />
              {preview.missing.length > 0 && <p className="text-xs text-warning-700">Still to fill: {preview.missing.join(', ')}</p>}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
function IssuedLetters({ templates, canIssue }) {
  const { pushError, pushSuccess } = useAlerts();
  const [filters, setFilters] = useState({ q: '', kind: '', status: '' });
  const params = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), [filters]);
  const [rows, reload] = useApi('/letters', [filters.q, filters.kind, filters.status], params);
  const [open, setOpen] = useState(false);
  const [cancelFor, setCancelFor] = useState(null);
  const [reason, setReason] = useState('');
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  async function cancel() {
    try {
      await apiClient.post(`/letters/${cancelFor.id}/cancel`, { reason });
      pushSuccess('Letter cancelled');
      setCancelFor(null); setReason('');
      reload();
    } catch (err) { pushError(apiErrorMessage(err, 'Could not cancel the letter'), 'Not cancelled'); }
  }
  const pdf = (l) => downloadFile(`/letters/${l.id}/pdf`, undefined, `${l.serial_number.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`).catch((err) => pushError(apiErrorMessage(err, 'Could not download'), 'Download failed'));

  return (
    <div className="space-y-3" data-testid="issued-letters">
      <div className="flex flex-wrap items-end gap-3">
        <label className={label}>Search<input className={input} placeholder="Serial, name or template" value={filters.q} onChange={set('q')} /></label>
        <label className={label}>Kind<select className={input} value={filters.kind} onChange={set('kind')}><option value="">All</option>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className={label}>Status<select className={input} value={filters.status} onChange={set('status')}><option value="">All</option><option value="issued">Issued</option><option value="cancelled">Cancelled</option></select></label>
        {canIssue && <button type="button" className="btn-primary ml-auto inline-flex items-center gap-2" data-testid="new-letter" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New letter</button>}
      </div>
      {!rows ? <Skeleton className="h-40" /> : rows.length === 0 ? <EmptyState title="No letters yet" description={canIssue ? 'Choose New letter to issue the first one.' : 'Nothing has been issued.'} /> : (
        <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
          <table className="min-w-full text-sm">
            <thead className="bg-canvas-muted"><tr><th className={th}>Serial no.</th><th className={th}>Letter</th><th className={th}>For</th><th className={th}>Office</th><th className={th}>Date</th><th className={th}>Status</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-t border-tertiary-100" data-testid="letter-row">
                  <td className={`${td} font-mono text-xs font-medium text-primary-700`}>{l.serial_number}</td>
                  <td className={td}>{l.template_name}<span className="block text-[11px] text-tertiary-500">{kindLabel(l.kind)}</span></td>
                  <td className={td}>{l.recipient_name}<span className="block text-[11px] text-tertiary-500">{l.recipient_type === 'employee' ? 'Employee' : l.recipient_type === 'vendor' ? 'Vendor' : l.recipient_type === 'candidate' ? 'Candidate' : 'Other'}</span></td>
                  <td className={td}>{l.issuing_office || <span className="text-tertiary-400">-</span>}</td>
                  <td className={`${td} whitespace-nowrap`}>{l.issued_on}</td>
                  <td className={td}><Pill tone={l.status === 'issued' ? 'green' : 'gray'}>{l.status === 'issued' ? 'Issued' : 'Cancelled'}</Pill>{l.cancelled_reason && <span className="block text-[11px] text-tertiary-500">{l.cancelled_reason}</span>}</td>
                  <td className={`${td} text-right`}>
                    <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => pdf(l)}><Download className="h-3.5 w-3.5" />PDF</button>
                    {canIssue && l.status === 'issued' && <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => { setCancelFor(l); setReason(''); }}>Cancel</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <GenerateDrawer open={open} templates={templates.filter((t) => t.active)} onClose={() => setOpen(false)} onIssued={reload} />
      <Drawer open={Boolean(cancelFor)} onClose={() => setCancelFor(null)} size="sm" tone="edit" title={cancelFor ? `Cancel ${cancelFor.serial_number}` : ''}>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-tertiary-500">A letter is never edited. Cancel it, say why, and issue a new one; the cancelled number stays in the list.</p>
          <label className={label}>Why is it cancelled?<input className={input} aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <button type="button" className="btn-primary" disabled={reason.trim().length < 3} onClick={cancel}>Cancel the letter</button>
        </div>
      </Drawer>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
const EMPTY = { name: '', kind: 'offer', audience: 'any', subject: '', body: '', signatory_name: '', signatory_title: '', serial_prefix: 'LTR', serial_format: '{PREFIX}/{FY}/{SEQ:4}', custom_fields: [], active: true };

/** The serial number a format would give, worked out here so the admin sees it while typing (the server checks it again on save). */
function exampleSerial(format, prefix) {
  const d = new Date();
  const y = d.getFullYear();
  const start = d.getMonth() + 1 >= 4 ? y : y - 1;
  const m = /\{SEQ(?::(\d{1,2}))?\}/.exec(format);
  const width = m && m[1] ? Number(m[1]) : 4;
  return format.replace(/\{PREFIX\}/g, (prefix || 'LTR').toUpperCase()).replace(/\{OFFICE\}/g, 'ahmedabad').replace(/\{YYYY\}/g, String(y)).replace(/\{YY\}/g, String(y % 100).padStart(2, '0')).replace(/\{MM\}/g, String(d.getMonth() + 1).padStart(2, '0'))
    .replace(/\{FY\}/g, `${start}-${String((start + 1) % 100).padStart(2, '0')}`).replace(/\{SEQ(?::\d{1,2})?\}/, '1'.padStart(width, '0'));
}

/** A template saved before the editor existed is plain text (blank line = new paragraph): shown in the editor as paragraphs. */
const escapeHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const toEditorHtml = (text) => (/<[a-z][\s\S]*>/i.test(text || '') ? text : String(text || '').split(/\n{2,}/).filter((x) => x.trim() !== '').map((x) => `<p>${escapeHtml(x).replace(/\n/g, '<br>')}</p>`).join(''));
const plainOf = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();

function TemplateDrawer({ template, catalog, onClose, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const [v, setV] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);
  const [loadKey, setLoadKey] = useState(0);
  const [newField, setNewField] = useState({ label: '', hint: '' });
  const open = template !== null;
  useEffect(() => {
    if (template === null) return;
    const loaded = template.id ? { ...EMPTY, ...Object.fromEntries(Object.entries(template).filter(([k]) => k in EMPTY).map(([k, x]) => [k, x ?? ''])) } : { ...EMPTY };
    setV({ ...loaded, body: toEditorHtml(loaded.body) });
    setLoadKey((k) => k + 1); // the editor loads its text when this changes
  }, [template]);
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));

  // The fields that fill themselves, the template's own fields, and names used in the text that are neither (they are still asked when issuing).
  const builtInKeys = useMemo(() => new Set([...(catalog?.common || []), ...(catalog?.employee || []), ...(catalog?.recipient || [])].map((x) => x.key)), [catalog]);
  const ownFields = v.custom_fields || [];
  const usedNames = useMemo(() => [...new Set([...String(v.subject || '').matchAll(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi), ...String(v.body || '').matchAll(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi)].map((m) => m[1].toLowerCase()))], [v.subject, v.body]);
  const undefinedNames = usedNames.filter((k) => !builtInKeys.has(k) && !ownFields.some((x) => x.key === k));
  const nameToKey = (label) => {
    let key = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36);
    if (!key) return '';
    if (!/^[a-z]/.test(key)) key = `f_${key}`;
    let candidate = key;
    for (let n = 2; builtInKeys.has(candidate) || ownFields.some((x) => x.key === candidate); n += 1) candidate = `${key}_${n}`;
    return candidate;
  };
  function addField(label, hint, { place = true } = {}) {
    const key = nameToKey(label);
    if (!key || !String(label).trim()) return;
    setV((c) => ({ ...c, custom_fields: [...(c.custom_fields || []), { key, label: String(label).trim(), hint: String(hint || '').trim() || null }] }));
    setNewField({ label: '', hint: '' });
    if (place) insert(`{{${key}}}`);
  }
  function defineUsed(key) {
    setV((c) => ({ ...c, custom_fields: [...(c.custom_fields || []), { key, label: key.replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase()), hint: null }] }));
  }
  const removeField = (key) => setV((c) => ({ ...c, custom_fields: (c.custom_fields || []).filter((x) => x.key !== key) }));

  function insert(token) {
    // at the caret of the letter text (the rich-text editor keeps its own selection)
    if (bodyRef.current) bodyRef.current.insertText(token);
    else setV((c) => ({ ...c, body: `${c.body}${token}` }));
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const payload = { name: v.name, kind: String(v.kind).trim().toLowerCase(), audience: v.audience, subject: v.subject || null, body: v.body, signatory_name: v.signatory_name || null, signatory_title: v.signatory_title || null, serial_prefix: v.serial_prefix, serial_format: v.serial_format, custom_fields: (v.custom_fields || []).map((x) => ({ key: x.key, label: x.label, hint: x.hint || null })), active: v.active };
    try {
      if (template.id) await apiClient.patch(`/letters/templates/${template.id}`, payload); else await apiClient.post('/letters/templates', payload);
      pushSuccess('Template saved');
      onSaved(); onClose();
    } catch (err) { pushError(apiErrorMessage(err, 'Could not save the template'), 'Not saved'); } finally { setBusy(false); }
  }
  const chip = 'rounded-full border border-tertiary-200 bg-white px-2 py-0.5 text-[11px] text-tertiary-700 hover:bg-primary-50';
  return (
    <Drawer open={open} onClose={onClose} size="xl" tone={template?.id ? 'edit' : 'create'} title={template?.id ? 'Edit template' : 'New template'} footer={
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" form="letter-template-form" className="btn-primary" disabled={busy || !v.name.trim() || !plainOf(v.body)}>{busy ? 'Saving…' : 'Save template'}</button>
      </>
    }>
      <form id="letter-template-form" onSubmit={save} className="space-y-4" data-testid="template-form">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={label}>Name<input required className={input} aria-label="Template name" value={v.name} onChange={set('name')} placeholder="Offer letter" /></label>
          <label className={label}>Kind
            <input list="letter-kinds" className={input} aria-label="Kind" value={v.kind} onChange={set('kind')} />
            <datalist id="letter-kinds">{(catalog?.kinds || []).map((k) => <option key={k} value={k} />)}</datalist>
          </label>
          <label className={label}>Meant for<select className={input} value={v.audience} onChange={set('audience')}>{Object.entries(AUDIENCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        </div>

        <div className="rounded-xl border border-tertiary-100 bg-canvas-muted p-3">
          <p className="text-xs font-semibold text-tertiary-700">Serial number</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <label className={label}>Prefix<input className={input} aria-label="Serial prefix" maxLength={12} value={v.serial_prefix} onChange={set('serial_prefix')} /></label>
            <label className={`${label} sm:col-span-2`}>Format<input className={`${input} font-mono`} aria-label="Serial format" value={v.serial_format} onChange={set('serial_format')} /></label>
          </div>
          <p className="mt-2 text-xs text-tertiary-600">Looks like: <span className="font-mono font-semibold" data-testid="serial-example">{exampleSerial(v.serial_format, v.serial_prefix)}</span></p>
          <div className="mt-1 flex flex-wrap gap-1">{(catalog?.serial_tokens || []).map((t) => <button key={t.token} type="button" title={t.label} className={chip} onClick={() => setV((c) => ({ ...c, serial_format: `${c.serial_format}${t.token}` }))}>{t.token}</button>)}</div>
          <p className="mt-1 text-[11px] text-tertiary-500">Use exactly one {'{SEQ}'}. The numbering restarts when the text before it changes (a new financial year in the format, say). Numbers are never reused.</p>
        </div>

        <label className={label}>Subject (optional)<input className={input} aria-label="Subject" value={v.subject} onChange={set('subject')} placeholder="Offer of employment - {{designation}}" /></label>
        <div>
          <label className={label}>Letter text
          </label>
          <div data-testid="letter-editor" aria-label="Letter text"><RichTextEditor apiRef={bodyRef} resetKey={loadKey} value={v.body} onChange={(html) => setV((c) => ({ ...c, body: html }))} minHeight="16rem" placeholder="Dear {{employee_name}}, ... use the toolbar for bold, headings and lists" /></div>
          <p className="mt-1 text-[11px] text-tertiary-500">Format the text with the toolbar (bold, italic, underline, headings, lists, links). Put {'{{field}}'} where a value goes. Fields from the record fill themselves; any other name you write (for example {'{{ctc}}'}) is asked for when the letter is issued.</p>
          <div className="mt-1 flex flex-wrap gap-1" data-testid="field-chips">
            {[...(catalog?.common || []), ...(catalog?.employee || []), ...(catalog?.recipient || [])].map((f) => <button key={f.key} type="button" title={`${f.label} (fills itself)`} className={chip} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(`{{${f.key}}}`)}>{f.key}</button>)}
          </div>
          <p className="mt-1 text-[11px] text-tertiary-500">The fields above fill themselves from the company or the person&apos;s record.</p>

          <div className="mt-3 rounded-xl border border-primary-100 bg-primary-50/30 p-3" data-testid="custom-fields">
            <p className="text-xs font-semibold text-tertiary-700">Your own fields</p>
            <p className="mt-0.5 text-[11px] text-tertiary-600">Make a field of your own (office location, CTC, notice period, anything). It does not fill itself: whoever issues the letter types its value, and it appears in the letter and the PDF.</p>
            {ownFields.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1" data-testid="own-field-chips">
                {ownFields.map((x) => (
                  <span key={x.key} className="inline-flex items-center overflow-hidden rounded-full border border-primary-200 bg-white text-[11px] text-tertiary-800">
                    <button type="button" title={x.hint || x.label} className="px-2 py-0.5 hover:bg-primary-50" onClick={() => insert(`{{${x.key}}}`)}>{x.label} <span className="font-mono text-tertiary-500">{x.key}</span></button>
                    <button type="button" aria-label={`Remove the field ${x.label}`} className="border-l border-primary-100 px-1.5 py-0.5 text-tertiary-500 hover:bg-danger-50 hover:text-danger-600" onClick={() => removeField(x.key)}>&times;</button>
                  </span>
                ))}
              </div>
            )}
            {undefinedNames.length > 0 && (
              <p className="mt-2 text-[11px] text-tertiary-600" data-testid="undefined-fields">Used in the text but not defined (asked when the letter is issued): {undefinedNames.map((k) => <button key={k} type="button" className="mx-0.5 rounded-full border border-warning-200 bg-warning-50 px-2 py-0.5 text-warning-800 hover:bg-warning-100" title="Give it a label" onClick={() => defineUsed(k)}>{k} +</button>)}</p>
            )}
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input className={input} aria-label="New field label" placeholder="Field name, e.g. Office location" value={newField.label} maxLength={80} onChange={(e) => setNewField((n) => ({ ...n, label: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addField(newField.label, newField.hint); } }} />
              <input className={input} aria-label="New field hint" placeholder="Help for the person issuing (optional)" value={newField.hint} maxLength={200} onChange={(e) => setNewField((n) => ({ ...n, hint: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addField(newField.label, newField.hint); } }} />
              <button type="button" className="btn-secondary" data-testid="add-own-field" disabled={!newField.label.trim()} onClick={() => addField(newField.label, newField.hint)}>Add field</button>
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>Signed by (name)<input className={input} value={v.signatory_name} onChange={set('signatory_name')} /></label>
          <label className={label}>Signed by (title)<input className={input} value={v.signatory_title} onChange={set('signatory_title')} /></label>
        </div>
        <label className="flex items-center gap-2 text-sm text-tertiary-700"><input type="checkbox" checked={v.active} onChange={(e) => setV((c) => ({ ...c, active: e.target.checked }))} /> Active (can be used to issue letters)</label>
      </form>
    </Drawer>
  );
}

function Templates({ canManage, catalog }) {
  const { pushError, pushSuccess } = useAlerts();
  const [rows, reload] = useApi('/letters/templates', [], { all: 1 });
  const [editing, setEditing] = useState(null);
  async function remove(t) {
    if (!await confirmAction(`Delete the template "${t.name}"? Letters already issued from it are kept.`)) return;
    try { await apiClient.delete(`/letters/templates/${t.id}`); pushSuccess('Template deleted'); reload(); } catch (err) { pushError(apiErrorMessage(err, 'Could not delete'), 'Not deleted'); }
  }
  return (
    <div className="space-y-3" data-testid="letter-templates">
      {canManage && <div className="flex justify-end"><button type="button" className="btn-primary inline-flex items-center gap-2" data-testid="new-template" onClick={() => setEditing({})}><Plus className="h-4 w-4" />New template</button></div>}
      {!rows ? <Skeleton className="h-40" /> : rows.length === 0 ? <EmptyState title="No templates yet" description={canManage ? 'Write your first letter template: an offer, appointment or appraisal letter.' : 'An admin has not added any template yet.'} /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((t) => (
            <section key={t.id} className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="template-card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-heading text-sm font-semibold text-tertiary-900">{t.name}</h3>
                  <p className="text-xs text-tertiary-500">{kindLabel(t.kind)} · for {AUDIENCE_LABEL[t.audience]}</p>
                </div>
                <Pill tone={t.active ? 'green' : 'gray'}>{t.active ? 'Active' : 'Off'}</Pill>
              </div>
              <p className="mt-2 text-xs text-tertiary-600">Serial number: <span className="font-mono font-semibold">{t.example_serial}</span> <span className="text-tertiary-400">({t.serial_format})</span></p>
              {t.fields.length > 0 && <p className="mt-1 text-[11px] text-tertiary-500">Fields: {t.fields.join(', ')}</p>}
              {canManage && (
                <div className="mt-3 flex gap-2">
                  <button type="button" className="btn-secondary inline-flex items-center gap-1 text-xs" onClick={() => setEditing(t)}><Pencil className="h-3.5 w-3.5" />Edit</button>
                  <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => remove(t)}>Delete</button>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
      <TemplateDrawer template={editing} catalog={catalog} onClose={() => setEditing(null)} onSaved={reload} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
export default function LettersPage() {
  const { user } = useAuth();
  const isAdmin = isAdminUser(user);
  const canIssue = allowed(user, 'letters.create', isAdmin);
  const canManage = allowed(user, 'letters.manage', isAdmin);
  const [view, setView] = useState('issued');
  const [templates, reloadTemplates] = useApi('/letters/templates', []);
  const [catalog] = useApi('/letters/fields', []);
  const list = useCallback(() => templates || [], [templates]);
  useEffect(() => { if (view === 'issued') reloadTemplates(); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-4" data-testid="letters-page">
      <div className="flex gap-2" role="tablist" aria-label="Letters">
        {[['issued', 'Issued letters'], ['templates', 'Templates']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} data-testid={`letters-view-${k}`} onClick={() => setView(k)} className={`rounded-xl px-4 py-2 text-sm font-medium ${view === k ? 'bg-primary-600 text-white' : 'border bg-white text-tertiary-700 hover:bg-primary-50'}`}>{l}</button>
        ))}
      </div>
      {view === 'issued' ? <IssuedLetters templates={list()} canIssue={canIssue} /> : <Templates canManage={canManage} catalog={catalog} />}
    </div>
  );
}
