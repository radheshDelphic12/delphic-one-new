import { useEffect, useState } from 'react';
import { Copy, Link2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { confirmAction } from '../../lib/confirmAction.js';
import { inputCls, labelCls } from './ui.jsx';

/** Delphic One > Leads > Lead form: the public link to share; every submission lands here as a new lead (source website). */
export default function LeadFormCard({ onNewLeads }) {
  const { pushError, pushSuccess } = useAlerts();
  const [form, setForm] = useState(undefined);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState({ title: '', intro: '' });
  const load = () => apiClient.get('/delphic-one/lead-form').then(({ data }) => { setForm(data.data); if (data.data) setEdit({ title: data.data.title, intro: data.data.intro || '' }); }).catch(() => setForm(null));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const link = form ? `${window.location.origin}/lead-form/${form.token}` : '';
  async function make() {
    if (form && !await confirmAction('Make a new link? The old link stops working.')) return;
    try { await apiClient.post('/delphic-one/lead-form'); pushSuccess('Form link ready'); load(); } catch (err) { pushError(apiErrorMessage(err, 'Could not make the link'), 'Not done'); }
  }
  async function save(patch, msg) {
    try { await apiClient.patch('/delphic-one/lead-form', patch); pushSuccess(msg); load(); onNewLeads?.(); } catch (err) { pushError(apiErrorMessage(err, 'Could not save'), 'Not saved'); }
  }
  if (form === undefined) return null;
  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="lead-form-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-heading text-sm font-semibold text-tertiary-900"><Link2 className="h-4 w-4 text-primary-600" />Lead form to share</h3>
        <button type="button" className="btn-ghost text-xs" onClick={() => setOpen((v) => !v)}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <div className="mt-2 space-y-2 text-sm">
          <p className="text-xs text-tertiary-500">Share this link on the website, by email or on social media. Whoever fills it in becomes a new lead here (source: website).</p>
          {!form ? <button type="button" className="btn-primary" onClick={make} data-testid="lead-form-make">Make the form link</button> : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <code className="max-w-full truncate rounded-lg bg-canvas-muted px-2 py-1 text-xs" data-testid="lead-form-link">{link}</code>
                <button type="button" className="btn-secondary inline-flex items-center gap-1 text-xs" onClick={() => navigator.clipboard?.writeText(link).then(() => pushSuccess('Link copied'))}><Copy className="h-3 w-3" />Copy</button>
                <a className="btn-ghost text-xs" href={link} target="_blank" rel="noreferrer">Open</a>
              </div>
              <p className="text-xs text-tertiary-600">{form.active ? 'On' : 'Off (the link shows "not available")'} · {form.submissions} lead{form.submissions === 1 ? '' : 's'} came in through it</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className={labelCls}>Title<input className={inputCls} value={edit.title} onChange={(e) => setEdit((v) => ({ ...v, title: e.target.value }))} /></label>
                <label className={labelCls}>Intro text<input className={inputCls} value={edit.intro} onChange={(e) => setEdit((v) => ({ ...v, intro: e.target.value }))} /></label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary text-xs" onClick={() => save({ title: edit.title.trim() || 'Talk to us', intro: edit.intro.trim() || null }, 'Form saved')}>Save text</button>
                <button type="button" className="btn-secondary text-xs" onClick={() => save({ active: !form.active }, form.active ? 'Form switched off' : 'Form switched on')}>{form.active ? 'Switch off' : 'Switch on'}</button>
                <button type="button" className="btn-ghost text-xs" onClick={make}>New link</button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
