import { useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { doxApi } from '../../lib/delphicone/api.js';
import { useDelphicOne, doxCan } from '../../lib/delphicone/useDelphicOne.js';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Pill from '../../components/ui/Pill.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import CustomerDeleteDrawer from './CustomerDeleteDrawer.jsx';
import PasswordResultDrawer from './PasswordResultDrawer.jsx';
import { inputCls, labelCls, th, thr, td, tdr, rupees, useLoad, useSave } from './ui.jsx';

const STATUS = { trial: ['blue', 'Trial'], active: ['green', 'Active'], read_only: ['amber', 'Read-only'], churned: ['gray', 'Churned'] };
const DELETED_STATUS = ['red', 'Deleted'];
const EMPTY = { name: '', contact_name: '', contact_email: '', contact_phone: '', gstin: '', address: '', status: 'trial', plan_name: '', users_count: 0, monthly_value: 0, trial_ends_on: '', started_on: '', notes: '' };

function CustomerDrawer({ customer, onClose, onSaved }) {
  const save = useSave();
  const [v, setV] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (customer) setV(customer.id ? { ...EMPTY, ...Object.fromEntries(Object.entries(customer).filter(([k]) => k in EMPTY).map(([k, x]) => [k, x ?? ''])) } : { ...EMPTY }); }, [customer]);
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const body = { ...v, users_count: Number(v.users_count) || 0, monthly_value: Number(v.monthly_value) || 0, trial_ends_on: v.trial_ends_on || null, started_on: v.started_on || null };
    const r = await save(() => (customer.id ? doxApi.updateCustomer(customer.id, body) : doxApi.createCustomer(body)), 'Customer saved', 'Could not save the customer');
    setBusy(false);
    if (r) { onSaved(); onClose(); }
  }
  return (
    <Drawer open={Boolean(customer)} onClose={onClose} size="lg" tone={customer?.id ? 'edit' : 'create'} title={customer?.id ? 'Edit customer' : 'New customer'} footer={
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" form="dox-customer-form" className="btn-primary" disabled={busy || !v.name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
      </>
    }>
      <form id="dox-customer-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2" data-testid="customer-form">
        <label className={`${labelCls} sm:col-span-2`}>Company<input required className={inputCls} aria-label="Company" value={v.name} onChange={set('name')} /></label>
        <label className={labelCls}>Contact person<input className={inputCls} value={v.contact_name} onChange={set('contact_name')} /></label>
        <label className={labelCls}>Contact email<input type="email" className={inputCls} value={v.contact_email} onChange={set('contact_email')} /></label>
        <label className={labelCls}>Phone<input className={inputCls} value={v.contact_phone} onChange={set('contact_phone')} /></label>
        <label className={labelCls}>GSTIN<input className={inputCls} value={v.gstin} onChange={set('gstin')} /></label>
        <label className={`${labelCls} sm:col-span-2`}>Address<input className={inputCls} value={v.address} onChange={set('address')} /></label>
        <label className={labelCls}>Status<select className={inputCls} value={v.status} onChange={set('status')}>{Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className={labelCls}>Plan<input className={inputCls} value={v.plan_name} onChange={set('plan_name')} placeholder="IT Services" /></label>
        <label className={labelCls}>Users<input type="number" min="0" className={inputCls} value={v.users_count} onChange={set('users_count')} /></label>
        <label className={labelCls}>Recurring revenue per 30 days (₹, before GST)<input type="number" min="0" step="0.01" className={inputCls} value={v.monthly_value} onChange={set('monthly_value')} /></label>
        <label className={labelCls}>Started on<input type="date" className={inputCls} value={v.started_on} onChange={set('started_on')} /></label>
        <label className={labelCls}>Trial ends on<input type="date" className={inputCls} value={v.trial_ends_on} onChange={set('trial_ends_on')} /></label>
        <label className={`${labelCls} sm:col-span-2`}>Notes<textarea rows={3} className={inputCls} value={v.notes} onChange={set('notes')} /></label>
      </form>
    </Drawer>
  );
}

// Shown once after "Create workspace": the customer's own company with a first admin login. The password is not stored anywhere readable.
function WorkspaceResult({ result, onClose }) {
  return (
    <Drawer open={Boolean(result)} onClose={onClose} size="md" title="Customer workspace created" footer={<button type="button" className="btn-primary" onClick={onClose}>Done</button>}>
      {result && (
        <div className="space-y-3 text-sm" data-testid="workspace-result">
          <p>A separate workspace now exists for this customer. It is not part of our group and holds none of our data. Trial until <b>{result.trial_ends_on}</b>, up to <b>{result.max_users}</b> users.</p>
          <p>Give the customer this first admin login. The password is shown only now; they should change it after signing in.</p>
          <dl className="rounded-xl bg-canvas-muted p-3 font-mono text-xs"><dt className="text-tertiary-500">Email</dt><dd className="mb-2">{result.admin_email}</dd><dt className="text-tertiary-500">One-time password</dt><dd>{result.temp_password}</dd></dl>
        </div>
      )}
    </Drawer>
  );
}

