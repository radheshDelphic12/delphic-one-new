import { useEffect } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { IN_KINDS, registerTrackHandler } from '../../lib/payments/trackInWallet.js';
import usePaymentDialog from './usePaymentDialog.jsx';

/** Mounted once (main.jsx): owns the "track in a wallet?" popup that company screens open after saving a payment. */
export default function TrackInWalletHost() {
  const { pushInfo } = useAlerts();
  const { pay, dialog } = usePaymentDialog();

  useEffect(() => registerTrackHandler(async (cfg) => {
    const direction = IN_KINDS.has(cfg.kind) ? 'in' : 'out';
    const currency = cfg.currency || 'INR';
    const record = await pay(
      { title: cfg.title || (direction === 'in' ? 'Payment received' : 'Payment made'), direction, currency, amount: String(cfg.amount), fixedAmount: true, party: cfg.party, track: false },
      (body) => apiClient.post('/payments/track', { kind: cfg.kind, reference_id: cfg.reference_id, currency, party: cfg.party, category: cfg.category, ...body, amount: String(cfg.amount) }).then((r) => r.data.data),
    );
    pushInfo(record?.wallet ? `Tracked in wallet ${record.wallet.name}` : 'Payment details saved (no wallet)');
    return record;
  }), [pay, pushInfo]);

  return dialog;
}
