import { SERVICE_TYPES } from '../../lib/acconcy/meta.js';
import { DateInput, Select, card, inputCls, labelCls } from './ui.jsx';

export const BLANK_FILTERS = { month: '', year: '', from: '', to: '', service_type: '', party_id: '', vendor_id: '', deal_id: '', assignee_id: '' };

/** Query for /finance/* from the filter state: empty values are dropped; month wins over year over from/to (as on the server). */
export function financeQuery(f) {
  const q = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
  if (q.month) { delete q.year; delete q.from; delete q.to; } else if (q.year && (q.from || q.to)) delete q.year;
  return q;
}

/** The shared filter panel of every Acconcy finance view: period, service, client, vendor, deal, employee. */
export default function FinanceFilters({ f, set, pickers, deals, onReset, hide = [] }) {
  const years = Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - i));
  const show = (k) => !hide.includes(k);
  return (
    <div className={`${card} grid gap-3 sm:grid-cols-2 lg:grid-cols-4`}>
      <label className={labelCls}>Month<input type="month" className={inputCls} value={f.month} onChange={(e) => set('month', e.target.value)} /></label>
      <Select label="Year" value={f.year} onChange={(v) => set('year', v)} options={years.map((y) => ({ value: y, label: y }))} blank="Any year" disabled={Boolean(f.month)} />
      <DateInput label="From" value={f.from} onChange={(v) => set('from', v)} disabled={Boolean(f.month)} />
      <DateInput label="To" value={f.to} onChange={(v) => set('to', v)} disabled={Boolean(f.month)} />
      {show('service_type') && <Select label="Service type" value={f.service_type} onChange={(v) => set('service_type', v)} options={SERVICE_TYPES.map((t) => ({ value: t.value, label: t.label }))} blank="All services" />}
      {show('party_id') && <Select label="Client" value={f.party_id} onChange={(v) => set('party_id', v)} options={pickers.clients} blank="All clients" />}
      {show('vendor_id') && <Select label="Vendor" value={f.vendor_id} onChange={(v) => set('vendor_id', v)} options={pickers.vendors} blank="All vendors" />}
      {show('deal_id') && <Select label="Deal" value={f.deal_id} onChange={(v) => set('deal_id', v)} options={deals} blank="All deals" />}
      {show('assignee_id') && <Select label="Employee / contractor" value={f.assignee_id} onChange={(v) => set('assignee_id', v)} options={[...pickers.employees, ...pickers.contractors]} blank="Anyone" />}
      <div className="flex items-end justify-end sm:col-span-2 lg:col-span-4"><button type="button" className="text-xs font-medium text-tertiary-500 hover:text-primary-700" onClick={onReset}>Clear filters</button></div>
    </div>
  );
}
