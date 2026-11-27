import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../lib/apiClient.js';
import useSavedState from '../../lib/useSavedState.js';
import { promptAction } from '../../lib/confirmAction.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';

const Gap = ({ children }) => <span className="mr-1 inline-block rounded-full bg-danger-50 px-2 py-0.5 text-[11px] font-medium text-danger-700">{children}</span>;

const STAGES = [
  ['active', 'Active', 'bg-success-50 text-success-700'],
  ['lead', 'Lead', 'bg-primary-50 text-primary-700'],
  ['meeting_scheduled', 'Meeting scheduled', 'bg-amber-50 text-amber-800'],
  ['rescheduled', 'Rescheduled', 'bg-amber-50 text-amber-800'],
  ['dropped', 'Dropped', 'bg-tertiary-100 text-tertiary-600'],
];
const stageOf = (s) => STAGES.find(([k]) => k === s) || [s, s || '-', 'bg-tertiary-100 text-tertiary-600'];
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

/**
 * Reports > Missing contact details: every client and vendor whose point of contact has no phone or email (and extra contacts with gaps).
 * Filter by account type, status and what is missing. An account can be skipped for now: it moves to the Skipped list, from where
 * "Bring back" returns it to the list at any time.
 */
export default function ContactGaps() {
  const { pushError, pushSuccess } = useAlerts();
  const [type, setType] = useSavedState('reports.contactGaps.type', '');
  const [stage, setStage] = useSavedState('reports.contactGaps.stage', 'active');
  const [missing, setMissing] = useSavedState('reports.contactGaps.missing', '');
  const [view, setView] = useSavedState('reports.contactGaps.view', 'open');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    setData(null);
    apiClient.get('/reports/contact-gaps', { params: { ...(type ? { type } : {}), ...(stage ? { stage } : {}), view } })
      .then(({ data: res }) => { if (live) setData(res.data); })
      .catch((err) => { if (live) { setData({ rows: [], summary: null }); pushError(apiErrorMessage(err, 'Could not load the report'), 'Something went wrong'); } });
    return () => { live = false; };
  }, [type, stage, view, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = search.trim().toLowerCase();
  const rows = useMemo(() => (data?.rows || []).filter((r) => (!q || `${r.name} ${r.poc.name || ''} ${r.owner?.name || ''}`.toLowerCase().includes(q))
    && (!missing || (missing === 'phone' ? r.missing.includes('POC phone') : missing === 'email' ? r.missing.includes('POC email') : r.other_contacts_missing.length > 0))), [data, q, missing]);
  const s = data?.summary;

  const skip = async (r) => {
    const reason = await promptAction(`Skip ${r.name} for now? It moves to the Skipped list, and you can bring it back any time.\nReason (optional):`, '', { title: 'Skip for now', confirmLabel: 'Skip', required: false });
    if (reason === null) return;
    setBusy(r.id);
    try { await apiClient.post(`/reports/contact-gaps/${r.id}/skip`, { reason }); pushSuccess(`${r.name} skipped`); reload(); }
    catch (err) { pushError(apiErrorMessage(err, 'Could not skip it'), 'Not saved'); }
    finally { setBusy(''); }
  };
  const bringBack = async (r) => {
    setBusy(r.id);
    try { await apiClient.delete(`/reports/contact-gaps/${r.id}/skip`); pushSuccess(`${r.name} is back in the list`); reload(); }
    catch (err) { pushError(apiErrorMessage(err, 'Could not bring it back'), 'Not saved'); }
    finally { setBusy(''); }
  };

  const tabCls = (on) => `rounded-lg px-3 py-1.5 text-sm font-medium ${on ? 'bg-primary-50 text-primary-700' : 'text-tertiary-600 hover:bg-tertiary-50'}`;
  return (
    <div className="space-y-3" data-testid="contact-gaps">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-tertiary-600">Accounts
          <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 block rounded-xl border px-3 py-2 text-sm"><option value="">Clients and vendors</option><option value="client">Clients</option><option value="vendor">Vendors</option></select>
        </label>
        <label className="text-xs font-medium text-tertiary-600">Status
          <select value={stage} onChange={(e) => setStage(e.target.value)} data-testid="contact-gaps-status" className="mt-1 block rounded-xl border px-3 py-2 text-sm">
            <option value="">All statuses</option>
            {STAGES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-tertiary-600">Missing
          <select value={missing} onChange={(e) => setMissing(e.target.value)} className="mt-1 block rounded-xl border px-3 py-2 text-sm"><option value="">Anything</option><option value="phone">POC phone</option><option value="email">POC email</option><option value="other">Other contacts</option></select>
        </label>
        <label className="text-xs font-medium text-tertiary-600">Search
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Account, POC or owner" className="mt-1 block w-52 rounded-xl border px-3 py-2 text-sm" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1" role="tablist">
        <button type="button" role="tab" aria-selected={view !== 'skipped'} className={tabCls(view !== 'skipped')} onClick={() => setView('open')} data-testid="contact-gaps-open">To fix</button>
        <button type="button" role="tab" aria-selected={view === 'skipped'} className={tabCls(view === 'skipped')} onClick={() => setView('skipped')} data-testid="contact-gaps-skipped">Skipped{s ? ` (${s.skipped})` : ''}</button>
      </div>
      {s && view !== 'skipped' && <p className="text-sm text-tertiary-700">{s.clients_with_gaps} of {s.clients} clients and {s.vendors_with_gaps} of {s.vendors} vendors have a gap · {s.no_phone} without a POC phone · {s.no_email} without a POC email{s.skipped ? ` · ${s.skipped} skipped` : ''}</p>}
      {view === 'skipped' && <p className="text-sm text-tertiary-700">Accounts set aside for now. Bring one back to put it in the list again.</p>}
      <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
        {!data ? <p className="p-4 text-sm text-tertiary-500">Loading...</p> : rows.length === 0 ? <p className="p-6 text-center text-sm text-tertiary-500">{view === 'skipped' ? 'Nothing is skipped.' : 'Every contact has a phone and an email.'}</p> : (
          <table className="min-w-full text-sm">
            <thead className="bg-canvas-muted text-left text-xs uppercase text-tertiary-500"><tr><th className="px-3 py-2">Account</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">POC</th><th className="px-3 py-2">Missing</th><th className="px-3 py-2">Owner (our POC)</th>{view === 'skipped' && <th className="px-3 py-2">Skipped</th>}<th className="px-3 py-2" /></tr></thead>
            <tbody>{rows.map((r) => {
              const [, label, cls] = stageOf(r.stage);
              return (
                <tr key={r.id} className="border-t border-tertiary-100" data-testid="contact-gap-row">
                  <td className="px-3 py-2"><Link to={`/accounts/${r.id}`} className="font-medium text-primary-700 hover:underline">{r.name}</Link></td>
                  <td className="px-3 py-2 capitalize">{r.type}</td>
                  <td className="whitespace-nowrap px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`} data-testid="contact-gap-status">{label}</span></td>
                  <td className="px-3 py-2">{r.poc.name || <span className="text-tertiary-400">no name</span>}<span className="block text-xs text-tertiary-500">{[r.poc.phone, r.poc.email].filter(Boolean).join(' · ')}</span></td>
                  <td className="px-3 py-2">{r.missing.map((m) => <Gap key={m}>{m}</Gap>)}{r.other_contacts_missing.map((c) => <Gap key={c.name}>{c.name}: no {c.missing.join(', ')}</Gap>)}</td>
                  <td className="px-3 py-2">{r.owner?.name || '-'}</td>
                  {view === 'skipped' && <td className="px-3 py-2 text-xs text-tertiary-600">{day(r.skipped?.at)}{r.skipped?.by?.name ? ` by ${r.skipped.by.name}` : ''}{r.skipped?.reason ? <span className="block text-tertiary-500">{r.skipped.reason}</span> : null}</td>}
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {view === 'skipped'
                      ? <button type="button" disabled={busy === r.id} onClick={() => bringBack(r)} className="btn-ghost text-xs font-medium text-primary-700" data-testid="contact-gap-unskip">Bring back</button>
                      : <button type="button" disabled={busy === r.id} onClick={() => skip(r)} className="btn-ghost text-xs font-medium text-tertiary-600" data-testid="contact-gap-skip">Skip for now</button>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
