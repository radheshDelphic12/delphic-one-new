import { useState } from 'react';
import { Plus } from 'lucide-react';
import { doxApi } from '../../lib/delphicone/api.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { inputCls, labelCls, th, td, useLoad, useSave } from './ui.jsx';

// Delphic One > Team (admins only): the people of the Delphic One company itself. It uses the same user service as People > Users, so the same rules apply.
const ROLE_LABEL = { admin: 'Admin', sales: 'Sales', bda: 'BDA' };

function AddDrawer({ open, roles, onClose, onAdded }) {
  const save = useSave();
  const [v, setV] = useState({ name: '', email: '', role: 'sales', phone: '' });
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState(null);
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const r = await save(() => doxApi.addTeamMember({ ...v, phone: v.phone || null }), 'Person added', 'Could not add this person');
    setBusy(false);
    if (r) { setMade(r); onAdded(); }
  }
  function close() { setMade(null); setV({ name: '', email: '', role: 'sales', phone: '' }); onClose(); }
  return (
    <Drawer open={open} onClose={close} size="md" tone="create" title={made ? 'Person added' : 'Add a team member'} footer={made
      ? <button type="button" className="btn-primary" onClick={close}>Done</button>
      : (<><button type="button" className="btn-secondary" onClick={close} disabled={busy}>Cancel</button><button type="submit" form="team-form" className="btn-primary" disabled={busy || !v.name.trim() || !v.email.trim()}>{busy ? 'Adding...' : 'Add'}</button></>)}>
      {made ? (
        <div className="space-y-3 text-sm" data-testid="team-added">
          <p>{made.name} can now sign in to Delphic One as <b>{ROLE_LABEL[made.role]}</b>. Give them this first password; it is shown only now and they should change it after signing in.</p>
          <dl className="rounded-xl bg-canvas-muted p-3 font-mono text-xs"><dt className="text-tertiary-500">Email</dt><dd className="mb-2">{made.email}</dd><dt className="text-tertiary-500">One-time password</dt><dd>{made.temp_password}</dd></dl>
        </div>
      ) : (
        <form id="team-form" onSubmit={submit} className="grid gap-3" data-testid="team-form">
          <label className={labelCls}>Name<input required className={inputCls} aria-label="Name" value={v.name} onChange={set('name')} /></label>
          <label className={labelCls}>Email<input required type="email" className={inputCls} aria-label="Email" value={v.email} onChange={set('email')} /></label>
          <label className={labelCls}>Phone<input className={inputCls} value={v.phone} onChange={set('phone')} /></label>
          <label className={labelCls}>Role<select className={inputCls} aria-label="Role" value={v.role} onChange={set('role')}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
          <p className="text-xs text-tertiary-500">Admin: everything, including this Team page. Sales and BDA: customers and leads, and they can read invoices. A first password is generated for you. An email that already has a login anywhere cannot be used here.</p>
        </form>
      )}
    </Drawer>
  );
}

export default function DelphicOneTeamPage() {
  const save = useSave();
  const [data, reload] = useLoad(() => doxApi.team(), [], null);
  const [adding, setAdding] = useState(false);
  if (!data) return <Skeleton className="h-40" />;
  const change = async (m, patch, ok) => { const r = await save(() => doxApi.updateTeamMember(m.id, patch), ok, 'Could not change this person'); if (r) reload(); };
  return (
    <div className="space-y-3" data-testid="dox-team">
      <div className="flex items-center justify-between">
        <p className="text-sm text-tertiary-500">The people who work in the Delphic One company: our sales and admin team.</p>
        <button type="button" className="btn-primary inline-flex items-center gap-2" data-testid="add-team-member" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add person</button>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-sm">
          <thead className="bg-canvas-muted"><tr><th className={th}>Name</th><th className={th}>Email</th><th className={th}>Role</th><th className={th}>Status</th><th className={th} /></tr></thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.id} className="border-t border-tertiary-100" data-testid="team-row">
                <td className={`${td} font-medium`}>{m.name}</td>
                <td className={td}>{m.email}</td>
                <td className={td}>
                  {m.can_edit ? (
                    <select className={inputCls} aria-label={`Role of ${m.name}`} value={m.role} onChange={(e) => change(m, { role: e.target.value }, 'Role changed')}>{data.roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}{!data.roles.includes(m.role) && <option value={m.role}>{m.role}</option>}</select>
                  ) : (ROLE_LABEL[m.role] || m.role)}
                </td>
                <td className={td}><Pill tone={m.active ? 'green' : 'gray'}>{m.active ? 'Active' : 'Inactive'}</Pill>{!m.can_edit && <span className="ml-2 text-[11px] text-tertiary-500">{m.protected ? 'super admin' : 'works in another company too'}</span>}</td>
                <td className={`${td} text-right`}>{m.can_edit && <button type="button" className="btn-ghost text-xs" onClick={() => change(m, { active: !m.active }, m.active ? 'Switched off' : 'Switched on')}>{m.active ? 'Deactivate' : 'Reactivate'}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AddDrawer open={adding} roles={data.roles} onClose={() => setAdding(false)} onAdded={reload} />
    </div>
  );
}
