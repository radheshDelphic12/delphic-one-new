import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../lib/apiClient.js';
import useSavedState from '../../lib/useSavedState.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';

const Gap = ({ children }) => <span className="mr-1 inline-block rounded-full bg-danger-50 px-2 py-0.5 text-[11px] font-medium text-danger-700">{children}</span>;

/** Reports > Missing contact details: every client and vendor whose point of contact has no phone or email (and extra contacts with gaps). */
export default function ContactGaps() {
  const { pushError } = useAlerts();
  const [type, setType] = useSavedState('reports.contactGaps.type', '');
  const [activeOnly, setActiveOnly] = useSavedState('reports.contactGaps.active', true);
  const [missing, setMissing] = useSavedState('reports.contactGaps.missing', '');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    setData(null);
    apiClient.get('/reports/contact-gaps', { params: { ...(type ? { type } : {}), ...(activeOnly ? { stage: 'active' } : {}) } })
      .then(({ data: res }) => { if (live) setData(res.data); })
      .catch((err) => { if (live) { setData({ rows: [], summary: null }); pushError(apiErrorMessage(err, 'Could not load the report'), 'Something went wrong'); } });
    return () => { live = false; };
  }, [type, activeOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = search.trim().toLowerCase();
  const rows = useMemo(() => (data?.rows || []).filter((r) => (!q || `${r.name} ${r.poc.name || ''} ${r.owner?.name || ''}`.toLowerCase().includes(q))
    && (!missing || (missing === 'phone' ? r.missing.includes('POC phone') : missing === 'email' ? r.missing.includes('POC email') : r.other_contacts_missing.length > 0))), [data, q, missing]);
  const s = data?.summary;
  return (
    <div className="space-y-3" data-testid="contact-gaps">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-tertiary-600">Accounts
          <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 block rounded-xl border px-3 py-2 text-sm"><option value="">Clients and vendors</option><option value="client">Clients</option><option value="vendor">Vendors</option></select>
        </label>
        <label className="text-xs font-medium text-tertiary-600">Missing
          <select value={missing} onChange={(e) => setMissing(e.target.value)} className="mt-1 block rounded-xl border px-3 py-2 text-sm"><option value="">Anything</option><option value="phone">POC phone</option><option value="email">POC email</option><option value="other">Other contacts</option></select>
        </label>
        <label className="text-xs font-medium text-tertiary-600">Search
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Account, POC or owner" className="mt-1 block w-52 rounded-xl border px-3 py-2 text-sm" />
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-xs text-tertiary-700"><input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Active accounts only</label>
      </div>
      {s && <p className="text-sm text-tertiary-700">{s.clients_with_gaps} of {s.clients} clients and {s.vendors_with_gaps} of {s.vendors} vendors have a gap · {s.no_phone} without a POC phone · {s.no_email} without a POC email</p>}
      <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
        {!data ? <p className="p-4 text-sm text-tertiary-500">Loading...</p> : rows.length === 0 ? <p className="p-6 text-center text-sm text-tertiary-500">Every contact has a phone and an email.</p> : (
          <table className="min-w-full text-sm">
            <thead className="bg-canvas-muted text-left text-xs uppercase text-tertiary-500"><tr><th className="px-3 py-2">Account</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">POC</th><th className="px-3 py-2">Missing</th><th className="px-3 py-2">Owner (our POC)</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-t border-tertiary-100" data-testid="contact-gap-row">
                <td className="px-3 py-2"><Link to={`/accounts/${r.id}`} className="font-medium text-primary-700 hover:underline">{r.name}</Link></td>
                <td className="px-3 py-2 capitalize">{r.type}</td>
                <td className="px-3 py-2">{r.poc.name || <span className="text-tertiary-400">no name</span>}<span className="block text-xs text-tertiary-500">{[r.poc.phone, r.poc.email].filter(Boolean).join(' · ')}</span></td>
                <td className="px-3 py-2">{r.missing.map((m) => <Gap key={m}>{m}</Gap>)}{r.other_contacts_missing.map((c) => <Gap key={c.name}>{c.name}: no {c.missing.join(', ')}</Gap>)}</td>
                <td className="px-3 py-2">{r.owner?.name || '-'}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
