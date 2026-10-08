import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AlertTriangle, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { METHOD_LABEL, RENT_STATUS, monthLabel, shiftMonth, thisMonth } from '../../lib/zephyr/propertyMeta.js';
import { rupees } from '../../lib/zephyr/projectMeta.js';
import { compact, dateLabel } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import ZephyrDocuments from '../../components/zephyr/ZephyrDocuments.jsx';
import { LeaseForm, PaymentForm, TenantForm } from '../../components/zephyr/ZephyrRentForms.jsx';
import { Empty, card, useDebounced } from '../../components/zephyr/formKit.jsx';

const TABS = [
  { key: 'dues', label: 'Rent due' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'payments', label: 'Payments received' },
  { key: 'leases', label: 'Leases' },
  { key: 'tenants', label: 'Tenants' },
];

function StatusPill({ due }) {
  const meta = RENT_STATUS[due.status];
  return (
    <span className="inline-flex items-center gap-1">
      <Pill tone={meta.tone}>{meta.label}</Pill>
      {due.partially_paid && due.status === 'overdue' && <span className="text-[11px] text-tertiary-500">part paid</span>}
    </span>
  );
}

function DuesTable({ dues, canEdit, onPay, onWaive, onEditAmount, showMonth }) {
  if (dues.length === 0) return <Empty>Nothing here.</Empty>;
  return (
    <div className={`${card} overflow-x-auto p-0 md:p-0`}>
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-primary-50/60 text-xs uppercase tracking-wide text-tertiary-500">
          <tr><th className="px-4 py-2.5">Tenant</th><th className="px-4 py-2.5">Property / unit</th>{showMonth && <th className="px-4 py-2.5">Month</th>}<th className="px-4 py-2.5">Due date</th><th className="px-4 py-2.5 text-right">Rent</th><th className="px-4 py-2.5 text-right">Paid</th><th className="px-4 py-2.5">Status</th><th className="w-40" /></tr>
        </thead>
        <tbody className="divide-y">
          {dues.map((d) => (
            <tr key={d.id}>
              <td className="px-4 py-2.5 font-medium text-tertiary-900">{d.tenant.name}{d.tenant.company_name && <span className="block text-xs font-normal text-tertiary-500">{d.tenant.company_name}</span>}</td>
              <td className="px-4 py-2.5"><Link to={`/zephyr/properties/${d.property_id}`} className="text-primary-700 hover:underline">{d.property.name}</Link><span className="block text-xs text-tertiary-500">{d.unit.name}</span></td>
              {showMonth && <td className="px-4 py-2.5">{monthLabel(d.period)}</td>}
              <td className="px-4 py-2.5">{dateLabel(d.due_date)}{d.days_overdue > 0 && <span className="block text-xs text-red-600">{d.days_overdue} days late</span>}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{rupees(d.amount)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{rupees(d.paid_amount)}</td>
              <td className="px-4 py-2.5"><StatusPill due={d} /></td>
              <td className="px-2 text-right">
                {canEdit && d.balance > 0 && <button type="button" className="btn-secondary" onClick={() => onPay(d)}>Record payment</button>}
                {canEdit && d.status !== 'paid' && d.status !== 'waived' && <button type="button" className="ml-1 rounded-lg px-2 py-1 text-xs font-medium text-tertiary-500 hover:bg-primary-50" onClick={() => onWaive(d)}>Waive</button>}
                {canEdit && d.status !== 'waived' && <button type="button" className="ml-1 rounded-lg px-2 py-1 text-xs font-medium text-tertiary-500 hover:bg-primary-50" onClick={() => onEditAmount(d)}>Edit rent</button>}
                {canEdit && d.status === 'waived' && <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-tertiary-500 hover:bg-primary-50" onClick={() => onWaive(d, true)}>Undo waiver</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ZephyrRentPage() {
  const { me, loading } = useZephyr();
  const { pushError, pushSuccess } = useAlerts();
  const [tab, setTab] = useState('dues');
  const [month, setMonth] = useState(thisMonth());
  const [summary, setSummary] = useState(null);
  const [dues, setDues] = useState(null);
  const [overdue, setOverdue] = useState(null);
  const [payments, setPayments] = useState(null);
  const [leases, setLeases] = useState(null);
  const [tenants, setTenants] = useState(null);
  const [units, setUnits] = useState([]);
  const [people, setPeople] = useState([]);
  const [properties, setProperties] = useState([]);
  const [filters, setFilters] = useState({ property_id: '', status: '' });
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const [drawer, setDrawer] = useState(null);
  const [saving, setSaving] = useState(false);

  const canEdit = zxCan(me, 'rentEdit');
  const canDelete = zxCan(me, 'delete');

  const loadDues = useCallback(async () => {
    try {
      const params = { month, ...(filters.property_id ? { property_id: filters.property_id } : {}), ...(filters.status ? { status: filters.status } : {}), ...(dq ? { q: dq } : {}) };
      const [list, sum] = await Promise.all([zephyrApi.rentDues(params), zephyrApi.rentSummary(month)]);
      setDues(list);
      setSummary(sum);
    } catch (e) {
      pushError(zephyrError(e, 'Could not load rent'), 'Load failed');
    }
  }, [month, filters.property_id, filters.status, dq, pushError]);
  const loadOverdue = useCallback(() => zephyrApi.rentOverdue().then(setOverdue, (e) => pushError(zephyrError(e), 'Could not load overdue rent')), [pushError]);
  const loadPayments = useCallback(() => zephyrApi.rentPayments({ ...(filters.property_id ? { property_id: filters.property_id } : {}) }).then(setPayments, (e) => pushError(zephyrError(e), 'Could not load payments')), [filters.property_id, pushError]);
  const loadLeases = useCallback(() => zephyrApi.leases({ ...(filters.property_id ? { property_id: filters.property_id } : {}) }).then(setLeases, (e) => pushError(zephyrError(e), 'Could not load leases')), [filters.property_id, pushError]);
  const loadTenants = useCallback(() => zephyrApi.tenants({ ...(dq ? { q: dq } : {}) }).then(setTenants, (e) => pushError(zephyrError(e), 'Could not load tenants')), [dq, pushError]);

  useEffect(() => {
    if (tab === 'dues') loadDues();
    if (tab === 'overdue') loadOverdue();
    if (tab === 'payments') loadPayments();
    if (tab === 'leases') loadLeases();
    if (tab === 'tenants') loadTenants();
  }, [tab, loadDues, loadOverdue, loadPayments, loadLeases, loadTenants]);

  useEffect(() => {
    zephyrApi.properties({}).then(setProperties, () => setProperties([]));
    zephyrApi.people({ status: 'active' }).then(setPeople, () => setPeople([]));
    zephyrApi.tenants({}).then(setTenants, () => setTenants([]));
    zephyrApi.rentableUnits().then(setUnits, () => setUnits([]));
  }, []);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!zxCan(me, 'rent')) return <Navigate to="/zephyr" replace />;

  const refresh = async () => {
    await Promise.all([loadDues(), loadOverdue(), loadPayments(), loadLeases(), loadTenants()]);
    zephyrApi.rentableUnits().then(setUnits, () => setUnits([]));
  };
  async function run(action, success, fail = 'Could not save') {
    setSaving(true);
    try {
      const result = await action();
      if (success) pushSuccess(success);
      await refresh();
      return result;
    } catch (e) {
      pushError(zephyrError(e, fail), fail);
      return null;
    } finally {
      setSaving(false);
    }
  }
  const close = () => setDrawer(null);

  async function pay(body) {
    const edit = drawer.payment;
    if (await run(() => (edit ? zephyrApi.updateRentPayment(edit.id, body) : zephyrApi.payRent(drawer.due.id, body)), edit ? 'Payment updated' : 'Payment recorded')) close();
  }
  async function waive(due, undo) {
    if (undo) return void (await run(() => zephyrApi.updateRentDue(due.id, { waived: false }), 'Waiver removed'));
    const reason = window.prompt(`Why is ${monthLabel(due.period)} rent for ${due.tenant.name} being waived?`);
    if (!reason?.trim()) return undefined;
    return run(() => zephyrApi.updateRentDue(due.id, { waived: true, waived_reason: reason.trim() }), 'Rent waived');
  }
  async function editAmount(due) {
    const value = window.prompt(`Rent for ${monthLabel(due.period)} (${due.tenant.name}). Change the amount due:`, String(due.amount));
    if (value === null) return;
    const amount = Number(value);
    if (!(amount > 0)) return pushError('Enter an amount above zero', 'Not saved');
    await run(() => zephyrApi.updateRentDue(due.id, { amount }), 'Rent amount updated');
  }
  async function removePayment(p) {
    if (window.confirm(`Reverse the ${rupees(p.amount)} payment from ${p.tenant?.name}? The rental income entry is removed too.`)) await run(() => zephyrApi.deleteRentPayment(p.id), 'Payment reversed', 'Could not reverse');
  }
  async function saveLease(values) {
    const edit = drawer.lease;
    if (await run(() => (edit ? zephyrApi.updateLease(edit.id, values) : zephyrApi.createLease(values)), edit ? 'Lease updated' : 'Lease created')) close();
  }
  async function endLease(l) {
    const reason = window.prompt(`End the lease of ${l.tenant?.name} on ${l.unit?.name}? Optionally say why:`, '');
    if (reason !== null) await run(() => zephyrApi.endLease(l.id, { reason: reason.trim() || null }), 'Lease ended');
  }
  async function saveTenant(values) {
    const edit = drawer.tenant;
    const saved = await run(() => (edit ? zephyrApi.updateTenant(edit.id, values) : zephyrApi.createTenant(values)), edit ? 'Tenant saved' : 'Tenant added');
    if (saved) setDrawer(drawer.back ? { kind: drawer.back } : null);
  }
  async function removeTenant(t) {
    if (window.confirm(`Delete ${t.name}?`)) await run(() => zephyrApi.deleteTenant(t.id), 'Tenant deleted', 'Could not delete');
  }

  const rentSummary = summary;
  const setFilter = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const propertySelect = (
    <select value={filters.property_id} onChange={setFilter('property_id')} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Property"><option value="">All properties</option>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
  );

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={`Rent due · ${monthLabel(month)}`} value={`₹${compact(rentSummary?.total_due)}`} hint={`${rentSummary?.count ?? 0} rents`} />
        <StatCard label="Collected" value={`₹${compact(rentSummary?.collected)}`} />
        <StatCard label="Pending" value={`₹${compact(rentSummary?.pending)}`} hint="not yet received" />
        <StatCard label="Overdue" value={`₹${compact(rentSummary?.overdue)}`} hint={`${rentSummary?.overdue_count ?? 0} past their due date`} tone={rentSummary?.overdue ? 'danger' : undefined} />
      </div>

      <SectionTabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'dues' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
            <span className="min-w-[8rem] text-center text-sm font-semibold text-tertiary-900">{monthLabel(month)}</span>
            <button type="button" className="btn-secondary" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth()} aria-label="Next month">›</button>
            {propertySelect}
            <select value={filters.status} onChange={setFilter('status')} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Status"><option value="">All statuses</option>{Object.entries(RENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tenant or unit…" aria-label="Search rent" className="w-44 rounded-xl border py-1.5 pl-9 pr-3 text-sm" /></div>
          </div>
          {!dues ? <Empty>Loading…</Empty> : <DuesTable dues={dues} canEdit={canEdit} onPay={(due) => setDrawer({ kind: 'pay', due })} onWaive={waive} onEditAmount={editAmount} />}
          {rentSummary?.by_property?.length > 1 && (
            <section className={card}>
              <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">By property</h3>
              <ul className="divide-y text-sm">{rentSummary.by_property.map((r) => <li key={r.property_id} className="flex items-center justify-between py-2"><span>{r.name}</span><span className="tabular-nums text-tertiary-600">{rupees(r.collected)} of {rupees(r.total_due)}{r.overdue > 0 && <span className="ml-2 text-red-600">{rupees(r.overdue)} overdue</span>}</span></li>)}</ul>
            </section>
          )}
        </div>
      )}

      {tab === 'overdue' && (
        <div className="space-y-3">
          {overdue && overdue.length > 0 && <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800"><AlertTriangle className="h-4 w-4" />{overdue.length} rent{overdue.length === 1 ? ' is' : 's are'} overdue, {rupees(overdue.reduce((a, d) => a + d.balance, 0))} in total.</div>}
          {!overdue ? <Empty>Loading…</Empty> : overdue.length === 0 ? <Empty>No rent is overdue. Everything due so far has been received.</Empty> : <DuesTable dues={overdue} canEdit={canEdit} onEditAmount={editAmount} onPay={(due) => setDrawer({ kind: 'pay', due })} onWaive={waive} showMonth />}
        </div>
      )}

      {tab === 'payments' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">{propertySelect}</div>
          {!payments ? <Empty>Loading…</Empty> : payments.length === 0 ? <Empty>No rent has been received yet.</Empty> : (
            <DataTable
              columns={[
                { key: 'date', header: 'Received on', render: (r) => dateLabel(r.paid_on) },
                { key: 'tenant', header: 'Tenant', render: (r) => <span className="font-medium text-tertiary-900">{r.tenant?.name}</span> },
                { key: 'unit', header: 'Property / unit', render: (r) => `${r.property?.name || ''} · ${r.unit?.name || ''}` },
                { key: 'period', header: 'For', render: (r) => monthLabel(r.period) },
                { key: 'amount', header: 'Amount', render: (r) => <span className="tabular-nums">{rupees(r.amount)}</span> },
                { key: 'method', header: 'Method', render: (r) => `${METHOD_LABEL[r.method] || r.method}${r.reference ? ` · ${r.reference}` : ''}` },
                { key: 'by', header: 'Collected by', render: (r) => r.collected_by?.name || 'Directly' },
                { key: 'x', header: '', render: (r) => canEdit && (
                  <span className="inline-flex gap-1">
                    <button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-primary-50 hover:text-primary-700" aria-label="Edit payment" onClick={() => setDrawer({ kind: 'pay', payment: r, due: { tenant: r.tenant, property: r.property, unit: r.unit, period: monthLabel(r.period) } })}><Pencil className="h-4 w-4" /></button>
                    <button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" aria-label="Reverse payment" onClick={() => removePayment(r)}><Trash2 className="h-4 w-4" /></button>
                  </span>
                ) },
              ]}
              rows={payments}
              maxHeight="60vh"
            />
          )}
        </div>
      )}

      {tab === 'leases' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {propertySelect}
            {canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ kind: 'lease' })}><Plus className="h-4 w-4" />New lease</button>}
          </div>
          {!leases ? <Empty>Loading…</Empty> : leases.length === 0 ? <Empty>No leases yet.</Empty> : (
            <DataTable
              columns={[
                { key: 'tenant', header: 'Tenant', render: (r) => <span className="font-medium text-tertiary-900">{r.tenant?.name}</span> },
                { key: 'unit', header: 'Property / unit', render: (r) => <Link to={`/zephyr/properties/${r.property_id}`} className="text-primary-700 hover:underline">{r.unit?.property?.name} · {r.unit?.name}</Link> },
                { key: 'period', header: 'Period', render: (r) => `${dateLabel(r.start_date)} → ${r.ended_on ? dateLabel(r.ended_on) : r.end_date ? dateLabel(r.end_date) : 'ongoing'}` },
                { key: 'rent', header: 'Monthly rent', render: (r) => <span className="tabular-nums">{rupees(r.monthly_rent)}</span> },
                { key: 'due', header: 'Due day', render: (r) => r.due_day },
                { key: 'status', header: 'Status', render: (r) => <Pill tone={r.status === 'active' ? 'green' : 'gray'}>{r.status === 'active' ? 'Active' : 'Ended'}</Pill> },
                { key: 'x', header: '', render: (r) => canEdit && r.status === 'active' && (
                  <span className="inline-flex gap-1">
                    <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50" onClick={() => setDrawer({ kind: 'lease', lease: r })}>Edit</button>
                    <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-danger-600 hover:bg-danger-50" onClick={() => endLease(r)}>End lease</button>
                  </span>
                ) },
              ]}
              rows={leases}
              maxHeight="60vh"
            />
          )}
        </div>
      )}

      {tab === 'tenants' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tenants…" aria-label="Search tenants" className="w-52 rounded-xl border py-1.5 pl-9 pr-3 text-sm" /></div>
            {canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ kind: 'tenant' })}><Plus className="h-4 w-4" />Add tenant</button>}
          </div>
          {!tenants ? <Empty>Loading…</Empty> : tenants.length === 0 ? <Empty>No tenants yet.</Empty> : (
            <DataTable
              columns={[
                { key: 'name', header: 'Tenant', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span>{r.company_name && <span className="block text-xs text-tertiary-500">{r.company_name}</span>}</span> },
                { key: 'contact', header: 'Contact', render: (r) => [r.phone, r.email].filter(Boolean).join(' · ') || '—' },
                { key: 'places', header: 'Renting', render: (r) => (r.places?.length ? r.places.join(', ') : '—') },
                { key: 'rent', header: 'Monthly rent', render: (r) => (r.active_leases ? <span className="tabular-nums">{rupees(r.monthly_rent)}</span> : '—') },
                { key: 'status', header: 'Status', render: (r) => <Pill tone={r.status === 'active' ? 'green' : 'gray'}>{r.status === 'active' ? 'Active' : 'Inactive'}</Pill> },
                { key: 'x', header: '', render: (r) => (
                  <span className="inline-flex gap-1">
                    {canEdit && <button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-primary-50 hover:text-primary-700" aria-label={`Edit ${r.name}`} onClick={() => setDrawer({ kind: 'tenant', tenant: r })}><Pencil className="h-4 w-4" /></button>}
                    {canDelete && !r.active_leases && <button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" aria-label={`Delete ${r.name}`} onClick={() => removeTenant(r)}><Trash2 className="h-4 w-4" /></button>}
                  </span>
                ) },
              ]}
              rows={tenants}
              maxHeight="60vh"
            />
          )}
        </div>
      )}

      <Drawer open={Boolean(drawer)} onClose={close} size="xl" tone={drawer?.tenant ? 'edit' : 'create'} title={{ pay: drawer?.payment ? 'Edit rent payment' : 'Record rent payment', lease: drawer?.lease ? 'Edit lease' : 'New lease', tenant: drawer?.tenant ? `Edit ${drawer.tenant.name}` : 'Add tenant' }[drawer?.kind] || ''}>
        {drawer?.kind === 'pay' && <PaymentForm due={drawer.due} initial={drawer.payment} people={people} saving={saving} onSubmit={pay} onCancel={close} />}
        {drawer?.kind === 'lease' && <LeaseForm initial={drawer.lease} tenants={tenants || []} units={units} saving={saving} onSubmit={saveLease} onCancel={close} onNewTenant={() => setDrawer({ kind: 'tenant', back: 'lease' })} />}
        {drawer?.kind === 'tenant' && (
          <div className="space-y-6">
            <TenantForm initial={drawer.tenant} saving={saving} onSubmit={saveTenant} onCancel={drawer.back ? () => setDrawer({ kind: drawer.back }) : close} />
            {drawer.tenant && <ZephyrDocuments ownerType="tenant" ownerId={drawer.tenant.id} canEdit={canEdit} />}
          </div>
        )}
      </Drawer>
    </div>
  );
}
