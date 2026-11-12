import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import Modal from '../ui/Modal.jsx';

const MODES = [['neft', 'NEFT'], ['rtgs', 'RTGS'], ['imps', 'IMPS'], ['upi', 'UPI'], ['cheque', 'Cheque'], ['cash', 'Cash'], ['swift', 'SWIFT'], ['other', 'Other']];
const inputCls = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';

/** The server asks for a wallet on payments of records created after the group's Book Keeping go-live date. */
export const needsWallet = (err) => err?.response?.status === 422 && /^Choose the wallet/.test(err.response?.data?.message || '');
export const WALLET_CANCELLED = 'wallet_cancelled';

function WalletDialog({ open, direction, onChoose, onCancel }) {
  const [wallets, setWallets] = useState(null);
  const [v, setV] = useState({ wallet_id: '', mode: 'neft', date: '' });
  useEffect(() => {
    if (!open) return;
    setV({ wallet_id: '', mode: 'neft', date: '' });
    apiClient.get('/wallets/mine').then((r) => setWallets(r.data.data)).catch(() => setWallets([]));
  }, [open]);
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  return (
    <Modal
      open={open}
      title={direction === 'in' ? 'Which wallet did the money come into?' : 'Which wallet was this paid from?'}
      onClose={onCancel}
      layer="z-[60]"
      footer={(
        <>
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!v.wallet_id} onClick={() => onChoose({ wallet_id: v.wallet_id, mode: v.mode, ...(v.date ? { date: v.date } : {}) })}>Save payment</button>
        </>
      )}
    >
      <p className="mb-3 text-xs text-tertiary-500">Book Keeping is live for this record, so the payment is also entered in the wallet it went through.</p>
      {wallets && !wallets.length ? (
        <p className="rounded-xl bg-warning-50 p-3 text-sm">This company has no wallet yet. Ask the group admin to add one under Group Overview &gt; Book Keeping &gt; Setup.</p>
      ) : (
        <div className="space-y-3">
          <label className="block text-xs font-medium text-tertiary-600">Wallet
            <select className={inputCls} value={v.wallet_id} onChange={set('wallet_id')}>
              <option value="">Choose a wallet…</option>
              {(wallets || []).map((w) => <option key={w.id} value={w.id}>{w.name}{w.bank_account_name ? ` · ${w.bank_account_name}` : ""} ({w.currency})</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-tertiary-600">How was it paid
              <select className={inputCls} value={v.mode} onChange={set('mode')}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
            <label className="block text-xs font-medium text-tertiary-600">Date (optional)<input type="date" className={inputCls} value={v.date} onChange={set('date')} /></label>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * Wraps a "mark as paid" request. `run(fn)` calls fn(undefined); if the server says a wallet is needed it asks the user
 * and calls fn(walletPayment) again. A cancelled prompt rejects with WALLET_CANCELLED (callers just ignore it).
 *   const { run, dialog } = useWalletPayment('out');   ...   await run((wp) => apiClient.post(url, { ...body, ...(wp ? { wallet_payment: wp } : {}) }));
 */
export default function useWalletPayment(direction = 'out') {
  const [open, setOpen] = useState(false);
  const pending = useRef(null);
  const ask = () => new Promise((resolve, reject) => { pending.current = { resolve, reject }; setOpen(true); });
  const run = useCallback(async (fn) => {
    try {
      return await fn(undefined);
    } catch (err) {
      if (!needsWallet(err)) throw err;
      const wp = await ask();
      return fn(wp);
    }
  }, []);
  const dialog = (
    <WalletDialog
      open={open}
      direction={direction}
      onChoose={(wp) => { setOpen(false); pending.current?.resolve(wp); }}
      onCancel={() => { setOpen(false); pending.current?.reject(new Error(WALLET_CANCELLED)); }}
    />
  );
  return { run, dialog };
}

export const isCancelled = (err) => err?.message === WALLET_CANCELLED;