export default function DelphicOneCustomersPage() {
  const { me } = useDelphicOne();
  const canEdit = doxCan(me, 'customersEdit');
  const save = useSave();
  const [workspace, setWorkspace] = useState(null);
  const [removing, setRemoving] = useState(null); // { customer, mode: 'delete' | 'restore' }, super admins of our own group only
  const canDelete = Boolean(me?.can_delete_customers);
  const [shown, setShown] = useState(null);
  const resetAdmin = async (c) => {
    if (!window.confirm(`Reset the admin password of ${c.name}?\n\nA new strong password is generated and shown once. Their admin's earlier sign-ins end at once.`)) return;
    const r = await save(() => doxApi.resetCustomerAdminPassword(c.id, {}), null, 'Could not reset the admin password');
    if (r) setShown(r);
  };
  const createWorkspace = async (c) => {
    if (!window.confirm(`Create a separate workspace for ${c.name}? This creates their company and first admin login (${c.contact_email || 'no email yet'}).`)) return;
    const r = await save(() => doxApi.provisionCustomer(c.id), null, 'Could not create the workspace');
    if (r) { setWorkspace(r); reload(); }
  };
  const [filters, setFilters] = useState({ status: '', q: '' });
  const [rows, reload] = useLoad(() => doxApi.customers(filters), [filters.status, filters.q], []);
  const [editing, setEditing] = useState(null);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="space-y-3" data-testid="dox-customers">
      <div className="flex flex-wrap items-end gap-3">
        <label className={labelCls}>Search<input className={inputCls} placeholder="Company, person or email" value={filters.q} onChange={set('q')} /></label>
        <label className={labelCls}>Status<select className={inputCls} value={filters.status} onChange={set('status')}><option value="">All</option>{Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}{canDelete && <option value="deleted">Deleted</option>}</select></label>
        {canEdit && <button type="button" className="btn-primary ml-auto inline-flex items-center gap-2" data-testid="new-customer" onClick={() => setEditing({})}><Plus className="h-4 w-4" />New customer</button>}
      </div>
      {!rows ? <Skeleton className="h-40" /> : rows.length === 0 ? <EmptyState title="No customers yet" description="A lead becomes a customer when you convert it, or add one here." /> : (
        <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
          <table className="min-w-full text-sm">
            <thead className="bg-canvas-muted"><tr><th className={th}>Customer</th><th className={th}>Status</th><th className={th}>Plan</th><th className={thr}>Users</th><th className={thr}>Per 30 days</th><th className={thr}>Owes</th><th className={th}>Trial ends</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-tertiary-100" data-testid="customer-row">
                  <td className={`${td} font-medium`}>{c.name}<span className="block text-[11px] font-normal text-tertiary-500">{[c.contact_name, c.contact_email].filter(Boolean).join(' · ')}</span></td>
                  <td className={td}><Pill tone={c.deleted_at ? DELETED_STATUS[0] : STATUS[c.status][0]}>{c.deleted_at ? DELETED_STATUS[1] : STATUS[c.status][1]}</Pill></td>
                  <td className={td}>{c.plan_name || '—'}</td>
                  <td className={tdr}>{c.users_count}</td>
                  <td className={tdr}>{rupees(c.monthly_value)}</td>
                  <td className={`${tdr} ${c.outstanding > 0 ? 'font-semibold text-warning-700' : ''}`}>{c.outstanding > 0 ? rupees(c.outstanding) : '—'}</td>
                  <td className={td}>{c.trial_ends_on || '—'}</td>
                  <td className={`${td} text-right`}>{canDelete && !c.deleted_at && c.has_workspace && <button type="button" className="btn-ghost mr-1 text-xs" data-testid="reset-admin-password" onClick={() => resetAdmin(c)}>Reset admin password</button>}{canDelete && !c.deleted_at && <button type="button" className="btn-ghost mr-1 text-xs text-danger-700" data-testid="delete-customer" onClick={() => setRemoving({ customer: c, mode: 'delete' })}>Delete</button>}{canDelete && c.deleted_at && <button type="button" className="btn-ghost mr-1 text-xs" data-testid="restore-customer" onClick={() => setRemoving({ customer: c, mode: 'restore' })}>Restore</button>}{!c.deleted_at && me?.provisioning && c.status === 'trial' && <button type="button" className="btn-ghost mr-1 text-xs" data-testid="create-workspace" onClick={() => createWorkspace(c)}>Create workspace</button>}{canEdit && !c.deleted_at && <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => setEditing(c)}><Pencil className="h-3.5 w-3.5" />Edit</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CustomerDrawer customer={editing} onClose={() => setEditing(null)} onSaved={reload} />
      <WorkspaceResult result={workspace} onClose={() => setWorkspace(null)} />
      <PasswordResultDrawer result={shown} onClose={() => setShown(null)} />
      <CustomerDeleteDrawer customer={removing?.customer || null} mode={removing?.mode} onClose={() => setRemoving(null)} onDone={reload}
        api={removing ? (removing.mode === 'restore' ? { preview: () => doxApi.restorePreview(removing.customer.id), run: (b) => doxApi.restoreCustomer(removing.customer.id, b) } : { preview: () => doxApi.deletePreview(removing.customer.id), run: (b) => doxApi.softDeleteCustomer(removing.customer.id, b) }) : { preview: () => Promise.reject(new Error('none')), run: () => Promise.reject(new Error('none')) }} />
    </div>
  );
}
