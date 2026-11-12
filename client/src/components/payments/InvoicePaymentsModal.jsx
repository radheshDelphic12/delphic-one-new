import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Modal from '../ui/Modal.jsx';
import UndoReasonModal from './UndoReasonModal.jsx';
import usePaymentDialog, { isPaymentCancelled } from './usePaymentDialog.jsx';

const fmt = (n, cur) => `${cur ? `${cur} ` : ''}${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Every payment of one client invoice (paid, bank charges, deductions, the wallet it was tracked in); the group admin can undo one. */
export default function InvoicePaymentsModal({ invoice, onClose, onChanged, canUndo = false }) {
  const { pushError, pushInfo } = useAlerts();
  const [rows, setRows] = useState(null);
  const [undoing, setUndoing] = useState(null);
  const paymentDialog = usePaymentDialog();

  function load() {
    apiClient.get(`/billing/invoices/${invoice.id}/payments`).then((r) => setRows(r.data.data || [])).catch((err) => { setRows([]); pushError(apiErrorMessage(err, 'Failed to load the payments'), 'Something went wrong'); });
  }
  useEffect(() => { if (invoice) { setRows(null); load(); } }, [invoice?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Edit (group admin): the old payment stays in the history as replaced, the corrected one takes its place (and its wallet entry).
  async function edit(p) {
    try {
      await paymentDialog.pay(
        {
          title: `Edit payment · ${invoice.invoice_number || ''}`, direction: 'in', currency: p.currency, amount: p.amount, initialAmount: p.amount,
          cap: Number(invoice.pending_amount || 0) + Number(p.amount),
          initial: { date: p.paid_on, exchange_rate: p.exchange_rate || '', bank_charges: Number(p.bank_charges) ? p.bank_charges : '', other_deductions: Number(p.other_deductions) ? p.other_deductions : '', deduction_notes: p.deduction_notes || '', notes: p.notes || '' },
          note: 'Saving replaces this payment (and its wallet entry, if there was one). Choose Yes again to keep it in a wallet.', submitLabel: 'Save changes',
        },
        (body) => apiClient.patch(`/billing/invoices/${invoice.id}/payments/${p.id}`, { ...body, reason: 'Edited' }),
      );
      pushInfo('Payment updated');
      load();
      onChanged?.();
    } catch (err) {
      if (!isPaymentCancelled(err)) pushError(apiErrorMessage(err, 'Failed to update the payment'), 'Something went wrong');
    }
  }

  return (
    <>
      {paymentDialog.dialog}
      <Modal open={Boolean(invoice)} wide title={`Payments · ${invoice?.invoice_number || ''}`} onClose={onClose} footer={<button type="button" className="btn-secondary" onClick={onClose}>Close</button>}>
        {invoice && (
          <div className="space-y-3">
            <p className="text-xs text-tertiary-600">
              Invoice {fmt(invoice.amount, invoice.currency)} · paid {fmt(invoice.paid_amount, invoice.currency)} · pending {fmt(invoice.pending_amount, invoice.currency)}
            </p>
            {rows && !rows.length && <p className="text-sm text-tertiary-500">No payments recorded yet.</p>}
            <ul className="divide-y divide-tertiary-100">
              {(rows || []).map((p) => (
                <li key={p.id} className={`py-2.5 ${p.undone ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-tertiary-900">{fmt(p.amount, p.currency)} <span className="text-xs font-normal text-tertiary-500">on {p.paid_on}</span>{p.undone && <span className="ml-2 rounded-full bg-danger-50 px-2 py-0.5 text-[11px] font-medium text-danger-700">{p.undone_reason === 'Edited' ? 'Replaced' : 'Undone'}</span>}</p>
                      <p className="text-xs text-tertiary-500">
                        {p.exchange_rate ? `Rate ${p.exchange_rate} · INR ${fmt(p.inr_amount)} · ` : ''}
                        {Number(p.bank_charges) > 0 ? `Bank charges ${fmt(p.bank_charges)} · ` : ''}
                        {Number(p.other_deductions) > 0 ? `Deductions ${fmt(p.other_deductions)}${p.deduction_notes ? ` (${p.deduction_notes})` : ''} · ` : ''}
                        Net {fmt(p.net_amount, p.currency)} · {p.wallet ? `in wallet ${p.wallet.name}` : 'not tracked in a wallet'}
                      </p>
                      {p.notes && <p className="text-xs text-tertiary-500">{p.notes}</p>}
                      {p.undone && p.undone_reason && p.undone_reason !== 'Edited' && <p className="text-xs text-danger-700">Reason: {p.undone_reason}</p>}
                    </div>
                    {canUndo && !p.undone && (
                      <span className="flex shrink-0 gap-1">
                        <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => edit(p)}><Pencil className="h-3.5 w-3.5" />Edit</button>
                        <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => setUndoing(p)}>Undo</button>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
      <UndoReasonModal
        open={Boolean(undoing)}
        title="Undo this payment"
        description="The payment stops counting, its wallet entry (if any) is removed, and a paid invoice goes back to sent. Only the group admin can do this."
        onClose={() => setUndoing(null)}
        onConfirm={async (reason) => {
          await apiClient.delete(`/billing/invoices/${invoice.id}/payments/${undoing.id}`, { data: { reason } });
          setUndoing(null);
          pushInfo('Payment undone');
          load();
          onChanged?.();
        }}
      />
    </>
  );
}
