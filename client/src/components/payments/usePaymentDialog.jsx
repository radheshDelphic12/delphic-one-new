import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Modal from '../ui/Modal.jsx';

const MODES = [['neft', 'NEFT'], ['rtgs', 'RTGS'], ['imps', 'IMPS'], ['upi', 'UPI'], ['cheque', 'Cheque'], ['cash', 'Cash'], ['swift', 'SWIFT'], ['other', 'Other']];
const inputCls = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const today = () => new Date().toISOString().slice(0, 10);
const num = (v) => (v === '' || v === undefined || v === null ? 0 : Number(v) || 0);
const fmt = (n, cur) => `${cur ? `${cur} ` : ''}${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const PAYMENT_CANCELLED = 'payment_cancelled';
export const isPaymentCancelled = (err) => err?.message === PAYMENT_CANCELLED;

/**
 * The one payment popup (Paras): how much (full or part, the rest stays pending), the rate typed at payment time for a foreign currency,
 * bank charges and other deductions with a note, and "track in a wallet?" Yes / No (default No) with the wallet.
 *
 * config = { title, direction ('in' | 'out'), currency, amount (pending, or the fixed amount), fixedAmount (no part payment), party }
 */
function PaymentDialog({ config, onSubmit, onCancel }) {
  const open = Boolean(config);
  const currency = config?.currency || 'INR';
  const foreign = currency !== 'INR';
  const [v, setV] = useState({});
  const [wallets, setWallets] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!config) return;
    setError('');
    setV({ amount: config.amount ? String(config.amount) : '', date: today(), exchange_rate: '', bank_charges: '', other_deductions: '', deduction_notes: '', notes: '', track: false, wallet_id: '', mode: 'neft' });
    setSaving(false);
    if (foreign) {
      apiClient.get('/billing/exchange-rates').then((r) => {
        const row = (r.data.data || []).find((x) => x.currency === currency);
        const rate = row?.rate_to_inr ?? row?.rate;
        if (rate) setV((c) => ({ ...c, exchange_rate: c.exchange_rate || String(rate) }));
      }).catch(() => {});
    }
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open && v.track && wallets === null) apiClient.get('/wallets/mine').then((r) => setWallets(r.data.data || [])).catch(() => setWallets([]));
  }, [open, v.track, wallets]);

  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  const amount = config?.fixedAmount ? num(config.amount) : num(v.amount);
  const charges = num(v.bank_charges) + num(v.other_deductions);
  const net = amount - charges;
  const inr = foreign ? amount * num(v.exchange_rate) : amount;
  const pending = num(config?.amount);
  const problem = !amount || amount <= 0 ? 'Enter the amount.'
    : !config?.fixedAmount && amount > pending + 0.001 ? 'That is more than what is pending.'
    : foreign && !num(v.exchange_rate) ? 'Enter the exchange rate.'
    : charges > amount ? 'Charges and deductions cannot be more than the amount.'
    : v.track && !v.wallet_id ? 'Choose the wallet.'
    : '';

  async function submit() {
    setSaving(true);
    const body = {
      ...(config.fixedAmount ? {} : { amount: String(v.amount) }),
      date: v.date || undefined,
      ...(foreign ? { exchange_rate: String(v.exchange_rate) } : {}),
      ...(num(v.bank_charges) ? { bank_charges: String(v.bank_charges) } : {}),
      ...(num(v.other_deductions) ? { other_deductions: String(v.other_deductions), deduction_notes: v.deduction_notes || undefined } : {}),
      ...(v.notes ? { notes: v.notes } : {}),
      ...(v.track ? { wallet_payment: { wallet_id: v.wallet_id, mode: v.mode, ...(v.date ? { date: v.date } : {}) } } : {}),
    };
    setError('');
    try { await onSubmit(body); } catch (err) { setError(apiErrorMessage(err, 'Could not save the payment')); } finally { setSaving(false); }
  }

  return (
    <Modal
      open={open}
      wide
      title={config?.title || 'Record payment'}
      onClose={saving ? () => {} : onCancel}
      layer="z-[60]"
      footer={(
        <>
          <button type="button" className="btn-secondary" disabled={saving} onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-primary" disabled={saving || Boolean(problem)} title={problem} onClick={submit}>{saving ? 'Saving…' : config?.direction === 'in' ? 'Save payment received' : 'Save payment'}</button>
        </>
      )}
    >
      {config && (
        <div className="space-y-3">
          {config.party && <p className="text-xs text-tertiary-500">{config.party}</p>}
          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>{config.direction === 'in' ? 'Amount received' : 'Amount paid'} ({currency}){config.fixedAmount
              ? <input className={`${inputCls} bg-tertiary-50`} readOnly value={fmt(config.amount)} />
              : <input inputMode="decimal" className={inputCls} value={v.amount || ''} onChange={set('amount')} />}
            </label>
            <label className={labelCls}>Date<input type="date" className={inputCls} value={v.date || ''} onChange={set('date')} /></label>
          </div>
          {!config.fixedAmount && <p className="-mt-1 text-xs text-tertiary-500">Pending: {fmt(pending, currency)}. A part payment leaves the rest pending.</p>}

          {foreign && (
            <div className="grid grid-cols-2 gap-3">
              <label className={labelCls}>Exchange rate (INR per 1 {currency})<input inputMode="decimal" className={inputCls} value={v.exchange_rate || ''} onChange={set('exchange_rate')} placeholder="Rate on the day" /></label>
              <div className={labelCls}>Value in INR<p className="mt-1 rounded-xl bg-tertiary-50 px-3 py-2 text-sm font-semibold text-tertiary-900">{fmt(inr, 'INR')}</p></div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>Bank charges ({currency})<input inputMode="decimal" className={inputCls} value={v.bank_charges || ''} onChange={set('bank_charges')} placeholder="0" /></label>
            <label className={labelCls}>Other deductions ({currency})<input inputMode="decimal" className={inputCls} value={v.other_deductions || ''} onChange={set('other_deductions')} placeholder="0" /></label>
          </div>
          {num(v.other_deductions) > 0 && (
            <label className={labelCls}>What was deducted (note)<input className={inputCls} value={v.deduction_notes || ''} onChange={set('deduction_notes')} maxLength={500} placeholder="e.g. TDS, short payment" /></label>
          )}
          {charges > 0 && <p className="text-xs text-tertiary-600">{config.direction === 'in' ? 'Net received' : 'Net paid'}: <span className="font-semibold">{fmt(net, currency)}</span></p>}
          <label className={labelCls}>Notes (optional)<input className={inputCls} value={v.notes || ''} onChange={set('notes')} maxLength={1000} /></label>

          <div className="rounded-xl border border-tertiary-100 bg-tertiary-50/50 p-3">
            <p className="text-xs font-medium text-tertiary-700">{config.direction === 'in' ? 'Track this money in a wallet?' : 'Take this payment out of a wallet?'}</p>
            <div className="mt-2 flex gap-4 text-sm">
              <label className="inline-flex items-center gap-1.5"><input type="radio" name="track" checked={!v.track} onChange={() => setV((c) => ({ ...c, track: false }))} />No</label>
              <label className="inline-flex items-center gap-1.5"><input type="radio" name="track" checked={Boolean(v.track)} onChange={() => setV((c) => ({ ...c, track: true }))} />Yes</label>
            </div>
            {!v.track && <p className="mt-1.5 text-xs text-tertiary-500">No: the payment is recorded, but no wallet is touched (for example, the money went to another account).</p>}
            {v.track && (wallets && !wallets.length ? (
              <p className="mt-2 rounded-lg bg-warning-50 p-2 text-xs">This company has no wallet yet. Ask the group admin to add one under Group Overview &gt; Book Keeping &gt; Setup.</p>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className={labelCls}>Wallet
                  <select className={inputCls} value={v.wallet_id || ''} onChange={set('wallet_id')}>
                    <option value="">Choose a wallet…</option>
                    {(wallets || []).map((w) => <option key={w.id} value={w.id}>{w.name}{w.bank_account_name ? ` · ${w.bank_account_name}` : ''} ({w.currency})</option>)}
                  </select>
                </label>
                <label className={labelCls}>How was it paid
                  <select className={inputCls} value={v.mode} onChange={set('mode')}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                </label>
                <p className="col-span-2 text-xs text-tertiary-500">The net amount {config.direction === 'in' ? 'is added to' : 'is taken from'} the wallet. An INR wallet takes a foreign payment at the rate above.</p>
              </div>
            ))}
          </div>
          {(error || problem) && <p className="text-xs text-danger-600">{error || problem}</p>}
        </div>
      )}
    </Modal>
  );
}

/**
 * const { pay, dialog } = usePaymentDialog();   ...   await pay({ title, direction, currency, amount, fixedAmount, party }, (body) => apiClient.post(url, body));
 * The popup stays open while the request runs and shows its error; pay() resolves with the request's result, or rejects with
 * PAYMENT_CANCELLED when the popup is closed (ignore that with isPaymentCancelled).
 */
export default function usePaymentDialog() {
  const [config, setConfig] = useState(null);
  const pending = useRef(null);
  const pay = useCallback((cfg, run) => new Promise((resolve, reject) => { pending.current = { resolve, reject, run }; setConfig(cfg); }), []);
  const dialog = (
    <PaymentDialog
      config={config}
      onSubmit={async (body) => { const p = pending.current; const result = await p.run(body); setConfig(null); p.resolve(result); }}
      onCancel={() => { const p = pending.current; setConfig(null); p?.reject(new Error(PAYMENT_CANCELLED)); }}
    />
  );
  return { pay, dialog };
}
