// "Track in a wallet?" for a payment saved by any company's own screen (rent, deal payments, salaries, funding, invoices, debt EMIs ...).
// The api wrapper that saved the payment calls trackInWallet({ kind, reference_id, amount, ... }) right after; a single host component
// (components/payments/TrackInWalletHost.jsx, mounted once) shows the popup and posts to /payments/track. Closing the popup skips it, and
// nothing here can fail the payment that was already saved.

let handler = null;

export function registerTrackHandler(fn) {
  handler = fn;
  return () => { if (handler === fn) handler = null; };
}

/**
 * cfg = { kind, reference_id, amount, currency ('INR'), title, party, category }  (kind: see TRACK_KINDS in the payments service)
 * Resolves with the payment record, or null when it was skipped.
 */
export async function trackInWallet(cfg) {
  if (!handler || !cfg?.reference_id || !(Number(cfg.amount) > 0)) return null;
  try {
    return await handler(cfg);
  } catch {
    return null;
  }
}

export const IN_KINDS = new Set(['rent_payment', 'ledger_income', 'deal_client_payment', 'invoice_payment', 'franchise_settlement', 'debt_received', 'other_in']);
