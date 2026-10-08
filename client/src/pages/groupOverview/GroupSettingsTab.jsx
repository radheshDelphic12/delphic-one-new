import { useEffect, useState } from 'react';
import { Building2, KeyRound, UserRound } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { DEFAULT_THRESHOLDS, loadThresholds, resetThresholds, saveThresholds } from '../../lib/groupSettings.js';
import ChangePasswordForm from '../../components/ChangePasswordForm.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';

const THRESHOLD_FIELDS = [
  ['revenue_drop_pct', 'Revenue drop (%)', 'Alert when a company revenue falls by at least this much against the previous period'],
  ['profit_drop_pct', 'Profit drop (%)', 'Alert when profit falls by at least this much'],
  ['expense_rise_pct', 'Cost rise (%)', 'Alert when costs (revenue minus profit) rise by at least this much'],
  ['valuation_drop_pct', 'Valuation drop (%)', '0 = alert on any fall in valuation'],
];

function Card({ icon: Icon, title, hint, children }) {
  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><Icon className="h-5 w-5" aria-hidden="true" /></span>
        <div>
          <h3 className="font-heading text-base font-semibold text-tertiary-900">{title}</h3>
          {hint && <p className="text-xs text-tertiary-500">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Group Settings: the group admin's own account, the companies in the group, and the dashboard alert thresholds. */
export default function GroupSettingsTab() {
  const { user } = useAuth();
  const { pushError, pushInfo } = useAlerts();
  const [orgs, setOrgs] = useState(null);
  const [thresholds, setThresholds] = useState(loadThresholds);

  useEffect(() => {
    apiClient.get('/orgs').then(({ data }) => setOrgs(data.data || [])).catch((err) => pushError(apiErrorMessage(err, 'Failed to load the companies'), 'Something went wrong'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function saveAlerts(e) {
    e.preventDefault();
    saveThresholds(thresholds);
    pushInfo('Alert thresholds saved - the Group Finance tab uses them from now on');
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card icon={UserRound} title="Group administrator" hint="You manage every company of the group from this account">
        <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-sm">
          <dt className="text-tertiary-500">Name</dt><dd className="font-medium text-tertiary-900">{user?.name}</dd>
          <dt className="text-tertiary-500">Email</dt><dd className="font-medium text-tertiary-900">{user?.email}</dd>
          <dt className="text-tertiary-500">Access</dt><dd className="font-medium text-tertiary-900">Group superadmin - all companies of the group, admin in each</dd>
        </dl>
      </Card>

      <Card icon={KeyRound} title="Change password">
        <ChangePasswordForm />
      </Card>

      <Card icon={Building2} title="Companies in the group" hint="Each company keeps its own settings; open the company to change them">
        {!orgs ? <Skeleton className="h-24 w-full" /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-tertiary-500"><th className="py-1">Company</th><th>Status</th><th>Currency</th><th>Modules</th></tr></thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className="border-t border-tertiary-100">
                  <td className="py-2 font-medium text-tertiary-900">{o.name}</td>
                  <td className="capitalize">{o.status}</td>
                  <td>{o.default_currency}</td>
                  <td className="text-xs text-tertiary-500">{o.enabled_modules?.length ? o.enabled_modules.join(', ') : 'core'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card icon={Building2} title="Dashboard alert thresholds" hint="Saved in this browser for your login. They decide when 'Attention required' flags a company">
        <form onSubmit={saveAlerts} className="space-y-3">
          {THRESHOLD_FIELDS.map(([key, label, hint]) => (
            <label key={key} className="block text-xs font-medium text-tertiary-600">
              {label}
              <input type="number" min="0" max="1000" step="1" value={thresholds[key]} onChange={(e) => setThresholds((t) => ({ ...t, [key]: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
              <span className="font-normal text-tertiary-500">{hint}</span>
            </label>
          ))}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary">Save thresholds</button>
            <button type="button" className="btn-secondary" onClick={() => { resetThresholds(); setThresholds({ ...DEFAULT_THRESHOLDS }); pushInfo('Thresholds reset to the defaults'); }}>Reset to defaults</button>
          </div>
        </form>
      </Card>
    </div>
  );
}
