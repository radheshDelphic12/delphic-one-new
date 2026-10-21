import { useEffect, useMemo, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../components/ui/Drawer.jsx';

const inputCls = 'mt-1 block w-full rounded-xl border border-tertiary-200 bg-white px-3 py-2 text-sm';
const labelCls = 'block text-xs font-medium text-tertiary-600';

/**
 * Email the selected requirements to vendors. Step 1: choose active vendors (filter by specialization or name; the vendor's owner is
 * CC'd). Step 2: the exact email and recipients are shown before anything is sent. Every send is logged on the server.
 */
export default function VendorEmailDrawer({ open, requirementIds, onClose, onSent }) {
  const { pushError, pushSuccess } = useAlerts();
  const [step, setStep] = useState('pick');
  const [vendors, setVendors] = useState([]);
  const [specializations, setSpecializations] = useState([]);
  const [specialization, setSpecialization] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState([]);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('pick');
    setPicked([]);
    setPreview(null);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    const t = setTimeout(() => {
      apiClient.get('/vendor-email/vendors', { params: { ...(specialization ? { specialization } : {}), ...(search ? { search } : {}) } })
        .then(({ data }) => { if (live) { setVendors(data.data.vendors); setSpecializations(data.data.specializations); } })
        .catch((err) => pushError(apiErrorMessage(err, 'Failed to load vendors'), 'Something went wrong'));
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [open, specialization, search, pushError]);

  const emailable = useMemo(() => vendors.filter((v) => v.can_email), [vendors]);
  const allPicked = emailable.length > 0 && emailable.every((v) => picked.includes(v.id));
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const body = () => ({ requirement_ids: requirementIds, vendor_ids: picked, message: message.trim() || null });

  async function showPreview() {
    setBusy(true);
    try {
      const { data } = await apiClient.post('/vendor-email/preview', body());
      setPreview(data.data);
      setStep('preview');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not build the email'), 'Not ready');
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    try {
      const { data } = await apiClient.post('/vendor-email/send', body());
      pushSuccess(`Email queued for ${data.data.queued} ${data.data.queued === 1 ? 'vendor' : 'vendors'}`);
      onSent?.();
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not send'), 'Not sent');
    } finally {
      setBusy(false);
    }
  }

  const footer = step === 'pick'
    ? (
      <>
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={!picked.length || busy} onClick={showPreview}>Preview ({picked.length})</button>
      </>
    )
    : (
      <>
        <button type="button" className="btn-secondary" onClick={() => setStep('pick')} disabled={busy}>Back</button>
        <button type="button" className="btn-primary" disabled={busy || !preview?.recipients?.length} onClick={send}>{busy ? 'Sending…' : `Send to ${preview?.recipients?.length || 0}`}</button>
      </>
    );

  return (
    <Drawer open={open} title={`Email ${requirementIds.length} ${requirementIds.length === 1 ? 'requirement' : 'requirements'} to vendors`} onClose={onClose} size="lg" footer={footer}>
      {step === 'pick' ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelCls}>Specialization
              <select className={inputCls} value={specialization} onChange={(e) => setSpecialization(e.target.value)}>
                <option value="">All vendors</option>
                {specializations.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className={labelCls}>Search by name<input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Vendor name" /></label>
          </div>
          <label className="flex items-center gap-2 text-sm text-tertiary-700">
            <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? [] : emailable.map((v) => v.id))} /> Select all shown ({emailable.length})
          </label>
          <ul className="divide-y divide-tertiary-100 rounded-xl border border-tertiary-100">
            {vendors.map((v) => (
              <li key={v.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                <input type="checkbox" className="mt-1" disabled={!v.can_email} checked={picked.includes(v.id)} onChange={() => toggle(v.id)} aria-label={`Select ${v.name}`} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-tertiary-900">{v.name}</p>
                  <p className="text-xs text-tertiary-500">{v.email || 'No contact email on this vendor'}{v.owner ? ` · CC ${v.owner.name}` : ''}</p>
                  {v.specializations.length > 0 && <p className="text-xs text-tertiary-400">{v.specializations.join(', ')}</p>}
                </div>
              </li>
            ))}
            {!vendors.length && <li className="px-3 py-4 text-sm text-tertiary-500">No active vendors match.</li>}
          </ul>
          <label className={labelCls}>Note at the top of the email (optional)<textarea rows={3} className={inputCls} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
        </div>
      ) : (
        preview && (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-tertiary-600">Subject</p>
              <p className="text-sm font-semibold text-tertiary-900">{preview.subject}</p>
            </div>
            <pre className="whitespace-pre-wrap rounded-xl bg-tertiary-50 p-3 text-sm text-tertiary-800">{preview.body_text}</pre>
            <div>
              <p className="text-xs font-medium text-tertiary-600">Goes to ({preview.recipients.length})</p>
              <ul className="mt-1 divide-y divide-tertiary-100 rounded-xl border border-tertiary-100 text-sm">
                {preview.recipients.map((r) => (
                  <li key={r.account_id} className="px-3 py-1.5"><span className="font-medium">{r.vendor}</span> <span className="text-xs text-tertiary-500">{r.to}{r.cc ? ` · CC ${r.cc}` : ''}</span></li>
                ))}
              </ul>
            </div>
            {preview.skipped.length > 0 && (
              <div className="rounded-xl bg-warning-50 p-3 text-xs text-warning-700">
                Not included: {preview.skipped.map((s) => `${s.vendor || 'unknown'} (${s.reason})`).join('; ')}
              </div>
            )}
          </div>
        )
      )}
    </Drawer>
  );
}
