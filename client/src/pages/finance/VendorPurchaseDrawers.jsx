import { useEffect, useState } from 'react';
import Drawer from '../../components/ui/Drawer.jsx';
import { useFinanceCategories, useLocationOptions } from '../../lib/lookups.js';

const CURRENCIES = ['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP'];
const PAY_MODES = [['neft', 'NEFT'], ['rtgs', 'RTGS'], ['imps', 'IMPS'], ['upi', 'UPI'], ['cheque', 'Cheque'], ['cash', 'Cash'], ['card', 'Card'], ['other', 'Other']];
const today = () => new Date().toISOString().slice(0, 10);
const money = (n, c = 'INR') => `${c} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const input = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm';

function emptyFields() {
  return { vendor_account_id: '', bill_number: '', bill_date: today(), due_date: '', category_id: '', location_id: '', amount: '', currency: 'INR', gst_amount: '', tds_amount: '', adjustment_amount: '', adjustment_note: '', description: '' };
}

function fieldsFrom(p) {
  return {
    vendor_account_id: p.vendor_account_id || '',
    bill_number: p.bill_number || '',
    bill_date: p.bill_date || today(),
    due_date: p.due_date || '',
    category_id: p.category_id || '',
    location_id: p.location_id || '',
    amount: String(p.amount ?? ''),
    currency: p.currency || 'INR',
    gst_amount: p.gst_amount ? String(p.gst_amount) : '',
    tds_amount: p.tds_amount ? String(p.tds_amount) : '',
    adjustment_amount: p.adjustment_amount ? String(p.adjustment_amount) : '',
    adjustment_note: p.adjustment_note || '',
    description: p.description || '',
  };
}

/**
 * Finance > Vendor Invoices > Add purchase: a vendor bill that is not tied to a client project (office, software, equipment, services).
 * It is booked as a company expense (amount before GST, in the bill date's month); payable = amount + GST - TDS + adjustment.
 * Add (no `purchase`) and edit (`purchase` set) share the form.
 */
export function PurchaseDrawer({ open, purchase, vendors, onClose, onSubmit }) {
  const isEditing = Boolean(purchase);
  const [f, setF] = useState(emptyFields);
  const [saving, setSaving] = useState(false);
  const categories = useFinanceCategories('group_charge', { includeInactive: true, enabled: open });
  const locations = useLocationOptions(open);

  useEffect(() => { if (open) setF(purchase ? fieldsFrom(purchase) : emptyFields()); }, [open, purchase]);
  const set = (key, value) => setF((cur) => ({ ...cur, [key]: value }));
  const payable = (Number(f.amount) || 0) + (Number(f.gst_amount) || 0) - (Number(f.tds_amount) || 0) + (Number(f.adjustment_amount) || 0);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit({
        vendor_account_id: f.vendor_account_id,
        bill_number: f.bill_number.trim(),
        bill_date: f.bill_date,
        due_date: f.due_date || null,
        category_id: f.category_id || null,
        location_id: f.location_id || null,
        amount: Number(f.amount),
        currency: f.currency,
        gst_amount: Number(f.gst_amount) || 0,
        tds_amount: Number(f.tds_amount) || 0,
        adjustment_amount: Number(f.adjustment_amount) || 0,
        adjustment_note: f.adjustment_note.trim() || null,
        description: f.description.trim() || null,
      });
      onClose();
    } catch {
      // the caller already showed the error; keep the drawer open so nothing typed is lost
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} title={isEditing ? 'Edit purchase' : 'Add purchase'} onClose={onClose} size="lg" tone={isEditing ? 'edit' : 'create'} footer={
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" form="vendor-purchase-form" data-testid="vendor-purchase-save" className="btn-primary" disabled={saving || !f.vendor_account_id || !f.bill_number.trim() || !f.amount || !f.bill_date}>
          {saving ? 'Saving...' : isEditing ? 'Save changes' : 'Add purchase'}
        </button>
      </>
    }>
      <form id="vendor-purchase-form" onSubmit={submit} className="space-y-3" data-testid="vendor-purchase-form">
        <p className="rounded-xl bg-primary-50 px-3 py-2 text-xs text-primary-800">A normal purchase is a vendor bill that is not tied to a client project (office, software, equipment, services). It is booked as a company expense in the month of the bill date.</p>
        <label className="block text-xs font-medium text-tertiary-600">Vendor
          <select required value={f.vendor_account_id} onChange={(e) => set('vendor_account_id', e.target.value)} className={input} data-testid="vendor-purchase-vendor">
            <option value="" disabled>Select vendor</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">Vendor bill number
            <input required value={f.bill_number} onChange={(e) => set('bill_number', e.target.value)} className={input} data-testid="vendor-purchase-number" />
          </label>
          <label className="block text-xs font-medium text-tertiary-600">Bill date
            <input required type="date" value={f.bill_date} onChange={(e) => set('bill_date', e.target.value)} className={input} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">Category <span className="font-normal text-tertiary-400">(optional)</span>
            <select value={f.category_id} onChange={(e) => set('category_id', e.target.value)} className={input}>
              <option value="">No category</option>
              {categories.filter((c) => c.is_active || c.id === purchase?.category_id).map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_active ? '' : ' (inactive)'}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium text-tertiary-600">Due date <span className="font-normal text-tertiary-400">(optional)</span>
            <input type="date" value={f.due_date} onChange={(e) => set('due_date', e.target.value)} className={input} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">Amount (before GST)
            <input required type="number" min="0.01" step="0.01" value={f.amount} onChange={(e) => set('amount', e.target.value)} className={input} data-testid="vendor-purchase-amount" />
          </label>
          <label className="block text-xs font-medium text-tertiary-600">Currency
            <select value={f.currency} onChange={(e) => set('currency', e.target.value)} className={input}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">GST (added)
            <input type="number" min="0" step="0.01" value={f.gst_amount} onChange={(e) => set('gst_amount', e.target.value)} className={input} />
          </label>
          <label className="block text-xs font-medium text-tertiary-600">TDS (withheld)
            <input type="number" min="0" step="0.01" value={f.tds_amount} onChange={(e) => set('tds_amount', e.target.value)} className={input} />
          </label>
          <label className="block text-xs font-medium text-tertiary-600">Adjustment
            <input type="number" step="0.01" value={f.adjustment_amount} onChange={(e) => set('adjustment_amount', e.target.value)} placeholder="+ / -" className={input} />
          </label>
        </div>
        {Number(f.adjustment_amount) !== 0 && f.adjustment_amount !== '' && (
          <label className="block text-xs font-medium text-tertiary-600">Adjustment note
            <input value={f.adjustment_note} onChange={(e) => set('adjustment_note', e.target.value)} className={input} />
          </label>
        )}
        <div className="flex items-center justify-between rounded-xl border border-tertiary-100 bg-tertiary-50 px-3 py-2 text-sm" data-testid="vendor-purchase-payable">
          <span className="text-tertiary-600">Net payable to the vendor</span>
          <span className="font-semibold text-tertiary-900">{money(payable, f.currency)}</span>
        </div>
        <label className="block text-xs font-medium text-tertiary-600">Office <span className="font-normal text-tertiary-400">(optional)</span>
          <select value={f.location_id} onChange={(e) => set('location_id', e.target.value)} className={input}>
            <option value="">Company-wide</option>
            {locations.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-tertiary-600">What was bought <span className="font-normal text-tertiary-400">(optional)</span>
          <input value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. Annual software licence" className={input} />
        </label>
        <p className="text-xs text-tertiary-500">The expense is the amount before GST. Attach the vendor&apos;s bill with Files after saving. Manage the category list under Finance &gt; Categories.</p>
      </form>
    </Drawer>
  );
}

/** Mark a purchase paid: when, how, and the reference (UTR / cheque no.). The amount defaults to the net payable. */
export function PayPurchaseDrawer({ purchase, onClose, onSubmit }) {
  const [f, setF] = useState({ paid_on: today(), payment_mode: 'neft', payment_reference: '', paid_amount: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (purchase) setF({ paid_on: today(), payment_mode: 'neft', payment_reference: '', paid_amount: String(purchase.net_payable ?? '') }); }, [purchase]);
  const set = (key, value) => setF((cur) => ({ ...cur, [key]: value }));

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit({ paid_on: f.paid_on, payment_mode: f.payment_mode, payment_reference: f.payment_reference.trim() || undefined, paid_amount: f.paid_amount ? Number(f.paid_amount) : undefined });
      onClose();
    } catch {
      // error already shown
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={Boolean(purchase)} title={purchase ? `Mark paid: ${purchase.vendor_account?.name || 'Vendor'} ${purchase.bill_number}` : 'Mark paid'} onClose={onClose} size="sm" tone="create" footer={
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" form="vendor-purchase-pay-form" data-testid="vendor-purchase-pay-save" className="btn-primary" disabled={saving || !f.paid_on}>{saving ? 'Saving...' : 'Mark paid'}</button>
      </>
    }>
      <form id="vendor-purchase-pay-form" onSubmit={submit} className="space-y-3">
        <p className="text-xs text-tertiary-500">Net payable {purchase ? money(purchase.net_payable, purchase.currency) : ''}. Paying does not change the expense, which stays in the bill month.</p>
        <label className="block text-xs font-medium text-tertiary-600">Paid on
          <input required type="date" value={f.paid_on} onChange={(e) => set('paid_on', e.target.value)} className={input} />
        </label>
        <label className="block text-xs font-medium text-tertiary-600">Amount paid
          <input type="number" min="0.01" step="0.01" value={f.paid_amount} onChange={(e) => set('paid_amount', e.target.value)} className={input} />
        </label>
        <label className="block text-xs font-medium text-tertiary-600">Mode
          <select value={f.payment_mode} onChange={(e) => set('payment_mode', e.target.value)} className={input}>{PAY_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className="block text-xs font-medium text-tertiary-600">Reference <span className="font-normal text-tertiary-400">(UTR / cheque no., optional)</span>
          <input value={f.payment_reference} onChange={(e) => set('payment_reference', e.target.value)} className={input} />
        </label>
      </form>
    </Drawer>
  );
}
