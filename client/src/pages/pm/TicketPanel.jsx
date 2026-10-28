import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { pmApi, pmError, PRIORITY_OPTIONS, PRIORITY_TONE, TYPE_OPTIONS, CATEGORY_TONE } from '../../lib/pm/api.js';
import { dateLabel } from '../../lib/format.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';

const INPUT = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm';
const ACTION_LABEL = {
  ticket_created: 'Created', status_changed: 'Status', priority_changed: 'Priority', assignee_membership_id_changed: 'Assignee', due_date_changed: 'Due date',
  title_changed: 'Title', description_changed: 'Description', type_changed: 'Type', contract_id_changed: 'Contract', resolution_changed: 'Resolution',
};

/**
 * One ticket: edit its fields, move it through the statuses (a done status needs a resolution), comment, see the history.
 * `ticketId` null creates a new ticket in `project`. props: project (with members, contracts), meta (statuses), canManage.
 */
export default function TicketPanel({ open, ticketId, project, meta, canManage, onClose, onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [t, setT] = useState(null);
  const [form, setForm] = useState({});
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const isNew = !ticketId;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setComment('');
    if (isNew) { setT(null); setForm({ title: '', description: '', type: 'task', priority: 'medium', status_key: 'open', assignee_membership_id: '', contract_id: '', due_date: '' }); return; }
    pmApi.ticket(ticketId).then((d) => {
      setT(d);
      setForm({ title: d.title, description: d.description || '', type: d.type, priority: d.priority, status_key: d.status_key, assignee_membership_id: d.assignee?.id || '', contract_id: d.contract_id || '', due_date: d.due_date || '', resolution: d.resolution || '' });
    }).catch((e) => pushError(pmError(e, 'Could not load the ticket'), 'Load failed'));
  }, [open, ticketId, isNew, pushError]);

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
    try { await pmApi.comment(ticketId, comment.trim()); setComment(''); setT(await pmApi.ticket(ticketId)); } catch (e) { pushError(pmError(e, 'Could not add the comment'), 'Failed'); }
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
          {!isNew && wantsResolution && (
            <label className="block text-xs text-tertiary-500">Resolution <span className="text-danger-600">(required for a done status)</span>
              <textarea className={INPUT} rows={3} value={form.resolution || ''} onChange={(e) => set('resolution', e.target.value)} disabled={!canEdit} data-testid="pm-resolution" />
            </label>
          )}
          {isNew && wantsResolution && <p className="text-xs text-amber-700">A new ticket cannot start in a done status.</p>}

          {!isNew && t && (
            <>
              <section>
                <h4 className="mb-2 text-sm font-semibold text-tertiary-900">Comments</h4>
                <ul className="space-y-2">
                  {t.comments.length === 0 && <li className="text-xs text-tertiary-400">No comments yet.</li>}
                  {t.comments.map((c) => (
                    <li key={c.id} className="rounded-xl bg-tertiary-50 px-3 py-2 text-sm"><div className="text-xs text-tertiary-500">{c.author} · {dateLabel(c.created_at)}</div><div className="whitespace-pre-wrap">{c.body}</div></li>
                  ))}
                </ul>
                <div className="mt-2 flex gap-2">
                  <input className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="Write a comment..." value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addComment()} data-testid="pm-comment-input" />
                  <button type="button" className="rounded-xl border px-3 py-2 text-sm" onClick={addComment}>Add</button>
                </div>
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
