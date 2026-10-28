import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Undo2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import UndoReasonModal from './UndoReasonModal.jsx';
import usePaymentDialog, { isPaymentCancelled } from './usePaymentDialog.jsx';

const fmt = (n, cur) => `${cur ? `${cur} ` : ''}${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const asNumber = (v) => Number(v || 0);

/**
 * Payments recorded against one record of any company (a deal, a loan ...) through POST /payments/track, with the payment popup (part
 * payments, rate, bank charges, deductions, wallet yes / no). With `total` it also shows paid / pending. Edit and Undo are the group
 * admin's. props: kind, referenceId, direction ('in' | 'out'), currency, total, title, party, category, canRecord, recordLabel, orgId.
 */
export default function TrackedPaymentsPanel({ kind, referenceId, direction = 'in', currency = 'INR', total = null, title = 'Payments', party, category, canRecord = true, recordLabel, orgId }) {
  const { user } = useAuth();
  const { pushError, pushInfo } = useAlerts();
  const paymentDialog = usePaymentDialog();
  const [rows, setRows] = useState(null);
  const [undoing, setUndoing] = useState(null);
  const groupAdmin = Boolean(user?.is_group_superadmin);
  const headers = orgId ? { 'X-Org-Id': orgId } : undefined;

  const load = useCallback(() => {
    if (!referenceId) return;
    apiClient.get('/payments/track', { params: { kind, reference_id: referenceId }, headers })
      .then((r) => setRows(r.data.data || []))
      .catch((err) => { setRows([]); pushError(apiErrorMessage(err, 'Failed to load the payments'), 'Something went wrong'); });
  }, [kind, referenceId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setRows(null); load(); }, [load]);

  const live = (rows || []).filter((r) => !r.undone);
  const paid = live.reduce((a, r) => a + asNumber(r.amount), 0);
  const pending = total === null ? null : Math.max(0, asNumber(total) - paid);

  async function record() {
    try {
      await paymentDialog.pay(
        { title, direction, currency, amount: pending ?? '', cap: pending ?? 1e13, party },
        (body) => apiClient.post('/payments/track', { kind, reference_id: referenceId, currency, party, category, ...body }, { headers }),
      );
      pushInfo('Payment recorded');
      load();
    } catch (err) {
      if (!isPaymentCancelled(err)) pushError(apiErrorMessage(err, 'Failed to record the payment'), 'Something went wrong');
    }
  }

  async function edit(p) {
    try {
      await paymentDialog.pay(
        {
          title: `Edit payment · ${title}`, direction, currency: p.currency, amount: p.amount, cap: (pending ?? 1e13) + asNumber(p.amount), initialAmount: p.amount, party,
          initial: { date: p.paid_on, exchange_rate: p.exchange_rate || '', bank_charges: asNumber(p.bank_charges) ? p.bank_charges : '', other_deductions: asNumber(p.other_deductions) ? p.other_deductions : '', deduction_notes: p.deduction_notes || '', notes: p.notes || '' },
          note: 'Saving replaces this payment (and its wallet entry, if there was one). Choose Yes again to keep it in a wallet.', submitLabel: 'Save changes',
        },
        (body) => apiClient.patch(`/payments/track/${p.id}`, { ...body, reason: 'Edited' }, { headers }),
      );
      pushInfo('Payment updated');
      load();
    } catch (err) {
      if (!isPaymentCancelled(err)) pushError(apiErrorMessage(err, 'Failed to update the payment'), 'Something went wrong');
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-tertiary-100 bg-white p-4" data-testid={`tracked-${kind}`}>
      {paymentDialog.dialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-heading text-sm font-semibold text-tertiary-900">{title}</h3>
          <p className="text-xs text-tertiary-500" data-testid="tracked-summary">
            {total !== null ? `Total ${fmt(total, currency)} · ${direction === 'in' ? 'received' : 'paid'} ${fmt(paid, currency)} · pending ${fmt(pending, currency)}` : `${live.length} recorded · ${fmt(paid, currency)}`}
          </p>
        </div>
        {canRecord && (total === null || pending > 0) && (
          <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={record}><Plus className="h-4 w-4" />{recordLabel || (direction === 'in' ? 'Record payment received' : 'Record payment')}</button>
        )}
      </div>
      {rows && !rows.length && <p className="text-sm text-tertiary-500">Nothing recorded yet.</p>}
      <ul className="divide-y divide-tertiary-100">
        {(rows || []).map((p) => (
          <li key={p.id} className={`flex items-start justify-between gap-3 py-2.5 ${p.undone ? 'opacity-60' : ''}`}>
            <div>
              <p className="text-sm font-medium text-tertiary-900">{fmt(p.amount, p.currency)} <span className="text-xs font-normal text-tertiary-500">on {p.paid_on}</span>{p.undone && <span className="ml-2 rounded-full bg-danger-50 px-2 py-0.5 text-[11px] font-medium text-danger-700">{p.undone_reason === 'Edited' ? 'Replaced' : 'Undone'}</span>}</p>
              <p className="text-xs text-tertiary-500">
                {p.exchange_rate ? `Rate ${p.exchange_rate} · INR ${fmt(p.inr_amount)} · ` : ''}
                {asNumber(p.bank_charges) > 0 ? `Bank charges ${fmt(p.bank_charges)} · ` : ''}
                {asNumber(p.other_deductions) > 0 ? `Deductions ${fmt(p.other_deductions)}${p.deduction_notes ? ` (${p.deduction_notes})` : ''} · ` : ''}
                Net {fmt(p.net_amount, p.currency)} · {p.wallet ? `in wallet ${p.wallet.name}` : 'not tracked in a wallet'}
              </p>
              {p.notes && <p className="text-xs text-tertiary-500">{p.notes}</p>}
              {p.undone && p.undone_reason && p.undone_reason !== 'Edited' && <p className="text-xs text-danger-700">Reason: {p.undone_reason}</p>}
            </div>
            {groupAdmin && !p.undone && (
              <span className="flex shrink-0 gap-1">
                <button type="button" title="Edit" className="rounded p-1.5 text-tertiary-500 hover:bg-primary-50 hover:text-primary-700" onClick={() => edit(p)}><Pencil className="h-4 w-4" /></button>
                <button type="button" title="Undo" className="rounded p-1.5 text-tertiary-500 hover:bg-danger-50 hover:text-danger-600" onClick={() => setUndoing(p)}><Undo2 className="h-4 w-4" /></button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <UndoReasonModal
        open={Boolean(undoing)}
        title="Undo this payment"
        description="The payment stops counting and its wallet entry (if any) is removed. Only the group admin can do this."
        onClose={() => setUndoing(null)}
        onConfirm={async (reason) => {
          await apiClient.delete(`/payments/track/${undoing.id}`, { data: { reason }, headers });
          setUndoing(null);
          pushInfo('Payment undone');
          load();
        }}
      />
    </section>
  );
}
