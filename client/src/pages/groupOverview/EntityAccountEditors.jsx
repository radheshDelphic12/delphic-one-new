import { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { GST_STATES } from '../../lib/gstStates.js';
import Drawer from '../../components/ui/Drawer.jsx';

const inputCls = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';

function useSave(onSaved, onClose) {
  const { pushSuccess, pushError } = useAlerts();
  const [busy, setBusy] = useState(false);
  const save = async (fn, ok) => {
    setBusy(true);
    try { await fn(); pushSuccess(ok); onSaved(); onClose(); } catch (err) { pushError(apiErrorMessage(err, 'Could not save'), 'Not saved'); } finally { setBusy(false); }
  };
  return { busy, save };
}

/** A legal entity's registration details: these are what its invoices print and number from. */
export function EntityEditDrawer({ entity, workspaces, onClose, onSaved }) {
  const [v, setV] = useState({});
  const { busy, save } = useSave(onSaved, onClose);
  useEffect(() => {
    if (entity) setV({ name: entity.name, workspace_id: entity.workspace_id || '', gstin: entity.gstin || '', pan: entity.pan || '', address: entity.address || '', invoice_prefix: entity.invoice_prefix || '', state_code: entity.state_code || '', lut_note: entity.lut_note || '', active: entity.active });
  }, [entity]);
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  return (
    <Drawer open={Boolean(entity)} onClose={onClose} size="md" tone="edit" title={entity ? `Edit ${entity.name}` : 'Edit legal entity'}>
      {entity && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(() => apiClient.patch(`/group-cash/entities/${entity.id}`, { ...v, workspace_id: v.workspace_id || null }), 'Legal entity saved'); }}>
          <label className={labelCls}>Name<input required className={inputCls} value={v.name || ''} onChange={set('name')} /></label>
          <label className={labelCls}>Same as company (optional)<select className={inputCls} value={v.workspace_id || ''} onChange={set('workspace_id')}><option value="">None</option>{(workspaces || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>GSTIN<input className={inputCls} maxLength={20} value={v.gstin || ''} onChange={set('gstin')} /></label>
            <label className={labelCls}>PAN<input className={inputCls} maxLength={20} value={v.pan || ''} onChange={set('pan')} /></label>
            <label className={labelCls}>Invoice prefix<input className={inputCls} maxLength={10} placeholder="e.g. DG" value={v.invoice_prefix || ''} onChange={(e) => setV((c) => ({ ...c, invoice_prefix: e.target.value.toUpperCase() }))} /></label>
            <label className={labelCls}>GST state<select className={inputCls} value={v.state_code || ''} onChange={set('state_code')}><option value="">Choose…</option>{GST_STATES.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</select></label>
          </div>
          <label className={labelCls}>Address (printed on invoices)<textarea rows={3} className={inputCls} maxLength={500} value={v.address || ''} onChange={set('address')} /></label>
          <label className={labelCls}>LUT note (printed on USD export invoices)<textarea rows={2} className={inputCls} maxLength={500} value={v.lut_note || ''} onChange={set('lut_note')} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(v.active)} onChange={(e) => setV((c) => ({ ...c, active: e.target.checked }))} />Active</label>
          <p className="text-xs text-tertiary-500">The prefix starts this entity&apos;s own invoice numbers (e.g. DG/2026-27/0001). Invoices already issued keep the details they were issued with.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(v.active)} onChange={(e) => setV((c) => ({ ...c, active: e.target.checked }))} />Active (an account can only be switched off when every wallet in it is at zero)</label>
          <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={busy || !String(v.name || '').trim()}>{busy ? 'Saving…' : 'Save'}</button></div>
        </form>
      )}
    </Drawer>
  );
}

/** A bank account's name, bank details and the payment lines printed on invoices paid into it. */
export function AccountEditDrawer({ account, entities, onClose, onSaved }) {
  const [v, setV] = useState({});
  const { busy, save } = useSave(onSaved, onClose);
  useEffect(() => {
    if (account) setV({ legal_entity_id: account.legal_entity_id || '', name: account.name, bank_name: account.bank_name || '', account_last4: account.account_last4 || '', payment_instructions: account.payment_instructions || '', declared_opening_balance: account.declared_opening_balance ?? '0', minimum_balance: account.minimum_balance ?? '', opening_date: account.opening_date || '', active: account.active !== false });
  }, [account]);
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  return (
    <Drawer open={Boolean(account)} onClose={onClose} size="md" tone="edit" title={account ? `Edit ${account.name}` : 'Edit bank account'}>
      {account && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(() => apiClient.patch(`/group-cash/accounts/${account.id}`, { ...(account.type === 'cash' ? { name: v.name, payment_instructions: v.payment_instructions } : { name: v.name, bank_name: v.bank_name, account_last4: v.account_last4, payment_instructions: v.payment_instructions }), legal_entity_id: v.legal_entity_id || null, declared_opening_balance: v.declared_opening_balance, minimum_balance: String(v.minimum_balance ?? '').trim() === '' ? null : v.minimum_balance, ...(v.opening_date ? { opening_date: v.opening_date } : {}), active: v.active }), 'Bank account saved'); }}>
          <label className={labelCls}>Name<input required className={inputCls} value={v.name || ''} onChange={set('name')} /></label>
          <label className={labelCls}>Legal entity (optional)<select className={inputCls} value={v.legal_entity_id || ''} onChange={set('legal_entity_id')}><option value="">None</option>{(entities || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          {account.type !== 'cash' && (
            <div className="grid grid-cols-2 gap-3">
              <label className={labelCls}>Bank<input className={inputCls} value={v.bank_name || ''} onChange={set('bank_name')} /></label>
              <label className={labelCls}>Last 4 digits<input className={inputCls} maxLength={4} value={v.account_last4 || ''} onChange={set('account_last4')} /></label>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>Opening balance<input inputMode="decimal" className={inputCls} value={v.declared_opening_balance ?? ''} onChange={set('declared_opening_balance')} /></label>
            <label className={labelCls}>As on<input type="date" className={inputCls} value={v.opening_date || ''} onChange={set('opening_date')} /></label>
          </div>
          <label className={labelCls}>Minimum balance (optional)<input inputMode="decimal" className={inputCls} value={v.minimum_balance ?? ''} onChange={set('minimum_balance')} placeholder="e.g. 500000" data-testid="min-balance-input" /><span className="text-[11px] font-normal text-tertiary-400">The account is highlighted in red once its balance falls below this. Leave empty for no alert.</span></label>
          <label className={labelCls}>Payment details printed on invoices (bank, IFSC / SWIFT, account holder)
            <textarea rows={4} className={inputCls} maxLength={1000} value={v.payment_instructions || ''} onChange={set('payment_instructions')} />
          </label>
          <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={busy || !String(v.name || '').trim()}>{busy ? 'Saving…' : 'Save'}</button></div>
        </form>
      )}
    </Drawer>
  );
}
