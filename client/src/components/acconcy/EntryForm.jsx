import { useState } from 'react';
import { Area, DateInput, Num, Select, Text, dayOf, toBody, today } from './ui.jsx';

/**
 * One form for a revenue or expense entry. On a deal page `fixedDeal` pins the deal; on the company ledger the deal
 * is an optional picker (empty = company level). `categories` are the active categories of both kinds.
 */
export default function EntryForm({ initial, fixedType, fixedDeal, categories, deals = [], clients = [], vendors = [], onSubmit, onCancel, saving }) {
  const [v, setV] = useState(() => ({
    type: initial?.type || fixedType || 'revenue',
    entry_date: dayOf(initial?.entry_date) || today(),
    category_id: initial?.category_id || '',
    deal_id: fixedDeal?.id || initial?.deal_id || '',
    party_id: initial?.party_id || fixedDeal?.party_id || '',
    vendor_id: initial?.vendor_id || fixedDeal?.vendor_id || '',
    amount: initial?.amount ?? '',
    tax: initial?.tax ?? 0,
    payment_mode: initial?.payment_mode ?? '',
    reference: initial?.reference ?? '',
    description: initial?.description ?? '',
  }));
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  const options = categories.filter((c) => c.kind === v.type).map((c) => ({ value: c.id, label: c.name }));
  const categoryId = options.some((o) => o.value === v.category_id) ? v.category_id : options[0]?.value || '';
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...toBody({ ...v, category_id: categoryId }, { numbers: ['amount', 'tax'] }), type: v.type });
      }}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {!fixedType && <Select label="Type" value={v.type} onChange={set('type')} options={[{ value: 'revenue', label: 'Revenue' }, { value: 'expense', label: 'Expense' }]} required />}
        <Select label="Category" value={categoryId} onChange={set('category_id')} options={options} required />
        <DateInput label="Date" value={v.entry_date} onChange={set('entry_date')} required />
        <Num label="Amount" value={v.amount} onChange={set('amount')} required min="0.01" />
        {!fixedDeal && <Select label="Deal" value={v.deal_id} onChange={set('deal_id')} options={deals} blank="Company level (no deal)" />}
        <Num label="Tax (GST)" value={v.tax} onChange={set('tax')} hint="Tracked separately; profit uses the amount before tax" />
        <Select label="Client" value={v.party_id} onChange={set('party_id')} options={clients} blank="Not specified" />
        <Select label="Vendor" value={v.vendor_id} onChange={set('vendor_id')} options={vendors} blank="Not specified" />
        <Text label="Payment mode" value={v.payment_mode} onChange={set('payment_mode')} maxLength={60} placeholder="Bank transfer, cheque, cash..." />
        <Text label="Reference" value={v.reference} onChange={set('reference')} maxLength={200} placeholder="Invoice / voucher number" />
        <Area label="Description" className="sm:col-span-2" rows={2} value={v.description} onChange={set('description')} maxLength={1000} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save entry'}</button>
      </div>
    </form>
  );
}
