import { useEffect, useState } from 'react';
import { Camera, Fingerprint, MapPin, Users } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import Pill from '../../components/ui/Pill.jsx';

const selectCls = 'mt-1 block w-full rounded-xl border border-tertiary-200 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const WORK_MODES = [['', 'All work modes'], ['onsite', 'On-site'], ['remote', 'Remote'], ['hybrid', 'Hybrid'], ['not_set', 'Not set']];
const STATUSES = [['', 'Working now (incl. notice, on leave)'], ['active', 'Active'], ['notice_period', 'Serving notice'], ['on_leave', 'On leave'], ['pending_onboarding', 'New hire (not joined yet)'], ['terminated', 'Exited'], ['all', 'All statuses']];
const USER_TYPES = [['', 'All user types'], ['full_time_employee', 'Employee'], ['contractor', 'Contractor']];
const BLANK = { work_mode: '', status: '', user_type: '', department_id: '' };

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
 * watch every office) and biometric check-in / check-out devices are planned and will be connected here per office. The headcount on
 * every card follows the filters above: work mode, employee status, user type and department.
 */
export default function OfficesPage() {
  const [filters, setFilters] = useState(BLANK);
  const [departments, setDepartments] = useState([]);
  useEffect(() => { apiClient.get('/departments').then((r) => setDepartments(r.data.data || [])).catch(() => {}); }, []);
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const offices = useLiveData(() => apiClient.get('/orgs/locations/overview', { params }).then((r) => r.data.data), { intervalMs: 60000, deps: [filters] });
  const rows = offices.data || [];
  const total = rows.reduce((s, o) => s + o.people_count, 0);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const filtered = Object.keys(params).length > 0;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-tertiary-900">Offices</h1>
        <p className="text-sm text-tertiary-500">Every office location and who works from it. Locations are managed in Settings.</p>
      </div>
      <section className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-5" aria-label="Filters" data-testid="office-filters">
        <label className={labelCls}>Work mode<select className={selectCls} value={filters.work_mode} onChange={set('work_mode')} aria-label="Work mode">{WORK_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className={labelCls}>Employee status<select className={selectCls} value={filters.status} onChange={set('status')} aria-label="Employee status">{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className={labelCls}>User type<select className={selectCls} value={filters.user_type} onChange={set('user_type')} aria-label="User type">{USER_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className={labelCls}>Department
          <select className={selectCls} value={filters.department_id} onChange={set('department_id')} aria-label="Department">
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <div className="flex items-end justify-between gap-2">
          <p className="text-sm text-tertiary-600" data-testid="office-total"><strong className="text-lg text-tertiary-900">{total}</strong> people{filtered ? ' match' : ''}<span className="block text-xs text-tertiary-400">across {rows.length} office{rows.length === 1 ? '' : 's'}</span></p>
          {filtered && <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setFilters(BLANK)}>Clear</button>}
        </div>
      </section>
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
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-tertiary-700"><Users className="h-4 w-4" /><strong data-testid="office-people">{o.people_count}</strong> people</p>
            <div className="mt-3 space-y-2">
              <Device icon={Camera} label="CCTV" info={o.cctv} unit="cameras" />
              <Device icon={Fingerprint} label="Biometric check-in / check-out" info={o.biometric} unit="devices" />
            </div>
          </section>
        ))}
        {!rows.length && <p className="rounded-xl border border-tertiary-100 bg-white p-8 text-center text-sm text-tertiary-500 md:col-span-2 xl:col-span-3">{offices.loading ? 'Loading…' : 'No office locations yet. Add one in Settings.'}</p>}
      </div>
    </div>
  );
}
