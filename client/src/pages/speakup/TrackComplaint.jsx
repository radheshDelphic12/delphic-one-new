import { useState } from 'react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import ReporterView from './ReporterView.jsx';
import { publicCall } from './speakUp.js';

const FIELD = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm font-mono uppercase focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';

/**
 * Follow a complaint with its reference number and tracking code, and add more information or evidence. For an anonymous complaint this
 * is the only way in. The request is sent without a token, so it is not tied to the signed-in person.
 */
export default function TrackComplaint() {
  const { pushError } = useAlerts();
  const [ref, setRef] = useState('');
  const [code, setCode] = useState('');
  const [item, setItem] = useState(null);
  const [busy, setBusy] = useState(false);

  async function look(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await publicCall('/track', { case_no: ref.trim(), code: code.trim() });
      setItem(data.case);
    } catch (err) {
      pushError(err.status === 404 ? 'No complaint matches that reference number and tracking code. Check both and try again.' : err.status === 429 ? 'Too many attempts. Please wait a while and try again.' : err.message, 'Not found');
    } finally {
      setBusy(false);
    }
  }

  async function reply(body, files) {
    const form = new FormData();
    form.append('case_no', ref.trim());
    form.append('code', code.trim());
    form.append('body', body);
    files.forEach((f) => form.append('files', f));
    const data = await publicCall('/reply', form);
    setItem(data.case);
  }

  if (item) {
    return (
      <div className="space-y-3 rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card">
        <button type="button" className="btn-ghost text-sm" onClick={() => { setItem(null); setCode(''); }}>← Track another complaint</button>
        <ReporterView item={item} onReply={reply} downloadable={false} />
      </div>
    );
  }
  return (
    <form onSubmit={look} className="max-w-xl space-y-4 rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card" data-testid="speakup-track">
      <div>
        <h3 className="font-heading text-base font-semibold text-tertiary-900">Track a complaint</h3>
        <p className="mt-1 text-sm text-tertiary-500">Enter the reference number and the tracking code you were given when you raised it anonymously. You can then see its status and add more information or evidence.</p>
      </div>
      <label className="block text-xs font-medium text-tertiary-600">Complaint reference number
        <input required className={FIELD} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="SU-2026-0001" autoComplete="off" />
      </label>
      <label className="block text-xs font-medium text-tertiary-600">Tracking code
        <input required className={FIELD} value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX" autoComplete="off" />
      </label>
      <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Track'}</button>
    </form>
  );
}
