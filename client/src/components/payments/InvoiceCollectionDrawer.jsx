import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../ui/Drawer.jsx';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Payment collection for one unpaid invoice: its due date, the next follow-up date and the log of every chase (what was said, who did it, when).
 * `basePath` is the invoice's API path, e.g. /billing/invoices/<id> or /group-cash/invoices/<id>. `canSetDueDate` is false where the due date is
 * part of the invoice itself (Book Keeping edits it on the invoice).
 */
export default function InvoiceCollectionDrawer({ invoice, title, basePath, onClose, onChanged, canSetDueDate = true }) {
  const { pushError, pushSuccess } = useAlerts();
  const [log, setLog] = useState([]);
  const [terms, setTerms] = useState({ due_date: '', next_followup_date: '' });
  const [form, setForm] = useState({ note: '', followed_on: today(), next_followup_date: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!invoice) return;
    apiClient.get(`${basePath}/followups`).then(({ data }) => {
      setLog(data.data.followups || []);
      setTerms({ due_date: data.data.terms.due_date || '', next_followup_date: data.data.terms.next_followup_date || '' });
    }).catch((err) => pushError(apiErrorMessage(err, 'Could not load the follow-ups'), 'Load failed'));
  }, [invoice, basePath]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setForm({ note: '', followed_on: today(), next_followup_date: '' });
    setLog([]);
    load();
  }, [load]);

  async function saveTerms() {
    setSaving(true);
    try {
      await apiClient.patch(`${basePath}/collection`, { ...(canSetDueDate ? { due_date: terms.due_date || null } : {}), next_followup_date: terms.next_followup_date || null });
      pushSuccess('Dates saved');
      onChanged();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save the dates'), 'Save failed');
    } finally { setSaving(false); }
  }

  async function addFollowup(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post(`${basePath}/followups`, { note: form.note, followed_on: form.followed_on || undefined, next_followup_date: form.next_followup_date || null });
      pushSuccess('Follow-up saved');
      setForm({ note: '', followed_on: today(), next_followup_date: '' });
      load();
      onChanged();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save the follow-up'), 'Save failed');
    } finally { setSaving(false); }
  }

  const input = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm';
  return (
    <Drawer open={Boolean(invoice)} title={title || 'Payment follow-up'} onClose={onClose} size="md">
      {invoice && (
        <div className="space-y-5 text-sm" data-testid="collection-drawer">
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">When to collect</h4>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-tertiary-600">Due date
                <input type="date" aria-label="Due date" className={input} value={terms.due_date} disabled={!canSetDueDate} onChange={(e) => setTerms((t) => ({ ...t, due_date: e.target.value }))} />
              </label>
              <label className="block text-xs font-medium text-tertiary-600">Next follow-up date
                <input type="date" aria-label="Next follow-up date" className={input} value={terms.next_followup_date} onChange={(e) => setTerms((t) => ({ ...t, next_followup_date: e.target.value }))} />
              </label>
            </div>
            {!canSetDueDate && <p className="text-xs text-tertiary-500">The due date is part of the invoice; change it by editing the invoice.</p>}
            <button type="button" className="btn-secondary text-xs" disabled={saving} onClick={saveTerms}>Save dates</button>
          </section>

          <form onSubmit={addFollowup} className="space-y-2 rounded-xl border border-tertiary-100 bg-canvas-muted p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">Add a follow-up</h4>
            <label className="block text-xs font-medium text-tertiary-600">What was said or agreed
              <textarea required rows={3} aria-label="Follow-up note" className={input} value={form.note} placeholder="Called accounts; they promised payment by Friday" onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-tertiary-600">Done on
                <input type="date" className={input} value={form.followed_on} onChange={(e) => setForm((f) => ({ ...f, followed_on: e.target.value }))} />
              </label>
              <label className="block text-xs font-medium text-tertiary-600">Follow up again on
                <input type="date" aria-label="Follow up again on" className={input} value={form.next_followup_date} onChange={(e) => setForm((f) => ({ ...f, next_followup_date: e.target.value }))} />
              </label>
            </div>
            <button type="submit" className="btn-primary text-xs" disabled={saving || !form.note.trim()}>Save follow-up</button>
          </form>

          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-tertiary-500">History ({log.length})</h4>
            <ul className="divide-y divide-tertiary-100 rounded-xl border border-tertiary-100">
              {log.length === 0 && <li className="px-3 py-3 text-xs text-tertiary-500">No follow-up yet.</li>}
              {log.map((f) => (
                <li key={f.id} className="px-3 py-2" data-testid="followup-row">
                  <p className="text-xs text-tertiary-500">{f.followed_on}{f.by ? ` · ${f.by}` : ''}{f.next_followup_date ? ` · next ${f.next_followup_date}` : ''}</p>
                  <p className="whitespace-pre-wrap text-tertiary-900">{f.note}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Drawer>
  );
}
