import { useCallback, useEffect, useState } from 'react';
import { ArchiveRestore, DatabaseBackup, RotateCcw, ShieldCheck } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Pill from '../ui/Pill.jsx';

const box = 'rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card';
const when = (iso) => (iso ? new Date(iso).toLocaleString() : 'never');

/** Every company, its mode and its one Admin account. A missing Admin account is shown here, not hidden. */
function CompaniesTable({ rows, activeOrgId }) {
  return (
    <div className={box}>
      <h3 className="font-heading text-sm font-semibold text-tertiary-900">Companies</h3>
      <p className="text-xs text-tertiary-500">Move one company at a time, starting with Delphic Global. Switch to the company in the sidebar to review and apply it.</p>
      <table className="mt-2 w-full text-sm">
        <thead><tr className="text-left text-xs text-tertiary-500"><th>Company</th><th>Access</th><th>Admin account</th><th>Last backup</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.org_id} className="border-t border-tertiary-100">
              <td className="py-1.5 font-medium">{r.name}{r.org_id === activeOrgId && <span className="ml-2"><Pill tone="blue">open now</Pill></span>}</td>
              <td>{r.access_mode === 'permissions' ? <Pill tone="green">Permissions</Pill> : <Pill tone="gray">Old roles</Pill>}</td>
              <td>
                {r.admin_status === 'one' && r.admin_accounts[0].name}
                {r.admin_status === 'many' && <span className="text-warning-700">More than one Admin: {r.admin_accounts.map((a) => a.name).join(', ')}</span>}
                {r.admin_status === 'none' && <span className="text-warning-700">No Admin account. Add one in People &gt; Users first.</span>}
              </td>
              <td className="text-xs text-tertiary-500">{when(r.last_backup)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Preview({ plan, setNames, onApplied }) {
  const { pushError, pushSuccess } = useAlerts();
  const [adminId, setAdminId] = useState(plan.admin.proposed?.org_membership_id || '');
  const [chosen, setChosen] = useState(() => Object.fromEntries(plan.people.filter((p) => p.proposed.level === 'employee').map((p) => [p.org_membership_id, p.proposed.set?.name || ''])));
  const [onlyDown, setOnlyDown] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const shown = plan.people.filter((p) => !onlyDown || p.flags.includes('access_down'));
  const employees = plan.people.filter((p) => p.proposed.level === 'employee' && p.org_membership_id !== adminId);

  async function apply() {
    setBusy(true);
    try {
      const assignments = employees.map((p) => ({ org_membership_id: p.org_membership_id, set_name: chosen[p.org_membership_id] || null }));
      await apiClient.post('/access/migration/apply', { plan_hash: plan.plan_hash, admin_membership_id: adminId, assignments });
      pushSuccess(`${plan.org.name} now uses permissions`);
      onApplied();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not apply'), 'Not applied');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className={box}>
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">2. Review: the Admin account</h3>
        {plan.admin.status === 'none' && <p className="mt-1 text-sm text-warning-700">This company has no Admin account. Add one in People &gt; Users (the company ID of the Admin), then reload this preview.</p>}
        <label className="mt-2 block max-w-md text-xs font-medium text-tertiary-600">The one Admin of {plan.org.name}
          <select className="mt-1 block w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm" value={adminId} onChange={(e) => setAdminId(e.target.value)}>
            <option value="">Choose the Admin account</option>
            {[...new Map([...(plan.admin.candidates || []), ...plan.people.filter((p) => !p.current.is_group_superadmin).map((p) => ({ org_membership_id: p.org_membership_id, name: p.name, email: p.email, employee_code: p.employee_code }))].map((c) => [c.org_membership_id, c])).values()]
              .map((c) => <option key={c.org_membership_id} value={c.org_membership_id}>{c.name} · {c.employee_code || 'no code'} · {c.email}</option>)}
          </select>
        </label>
        <p className="mt-2 text-xs text-tertiary-500">The Super Admin ({plan.super_admin_accounts === 1 ? 'one account' : `${plan.super_admin_accounts} accounts: there should be exactly one`}) keeps full access in every company.</p>
      </div>

      <div className={box}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-heading text-sm font-semibold text-tertiary-900">3. Review: everyone else ({plan.summary.total} people, {plan.summary.access_down} lose some access)</h3>
          <label className="flex items-center gap-2 text-xs text-tertiary-600"><input type="checkbox" checked={onlyDown} onChange={(e) => setOnlyDown(e.target.checked)} />Only people whose access goes down</label>
        </div>
        <p className="text-xs text-tertiary-500">Each person gets the default basic access plus the permission set shown. Change a set here before approving. Nothing is applied until step 4.</p>
        <table className="mt-2 w-full text-sm">
          <thead><tr className="text-left text-xs text-tertiary-500"><th>Person</th><th>Today</th><th>Permission set</th><th>Change</th></tr></thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.org_membership_id} className="border-t border-tertiary-100 align-top">
                <td className="py-1.5"><span className="font-medium">{p.name}</span><span className="block text-xs text-tertiary-500">{p.employee_code || 'no code'} · {p.email}</span></td>
                <td className="text-xs text-tertiary-600">{p.current.is_group_superadmin ? 'Group Super Admin' : `${p.current.custom_role || p.current.role}${p.current.is_superadmin ? ' (super)' : ''}`}{p.department ? ` · ${p.department}` : ''}</td>
                <td>
                  {p.proposed.level === 'super_admin' && <Pill tone="purple">Super Admin</Pill>}
                  {p.org_membership_id === adminId && p.proposed.level !== 'super_admin' && <Pill tone="blue">Admin</Pill>}
                  {p.proposed.level === 'employee' && p.org_membership_id !== adminId && (
                    <select aria-label={`Permission set for ${p.name}`} className="rounded-lg border border-tertiary-200 px-2 py-1 text-xs" value={chosen[p.org_membership_id] || ''} onChange={(e) => setChosen({ ...chosen, [p.org_membership_id]: e.target.value })}>
                      <option value="">Basic access only</option>
                      {setNames.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  )}
                </td>
                <td className="text-xs">
                  {p.flags.includes('access_down') && <details><summary className="cursor-pointer"><Pill tone="red">Access goes down</Pill> {p.diff.lost.length} lost{p.diff.narrowed.length ? `, ${p.diff.narrowed.length} narrower` : ''}</summary><div className="mt-1 max-w-sm text-tertiary-600">{[...p.diff.lost, ...p.diff.narrowed.map((k) => `${k} (narrower)`)].join(', ')}</div></details>}
                  {p.flags.includes('access_up') && <span className="mr-1"><Pill tone="amber">Gains {p.diff.gained.length}</Pill></span>}
                  {p.flags.includes('was_admin') && <Pill tone="gray">Was Admin</Pill>}
                  {!p.flags.length && <span className="text-tertiary-400">Same access</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={`${box} space-y-3`}>
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">4. Approve and apply</h3>
        <p className="text-xs text-tertiary-500">The old role fields stay on file, read-only, for 30 days so access can be restored if something was missed. A fresh backup (step 1) is required.</p>
        <label className="flex items-start gap-2 text-sm text-tertiary-800"><input type="checkbox" className="mt-1" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />I reviewed every person marked &quot;Access goes down&quot; and approve this move for {plan.org.name}.</label>
        <button type="button" className="btn-primary inline-flex items-center gap-1" disabled={!reviewed || !adminId || busy} onClick={apply}><ShieldCheck className="h-4 w-4" />{busy ? 'Applying…' : `Apply to ${plan.org.name}`}</button>
      </div>
    </div>
  );
}

/** Super Admin: back up, review, approve, apply, restore and clean up the move of the open company to the permission model. */
export default function AccessMigrationPanel() {
  const { user } = useAuth();
  const { pushError, pushSuccess } = useAlerts();
  const moved = user?.access?.mode === 'permissions';
  const [rows, setRows] = useState([]);
  const [plan, setPlan] = useState(null);
  const [cleanup, setCleanup] = useState(null);
  const [setNames, setSetNames] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const status = await apiClient.get('/access/migration/status');
      setRows(status.data.data || []);
      if (moved) {
        setPlan(null);
        setCleanup((await apiClient.get('/access/migration/cleanup')).data.data);
      } else {
        const [p, roles] = await Promise.all([apiClient.get('/access/migration/preview'), apiClient.get('/roles')]);
        setPlan(p.data.data);
        setSetNames([...new Set([...p.data.data.sets.map((s) => s.name), ...(roles.data.data || []).map((r) => r.name)])].filter((n) => !['Admin', 'Super Admin'].includes(n)).sort());
      }
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not load the migration'), 'Something went wrong');
    }
  }, [moved, pushError]);
  useEffect(() => { load(); }, [load]);

  async function run(label, fn) {
    setBusy(true);
    try {
      await fn();
      pushSuccess(label);
      await load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'That did not work'), 'Not done');
    } finally {
      setBusy(false);
    }
  }
  const current = rows.find((r) => r.org_id === user?.active_org?.id);

  return (
    <div className="space-y-4">
      <CompaniesTable rows={rows} activeOrgId={user?.active_org?.id} />
      {!moved && (
        <div className={box}>
          <h3 className="font-heading text-sm font-semibold text-tertiary-900">1. Back up {user?.active_org?.name}</h3>
          <p className="text-xs text-tertiary-500">Exports everyone&apos;s current access (roles, custom roles, flags) so it can be restored. Last backup: {when(current?.last_backup)}.</p>
          <button type="button" className="btn-secondary mt-2 inline-flex items-center gap-1" disabled={busy} onClick={() => run('Backup taken', () => apiClient.post('/access/migration/backup', { note: 'before moving to permissions' }))}><DatabaseBackup className="h-4 w-4" />Take a backup now</button>
        </div>
      )}
      {!moved && plan && <Preview key={plan.plan_hash} plan={plan} setNames={setNames} onApplied={async () => { await load(); window.location.reload(); }} />}
      {moved && cleanup && (
        <div className={`${box} space-y-3`}>
          <h3 className="font-heading text-sm font-semibold text-tertiary-900">{user?.active_org?.name} uses permissions</h3>
          <p className="text-sm text-tertiary-600">{cleanup.window_open ? 'The old role fields are kept read-only for 30 days from the move. If something was missed, restore puts everything back exactly as the backup recorded it.' : cleanup.ready ? 'The 30 days are over. Clean up to end the restore window and drop the Admin role value from everyone who is not the Admin.' : 'Nothing left to clean up.'}</p>
          <div className="flex gap-2">
            {cleanup.window_open && <button type="button" className="btn-secondary inline-flex items-center gap-1 text-danger-600" disabled={busy} onClick={() => window.confirm('Put this company back on the old roles, exactly as the backup recorded them?') && run('Restored to the old roles', async () => { await apiClient.post('/access/migration/restore'); window.location.reload(); })}><RotateCcw className="h-4 w-4" />Restore the old roles</button>}
            {cleanup.ready && <button type="button" className="btn-primary inline-flex items-center gap-1" disabled={busy} onClick={() => run('Clean-up done', () => apiClient.post('/access/migration/cleanup'))}><ArchiveRestore className="h-4 w-4" />Clean up</button>}
          </div>
        </div>
      )}
    </div>
  );
}
