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

function Line({ label, value, hint, strong = false, tone = '' }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 text-sm ${strong ? 'font-semibold' : ''}`}>
      <span className="text-tertiary-700">{label}{hint && <span className="block text-[11px] font-normal text-tertiary-500">{hint}</span>}</span>
      <span className={`tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

/** The whole group's position in INR: client money, TDS in its three states, GST, and what is left overall. An option: it can be hidden. */
function GroupBalance({ funds }) {
  const b = funds.balance;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('delphic_recv_balance') !== '0'; } catch { return true; } });
  const toggle = () => setOpen((v) => { const n = !v; try { localStorage.setItem('delphic_recv_balance', n ? '1' : '0'); } catch { /* storage blocked */ } return n; });
  if (!b) return null;
  const foreign = (b.by_currency || []).filter((c) => c.pending > 0);
  return (
    <div className="rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card" data-testid="group-balance">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-heading text-sm font-semibold text-tertiary-900">Group balance (INR)</h3>
          <p className="text-xs text-tertiary-500">Client money, TDS and GST together: what has come in, what is still to come, and what the group is left with. Foreign currencies are converted at the rates below.</p>
        </div>
        <button type="button" className="rounded-lg border border-tertiary-200 px-3 py-1.5 text-sm text-tertiary-700" aria-expanded={open} onClick={toggle}>{open ? 'Hide balance' : 'Show balance'}</button>
      </div>
      {open && (
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-tertiary-100 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">Client money</p>
            <Line label="Billed" hint="Invoice value before TDS" value={money(b.billed)} />
            <Line label="Received from clients" value={money(b.received)} />
            <Line label="Still to collect" hint="After the TDS clients will deduct" value={money(b.to_collect)} strong />
            {foreign.map((c) => <Line key={c.currency} label={`of which ${c.currency}`} hint={c.rate ? `at 1 ${c.currency} = ₹${c.rate}` : 'no rate set'} value={`${money(c.pending, c.currency)} = ${money(c.pending_inr)}`} />)}
          </div>
          <div className="rounded-xl border border-tertiary-100 p-3" data-testid="balance-tds">
            <p className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">TDS on our invoices</p>
            <Line label="Total TDS clients will deduct" value={money(b.tds.expected)} />
            <Line label="Deducted so far" hint="On the invoices clients have paid" value={money(b.tds.deducted)} />
            <Line label="Refund received" value={money(b.tds.received_back)} />
            <Line label="Still to claim back" hint="Deducted, refund awaited" value={money(b.tds.to_claim)} strong />
            <Line label="Not deducted yet" hint="Unpaid invoices: deducted when the client pays" value={money(b.tds.yet_to_deduct)} strong />
          </div>
          <div className="rounded-xl border border-tertiary-100 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">GST and what is left</p>
            <Line label="GST collected" value={money(b.gst.collected)} />
            <Line label="GST deposited" value={money(b.gst.deposited)} />
            <Line label="GST still to deposit" value={money(b.gst.to_deposit)} strong />
            <Line label="TDS still to deposit" hint="Employees + vendors" value={money(b.tds_to_deposit)} />
            <Line label="Money in hand" value={money(b.in_hand)} />
            <div className="mt-1 border-t border-tertiary-100 pt-1">
              <Line label="Overall balance" hint="In hand + to collect + TDS to claim - GST and TDS to deposit" value={money(b.net_position)} strong tone={b.net_position < 0 ? 'text-danger-600' : ''} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** What is still to collect in each currency, with the conversion rate used for INR (typed here, else the saved rate) and the INR total. */
function CurrencyCollect({ funds, rates, onRates }) {
  const list = funds.to_collect_by_currency || [];
  const foreign = list.filter((c) => c.currency !== 'INR');
  const [draft, setDraft] = useState({});
  useEffect(() => { setDraft(Object.fromEntries(String(rates || '').split(',').map((p) => p.split(':').map((x) => x.trim())).filter((p) => p[0] && p[1]))); }, [rates]);
  if (list.length === 0) return null;
  const apply = () => onRates(Object.entries(draft).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k}:${Number(v)}`).join(','));
  return (
    <div className="rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card" data-testid="receivable-by-currency">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-heading text-sm font-semibold text-tertiary-900">To collect, by currency</h3>
          <p className="text-xs text-tertiary-500">What clients still owe in each currency, and its value in INR. Leave a rate empty to use the rate finance has saved; type one to use your own.</p>
        </div>
        {foreign.length > 0 && (
          <div className="flex gap-2">
            <button type="button" className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white" onClick={apply}>Apply rates</button>
            {rates && <button type="button" className="rounded-lg border border-tertiary-200 px-3 py-1.5 text-sm text-tertiary-700" onClick={() => onRates('')}>Use saved rates</button>}
          </div>
        )}
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {list.map((c) => (
          <div key={c.currency} className="rounded-xl border border-tertiary-100 p-3" data-testid="currency-card">
            <p className="text-xs font-medium text-tertiary-500">{c.currency}</p>
            <p className="font-heading text-lg font-semibold tabular-nums">{money(c.pending, c.currency)}</p>
            {c.currency !== 'INR' && (
              <div className="mt-1 space-y-1 text-[11px] text-tertiary-600">
                <label className="flex items-center gap-1.5">1 {c.currency} = ₹
                  <input type="number" min="0" step="0.0001" aria-label={`Rate for ${c.currency}`} className="w-24 rounded-md border border-tertiary-200 px-1.5 py-0.5 text-xs tabular-nums" placeholder={c.rate_source === 'none' ? 'set rate' : String(c.rate)} value={draft[c.currency] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [c.currency]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} />
                </label>
                <p>{c.rate_source === 'none' ? <span className="text-warning-700">No rate set - not in the INR total</span> : <>= {money(c.pending_inr)} <span className="text-tertiary-400">({c.rate_source === 'typed' ? 'your rate' : 'saved rate'})</span></>}</p>
                {c.unconverted > 0 && c.rate_source !== 'none' && <p className="text-warning-700">{money(c.unconverted, c.currency)} has no rate</p>}
              </div>
            )}
          </div>
        ))}
        <div className="rounded-xl border border-primary-200 bg-primary-50/40 p-3">
          <p className="text-xs font-medium text-tertiary-500">Total in INR</p>
          <p className="font-heading text-lg font-semibold tabular-nums">{money(funds.to_collect_all_inr)}</p>
          <p className="mt-1 text-[11px] text-tertiary-600">All currencies, foreign ones converted</p>
        </div>
      </div>
    </div>
  );
}

export function GroupReceivablesView() {
  const { pushError, pushSuccess } = useAlerts();
  const [from, setFrom] = useState('');
  const [pendingOnly, setPendingOnly] = useState(true);
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  // Conversion rates typed for this screen ("USD:83.5,AED:22.7"), remembered in this browser. Empty = the rate finance has saved for each company.
  const [rates, setRates] = useState(() => { try { return localStorage.getItem('delphic_recv_rates') || ''; } catch { return ''; } });

  const load = useCallback(() => {
    apiClient.get('/group-tax/receivables', { params: { ...(from ? { from } : {}), ...(rates ? { rates } : {}) } }).then(({ data: res }) => setData(res.data)).catch((err) => { setData({ enabled: false, groups: [] }); pushError(apiErrorMessage(err, 'Could not load the receivables'), 'Load failed'); });
  }, [from, rates]); // eslint-disable-line react-hooks/exhaustive-deps
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
        <Tile label="To collect from clients (in INR)" value={money(f.to_collect_all_inr ?? f.to_collect)} hint={(f.to_collect_by_currency || []).some((c) => c.currency !== 'INR') ? 'Foreign currencies converted at the rates below' : `of which GST ${money(f.gst_in_pending)}`} />
        <Tile label="TDS to claim back (already deducted)" value={money(f.tds_to_receive)} hint="Deducted by clients on paid invoices, refund not yet received" />
        <Tile label="TDS not deducted yet" value={money(f.balance?.tds?.yet_to_deduct ?? 0)} hint="On unpaid invoices - clients deduct it when they pay" />
        <Tile label="GST still to deposit" value={money(f.gst_to_deposit)} hint="Collected on invoices minus deposited" />
        <Tile label="TDS still to deposit" value={money(f.tds_to_deposit)} hint="Employees + vendors" />
        <Tile label="Money in hand" value={money(f.in_hand)} hint="All bank accounts and cash (INR)" />
        <Tile label="Left now" value={money(f.left_now)} hint="In hand - GST to deposit - TDS to deposit" tone={f.left_now < 0 ? 'border-danger-200' : ''} />
        <Tile label="Left after collecting" value={money(f.left_after_collection)} hint="Left now + everything to collect" />
      </div>

      <GroupBalance funds={f} />

      <CurrencyCollect funds={f} rates={rates} onRates={(v) => { setRates(v); try { localStorage.setItem('delphic_recv_rates', v); } catch { /* storage blocked */ } }} />

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
