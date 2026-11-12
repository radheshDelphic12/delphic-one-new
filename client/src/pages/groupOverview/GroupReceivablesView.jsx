import { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Skeleton from '../../components/ui/Skeleton.jsx';
import Pill from '../../components/ui/Pill.jsx';
import { FIELD_INPUT } from '../../components/ui/formLayout.jsx';

// Group Dashboard > Book Keeping > Receivables. Switched on per holding group (Setup), so only the group that wants it sees it. Every client invoice
// from a billing month on (the month the invoice is FOR, not the day it was generated), what is paid and pending, the GST and TDS still to collect
// and what the group is left with.

const SYMBOL = { INR: '₹', USD: '$', AED: 'AED ', EUR: '€', GBP: '£', SAR: 'SAR ' };
const money = (n, cur = 'INR') => `${Number(n) < 0 ? '-' : ''}${SYMBOL[cur] ?? `${cur} `}${Math.abs(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-tertiary-500';
const thr = `${th} text-right`;
const td = 'px-3 py-2 align-top';
const tdr = `${td} text-right tabular-nums`;
const STATUS = { sent: ['amber', 'Unpaid'], part_paid: ['blue', 'Part paid'], paid: ['green', 'Paid'] };

function Tile({ label, value, hint, tone = '' }) {
  return (
    <div className={`rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card ${tone}`}>
      <p className="text-xs text-tertiary-500">{label}</p>
      <p className="font-heading text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-tertiary-500">{hint}</p>}
    </div>
  );
}

export function GroupReceivablesView() {
  const { pushError, pushSuccess } = useAlerts();
  const [from, setFrom] = useState('');
  const [pendingOnly, setPendingOnly] = useState(true);
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);

  const load = useCallback(() => {
    apiClient.get('/group-tax/receivables', { params: from ? { from } : {} }).then(({ data: res }) => setData(res.data)).catch((err) => { setData({ enabled: false, groups: [] }); pushError(apiErrorMessage(err, 'Could not load the receivables'), 'Load failed'); });
  }, [from]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.rows || []).filter((r) => (!pendingOnly || r.pending > 0)
      && (!q || [r.number, r.client, r.project, r.company].some((x) => String(x || '').toLowerCase().includes(q))));
  }, [data, pendingOnly, query]);

  const [syncing, setSyncing] = useState(false);
  const syncWallets = async () => {
    setSyncing(true);
    try {
      const { data: res } = await apiClient.post('/group-tax/receivables/sync-wallet', from ? { from } : {});
      setData(res.data);
      pushSuccess(`${res.data.synced} Receivable wallet${res.data.synced === 1 ? '' : 's'} updated`);
    } catch (err) { pushError(apiErrorMessage(err, 'Could not update the Receivable wallet'), 'Update failed'); } finally { setSyncing(false); }
  };

  if (!data) return <Skeleton className="h-48" />;
  if (!data.enabled) return <p className="rounded-xl bg-warning-50 px-3 py-2 text-sm text-warning-800">Receivables are switched off. Switch them on under Setup.</p>;
  const f = data.funds;
  return (
    <div className="space-y-4" data-testid="receivables">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card">
        <div>
          <label className="mb-1 block text-xs font-medium text-tertiary-600">From billing month</label>
          <input type="month" className={FIELD_INPUT} aria-label="From billing month" value={from || data.since_month} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="w-64">
          <label className="mb-1 block text-xs font-medium text-tertiary-600">Search</label>
          <input className={FIELD_INPUT} aria-label="Search invoices" placeholder="Invoice, client, project, company" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-tertiary-700"><input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} /> Pending only</label>
        <p className="pb-2 text-xs text-tertiary-500">Months are the billing month of each invoice, not the day it was generated.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="receivable-funds">
        <Tile label="To collect from clients" value={money(f.to_collect)} hint={`of which GST ${money(f.gst_in_pending)}`} />
        <Tile label="TDS to receive (claim)" value={money(f.tds_to_receive)} hint="Deducted by clients, not yet received back" />
        <Tile label="GST still to deposit" value={money(f.gst_to_deposit)} hint="Collected on invoices minus deposited" />
        <Tile label="TDS still to deposit" value={money(f.tds_to_deposit)} hint="Employees + vendors" />
        <Tile label="Money in hand" value={money(f.in_hand)} hint="All bank accounts and cash (INR)" />
        <Tile label="Left now" value={money(f.left_now)} hint="In hand - GST to deposit - TDS to deposit" tone={f.left_now < 0 ? 'border-danger-200' : ''} />
        <Tile label="Left after collecting" value={money(f.left_after_collection)} hint="Left now + everything to collect" />
      </div>

      {(data.wallets || []).length > 0 && (
        <div className="rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card" data-testid="receivable-wallets">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-heading text-sm font-semibold text-tertiary-900">Receivable wallet</h3>
              <p className="text-xs text-tertiary-500">The wallet named Receivable should equal what clients still owe on invoices billed from {data.since_month}. Updating adds one audited entry for the difference.</p>
            </div>
            {data.wallets.some((w) => !w.in_sync) && <button type="button" className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" disabled={syncing} onClick={syncWallets}>{syncing ? 'Updating…' : 'Update wallet to match invoices'}</button>}
          </div>
          <table className="mt-2 min-w-full text-sm">
            <thead><tr><th className={th}>Owner</th><th className={thr}>Wallet balance</th><th className={thr}>Pending on invoices</th><th className={thr}>Difference</th><th className={th}>Status</th></tr></thead>
            <tbody className="divide-y divide-tertiary-100">
              {data.wallets.map((w) => (
                <tr key={w.id} data-testid="receivable-wallet-row">
                  <td className={td}>{w.owner}</td><td className={tdr}>{money(w.balance)}</td><td className={tdr}>{money(w.expected)}</td><td className={tdr}>{money(w.difference)}</td>
                  <td className={td}><Pill tone={w.in_sync ? 'green' : 'amber'}>{w.in_sync ? 'Matches' : 'Differs'}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-sm">
          <thead className="bg-canvas-muted"><tr>
            <th className={th}>Billing month</th><th className={th}>Company</th><th className={th}>Invoice</th><th className={th}>Client / project</th><th className={th}>Invoice date</th>
            <th className={thr}>Base</th><th className={thr}>GST</th><th className={thr}>TDS</th><th className={thr}>Total</th><th className={thr}>Paid</th><th className={thr}>Pending</th><th className={th}>Status</th>
          </tr></thead>
          <tbody className="divide-y divide-tertiary-100">
            {rows.length === 0 && <tr><td colSpan={12} className="px-3 py-6 text-center text-sm text-tertiary-500">No invoice matches.</td></tr>}
            {rows.map((r) => {
              const st = r.paid >= r.total && r.total > 0 ? 'paid' : r.paid > 0 ? 'part_paid' : 'sent';
              const [tone, label] = STATUS[r.status === 'paid' ? 'paid' : st] || STATUS.sent;
              return (
                <tr key={r.key} data-testid="receivable-row">
                  <td className={`${td} whitespace-nowrap font-medium`}>{r.billing_label}</td>
                  <td className={td}>{r.company}</td>
                  <td className={td}>{r.number || '—'}</td>
                  <td className={td}>{r.client || '—'}{r.project && r.project !== r.client && <span className="block text-[11px] text-tertiary-500">{r.project}</span>}</td>
                  <td className={`${td} whitespace-nowrap`}>{r.invoice_date}</td>
                  <td className={tdr}>{money(r.base, r.currency)}</td>
                  <td className={tdr}>{r.gst ? money(r.gst, r.currency) : '—'}</td>
                  <td className={tdr}>{r.tds ? money(-r.tds, r.currency) : '—'}</td>
                  <td className={`${tdr} font-medium`}>{money(r.total, r.currency)}</td>
                  <td className={tdr}>{money(r.paid, r.currency)}</td>
                  <td className={`${tdr} font-semibold`}>{money(r.pending, r.currency)}</td>
                  <td className={td}><Pill tone={tone}>{label}</Pill></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-canvas-muted">
            {data.totals.map((t) => (
              <tr key={t.currency}>
                <td className={`${td} font-semibold`} colSpan={5}>Total {t.currency} ({t.invoices} invoices)</td>
                <td className={tdr}>{money(t.base, t.currency)}</td><td className={tdr}>{money(t.gst, t.currency)}</td><td className={tdr}>{money(-t.tds, t.currency)}</td>
                <td className={`${tdr} font-semibold`}>{money(t.total, t.currency)}</td><td className={tdr}>{money(t.paid, t.currency)}</td><td className={`${tdr} font-semibold`}>{money(t.pending, t.currency)}</td><td />
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** Setup: switch Receivables on or off for each holding group, and the first billing month counted. */
export function ReceivablesSetupCard({ onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [groups, setGroups] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    apiClient.get('/group-tax/receivable-setting').then(({ data }) => setGroups(data.data.groups)).catch(() => setGroups([]));
  }, []);

  async function save(group, patch) {
    setBusy(group.id);
    try {
      const { data } = await apiClient.put('/group-tax/receivable-setting', { org_group_id: group.id, enabled: group.enabled, since_month: group.since_month, ...patch });
      setGroups(data.data.groups);
      pushSuccess('Saved.', 'Saved');
      onChanged?.();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save'), 'Could not save');
    } finally {
      setBusy('');
    }
  }

  if (!groups || groups.length === 0) return null;
  return (
    <div className="space-y-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="receivables-setup">
      <div>
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">Receivables tracking</h3>
        <p className="text-xs text-tertiary-500">Adds a Receivables tab to Book Keeping for the group you switch on: every client invoice from a billing month on, what is pending, the GST and TDS to collect and what the group is left with. Off for every group until you switch it on.</p>
      </div>
      {groups.map((g) => (
        <div key={g.id} className="flex flex-wrap items-end gap-3 rounded-xl border border-tertiary-100 p-3">
          <span className="min-w-[10rem] flex-1 text-sm font-medium text-tertiary-800">{g.name}</span>
          <div>
            <label className="mb-1 block text-xs font-medium text-tertiary-600">Count from billing month</label>
            <input type="month" className={FIELD_INPUT} aria-label={`Count from billing month for ${g.name}`} value={g.since_month} onChange={(e) => setGroups((p) => p.map((x) => (x.id === g.id ? { ...x, since_month: e.target.value } : x)))} onBlur={() => g.enabled && save(g, {})} />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-tertiary-700">
            <input type="checkbox" checked={g.enabled} disabled={busy === g.id} onChange={(e) => save(g, { enabled: e.target.checked })} /> Switched on
          </label>
        </div>
      ))}
    </div>
  );
}
