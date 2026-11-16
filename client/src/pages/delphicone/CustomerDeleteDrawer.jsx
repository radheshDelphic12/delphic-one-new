import { useEffect, useState } from 'react';
import Drawer from '../../components/ui/Drawer.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { inputCls, labelCls } from './ui.jsx';

// Delete (soft) or restore a customer, super admins of our own group only. Step 1 shows what will happen (a dry run: nothing changes); step 2 needs the
// company name typed again. A delete keeps every record and can be undone with Restore, and the screen says so.
// `api` = { preview(), run({ confirm_name, token, reason }) } so the same drawer serves Delphic One > Customers and Platform > Customers.
export default function CustomerDeleteDrawer({ customer, mode, api, onClose, onDone }) {
  const { pushError, pushSuccess } = useAlerts();
  const [plan, setPlan] = useState(null); // null = loading, false = refused
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const restoring = mode === 'restore';

  useEffect(() => {
    if (!customer) return undefined;
    let live = true;
    setPlan(null); setName(''); setReason('');
    api.preview().then((p) => { if (live) setPlan(p); }, (err) => { if (live) { setPlan(false); pushError(apiErrorMessage(err, 'Could not prepare this'), restoring ? 'Cannot restore' : 'Cannot delete'); } });
    return () => { live = false; };
  }, [customer?.id, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.run({ confirm_name: name, token: plan.token, ...(restoring ? {} : { reason: reason || undefined }) });
      pushSuccess(restoring ? `${plan.name} is back` : `${plan.name} is deleted. Nothing was removed: a super admin can restore it from Customers > Deleted.`);
      onDone();
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Not done'), restoring ? 'Not restored' : 'Not deleted');
    } finally { setBusy(false); }
  }

  const counts = plan?.counts || {};
  const rows = Object.entries(counts.company_rows || {});
  return (
    <Drawer open={Boolean(customer)} onClose={onClose} size="md" tone={restoring ? 'edit' : 'create'} title={restoring ? 'Restore customer' : 'Delete customer'} footer={
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" form="customer-delete-form" className={restoring ? 'btn-primary' : 'btn-primary bg-danger-600 hover:bg-danger-700'} disabled={busy || !plan || plan.name !== name.trim()} data-testid="confirm-customer-delete">{busy ? 'Working...' : restoring ? 'Restore customer' : 'Delete customer'}</button>
      </>
    }>
      {plan === null && <Skeleton className="h-40" />}
      {plan === false && <p className="text-sm text-tertiary-500">This cannot be done. The reason was shown at the top of the screen.</p>}
      {plan && (
        <form id="customer-delete-form" onSubmit={run} className="space-y-4 text-sm" data-testid="customer-delete-form">
          <p className="rounded-xl bg-primary-50 p-3 text-primary-900"><b>The data is kept.</b> {restoring ? 'Restoring switches everything that the delete changed back on, exactly as it was.' : 'Nothing is removed from the database. The customer is hidden and switched off, and a super admin can restore it later (Customers > Deleted).'}</p>
          <ul className="list-disc space-y-1 pl-5">{plan.will.map((w) => <li key={w}>{w}</li>)}</ul>
          <dl className="grid grid-cols-2 gap-2 rounded-xl border border-tertiary-100 p-3">
            {Object.entries(counts).filter(([k]) => k !== 'company_rows').map(([k, v]) => <div key={k}><dt className="text-xs text-tertiary-500">{k.replace(/_/g, ' ')}</dt><dd className="font-semibold">{v}</dd></div>)}
          </dl>
          {plan.users.length > 0 && (
            <div>
              <p className="font-medium">{restoring ? 'Users switched back on' : 'Users who will be switched off (they cannot sign in)'}</p>
              <ul className="mt-1 space-y-0.5 text-xs">{plan.users.map((u) => <li key={u.id}>{u.name} <span className="text-tertiary-500">{u.email}</span></li>)}</ul>
            </div>
          )}
          {rows.length > 0 && <details><summary className="cursor-pointer text-xs text-tertiary-500">Records of the customer&apos;s company that are hidden ({rows.reduce((a, [, n]) => a + n, 0)})</summary><ul className="mt-1 text-xs">{rows.map(([t, n]) => <li key={t}>{t}: {n}</li>)}</ul></details>}
          {!restoring && <label className={labelCls}>Reason (optional)<input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></label>}
          <label className={labelCls}>Type the company name <b>{plan.confirm_with}</b> to confirm<input className={inputCls} aria-label="Company name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} /></label>
        </form>
      )}
    </Drawer>
  );
}
