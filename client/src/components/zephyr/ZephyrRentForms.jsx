import { useState } from 'react';
import { PAYMENT_METHODS } from '../../lib/zephyr/propertyMeta.js';
import { rupees } from '../../lib/zephyr/projectMeta.js';
import { Section, inputCls, labelCls, toBody, today } from './formKit.jsx';

const Actions = ({ saving, onCancel, label = 'Save' }) => (
  <div className="flex justify-end gap-2">
    <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
    <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : label}</button>
  </div>
);

export function TenantForm({ initial, saving, onSubmit, onCancel }) {
  const [v, setV] = useState({ name: initial?.name || '', company_name: initial?.company_name || '', phone: initial?.phone || '', email: initial?.email || '', status: initial?.status || 'active', notes: initial?.notes || '' });
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(toBody(v)); }} className="space-y-4">
      <Section title="Tenant">
        <label className={labelCls}>Name<input className={inputCls} value={v.name} onChange={set('name')} required maxLength={200} autoFocus /></label>
        <label className={labelCls}>Company name<input className={inputCls} value={v.company_name} onChange={set('company_name')} maxLength={200} /></label>
        <label className={labelCls}>Contact number<input className={inputCls} value={v.phone} onChange={set('phone')} maxLength={40} /></label>
        <label className={labelCls}>Email<input type="email" className={inputCls} value={v.email} onChange={set('email')} maxLength={200} /></label>
        <label className={labelCls}>Status<select className={inputCls} value={v.status} onChange={set('status')}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <label className={`${labelCls} sm:col-span-2`}>Notes<textarea className={inputCls} rows={2} value={v.notes} onChange={set('notes')} maxLength={2000} /></label>
      </Section>
      <Actions saving={saving} onCancel={onCancel} label="Save tenant" />
    </form>
  );
}

/** New lease for a unit. `units` is [{ id, name, property? }] to pick from, or pass `unit` to fix it. */
export function LeaseForm({ tenants, units, unit, saving, onSubmit, onCancel, onNewTenant }) {
  const [v, setV] = useState({ tenant_id: '', unit_id: unit?.id || '', start_date: today(), end_date: '', monthly_rent: '', security_deposit: '', due_day: 1, payment_method: '', notes: '' });
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(toBody({ ...v, due_day: Number(v.due_day) }, { numbers: ['monthly_rent', 'security_deposit'] }));
      }}
      className="space-y-4"
    >
      <Section title="Lease">
        <label className={labelCls}>Tenant
          <select className={inputCls} value={v.tenant_id} onChange={set('tenant_id')} required><option value="">Select a tenant…</option>{tenants.filter((t) => t.status === 'active').map((t) => <option key={t.id} value={t.id}>{t.name}{t.company_name ? ` · ${t.company_name}` : ''}</option>)}</select>
          {onNewTenant && <button type="button" className="mt-1 text-xs font-medium text-primary-700 hover:underline" onClick={onNewTenant}>+ New tenant</button>}
        </label>
        {unit ? (
          <div className={labelCls}>Unit<div className="mt-1 rounded-xl border bg-primary-50/50 px-3 py-2 text-sm text-tertiary-900">{unit.name}</div></div>
        ) : (
          <label className={labelCls}>Unit<select className={inputCls} value={v.unit_id} onChange={set('unit_id')} required><option value="">Select a unit…</option>{units.map((u) => <option key={u.id} value={u.id}>{u.property ? `${u.property} · ` : ''}{u.name}</option>)}</select></label>
        )}
        <label className={labelCls}>Lease start<input type="date" className={inputCls} value={v.start_date} onChange={set('start_date')} required /></label>
        <label className={labelCls}>Lease end (optional)<input type="date" className={inputCls} min={v.start_date} value={v.end_date} onChange={set('end_date')} /></label>
        <label className={labelCls}>Monthly rent (₹)<input type="number" min="1" className={inputCls} value={v.monthly_rent} onChange={set('monthly_rent')} required /></label>
        <label className={labelCls}>Security deposit (₹)<input type="number" min="0" className={inputCls} value={v.security_deposit} onChange={set('security_deposit')} /></label>
        <label className={labelCls}>Rent due on day of month<input type="number" min="1" max="28" className={inputCls} value={v.due_day} onChange={set('due_day')} required /></label>
        <label className={labelCls}>Usual payment method<select className={inputCls} value={v.payment_method} onChange={set('payment_method')}><option value="">Not set</option>{PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
        <label className={`${labelCls} sm:col-span-2`}>Notes<textarea className={inputCls} rows={2} value={v.notes} onChange={set('notes')} maxLength={2000} /></label>
      </Section>
      <p className="text-xs text-tertiary-500">Rent dues are created automatically every month from the start date. The due day can be 1 to 28.</p>
      <Actions saving={saving} onCancel={onCancel} label="Create lease" />
    </form>
  );
}

/** Record rent received against one due. */
export function PaymentForm({ due, people, saving, onSubmit, onCancel }) {
  const [v, setV] = useState({ amount: due.balance, paid_on: today(), method: 'upi', reference: '', collected_by_person_id: '', notes: '' });
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(toBody(v, { numbers: ['amount'] })); }} className="space-y-4">
      <div className="rounded-xl bg-primary-50 px-3 py-2 text-sm text-primary-900">
        {due.tenant?.name} · {due.property?.name} / {due.unit?.name} · {due.period}. Rent {rupees(due.amount)}, paid {rupees(due.paid_amount)}, balance <strong>{rupees(due.balance)}</strong>.
      </div>
      <Section title="Payment">
        <label className={labelCls}>Amount (₹)<input type="number" min="1" max={due.balance} step="0.01" className={inputCls} value={v.amount} onChange={set('amount')} required autoFocus /></label>
        <label className={labelCls}>Payment date<input type="date" className={inputCls} max={today()} value={v.paid_on} onChange={set('paid_on')} required /></label>
        <label className={labelCls}>Method<select className={inputCls} value={v.method} onChange={set('method')}>{PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
        <label className={labelCls}>Reference number<input className={inputCls} value={v.reference} onChange={set('reference')} maxLength={120} placeholder="UPI / cheque / receipt no." /></label>
        <label className={labelCls}>Collected by<select className={inputCls} value={v.collected_by_person_id} onChange={set('collected_by_person_id')}><option value="">Received directly</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.kind})</option>)}</select></label>
        <label className={labelCls}>Notes<input className={inputCls} value={v.notes} onChange={set('notes')} maxLength={500} /></label>
      </Section>
      <p className="text-xs text-tertiary-500">This is booked as rental income in the money ledger for the payment date.</p>
      <Actions saving={saving} onCancel={onCancel} label="Record payment" />
    </form>
  );
}
