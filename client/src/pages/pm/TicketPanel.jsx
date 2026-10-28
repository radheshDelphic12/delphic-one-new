import { useEffect, useRef, useState } from 'react';
import { Paperclip, Trash2, X } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import apiClient from '../../lib/apiClient.js';
import { pmApi, pmError, PRIORITY_OPTIONS, PRIORITY_TONE, TYPE_OPTIONS, CATEGORY_TONE } from '../../lib/pm/api.js';
import { dateLabel } from '../../lib/format.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';

const INPUT = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm';
const ACTION_LABEL = {
  ticket_created: 'Created', status_changed: 'Status', priority_changed: 'Priority', assignee_membership_id_changed: 'Assignee', due_date_changed: 'Due date',
  attachment_added: 'File attached', attachment_removed: 'File removed', title_changed: 'Title', description_changed: 'Description', type_changed: 'Type', contract_id_changed: 'Contract', resolution_changed: 'Resolution',
};

/**
 * One ticket: edit its fields, move it through the statuses (a done status needs a resolution), comment, see the history.
 * `ticketId` null creates a new ticket in `project`. props: project (with members, contracts), meta (statuses), canManage.
 */
export default function TicketPanel({ open, ticketId, presetStatus, project, meta, canManage, onClose, onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [t, setT] = useState(null);
  const [form, setForm] = useState({});
  const [comment, setComment] = useState('');
  const [commentPublic, setCommentPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const isNew = !ticketId;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setComment('');
    if (isNew) { setT(null); setForm({ title: '', description: '', type: 'task', priority: 'medium', status_key: 'open', assignee_membership_id: '', contract_id: '', due_date: '', internal_only: false, custom_values: {} }); return; }
    pmApi.ticket(ticketId).then((d) => {
      setT(d);
      setForm({ title: d.title, description: d.description || '', type: d.type, priority: d.priority, status_key: presetStatus || d.status_key, assignee_membership_id: d.assignee?.id || '', contract_id: d.contract_id || '', due_date: d.due_date || '', resolution: d.resolution || '', internal_only: d.internal_only, custom_values: d.custom_values || {} });
    }).catch((e) => pushError(pmError(e, 'Could not load the ticket'), 'Load failed'));
  }, [open, ticketId, presetStatus, isNew, pushError]);

  const statusCategory = (key) => meta.statuses.find((s) => s.key === key)?.category;
  const wantsResolution = statusCategory(form.status_key) === 'done';
  const canEdit = canManage || isNew || (t && (t.assignee?.id === project.me || t.reporter?.id === project.me));

  async function save() {
    setBusy(true);
    try {
      const body = { ...form, assignee_membership_id: form.assignee_membership_id || null, contract_id: form.contract_id || null, due_date: form.due_date || null };
      if (isNew) { delete body.resolution; if (wantsResolution) delete body.status_key; await pmApi.createTicket(project.id, body); }
      else await pmApi.updateTicket(ticketId, body);
      pushSuccess(isNew ? 'Ticket created' : 'Ticket saved');
      onChanged();
      if (isNew) onClose();
      else setT(await pmApi.ticket(ticketId));
    } catch (e) { pushError(pmError(e, 'Could not save the ticket'), 'Could not save'); } finally { setBusy(false); }
  }
  async function addComment() {
    if (!comment.trim()) return;
    try { await pmApi.comment(ticketId, comment.trim(), commentPublic); setComment(''); setCommentPublic(false); setT(await pmApi.ticket(ticketId)); } catch (e) { pushError(pmError(e, 'Could not add the comment'), 'Failed'); }
  }
  async function attach(file) {
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    try { await apiClient.post(`/pm/tickets/${ticketId}/attachments`, body); setT(await pmApi.ticket(ticketId)); pushSuccess('File attached'); } catch (e) { pushError(pmError(e, 'Could not attach the file'), 'Failed'); }
    if (fileRef.current) fileRef.current.value = '';
  }
  async function download(a) {
    try {
      const res = await apiClient.get(`/pm/attachments/${a.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url; link.download = a.filename; link.click();
      URL.revokeObjectURL(url);
    } catch (e) { pushError(pmError(e, 'Could not download the file'), 'Failed'); }
  }
  async function dropFile(a) {
    if (!window.confirm(`Remove ${a.filename}?`)) return;
    try { await pmApi.deleteAttachment(a.id); setT(await pmApi.ticket(ticketId)); } catch (e) { pushError(pmError(e, 'Could not remove the file'), 'Failed'); }
  }
  async function remove() {
    if (!window.confirm('Delete this ticket? Its comments and history go with it.')) return;
    try { await pmApi.deleteTicket(ticketId); pushSuccess('Ticket deleted'); onChanged(); onClose(); } catch (e) { pushError(pmError(e, 'Could not delete'), 'Failed'); }
  }

  const memberOptions = project.members.map((m) => ({ value: m.membership_id, label: m.name }));
  return (
    <Drawer open={open} onClose={onClose} size="xl" tone={isNew ? 'create' : 'edit'} title={isNew ? `New ticket · ${project.code}` : `#${t?.number ?? ''} · ${project.code}`}
      footer={canEdit ? (
        <div className="flex items-center justify-between gap-2">
          {!isNew && canManage ? <button type="button" className="inline-flex items-center gap-1 rounded-xl border border-danger-200 px-3 py-2 text-sm text-danger-600 hover:bg-danger-50" onClick={remove}><Trash2 className="h-4 w-4" />Delete</button> : <span />}
          <div className="flex gap-2"><button type="button" className="rounded-xl border px-3 py-2 text-sm" onClick={onClose}>Close</button><button type="button" className="btn-primary" disabled={busy || !form.title || form.title.trim().length < 2} onClick={save}>{isNew ? 'Create ticket' : 'Save changes'}</button></div>
        </div>
      ) : null}
    >
      {(isNew || t) && (
        <div className="space-y-4" data-testid="pm-ticket-panel">
          <label className="block text-xs text-tertiary-500">Title<input className={INPUT} value={form.title || ''} onChange={(e) => set('title', e.target.value)} disabled={!canEdit} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-tertiary-500">Status
              <select className={INPUT} value={form.status_key} onChange={(e) => set('status_key', e.target.value)} disabled={!canEdit}>
                {meta.statuses.filter((s) => s.is_active || s.key === form.status_key).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            <label className="block text-xs text-tertiary-500">Priority<select className={INPUT} value={form.priority} onChange={(e) => set('priority', e.target.value)} disabled={!canEdit}>{PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
            <label className="block text-xs text-tertiary-500">Assignee
              <select className={INPUT} value={form.assignee_membership_id || ''} onChange={(e) => set('assignee_membership_id', e.target.value)} disabled={!canEdit}>
                <option value="">Unassigned</option>{memberOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block text-xs text-tertiary-500">Due date<input type="date" className={INPUT} value={form.due_date || ''} onChange={(e) => set('due_date', e.target.value)} disabled={!canEdit} /></label>
            <label className="block text-xs text-tertiary-500">Type<select className={INPUT} value={form.type} onChange={(e) => set('type', e.target.value)} disabled={!canEdit}>{TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
            {project.contracts.length > 0 && (
              <label className="block text-xs text-tertiary-500">Contract
                <select className={INPUT} value={form.contract_id || ''} onChange={(e) => set('contract_id', e.target.value)} disabled={!canEdit}>
                  <option value="">Not tagged</option>{project.contracts.map((c) => <option key={c.contract_id} value={c.contract_id}>{c.title}</option>)}
                </select>
              </label>
            )}
          </div>
          <label className="block text-xs text-tertiary-500">Description<textarea className={INPUT} rows={4} value={form.description || ''} onChange={(e) => set('description', e.target.value)} disabled={!canEdit} /></label>
          {project.fields.filter((f) => f.is_active).length > 0 && (
            <div className="grid grid-cols-2 gap-3" data-testid="pm-custom-fields">
              {project.fields.filter((f) => f.is_active).map((f) => {
                const val = form.custom_values?.[f.key] ?? '';
                const setVal = (v) => set('custom_values', { ...(form.custom_values || {}), [f.key]: v === '' ? null : v });
                const label = <>{f.label}{f.required && <span className="text-danger-600"> *</span>}</>;
                return (
                  <label key={f.key} className="block text-xs text-tertiary-500">{label}
                    {f.type === 'select' ? (
                      <select className={INPUT} value={val} onChange={(e) => setVal(e.target.value)} disabled={!canEdit} data-testid={`pm-cf-${f.key}`}><option value="">Not set</option>{(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
                    ) : (
                      <input className={INPUT} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={val} onChange={(e) => setVal(e.target.value)} disabled={!canEdit} data-testid={`pm-cf-${f.key}`} />
                    )}
                  </label>
                );
              })}
            </div>
          )}
          {canManage && (
            <label className="flex items-center gap-2 text-xs text-tertiary-600"><input type="checkbox" checked={Boolean(form.internal_only)} onChange={(e) => set('internal_only', e.target.checked)} disabled={!canEdit} data-testid="pm-internal-only" />Hide from shared client / vendor links</label>
          )}
          {!isNew && wantsResolution && (
            <label className="block text-xs text-tertiary-500">Resolution <span className="text-danger-600">(required for a done status)</span>
              <textarea className={INPUT} rows={3} value={form.resolution || ''} onChange={(e) => set('resolution', e.target.value)} disabled={!canEdit} data-testid="pm-resolution" />
            </label>
          )}
          {isNew && wantsResolution && <p className="text-xs text-amber-700">A new ticket cannot start in a done status.</p>}

          {!isNew && t && (
            <>
              <section>
                <h4 className="mb-2 flex items-center justify-between text-sm font-semibold text-tertiary-900">Attachments
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-xl border px-2 py-1 text-xs font-normal hover:bg-primary-50"><Paperclip className="h-3.5 w-3.5" />Attach a file
                    <input ref={fileRef} type="file" className="hidden" data-testid="pm-attach-input" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg" onChange={(e) => attach(e.target.files?.[0])} />
                  </label>
                </h4>
                <ul className="space-y-1" data-testid="pm-attachments">
                  {t.attachments.length === 0 && <li className="text-xs text-tertiary-400">No files attached.</li>}
                  {t.attachments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 rounded-xl bg-tertiary-50 px-3 py-1.5 text-sm">
                      <button type="button" className="truncate text-left text-primary-700 hover:underline" onClick={() => download(a)}>{a.filename}</button>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-tertiary-500">{Math.max(1, Math.round(a.size_bytes / 1024))} KB · {a.uploaded_by}{a.can_delete && <button type="button" title="Remove" className="text-tertiary-400 hover:text-danger-600" onClick={() => dropFile(a)}><X className="h-3.5 w-3.5" /></button>}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h4 className="mb-2 text-sm font-semibold text-tertiary-900">Comments</h4>
                <ul className="space-y-2">
                  {t.comments.length === 0 && <li className="text-xs text-tertiary-400">No comments yet.</li>}
                  {t.comments.map((c) => (
                    <li key={c.id} className="rounded-xl bg-tertiary-50 px-3 py-2 text-sm"><div className="text-xs text-tertiary-500">{c.author} · {dateLabel(c.created_at)}{c.is_public && <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">{c.external ? 'From client / vendor' : 'Visible to client / vendor'}</span>}</div><div className="whitespace-pre-wrap">{c.body}</div></li>
                  ))}
                </ul>
                <div className="mt-2 flex gap-2">
                  <input className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="Write a comment..." value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addComment()} data-testid="pm-comment-input" />
                  <button type="button" className="rounded-xl border px-3 py-2 text-sm" onClick={addComment}>Add</button>
                </div>
                <label className="mt-1 flex items-center gap-2 text-xs text-tertiary-500"><input type="checkbox" checked={commentPublic} onChange={(e) => setCommentPublic(e.target.checked)} data-testid="pm-comment-public" />Visible to shared client / vendor links</label>
              </section>
              <section>
                <h4 className="mb-2 text-sm font-semibold text-tertiary-900">History</h4>
                <ul className="space-y-1 text-xs text-tertiary-600">
                  {t.activity.map((a) => (
                    <li key={a.id}><span className="font-medium">{a.actor}</span> · {ACTION_LABEL[a.action] || a.action}{a.from_value || a.to_value ? `: ${a.from_value || '-'} → ${a.to_value || '-'}` : ''} <span className="text-tertiary-400">({dateLabel(a.created_at)})</span></li>
                  ))}
                </ul>
              </section>
              <div className="flex items-center gap-2 text-xs text-tertiary-500"><Pill tone={CATEGORY_TONE[t.category]}>{t.status_label}</Pill><Pill tone={PRIORITY_TONE[t.priority]}>{t.priority}</Pill>{t.overdue && <Pill tone="red">Overdue</Pill>}</div>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
