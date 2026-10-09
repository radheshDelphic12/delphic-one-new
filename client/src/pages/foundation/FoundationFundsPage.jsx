import { useCallback, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { fxApi, foundationError } from '../../lib/foundation/api.js';
import { fxCan, useFoundation } from '../../lib/foundation/useFoundation.js';
import { useFxPickers } from '../../lib/foundation/pickers.js';
import { ALL_ENTRY_STATUSES, ENTRY_KINDS, ENTRY_NEXT, KIND_LABEL, ACTION_LABEL, NEEDS_REASON } from '../../lib/foundation/meta.js';
import { dateLabel } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Pill from '../../components/ui/Pill.jsx';
import FilterBar from '../../components/zephyr/FilterBar.jsx';
import EntryDrawer from '../../components/foundation/EntryDrawer.jsx';
import { Kpi, Money } from '../../components/foundation/ui.jsx';

const BLANK = { q: '', campaign_id: '', kind: '', status: '', expense_class: '', category_id: '', from: '', to: '', amount_min: '', amount_max: '' };
const ALL_STATUS = Object.values(ALL_ENTRY_STATUSES).filter((s, i, a) => a.findIndex((x) => x.value === s.value) === i).map((s) => ({ value: s.value, label: s.label }));

export default function FoundationFundsPage() {
  const { me, loading } = useFoundation();
  const { pushError, pushSuccess } = useAlerts();
  const [params, setParams] = useSearchParams();
  const pickers = useFxPickers({ people: false });
  const [f, setF] = useState(BLANK);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [drawer, setDrawer] = useState({ open: params.get('new') === '1', entry: null });
  const set = (k, v) => { setF((c) => ({ ...c, [k]: v })); setPage(1); };

  const load = useCallback(() => fxApi.entries({ ...f, page, limit: 25 }).then(setData, (e) => pushError(foundationError(e, 'Could not load the entries'), 'Load failed')), [f, page, pushError]);
  useEffect(() => { if (me) load(); }, [me, load]);
  useEffect(() => { if (params.get('new') === '1') setDrawer({ open: true, entry: null }); }, [params]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !fxCan(me, 'entries')) return <Navigate to="/foundation" replace />;
  const canApprove = fxCan(me, 'entriesApprove');
  const close = () => { setDrawer({ open: false, entry: null }); if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }); } };

  async function act(entry, to) {
    let reason;
    if (NEEDS_REASON.includes(to)) { reason = window.prompt(`Reason to ${(ACTION_LABEL[to] || to).toLowerCase()}:`); if (!reason || !reason.trim()) return; }
    try {
      await fxApi.setEntryStatus(entry.id, { to, ...(reason ? { reason: reason.trim() } : {}) });
      pushSuccess(`${ACTION_LABEL[to] || to}: done`);
      load();
    } catch (e) {
      const code = e?.response?.data?.code;
      if (code === 'over_budget' || code === 'override_reason_required') {
        const why = window.prompt(`${foundationError(e, '')}\n\nReason for going over budget (admin only):`);
        if (why && why.trim()) { try { await fxApi.setEntryStatus(entry.id, { to, override_reason: why.trim() }); load(); return; } catch (e2) { pushError(foundationError(e2, 'Not changed'), 'Not changed'); return; } }
      }
      pushError(foundationError(e, 'Could not change the entry'), 'Not changed');
    }
  }
  async function remove(entry) {
    if (!window.confirm('Delete this entry?')) return;
    try { await fxApi.deleteEntry(entry.id); load(); } catch (e) { pushError(foundationError(e, 'Could not delete'), 'Not deleted'); }
  }

  const s = data?.summary;
  const columns = [
    { key: 'date', header: 'Date', render: (r) => dateLabel(r.entry_date) },
    { key: 'campaign', header: 'Campaign', render: (r) => (r.campaign ? <span><span className="font-medium text-tertiary-900">{r.campaign.name}</span><span className="block text-xs text-tertiary-500">{r.campaign.code}</span></span> : <span className="text-tertiary-400">General</span>) },
    { key: 'kind', header: 'Type', render: (r) => <span>{KIND_LABEL[r.kind]}{r.expense_class && <span className="block text-xs text-tertiary-500">{r.expense_class === 'programme' ? 'Programme' : 'Operational'}</span>}</span> },
    { key: 'cat', header: 'Category / party', render: (r) => <span>{r.category?.name || '-'}{r.party_name && <span className="block text-xs text-tertiary-500">{r.party_name}</span>}</span> },
    { key: 'amount', header: 'Amount', render: (r) => <span className={r.kind === 'funding' ? 'font-medium text-green-700' : ''}><Money v={r.amount} /></span> },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={ALL_ENTRY_STATUSES[r.status]?.tone}>{ALL_ENTRY_STATUSES[r.status]?.label || r.status}</Pill> },
    { key: 'ref', header: 'Reference', render: (r) => r.reference || '-' },
    { key: 'a', header: '', render: (r) => (
      <span className="flex flex-wrap justify-end gap-2" onClick={(e) => e.stopPropagation()}>
        {(ENTRY_NEXT[r.kind][r.status] || []).filter((to) => !(r.kind === 'expense' && !canApprove && ['approved', 'paid', 'rejected', 'reversed'].includes(to))).map((to) => (
          <button key={to} type="button" className="text-xs font-medium text-primary-700 hover:underline" onClick={() => act(r, to)}>{ACTION_LABEL[to] || to}</button>
        ))}
        {!['rejected', 'cancelled', 'reversed'].includes(r.status) && <button type="button" title="Edit" className="rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => setDrawer({ open: true, entry: r })}><Pencil className="h-4 w-4" /></button>}
        {(['pending', 'pledged', 'rejected', 'cancelled', 'recorded'].includes(r.status) || me.role === 'admin') && <button type="button" title="Delete" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></button>}
      </span>
    ) },
  ];

  return (
    <div className="mt-4 space-y-4">
      <FilterBar
        q={f.q}
        onQ={(v) => set('q', v)}
        searchPlaceholder="Search payee, donor, reference, notes..."
        fields={[
          { key: 'campaign_id', label: 'Campaign', type: 'select', any: 'All', options: pickers.campaigns },
          { key: 'kind', label: 'Type', type: 'select', any: 'All', options: ENTRY_KINDS.map((k) => ({ value: k.value, label: k.label })) },
          { key: 'status', label: 'Status', type: 'select', any: 'All', options: ALL_STATUS },
          { key: 'expense_class', label: 'Counts as', type: 'select', any: 'All', options: [{ value: 'programme', label: 'Programme' }, { value: 'operational', label: 'Operational' }] },
          { key: 'category_id', label: 'Category', type: 'select', any: 'All', options: pickers.categories.filter((c) => c.scope !== 'initiative').map((c) => ({ value: c.id, label: `${c.name} (${c.scope === 'funding' ? 'funding' : 'spending'})` })) },
          { key: 'from', label: 'From', type: 'date' },
          { key: 'to', label: 'To', type: 'date' },
          { key: 'amount_min', label: 'Amount from (₹)', type: 'number', min: 0 },
          { key: 'amount_max', label: 'Amount up to (₹)', type: 'number', min: 0 },
        ]}
        values={f}
        defaults={BLANK}
        onChange={set}
        onReset={() => { setF(BLANK); setPage(1); }}
      >
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ open: true, entry: null })}><Plus className="h-4 w-4" />Record money</button>
      </FilterBar>

      {s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Paid expenditure" value={<Money v={s.paid_expenditure} />} hint="Actual spending" />
          <Kpi label="Of which programme" value={<Money v={s.paid_investment} />} hint="Investment in campaigns" />
          <Kpi label="Commitments" value={<Money v={s.commitments} />} hint="Approved, not paid" />
          <Kpi label="Pending approval" value={<Money v={s.pending} />} hint="Not counted yet" />
          <Kpi label="Funds received" value={<Money v={s.funds_received} />} />
          <Kpi label="Pledged" value={<Money v={s.funds_pledged} />} hint="Not received yet" />
        </div>
      )}
      <DataTable columns={columns} rows={data?.data || []} loading={!data} emptyLabel="Nothing recorded yet. Record funds received, investments and expenses here." onRowClick={(r) => !['rejected', 'cancelled', 'reversed'].includes(r.status) && setDrawer({ open: true, entry: r })} maxHeight="60vh" />
      {data && (
        <div className="flex items-center justify-between text-xs text-tertiary-500">
          <span>{data.pagination.total} entr{data.pagination.total === 1 ? 'y' : 'ies'} · totals above follow the filters</span>
          <span className="flex items-center gap-2">
            <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span>Page {data.pagination.page} of {data.pagination.pages}</span>
            <button type="button" className="btn-secondary" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </span>
        </div>
      )}
      <EntryDrawer open={drawer.open} entry={drawer.entry} campaigns={pickers.campaigns} categories={pickers.categories} me={me} onClose={close} onSaved={() => { close(); load(); }} />
    </div>
  );
}
