import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Save } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { vtApi, valterraError } from '../../lib/valterra/api.js';
import { vtCan, useValterra } from '../../lib/valterra/useValterra.js';
import { dateLabel, titleCase } from '../../lib/format.js';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import CategoriesManager from '../../components/valterra/CategoriesManager.jsx';
import { DateInput, Empty, Num, Select, Text, card } from '../../components/valterra/ui.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function General() {
  const { pushError, pushSuccess } = useAlerts();
  const [s, setS] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { vtApi.settings().then(setS, (e) => pushError(valterraError(e, 'Could not load'), 'Load failed')); }, [pushError]);
  if (!s) return <div className="py-6 text-sm text-tertiary-500">Loading...</div>;
  const set = (k) => (v) => setS((c) => ({ ...c, [k]: v }));
  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const blank = s.opening_balance === '' || s.opening_balance === null;
      const out = await vtApi.updateSettings({
        investment_prefix: s.investment_prefix, site_prefix: s.site_prefix, fy_start_month: Number(s.fy_start_month),
        opening_balance: blank ? null : Number(s.opening_balance), opening_date: s.opening_date || null,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setS(out);
      setReason('');
      pushSuccess('Settings saved');
    } catch (err) { pushError(valterraError(err, 'Could not save'), 'Could not save'); } finally { setSaving(false); }
  }
  return (
    <form onSubmit={save} className={`${card} max-w-2xl space-y-4`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Text label="Mining site code prefix" value={s.site_prefix} onChange={set('site_prefix')} maxLength={12} hint="New sites are numbered VS-001, VS-002 ..." />
        <Text label="Investment code prefix" value={s.investment_prefix} onChange={set('investment_prefix')} maxLength={12} hint="New investments are numbered VT-0001, VT-0002 ..." />
        <Select label="Financial year starts in" value={String(s.fy_start_month)} onChange={set('fy_start_month')} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} hint="Drives the quarter, financial-year and year-to-date figures" />
        <Num label="Opening cash balance (₹)" value={s.opening_balance ?? ''} onChange={set('opening_balance')} step="any" min="-1000000000000" hint="Leave empty if unknown: balances are then not shown, never guessed." />
        <DateInput label="Opening balance as of" value={s.opening_date || ''} onChange={set('opening_date')} hint="Cash movements before this date are not counted." />
      </div>
      <Text label="Reason for the change (optional, recorded in the audit log)" value={reason} onChange={setReason} maxLength={500} />
      <p className="text-xs text-tertiary-500">Currency: {s.currency}. Categories, projections, people and logins are managed in the other tabs and sections; none of them is fixed in code.</p>
      <div className="flex justify-end"><button type="submit" className="btn-primary inline-flex items-center gap-1.5" disabled={saving}><Save className="h-4 w-4" />{saving ? 'Saving...' : 'Save settings'}</button></div>
    </form>
  );
}

function Audit() {
  const { pushError } = useAlerts();
  const [entity, setEntity] = useState('');
  const [rows, setRows] = useState(null);
  const load = useCallback(() => vtApi.audit({ entity, limit: 150 }).then(setRows, (e) => pushError(valterraError(e, 'Could not load'), 'Load failed')), [entity, pushError]);
  useEffect(() => { load(); }, [load]);
  const summary = (r) => {
    const a = r.after || {};
    if (r.entity === 'period') return `${a.month || r.before?.month || ''} ${r.action}`;
    if (r.entity === 'return') return `principal ${a.principal ?? ''} · earnings ${a.earnings ?? ''} ${a.status || ''}`;
    return a.name || a.status || a.kind || a.month || '';
  };
  return (
    <section className={`${card} space-y-3`}>
      <Select label="Show" value={entity} onChange={setEntity} blank="Everything" options={['investment', 'return', 'entry', 'projection', 'category', 'period', 'setting', 'person', 'user'].map((e) => ({ value: e, label: titleCase(e) }))} />
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

export default function ValterraSettingsPage() {
  const { me, loading } = useValterra();
  const [tab, setTab] = useState('general');
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !vtCan(me, 'settings')) return <Navigate to="/valterra" replace />;
  const tabs = [{ key: 'general', label: 'Settings' }, { key: 'categories', label: 'Categories' }, ...(vtCan(me, 'audit') ? [{ key: 'audit', label: 'Audit log' }] : [])];
  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'general' && <General />}
      {tab === 'categories' && <CategoriesManager canEdit={vtCan(me, 'categories')} />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}
