import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Save } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { fxApi, foundationError } from '../../lib/foundation/api.js';
import { fxCan, useFoundation } from '../../lib/foundation/useFoundation.js';
import { FORECAST_METHODS } from '../../lib/foundation/meta.js';
import { dateLabel, titleCase } from '../../lib/format.js';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import { Empty, Num, Select, Text, card } from '../../components/foundation/ui.jsx';

const TABS = [{ key: 'general', label: 'Rules and projections' }, { key: 'audit', label: 'Audit log' }];

function General() {
  const { pushError, pushSuccess } = useAlerts();
  const [s, setS] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { fxApi.settings().then(setS, (e) => pushError(foundationError(e, 'Could not load'), 'Load failed')); }, [pushError]);
  if (!s) return <div className="py-6 text-sm text-tertiary-500">Loading...</div>;
  const set = (k) => (v) => setS((c) => ({ ...c, [k]: v }));
  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const out = await fxApi.updateSettings({ campaign_prefix: s.campaign_prefix, block_overspend: s.block_overspend, forecast_method: s.forecast_method, run_rate_months: Number(s.run_rate_months), ending_soon_days: Number(s.ending_soon_days), ...(reason.trim() ? { reason: reason.trim() } : {}) });
      setS(out);
      setReason('');
      pushSuccess('Settings saved');
    } catch (err) { pushError(foundationError(err, 'Could not save'), 'Could not save'); } finally { setSaving(false); }
  }
  return (
    <form onSubmit={save} className={`${card} space-y-4`}>
      <div>
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">Budget rules</h3>
        <label className="mt-2 flex items-start gap-2 text-sm text-tertiary-800">
          <input type="checkbox" className="mt-1" checked={s.block_overspend} onChange={(e) => set('block_overspend')(e.target.checked)} />
          <span>Stop spending that would take a campaign over its allocated budget<span className="block text-xs text-tertiary-500">When on, approving or paying such spending is refused unless an admin gives a reason. When off, it is allowed but still flagged on the campaign.</span></span>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Projection method" value={s.forecast_method} onChange={set('forecast_method')} options={FORECAST_METHODS} />
        <Num label="Run-rate: months of history" value={s.run_rate_months} onChange={set('run_rate_months')} step="1" min="2" max="12" hint="Used only by the run-rate method" />
        <Num label="'Ending soon' means within (days)" value={s.ending_soon_days} onChange={set('ending_soon_days')} step="1" min="1" max="365" />
        <Text label="Campaign code prefix" value={s.campaign_prefix} onChange={set('campaign_prefix')} maxLength={12} hint="New campaigns are numbered GF-0001, GF-0002 ..." />
      </div>
      <Text label="Reason for the change (kept in the audit log)" value={reason} onChange={setReason} maxLength={500} />
      <div className="flex items-center justify-between">
        <p className="text-xs text-tertiary-500">Initiatives, spending categories and funding sources are managed under <Link to="/foundation/initiatives" className="font-medium text-primary-700 hover:underline">Initiatives &amp; Categories</Link>.</p>
        <button type="submit" className="btn-primary inline-flex items-center gap-1.5" disabled={saving}><Save className="h-4 w-4" />{saving ? 'Saving...' : 'Save settings'}</button>
      </div>
    </form>
  );
}

function Audit() {
  const { pushError } = useAlerts();
  const [entity, setEntity] = useState('');
  const [rows, setRows] = useState(null);
  const load = useCallback(() => fxApi.audit({ entity, limit: 150 }).then(setRows, (e) => pushError(foundationError(e, 'Could not load'), 'Load failed')), [entity, pushError]);
  useEffect(() => { load(); }, [load]);
  const summary = (r) => {
    const after = r.after || {};
    if (r.entity === 'budget') return `Budget ${r.before?.allocated_budget} → ${after.allocated_budget}, planned investment ${r.before?.planned_investment} → ${after.planned_investment}`;
    if (r.action === 'status') return `${r.before?.status} → ${after.status}`;
    return after.name || after.status || after.month || after.kind || '';
  };
  return (
    <section className={`${card} space-y-3`}>
      <Select label="Show" value={entity} onChange={setEntity} blank="Everything" options={['campaign', 'budget', 'plan', 'entry', 'category', 'period', 'setting', 'person', 'user'].map((e) => ({ value: e, label: titleCase(e) }))} />
      {!rows ? <p className="text-sm text-tertiary-500">Loading...</p> : rows.length === 0 ? <Empty>Nothing recorded yet.</Empty> : (
        <ul className="divide-y text-sm">
          {rows.map((r) => (
            <li key={r.id} className="py-2">
              <span className="font-medium text-tertiary-900">{titleCase(r.entity)} · {r.action}</span>
              <span className="ml-2 text-xs text-tertiary-500">{dateLabel(r.created_at)}</span>
              <span className="block text-xs text-tertiary-600">{summary(r)}{r.reason ? ` - ${r.reason}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function FoundationSettingsPage() {
  const { me, loading } = useFoundation();
  const [tab, setTab] = useState('general');
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !fxCan(me, 'settings')) return <Navigate to="/foundation" replace />;
  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'general' && <General />}
      {tab === 'audit' && fxCan(me, 'audit') && <Audit />}
    </div>
  );
}
