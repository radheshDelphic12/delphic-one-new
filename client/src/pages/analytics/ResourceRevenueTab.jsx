import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, IndianRupee, TrendingUp, Users, Wallet } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useOrgMembershipOptions } from '../../lib/lookups.js';
import KpiCard from '../../components/ui/KpiCard.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import StatusBadge from '../../components/finance/StatusBadge.jsx';
import PeriodPicker, { currentPeriod, periodLabel } from '../../components/finance/PeriodPicker.jsx';
import CalculationLockBar, { inr } from '../../components/finance/CalculationLockBar.jsx';
import { cleanParams } from './AttendanceSalaryTab.jsx';

const BASIS = { attendance_salary: 'salary × allocation', vendor_rate: 'vendor rate', none: 'no cost set' };

/**
 * Live Analytics → Resource Revenue: per resource, one line per contract
 * (revenue = their share of the project's approved billing; cost = their
 * attendance-based salary × allocation, or the vendor payment for a
 * contractor), grouped by resource with a total. Lines are never merged.
 */
export default function ResourceRevenueTab() {
  const [period, setPeriod] = useState(currentPeriod());
  const [filters, setFilters] = useState({ org_membership_id: '', account_id: '', client_account_id: '', project_type: 'all' });
  const [open, setOpen] = useState(() => new Set());
  const [projects, setProjects] = useState([]);
  const members = useOrgMembershipOptions(true);
  useEffect(() => { apiClient.get('/calendars/projects').then(({ data }) => setProjects(data.data || [])).catch(() => setProjects([])); }, []);
  const projectOptions = projects.map((p) => ({ value: p.id, label: p.code ? `${p.name} · ${p.code}` : p.name, hint: p.client_name || undefined }));
  const clientOptions = useMemo(() => {
    const map = new Map();
    for (const p of projects) if (p.client_account_id) map.set(p.client_account_id, p.client_name || 'Client');
    return [...map].map(([value, label]) => ({ value, label }));
  }, [projects]);

  const params = useMemo(() => cleanParams({ ...period, ...filters }), [period, filters]);
  const { data, loading, refresh } = useLiveData(() => apiClient.get('/analytics/resource-revenue', { params }).then((r) => r.data.data), { deps: [JSON.stringify(params)], intervalMs: 60000 });
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const t = data?.totals;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2"><PeriodPicker value={period} onChange={setPeriod} label="Month" /></div>
        <label className="block text-xs font-medium text-tertiary-600">Resource<div className="mt-1"><SearchableSelect value={filters.org_membership_id} onChange={(v) => set('org_membership_id', v)} options={members} placeholder="All resources" allowClear /></div></label>
        <label className="block text-xs font-medium text-tertiary-600">Project<div className="mt-1"><SearchableSelect value={filters.account_id} onChange={(v) => set('account_id', v)} options={projectOptions} placeholder="All projects" allowClear /></div></label>
        <label className="block text-xs font-medium text-tertiary-600">Client<div className="mt-1"><SearchableSelect value={filters.client_account_id} onChange={(v) => set('client_account_id', v)} options={clientOptions} placeholder="All clients" allowClear /></div></label>
        <label className="block text-xs font-medium text-tertiary-600">Project type
          <select value={filters.project_type} onChange={(e) => set('project_type', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-1.5 text-sm">
            <option value="all">All types</option>
            <option value="managed_services">Managed services</option>
            <option value="project">Fixed price / project</option>
          </select>
        </label>
      </div>

      <CalculationLockBar kind="resource_revenue" period={period} title="Resource revenue" onChanged={() => refresh?.()} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={`Revenue · ${periodLabel(period)}`} value={inr(t?.revenue)} icon={IndianRupee} theme="green" />
        <KpiCard label="Resource cost" value={inr(t?.cost)} hint={data?.as_of ? `salary incurred to ${data.as_of}` : undefined} icon={Wallet} theme="red" />
        <KpiCard label="Margin" value={inr(t?.margin)} icon={TrendingUp} theme={(t?.margin || 0) < 0 ? 'red' : 'blue'} />
        <KpiCard label="Resources" value={t?.resources ?? '…'} icon={Users} theme="cyan" />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-white text-left text-xs text-tertiary-500">
            <tr>
              <th className="px-3 py-2 font-medium">Resource / contract</th>
              <th className="px-3 py-2 font-medium">Approved hours</th>
              <th className="px-3 py-2 font-medium">Revenue</th>
              <th className="px-3 py-2 font-medium">Cost</th>
              <th className="px-3 py-2 font-medium">Margin</th>
              <th className="px-3 py-2 font-medium">Approval</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && <tr><td colSpan={6} className="px-3 py-4 text-tertiary-400">Loading…</td></tr>}
            {data && data.resources.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-tertiary-400">No resources match these filters</td></tr>}
            {(data?.resources || []).map((r) => (
              <Fragment key={r.org_membership_id}>
                <tr className="cursor-pointer border-t border-tertiary-100 bg-tertiary-50/60 hover:bg-tertiary-50" onClick={() => toggle(r.org_membership_id)}>
                  <td className="px-3 py-2 font-medium text-tertiary-900">
                    <span className="inline-flex items-center gap-1.5">
                      {open.has(r.org_membership_id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      {r.name}
                      <span className="text-xs font-normal text-tertiary-500">· {r.projects.length} contract{r.projects.length === 1 ? '' : 's'}{r.worker_type === 'contractor' ? ' · vendor resource' : ''}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{Math.round(r.projects.reduce((s, p) => s + p.approved_hours, 0) * 100) / 100}h</td>
                  <td className="px-3 py-2 font-semibold tabular-nums">{inr(r.revenue)}</td>
                  <td className="px-3 py-2 tabular-nums">{inr(r.cost)}</td>
                  <td className={`px-3 py-2 tabular-nums ${r.margin < 0 ? 'text-danger-700' : 'text-success-700'}`}>{inr(r.margin)}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.approval_status} size="xs" /></td>
                </tr>
                {open.has(r.org_membership_id) && r.projects.map((p) => (
                  <tr key={`${r.org_membership_id}|${p.project.id}`} className="border-t border-tertiary-100">
                    <td className="py-2 pl-9 pr-3">
                      <span className="text-tertiary-800">{p.project.name}</span>
                      <span className="block text-xs text-tertiary-500">{[p.project.code, p.project.client_name, p.billing_locked ? 'billing locked' : null].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{p.approved_hours}h{p.overtime_hours ? ` + ${p.overtime_hours} OT` : ''}</td>
                    <td className="px-3 py-2 tabular-nums">{inr(p.revenue)}{p.missing_rate ? <span className="block text-xs text-warning-700">no {p.revenue_currency} rate</span> : null}</td>
                    <td className="px-3 py-2 tabular-nums">{inr(p.cost)}<span className="block text-xs text-tertiary-500">{BASIS[p.cost_basis] || ''}{p.allocation_percent !== undefined ? ` · ${p.allocation_percent}%` : ''}</span></td>
                    <td className={`px-3 py-2 tabular-nums ${p.margin < 0 ? 'text-danger-700' : ''}`}>{inr(p.margin)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={p.approval_status} size="xs" />
                      <span className="block text-[11px] text-tertiary-500">
                        {p.entries.approved} approved{p.entries.pending ? ` · ${p.entries.pending} pending` : ''}{p.entries.rejected ? ` · ${p.entries.rejected} rejected` : ''}
                        {p.last_approved_by ? ` · last by ${p.last_approved_by.name}${p.last_approved_at ? `, ${new Date(p.last_approved_at).toLocaleString()}` : ''}` : ''}
                      </span>
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-tertiary-500">Revenue: the resource&apos;s share of each project&apos;s approved Billing &amp; Sales (locked months use their locked figures). Cost: monthly salary ÷ the employee calendar&apos;s working days × days present or on approved paid leave, charged to each contract by allocation %; a contractor&apos;s cost is their vendor payment.</p>
    </div>
  );
}
