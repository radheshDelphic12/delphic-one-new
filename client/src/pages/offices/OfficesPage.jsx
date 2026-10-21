import { Camera, Fingerprint, MapPin, Users } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import Pill from '../../components/ui/Pill.jsx';

function Device({ icon: Icon, label, info, unit }) {
  const on = info.status === 'connected';
  return (
    <div className="flex items-center justify-between rounded-xl border border-tertiary-100 bg-[#F9FAFB] px-3 py-2">
      <span className="inline-flex items-center gap-2 text-sm text-tertiary-700"><Icon className="h-4 w-4" />{label}</span>
      {on ? <Pill tone="green">{info[unit]} {unit} connected</Pill> : <Pill tone="gray">Not connected</Pill>}
    </div>
  );
}

/**
 * Offices: one card per office location (Ahmedabad, Gurgaon, Indore, ...). Today it shows who sits where; CCTV (one place to
 * watch every office) and biometric check-in / check-out devices are planned and will be connected here per office.
 */
export default function OfficesPage() {
  const offices = useLiveData(() => apiClient.get('/orgs/locations/overview').then((r) => r.data.data), { intervalMs: 60000, deps: [] });
  const rows = offices.data || [];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-tertiary-900">Offices</h1>
        <p className="text-sm text-tertiary-500">Every office location and who works from it. Locations are managed in Settings.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((o) => (
          <section key={o.id} className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="office-card">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="inline-flex items-center gap-1.5 text-base font-semibold text-tertiary-900"><MapPin className="h-4 w-4 text-primary-600" />{o.name}</h2>
                <p className="text-xs text-tertiary-500">{[o.city, o.country].filter(Boolean).join(', ') || '—'}</p>
                {o.address && <p className="mt-0.5 whitespace-pre-line text-xs text-tertiary-500">{o.address}</p>}
              </div>
              {o.is_default && <Pill tone="blue">Default</Pill>}
            </div>
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-tertiary-700"><Users className="h-4 w-4" /><strong>{o.people_count}</strong> people</p>
            <div className="mt-3 space-y-2">
              <Device icon={Camera} label="CCTV" info={o.cctv} unit="cameras" />
              <Device icon={Fingerprint} label="Biometric check-in / check-out" info={o.biometric} unit="devices" />
            </div>
          </section>
        ))}
        {!rows.length && <p className="rounded-xl border border-tertiary-100 bg-white p-8 text-center text-sm text-tertiary-500 md:col-span-2 xl:col-span-3">{offices.loading ? 'Loading…' : 'No office locations yet. Add them in Settings.'}</p>}
      </div>
    </div>
  );
}
