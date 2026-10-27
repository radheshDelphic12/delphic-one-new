import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Banknote, ChevronDown, FileText, ChevronRight, Download, Landmark, Pencil, Plus, Receipt, Scale, Trash2, Wallet as WalletIcon } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { downloadFile } from '../../lib/downloadFile.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { accountKey, formatMoney, selectionTotals, walletKey } from '../../lib/cashSelection.js';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import GroupInvoicesView from './GroupInvoicesView.jsx';
import { AccountEditDrawer, EntityEditDrawer } from './EntityAccountEditors.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';

const inputCls = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const today = () => new Date().toLocaleDateString('en-CA');
const TYPE_LABEL = { current: 'Current', savings: 'Savings', cash: 'Cash in hand' };

/** "GI Retail – Current": the name plus the account type, so accounts that share a name can be told apart (last 4 digits only if still identical). */
function accountLabels(accounts) {
  const base = (a) => `${a.name} – ${TYPE_LABEL[a.type] || a.type}`;
  const seen = {};
  for (const a of accounts) seen[base(a)] = (seen[base(a)] || 0) + 1;
  return new Map(accounts.map((a) => [a.id, seen[base(a)] > 1 && a.account_last4 ? `${base(a)} (…${a.account_last4})` : base(a)]));
}
const PURPOSE_LABEL = { general: 'General', salary: 'Salary', travel: 'Travel', unallocated: 'Unallocated' };
const MODE_LABEL = { cash: 'Cash', upi: 'UPI', cheque: 'Cheque', neft: 'NEFT', rtgs: 'RTGS', imps: 'IMPS', swift: 'SWIFT', other: 'Other' };
const api = (path, params) => apiClient.get(`/group-cash${path}`, { params }).then((r) => r.data.data);

const Money = ({ value, currency, className = '' }) => (
  <span className={`tabular-nums ${String(value).startsWith('-') ? 'text-danger-600' : ''} ${className}`}>{formatMoney(value, currency)}</span>
);
const Totals = ({ totals }) => (
  <span className="inline-flex flex-wrap gap-x-3 tabular-nums"><Money value={totals.INR} currency="INR" /><Money value={totals.USD} currency="USD" /></span>
);

/** Shows what the server warned about (negative balance, opening balances that do not add up) after a save. */
function useSaved() {
  const { pushSuccess, pushWarning, pushError } = useAlerts();
  return {
    done: (message, res) => {
      pushSuccess(message);
      (res?.data?.data?.warnings || []).forEach((w) => pushWarning(w));
    },
    fail: (err, fallback) => pushError(apiErrorMessage(err, fallback), 'Not saved'),
  };
}

// ---------------------------------------------------------------------------------------------------------------- drawers

function TransactionDrawer({ open, options, walletId, initial, onClose, onSaved }) {
  const saved = useSaved();
  const [v, setV] = useState({ wallet_id: '', date: today(), direction: 'in', amount: '', mode: 'upi', category: '', party: '', notes: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setV(initial ? { wallet_id: initial.wallet_id, date: initial.date, direction: initial.direction, amount: initial.amount, mode: initial.mode, category: initial.category || '', party: initial.party || '', notes: initial.notes || '' }
      : { wallet_id: walletId || '', date: today(), direction: 'in', amount: '', mode: 'upi', category: '', party: '', notes: '' });
  }, [open, walletId, initial]);
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      let res;
      if (initial) {
        res = await apiClient.patch(`/group-cash/transactions/${initial.id}`, { date: v.date, direction: v.direction, amount: v.amount, mode: v.mode, category: v.category, party: v.party, notes: v.notes });
      } else {
        const form = new FormData();
        ['date', 'direction', 'amount', 'mode', 'category', 'party', 'notes'].forEach((k) => v[k] !== '' && form.append(k, v[k]));
        if (file) form.append('file', file);
        res = await apiClient.post(`/group-cash/wallets/${v.wallet_id}/transactions`, form);
      }
      saved.done(initial ? 'Entry updated' : 'Entry added', res);
      onSaved();
      onClose();
    } catch (err) { saved.fail(err, 'Could not save the entry'); } finally { setBusy(false); }
  }
  const wallet = (options?.wallets || []).find((w) => w.id === v.wallet_id);
  return (
    <Drawer open={open} onClose={onClose} size="md" tone={initial ? 'edit' : 'create'} title={initial ? 'Edit entry' : 'Add money in / out'}>
      <form className="space-y-3" onSubmit={submit}>
        <label className={labelCls}>Wallet
          <select required disabled={Boolean(initial)} className={inputCls} value={v.wallet_id} onChange={set('wallet_id')}>
            <option value="">Choose a wallet…</option>
            {(options?.wallets || []).map((w) => <option key={w.id} value={w.id}>{w.owner_name} · {w.name} · {w.bank_account_name} ({w.currency})</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={labelCls}>Money<select className={inputCls} value={v.direction} onChange={set('direction')}><option value="in">In (received)</option><option value="out">Out (paid)</option></select></label>
          <label className={labelCls}>Date<input required type="date" className={inputCls} value={v.date} onChange={set('date')} /></label>
          <label className={labelCls}>Amount {wallet ? `(${wallet.currency})` : ''}<input required inputMode="decimal" className={inputCls} value={v.amount} onChange={set('amount')} placeholder="0.00" /></label>
          <label className={labelCls}>Mode<select className={inputCls} value={v.mode} onChange={set('mode')}>{Object.entries(MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        </div>
        <label className={labelCls}>From / to (party)<input className={inputCls} value={v.party} maxLength={200} onChange={set('party')} /></label>
        <label className={labelCls}>Category<input className={inputCls} value={v.category} maxLength={120} onChange={set('category')} placeholder="e.g. Client payment, Rent" /></label>
        <label className={labelCls}>Notes<textarea rows={2} className={inputCls} value={v.notes} maxLength={2000} onChange={set('notes')} /></label>
        {!initial && <label className={labelCls}>Attachment (receipt, bank slip)<input type="file" className={inputCls} accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv,.doc,.docx" onChange={(e) => setFile(e.target.files[0] || null)} /></label>}
        <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={busy || !v.wallet_id || !v.amount}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Drawer>
  );
}

function TransferDrawer({ open, options, onClose, onSaved }) {
  const saved = useSaved();
  const [v, setV] = useState({ from_wallet_id: '', to_wallet_id: '', date: today(), amount: '', notes: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setV({ from_wallet_id: '', to_wallet_id: '', date: today(), amount: '', notes: '' }); }, [open]);
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  const wallets = options?.wallets || [];
  const from = wallets.find((w) => w.id === v.from_wallet_id);
  const to = wallets.find((w) => w.id === v.to_wallet_id);
  const hint = from && to
    ? from.currency !== to.currency ? 'Wallets of different currencies cannot be transferred between yet.'
      : `${from.bank_account_id === to.bank_account_id ? 'Reallocation: the bank balance does not change, only who owns the money.' : 'Bank transfer: real money moves between two bank accounts.'}${from.owner_name !== to.owner_name ? ' Different owners: this is flagged as intercompany.' : ''}`
    : '';
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiClient.post('/group-cash/transfers', v);
      saved.done('Transfer saved', res);
      onSaved();
      onClose();
    } catch (err) { saved.fail(err, 'Could not save the transfer'); } finally { setBusy(false); }
  }
  const pick = (key, label) => (
    <label className={labelCls}>{label}
      <select required className={inputCls} value={v[key]} onChange={set(key)}>
        <option value="">Choose a wallet…</option>
        {wallets.map((w) => <option key={w.id} value={w.id}>{w.owner_name} · {w.name} · {w.bank_account_name} ({w.currency})</option>)}
      </select>
    </label>
  );
  return (
    <Drawer open={open} onClose={onClose} size="md" tone="create" title="Transfer between wallets">
      <form className="space-y-3" onSubmit={submit}>
        {pick('from_wallet_id', 'From')}
        {pick('to_wallet_id', 'To')}
        {hint && <p className="rounded-xl bg-tertiary-50 p-2 text-xs text-tertiary-600">{hint}</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className={labelCls}>Date<input required type="date" className={inputCls} value={v.date} onChange={set('date')} /></label>
          <label className={labelCls}>Amount<input required inputMode="decimal" className={inputCls} value={v.amount} onChange={set('amount')} placeholder="0.00" /></label>
        </div>
        <label className={labelCls}>Notes<textarea rows={2} className={inputCls} value={v.notes} maxLength={2000} onChange={set('notes')} /></label>
        <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={busy || !v.from_wallet_id || !v.to_wallet_id || !v.amount}>{busy ? 'Saving…' : 'Transfer'}</button></div>
      </form>
    </Drawer>
  );
}

/** Every entry of one wallet: date range, running balance, split by mode, CSV / PDF, edit and delete. */
function WalletDrawer({ walletId, accountId, options, onClose, onChanged }) {
  const saved = useSaved();
  const [range, setRange] = useState({ from: '', to: '' });
  const [editing, setEditing] = useState(null);
  const params = { ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) };
  // a bank account's statement is the entries of every wallet mapped to it, date-wise; a wallet shows its own
  const target = accountId ? `accounts/${accountId}` : `wallets/${walletId}`;
  const data = useLiveData(() => api(`/${target}/entries`, params), { deps: [target, range.from, range.to], enabled: Boolean(walletId || accountId) });
  const d = data.data;
  const cur = d?.wallet.currency;
  async function remove(row) {
    if (!window.confirm(row.transfer_id ? 'This entry is one side of a transfer. Deleting it removes the whole transfer. Continue?' : 'Delete this entry?')) return;
    try { await apiClient.delete(`/group-cash/transactions/${row.id}`); saved.done('Entry deleted'); data.refresh(); onChanged(); } catch (err) { saved.fail(err, 'Could not delete'); }
  }
  const file = (format) => downloadFile(`/group-cash/${target}/entries`, { ...params, format }, `${d.wallet.name}.${format}`).catch((err) => saved.fail(err, 'Could not download'));
  return (
    <>
      <Drawer open={Boolean(walletId || accountId)} onClose={onClose} size="xl" tone="info" title={d ? `${d.wallet.name} · ${accountId ? 'bank statement' : d.wallet.owner_name}` : 'Wallet'}>
        {!d ? <Skeleton className="h-40" /> : (
          <div className="space-y-4">
            <p className="text-xs text-tertiary-500">{[d.wallet.bank_account_name, d.wallet.legal_entity_name, cur].filter(Boolean).join(' · ')}{accountId ? ` · ${d.wallet.owner_name}` : ''}</p>
            <div className="flex flex-wrap items-end gap-3">
              <label className={labelCls}>From<input type="date" className={inputCls} value={range.from} onChange={(e) => setRange((c) => ({ ...c, from: e.target.value }))} /></label>
              <label className={labelCls}>To<input type="date" className={inputCls} value={range.to} onChange={(e) => setRange((c) => ({ ...c, to: e.target.value }))} /></label>
              <button type="button" className="btn-secondary inline-flex items-center gap-1" onClick={() => file('csv')}><Download className="h-4 w-4" />CSV</button>
              <button type="button" className="btn-secondary inline-flex items-center gap-1" onClick={() => file('pdf')}><Download className="h-4 w-4" />PDF</button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {[['Opening', d.opening_balance], ['In', d.total_in], ['Out', d.total_out], ['Closing', d.closing_balance]].map(([l, x]) => (
                <div key={l} className="rounded-xl border border-tertiary-100 p-2"><p className="text-xs text-tertiary-500">{l}</p><Money value={x} currency={cur} className="font-semibold" /></div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(d.by_mode).map(([m, x]) => <span key={m} className="rounded-full bg-tertiary-50 px-2 py-1 text-tertiary-700">{MODE_LABEL[m] || m}: in {formatMoney(x.in, cur)} · out {formatMoney(x.out, cur)} ({x.count})</span>)}
            </div>
            <div className="overflow-x-auto rounded-xl border border-tertiary-100">
              <table className="min-w-full text-sm">
                <thead className="bg-tertiary-50 text-left text-xs text-tertiary-500"><tr><th className="p-2">Date</th><th className="p-2">Details</th><th className="p-2">Mode</th><th className="p-2 text-right">In</th><th className="p-2 text-right">Out</th><th className="p-2 text-right">Balance</th><th className="p-2" /></tr></thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.id} className="border-t border-tertiary-100">
                      <td className="p-2 whitespace-nowrap">{r.date}</td>
                      <td className="p-2">{r.party || r.category || '—'}{r.wallet && <span className="text-xs text-tertiary-500"> · {r.wallet}</span>}{r.transfer_id && <Pill tone="blue">Transfer</Pill>}{r.attachment_url && <span className="ml-1 text-xs text-tertiary-400">📎</span>}{r.notes && <p className="text-xs text-tertiary-500">{r.notes}</p>}</td>
                      <td className="p-2">{MODE_LABEL[r.mode] || r.mode}</td>
                      <td className="p-2 text-right">{r.direction === 'in' ? <Money value={r.amount} currency={cur} /> : ''}</td>
                      <td className="p-2 text-right">{r.direction === 'out' ? <Money value={r.amount} currency={cur} /> : ''}</td>
                      <td className="p-2 text-right"><Money value={r.balance_after} currency={cur} /></td>
                      <td className="p-2 whitespace-nowrap text-right">
                        {!accountId && <button type="button" title="Edit" className="rounded p-1 text-tertiary-400 hover:text-primary-600" onClick={() => setEditing({ ...r, wallet_id: walletId })}><Pencil className="h-4 w-4" /></button>}
                        {!accountId && <button type="button" title="Delete" className="rounded p-1 text-tertiary-400 hover:text-danger-600" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></button>}
                      </td>
                    </tr>
                  ))}
                  {!d.rows.length && <tr><td colSpan={7} className="p-4 text-center text-tertiary-500">No entries in this period.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Drawer>
      <TransactionDrawer open={Boolean(editing)} options={options} initial={editing} onClose={() => setEditing(null)} onSaved={() => { data.refresh(); onChanged(); }} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------- views

function Filters({ options, filters, setFilters }) {
  const set = (k) => (e) => setFilters((c) => ({ ...c, [k]: e.target.value }));
  const sel = (k, label, items) => (
    <label className={labelCls}>{label}
      <select className={inputCls} value={filters[k]} onChange={set(k)}><option value="">All</option>{items.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </label>
  );
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {sel('legal_entity_id', 'Legal entity', (options?.entities || []).map((e) => [e.id, e.name]))}
      {sel('workspace_id', 'Company', (options?.workspaces || []).map((w) => [w.id, w.name]))}
      {sel('type', 'Account type', Object.entries(TYPE_LABEL))}
      {sel('currency', 'Currency', (options?.currencies || ['INR', 'USD']).map((c) => [c, c]))}
    </div>
  );
}

function WalletRow({ w, currency, checked, onToggle, onOpen, indent = true }) {
  return (
    <tr className="border-t border-tertiary-100 hover:bg-tertiary-50/50">
      <td className={`p-2 ${indent ? 'pl-10' : 'pl-3'}`}><input type="checkbox" aria-label={`Select ${w.name}`} checked={checked} onChange={onToggle} /></td>
      <td className="p-2"><button type="button" className="text-left font-medium text-primary-700 hover:underline" onClick={onOpen}>{w.name}</button><p className="text-xs text-tertiary-500">{w.owner_name}</p></td>
      <td className="p-2"><Pill tone={w.purpose === 'unallocated' ? 'amber' : 'gray'}>{PURPOSE_LABEL[w.purpose]}</Pill></td>
      <td className="p-2 text-xs text-tertiary-500">{currency}</td>
      <td className="p-2 text-right"><Money value={w.balance} currency={currency} />{w.negative && <p className="text-xs text-danger-600">negative</p>}</td>
    </tr>
  );
}

function BankView({ position, selected, toggle, setOpenWallet, setOpenAccount }) {
  const [collapsed, setCollapsed] = useState({});
  const unmapped = position.unmapped_wallets || [];
  if (!position.entities.length && !unmapped.length) return <EmptyState icon={Landmark} title="No bank accounts yet" description="Add bank accounts and wallets under Setup, then map each wallet to its bank account." />;
  const low = position.below_minimum || [];
  return (
    <div className="space-y-4">
      {low.length > 0 && (
        <div className="rounded-2xl border border-danger-200 bg-danger-50 p-3 text-sm text-danger-800" role="alert" data-testid="below-minimum-banner">
          <p className="font-semibold">{low.length} bank account{low.length === 1 ? ' is' : 's are'} below the minimum balance</p>
          <ul className="mt-1 list-disc pl-5 text-xs">{low.map((a) => <li key={a.id}>{a.name}{a.legal_entity_name ? ` (${a.legal_entity_name})` : ''}: {formatMoney(a.balance, a.currency)} against a minimum of {formatMoney(a.minimum_balance, a.currency)}, short by {formatMoney(a.shortfall, a.currency)}</li>)}</ul>
        </div>
      )}
      {position.entities.map((e) => (
        <section key={e.id || 'no-entity'} className="rounded-2xl border border-tertiary-100 bg-white shadow-card">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-tertiary-100 p-3">
            <h3 className="font-heading text-base font-semibold text-tertiary-900">{e.name}</h3>
            <Totals totals={e.totals} />
          </header>
          <table className="min-w-full text-sm"><tbody>
            {e.accounts.map((a) => (
              <FragmentRows key={a.id}>
                <tr className={a.below_minimum ? 'bg-danger-50 ring-1 ring-inset ring-danger-200' : 'bg-tertiary-50/60'} data-testid={a.below_minimum ? 'below-minimum-row' : undefined}>
                  <td className="p-2 pl-3"><input type="checkbox" aria-label={`Select ${a.name}`} checked={selected.has(accountKey(a.id))} onChange={() => toggle(accountKey(a.id))} /></td>
                  <td className="p-2">
                    <button type="button" className="inline-flex items-center gap-1 font-semibold text-tertiary-900" onClick={() => setCollapsed((c) => ({ ...c, [a.id]: !c[a.id] }))}>
                      {collapsed[a.id] ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}{a.name}
                    </button>
                    <p className="text-xs text-tertiary-500">{a.bank_name ? `${a.bank_name} ····${a.account_last4 || ''}` : TYPE_LABEL[a.type]}</p>
                  </td>
                  <td className="p-2"><Pill tone="blue">{TYPE_LABEL[a.type]}</Pill><button type="button" className="ml-2 text-xs font-normal text-primary-700 hover:underline" onClick={() => setOpenAccount(a.id)}>Statement</button></td>
                  <td className="p-2 text-xs text-tertiary-500">{a.currency}</td>
                  <td className="p-2 text-right font-semibold"><span className={a.below_minimum ? 'text-danger-700' : ''}><Money value={a.shown_balance} currency={a.currency} /></span>{a.shown_balance !== a.balance && <p className="text-xs font-normal text-tertiary-500">of {formatMoney(a.balance, a.currency)}</p>}{a.below_minimum && <p className="text-xs font-semibold text-danger-700">Below minimum {formatMoney(a.minimum_balance, a.currency)} · short by {formatMoney(a.shortfall, a.currency)}</p>}</td>
                </tr>
                {a.warnings.length > 0 && <tr><td /><td colSpan={4} className="px-2 pb-1 text-xs text-warning-700">⚠ {a.warnings.join(' · ')}</td></tr>}
                {!collapsed[a.id] && a.wallets.map((w) => (
                  <WalletRow key={w.id} w={w} currency={a.currency} checked={selected.has(walletKey(w.id)) || selected.has(accountKey(a.id))} onToggle={() => toggle(walletKey(w.id))} onOpen={() => setOpenWallet(w.id)} />
                ))}
              </FragmentRows>
            ))}
          </tbody></table>
        </section>
      ))}
      {unmapped.length > 0 && (
        <section className="rounded-2xl border border-dashed border-tertiary-200 bg-white shadow-card">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-tertiary-100 p-3">
            <div><h3 className="font-heading text-base font-semibold text-tertiary-900">Wallets not mapped to a bank account</h3><p className="text-xs text-tertiary-500">Not part of any bank balance. Map them under Setup &gt; Wallets.</p></div>
            <Totals totals={position.unmapped_totals} />
          </header>
          <table className="min-w-full text-sm"><tbody>
            {unmapped.map((w) => <WalletRow key={w.id} w={w} currency={w.currency} checked={selected.has(walletKey(w.id))} onToggle={() => toggle(walletKey(w.id))} onOpen={() => setOpenWallet(w.id)} indent={false} />)}
          </tbody></table>
        </section>
      )}
    </div>
  );
}
const FragmentRows = ({ children }) => <>{children}</>;

function FundView({ position, selected, toggle, setOpenWallet }) {
  if (!position.funds.length) return <EmptyState icon={WalletIcon} title="No wallets yet" description="Wallets appear here once a bank account is set up." />;
  return (
    <div className="space-y-4">
      {position.funds.map((f) => (
        <section key={f.key} className="rounded-2xl border border-tertiary-100 bg-white shadow-card">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-tertiary-100 p-3">
            <h3 className="font-heading text-base font-semibold text-tertiary-900">{f.name}</h3>
            <Totals totals={f.totals} />
          </header>
          <table className="min-w-full text-sm"><tbody>
            {f.wallets.map((w) => (
              <tr key={w.id} className="border-t border-tertiary-100 first:border-t-0 hover:bg-tertiary-50/50">
                <td className="p-2 pl-3"><input type="checkbox" aria-label={`Select ${w.name}`} checked={selected.has(walletKey(w.id))} onChange={() => toggle(walletKey(w.id))} /></td>
                <td className="p-2"><button type="button" className="text-left font-medium text-primary-700 hover:underline" onClick={() => setOpenWallet(w.id)}>{w.name}</button><p className="text-xs text-tertiary-500">{[w.bank_account_name, w.legal_entity_name].filter(Boolean).join(' · ')}</p></td>
                <td className="p-2">{w.type && <Pill tone="blue">{TYPE_LABEL[w.type]}</Pill>}</td>
                <td className="p-2 text-xs text-tertiary-500">{w.currency}</td>
                <td className="p-2 text-right"><Money value={w.balance} currency={w.currency} /></td>
              </tr>
            ))}
          </tbody></table>
        </section>
      ))}
    </div>
  );
}

function ReceiptsView({ options }) {
  const [f, setF] = useState({ from: '', to: '', workspace_id: '', wallet_id: '' });
  const params = Object.fromEntries(Object.entries(f).filter(([, x]) => x));
  const data = useLiveData(() => api('/receipts', params), { deps: [f.from, f.to, f.workspace_id, f.wallet_id] });
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  const d = data.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <label className={labelCls}>From<input type="date" className={inputCls} value={f.from} onChange={set('from')} /></label>
        <label className={labelCls}>To<input type="date" className={inputCls} value={f.to} onChange={set('to')} /></label>
        <label className={labelCls}>Company<select className={inputCls} value={f.workspace_id} onChange={set('workspace_id')}><option value="">All</option>{(options?.workspaces || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <label className={labelCls}>Wallet<select className={inputCls} value={f.wallet_id} onChange={set('wallet_id')}><option value="">All</option>{(options?.wallets || []).map((w) => <option key={w.id} value={w.id}>{w.owner_name} · {w.name}</option>)}</select></label>
        <div className="flex items-end"><button type="button" className="btn-secondary inline-flex items-center gap-1" onClick={() => downloadFile('/group-cash/receipts', { ...params, format: 'csv' }, 'receipts.csv')}><Download className="h-4 w-4" />CSV</button></div>
      </div>
      {!d ? <Skeleton className="h-32" /> : (
        <>
          <p className="text-sm text-tertiary-600">Money received (transfers between wallets are not counted): <Totals totals={d.totals} /></p>
          <ul className="space-y-2">
            {d.summary.map((s) => (
              <li key={s.owner_name} className="rounded-xl border border-tertiary-100 bg-white p-3 text-sm">
                <p className="font-semibold text-tertiary-900">{s.owner_name} received {s.count} payment{s.count === 1 ? '' : 's'}</p>
                {Object.entries(s.by_currency).map(([cur, v]) => (
                  <p key={cur} className="text-tertiary-600"><Money value={v.total} currency={cur} className="font-medium" /> — {Object.entries(v.by_mode).map(([m, x]) => `${MODE_LABEL[m] || m} ${formatMoney(x, cur)}`).join(', ')}</p>
                ))}
              </li>
            ))}
            {!d.summary.length && <EmptyState icon={Receipt} title="No receipts in this period" />}
          </ul>
        </>
      )}
    </div>
  );
}

function ReconcileView({ position, onSaved, onOpenStatement }) {
  const saved = useSaved();
  const [editRec, setEditRec] = useState(null);
  const accounts = position.entities.flatMap((e) => e.accounts);
  const [v, setV] = useState({ bank_account_id: '', statement_date: today(), statement_balance: '', notes: '' });
  const [preview, setPreview] = useState(null);
  const history = useLiveData(() => api('/reconciliations', v.bank_account_id ? { bank_account_id: v.bank_account_id } : {}), { deps: [v.bank_account_id] });
  // changing the account, date or balance makes the comparison stale; typing a note does not
  const set = (k) => (e) => { setV((c) => ({ ...c, [k]: e.target.value })); if (k !== 'notes') setPreview(null); };
  const ready = v.bank_account_id && v.statement_date && v.statement_balance !== '';
  const body = { bank_account_id: v.bank_account_id, statement_date: v.statement_date, statement_balance: v.statement_balance, notes: v.notes || undefined };
  async function check() {
    try { setPreview((await apiClient.post('/group-cash/reconciliations/preview', body)).data.data); } catch (err) { saved.fail(err, 'Could not check'); }
  }
  async function save() {
    try { await apiClient.post('/group-cash/reconciliations', body); saved.done('Reconciliation saved'); setPreview(null); history.refresh(); onSaved(); } catch (err) { saved.fail(err, 'Could not save'); }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3 rounded-2xl border border-tertiary-100 bg-white p-4">
        <h3 className="font-heading font-semibold text-tertiary-900">Match a bank statement</h3>
        <label className={labelCls}>Bank account<select className={inputCls} value={v.bank_account_id} onChange={set('bank_account_id')}><option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.legal_entity_name} · {a.name} ({a.currency})</option>)}</select></label>
        <div className="grid grid-cols-2 gap-3">
          <label className={labelCls}>Statement date<input type="date" className={inputCls} value={v.statement_date} onChange={set('statement_date')} /></label>
          <label className={labelCls}>Balance on the statement<input inputMode="decimal" className={inputCls} value={v.statement_balance} onChange={set('statement_balance')} /></label>
        </div>
        <label className={labelCls}>Notes<input className={inputCls} value={v.notes} onChange={set('notes')} maxLength={2000} /></label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary" disabled={!ready} onClick={check}>Compare with the system</button>
          {v.bank_account_id && <button type="button" className="btn-ghost inline-flex items-center gap-1 text-sm" onClick={() => onOpenStatement(v.bank_account_id)}><FileText className="h-4 w-4" />View statement of this account</button>}
        </div>
        {preview && (
          <div className="rounded-xl bg-tertiary-50 p-3 text-sm">
            <p>System balance: <Money value={preview.system_balance} currency={preview.currency} className="font-semibold" /></p>
            <p>Statement balance: <Money value={preview.statement_balance} currency={preview.currency} className="font-semibold" /></p>
            <p>Difference: <Money value={preview.difference} currency={preview.currency} className="font-semibold" />{preview.difference === '0.00' && ' — matches'}</p>
            <button type="button" className="btn-primary mt-2" onClick={save}>Save this reconciliation</button>
          </div>
        )}
      </div>
      <div className="rounded-2xl border border-tertiary-100 bg-white p-4">
        <h3 className="mb-2 font-heading font-semibold text-tertiary-900">History</h3>
        <ul className="divide-y divide-tertiary-100 text-sm">
          {(history.data || []).map((r) => (
            <li key={r.id} className="py-2">
              <div className="flex items-center gap-1"><p className="flex-1 font-medium text-tertiary-900">{r.bank_account_name} · {r.statement_date}</p>
                <button type="button" title="Edit" className="rounded p-1 text-tertiary-400 hover:text-primary-600" onClick={() => setEditRec({ ...r })}><Pencil className="h-4 w-4" /></button>
                <button type="button" title="Delete" className="rounded p-1 text-tertiary-400 hover:text-danger-600" onClick={async () => { if (!window.confirm('Delete this reconciliation?')) return; try { await apiClient.delete(`/group-cash/reconciliations/${r.id}`); saved.done('Reconciliation deleted'); history.refresh(); onSaved(); } catch (err) { saved.fail(err, 'Could not delete'); } }}><Trash2 className="h-4 w-4" /></button></div>
              <p className="text-xs text-tertiary-500">statement {formatMoney(r.statement_balance, r.currency)} · system {formatMoney(r.system_balance, r.currency)} · difference <Money value={r.difference} currency={r.currency} />{r.notes ? ` · ${r.notes}` : ''}</p>
            </li>
          ))}
          {history.data && !history.data.length && <li className="py-3 text-tertiary-500">Nothing reconciled yet.</li>}
        </ul>
      </div>
      <Drawer open={Boolean(editRec)} onClose={() => setEditRec(null)} size="sm" tone="edit" title="Edit reconciliation">
        {editRec && (
          <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { await apiClient.patch(`/group-cash/reconciliations/${editRec.id}`, { statement_date: editRec.statement_date, statement_balance: editRec.statement_balance, notes: editRec.notes || null }); saved.done('Reconciliation updated'); setEditRec(null); history.refresh(); onSaved(); } catch (err) { saved.fail(err, 'Could not update'); } }}>
            <p className="text-xs text-tertiary-500">{editRec.bank_account_name}. The system balance is worked out again for the date you choose.</p>
            <label className={labelCls}>Statement date<input required type="date" className={inputCls} value={editRec.statement_date} onChange={(e) => setEditRec((c) => ({ ...c, statement_date: e.target.value }))} /></label>
            <label className={labelCls}>Balance on the statement<input required inputMode="decimal" className={inputCls} value={editRec.statement_balance} onChange={(e) => setEditRec((c) => ({ ...c, statement_balance: e.target.value }))} /></label>
            <label className={labelCls}>Notes<input className={inputCls} maxLength={2000} value={editRec.notes || ''} onChange={(e) => setEditRec((c) => ({ ...c, notes: e.target.value }))} /></label>
            <div className="flex justify-end"><button type="submit" className="btn-primary">Save</button></div>
          </form>
        )}
      </Drawer>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- setup

/** The date from which payments of new records must name a wallet (invoices, vendor payments, expenses, salaries). */
const STATEMENT_SCOPES = [['account', 'Bank account'], ['wallet', 'Wallet'], ['company', 'Company'], ['entity', 'Legal entity']];

/** A statement (opening, entries with a running balance, closing) for one bank account, wallet, company or legal entity, with CSV / PDF. */
function StatementsView({ options, filters, seed }) {
  const saved = useSaved();
  const [scope, setScope] = useState(filters.workspace_id ? 'company' : filters.legal_entity_id ? 'entity' : 'account');
  const [id, setId] = useState(filters.workspace_id || filters.legal_entity_id || '');
  const [currency, setCurrency] = useState(filters.currency || '');
  const [range, setRange] = useState({ from: '', to: '' });
  // opened from Reconciliation for one bank account
  useEffect(() => { if (seed) { setScope(seed.scope); setId(seed.id); } }, [seed]);
  const targets = useMemo(() => {
    if (!options) return [];
    if (scope === 'account') { const labels = accountLabels(options.accounts); return options.accounts.map((a) => ({ value: a.id, label: `${labels.get(a.id)} · ${a.currency}` })); }
    if (scope === 'wallet') return options.wallets.map((w) => ({ value: w.id, label: `${w.name} · ${w.owner_name} · ${w.currency}` }));
    if (scope === 'company') return options.workspaces.map((o) => ({ value: o.id, label: o.name }));
    return options.entities.map((e) => ({ value: e.id, label: e.name }));
  }, [options, scope]);
  const params = { scope, id, ...(currency && ['company', 'entity'].includes(scope) ? { currency } : {}), ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) };
  const data = useLiveData(() => api('/statement', params), { deps: [scope, id, currency, range.from, range.to], enabled: Boolean(id) });
  const d = id ? data.data : null;
  const cur = d?.wallet.currency;
  const pick = (next) => { setScope(next); setId(''); };
  const file = (format) => downloadFile('/group-cash/statement', { ...params, format }, `${d.wallet.name}.${format}`).catch((err) => saved.fail(err, 'Could not download'));
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-tertiary-100 bg-white p-4">
        <h3 className="font-heading font-semibold text-tertiary-900">Statement</h3>
        <p className="text-xs text-tertiary-500">Pick what to see: every entry in the period with a running balance, ready to download.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className={labelCls}>Statement of<select className={inputCls} value={scope} onChange={(e) => pick(e.target.value)}>{STATEMENT_SCOPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className={`${labelCls} lg:col-span-2`}>{STATEMENT_SCOPES.find(([k]) => k === scope)[1]}<select className={inputCls} value={id} onChange={(e) => setId(e.target.value)}><option value="">Choose…</option>{targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
          <label className={labelCls}>From<input type="date" className={inputCls} value={range.from} onChange={(e) => setRange((c) => ({ ...c, from: e.target.value }))} /></label>
          <label className={labelCls}>To<input type="date" className={inputCls} value={range.to} onChange={(e) => setRange((c) => ({ ...c, to: e.target.value }))} /></label>
          {['company', 'entity'].includes(scope) && (
            <label className={labelCls}>Currency<select className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="">Automatic</option>{(options?.currencies || ['INR', 'USD']).map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          )}
        </div>
      </div>
      {!id ? <EmptyState icon={FileText} title="Choose what to show" description="Pick a bank account, wallet, company or legal entity above." />
        : data.error ? <p className="rounded-xl border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700">{apiErrorMessage(data.error, 'Could not load the statement')}</p>
        : !d ? <Skeleton className="h-40" /> : (
          <div className="space-y-4 rounded-2xl border border-tertiary-100 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-heading font-semibold text-tertiary-900">{d.wallet.name}</p>
                <p className="text-xs text-tertiary-500">{[d.wallet.owner_name, d.wallet.legal_entity_name && scope === 'wallet' ? d.wallet.legal_entity_name : '', `${d.from || 'start'} to ${d.to || 'today'}`].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary inline-flex items-center gap-1" onClick={() => file('csv')}><Download className="h-4 w-4" />CSV</button>
                <button type="button" className="btn-secondary inline-flex items-center gap-1" onClick={() => file('pdf')}><Download className="h-4 w-4" />PDF</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {[['Opening balance', d.opening_balance], ['Credits (in)', d.total_in], ['Debits (out)', d.total_out], ['Closing balance', d.closing_balance]].map(([l, x]) => (
                <div key={l} className="rounded-xl border border-tertiary-100 p-2"><p className="text-xs text-tertiary-500">{l}</p><Money value={x} currency={cur} className="font-semibold" /></div>
              ))}
            </div>
            <div className="overflow-x-auto rounded-xl border border-tertiary-100">
              <table className="min-w-full text-sm">
                <thead className="bg-tertiary-50 text-left text-xs text-tertiary-500"><tr><th className="p-2">Date</th><th className="p-2">Particulars</th><th className="p-2">Mode</th><th className="p-2 text-right">Debit (out)</th><th className="p-2 text-right">Credit (in)</th><th className="p-2 text-right">Balance</th></tr></thead>
                <tbody>
                  <tr className="border-t border-tertiary-100 bg-tertiary-50/50 font-medium" data-testid="stmt-opening">
                    <td className="whitespace-nowrap p-2">{d.from || ''}</td><td className="p-2" colSpan={4}>Opening balance</td><td className="p-2 text-right"><Money value={d.opening_balance} currency={cur} /></td>
                  </tr>
                  {d.rows.map((r) => (
                    <tr key={r.id} className="border-t border-tertiary-100">
                      <td className="whitespace-nowrap p-2">{r.date}</td>
                      <td className="p-2">{r.party || r.category || (r.transfer_id ? 'Transfer' : '—')}{r.wallet && <span className="text-xs text-tertiary-500"> · {r.wallet}</span>}{r.transfer_id && <Pill tone="blue">Transfer</Pill>}{r.notes && <p className="text-xs text-tertiary-500">{r.notes}</p>}</td>
                      <td className="p-2">{MODE_LABEL[r.mode] || r.mode}</td>
                      <td className="p-2 text-right">{r.direction === 'out' ? <Money value={r.amount} currency={cur} /> : ''}</td>
                      <td className="p-2 text-right">{r.direction === 'in' ? <Money value={r.amount} currency={cur} /> : ''}</td>
                      <td className="p-2 text-right"><Money value={r.balance_after} currency={cur} /></td>
                    </tr>
                  ))}
                  {!d.rows.length && <tr><td colSpan={6} className="p-4 text-center text-tertiary-500">No entries in this period.</td></tr>}
                  <tr className="border-t-2 border-tertiary-200 bg-tertiary-50/50 font-semibold" data-testid="stmt-closing">
                    <td className="whitespace-nowrap p-2">{d.to || ''}</td><td className="p-2" colSpan={2}>Closing balance · totals</td>
                    <td className="p-2 text-right"><Money value={d.total_out} currency={cur} /></td><td className="p-2 text-right"><Money value={d.total_in} currency={cur} /></td><td className="p-2 text-right"><Money value={d.closing_balance} currency={cur} /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
    </div>
  );
}

/** Every company's payments (from the payment popup and the wallet link): INR value, bank charges, deductions, the wallet; filters and CSV. */
function PaymentsReportView({ options }) {
  const saved = useSaved();
  const [f, setF] = useState({ from: '', to: '', org_id: '', kind: '', direction: '' });
  const params = Object.fromEntries(Object.entries(f).filter(([, x]) => x));
  const data = useLiveData(() => api('/payments', params), { deps: [f.from, f.to, f.org_id, f.kind, f.direction] });
  const d = data.data;
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-tertiary-100 bg-white p-4">
        <h3 className="font-heading font-semibold text-tertiary-900">Payments</h3>
        <p className="text-xs text-tertiary-500">Every payment recorded through the payment popup, in all companies: what was paid, the rate and INR value, bank charges and deductions, and whether it was tracked in a wallet.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className={labelCls}>From<input type="date" className={inputCls} value={f.from} onChange={set('from')} /></label>
          <label className={labelCls}>To<input type="date" className={inputCls} value={f.to} onChange={set('to')} /></label>
          <label className={labelCls}>Company<select className={inputCls} value={f.org_id} onChange={set('org_id')}><option value="">All companies</option>{(options?.workspaces || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <label className={labelCls}>Type<select className={inputCls} value={f.kind} onChange={set('kind')}><option value="">All types</option>{(d?.kinds || []).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></label>
          <label className={labelCls}>In / out<select className={inputCls} value={f.direction} onChange={set('direction')}><option value="">Both</option><option value="in">Money in</option><option value="out">Money out</option></select></label>
          <div className="flex items-end"><button type="button" className="btn-secondary inline-flex items-center gap-1" onClick={() => downloadFile('/group-cash/payments', { ...params, format: 'csv' }, 'payments.csv').catch((err) => saved.fail(err, 'Could not download'))}><Download className="h-4 w-4" />CSV</button></div>
        </div>
      </div>
      {!d ? <Skeleton className="h-40" /> : (
        <>
          <div className="grid gap-2 sm:grid-cols-3" data-testid="payments-totals">
            <div className="rounded-xl border border-tertiary-100 bg-white p-3 text-sm"><p className="text-xs text-tertiary-500">Total in (INR value)</p><Money value={d.inr.in} currency="INR" className="font-semibold" /></div>
            <div className="rounded-xl border border-tertiary-100 bg-white p-3 text-sm"><p className="text-xs text-tertiary-500">Total out (INR value)</p><Money value={d.inr.out} currency="INR" className="font-semibold" /></div>
            <div className="rounded-xl border border-tertiary-100 bg-white p-3 text-xs text-tertiary-600">{Object.entries(d.totals).map(([c, t]) => <p key={c}>{c}: bank charges {formatMoney(t.bank_charges, c)} · deductions {formatMoney(t.deductions, c)}</p>)}{!Object.keys(d.totals).length && <p>No payments yet.</p>}</div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-tertiary-100 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-tertiary-50 text-left text-xs text-tertiary-500"><tr><th className="p-2">Date</th><th className="p-2">Company</th><th className="p-2">Type</th><th className="p-2 text-right">Amount</th><th className="p-2 text-right">Rate</th><th className="p-2 text-right">INR value</th><th className="p-2 text-right">Bank charges</th><th className="p-2 text-right">Deductions</th><th className="p-2 text-right">Net</th><th className="p-2">Wallet</th></tr></thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.id} className="border-t border-tertiary-100">
                    <td className="whitespace-nowrap p-2">{r.paid_on}</td>
                    <td className="p-2">{r.company}</td>
                    <td className="p-2">{r.label}<span className="ml-1 text-[11px] text-tertiary-400">{r.direction === 'in' ? 'in' : 'out'}</span>{r.notes && <p className="text-xs text-tertiary-500">{r.notes}</p>}</td>
                    <td className="p-2 text-right"><Money value={r.amount} currency={r.currency} /></td>
                    <td className="p-2 text-right">{r.exchange_rate || '—'}</td>
                    <td className="p-2 text-right"><Money value={r.inr_amount} currency="INR" /></td>
                    <td className="p-2 text-right">{Number(r.bank_charges) ? <Money value={r.bank_charges} currency={r.currency} /> : '—'}</td>
                    <td className="p-2 text-right">{Number(r.other_deductions) ? <span title={r.deduction_notes || ''}><Money value={r.other_deductions} currency={r.currency} /></span> : '—'}</td>
                    <td className="p-2 text-right"><Money value={r.net_amount} currency={r.currency} /></td>
                    <td className="p-2">{r.wallet || <span className="text-tertiary-400">not tracked</span>}</td>
                  </tr>
                ))}
                {!d.rows.length && <tr><td colSpan={10} className="p-4 text-center text-tertiary-500">No payments in this selection.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function GoLiveCard() {
  const saved = useSaved();
  const setting = useLiveData(() => api('/settings'), { deps: [] });
  const [date, setDate] = useState('');
  useEffect(() => { if (setting.data) setDate(setting.data.go_live_date || ''); }, [setting.data]);
  async function save() {
    try { await apiClient.put('/group-cash/settings', { go_live_date: date || null }); saved.done(date ? 'Go-live date saved' : 'Go-live date cleared'); setting.refresh(); } catch (err) { saved.fail(err, 'Could not save'); }
  }
  return (
    <div className="rounded-2xl border border-tertiary-100 bg-white p-4">
      <h3 className="font-heading font-semibold text-tertiary-900">Go-live date</h3>
      <p className="mt-1 text-xs text-tertiary-500">From this date, when an invoice, vendor payment, expense or salary <strong>created on or after it</strong> is marked paid, you choose the wallet it went through and the entry is added here by itself. Older records are not touched: enter their payments by hand. Leave empty to switch this off.</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className={labelCls}>Go-live date<input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <button type="button" className="btn-primary" onClick={save}>Save</button>
      </div>
    </div>
  );
}

function SetupView({ options, position, onChanged }) {
  const saved = useSaved();
  const [entity, setEntity] = useState({ name: '', workspace_id: '', gstin: '', pan: '' });
  const [account, setAccount] = useState({ legal_entity_id: '', name: '', type: 'current', bank_name: '', account_last4: '', currency: 'INR', declared_opening_balance: '0', minimum_balance: '', opening_date: today() });
  const [wallet, setWallet] = useState({ bank_account_id: '', owner: '', purpose: 'general', name: '', opening_balance: '0', currency: 'INR' });
  const [editWallet, setEditWallet] = useState(null);
  const [editEntity, setEditEntity] = useState(null);
  const [editAccount, setEditAccount] = useState(null);
  const entityList = useLiveData(() => api('/entities'), { deps: [options?.entities?.length] });
  const setup = useLiveData(() => api('/setup'), { deps: [options?.accounts?.length, options?.wallets?.length] });
  const refreshAll = () => { setup.refresh(); entityList.refresh(); onChanged(); };
  const run = async (fn, ok, fallback) => { try { const res = await fn(); saved.done(ok, res); refreshAll(); return true; } catch (err) { saved.fail(err, fallback); return false; } };
  const wallets = setup.data?.wallets || [];
  const allAccounts = setup.data?.accounts || [];
  const accountLabel = accountLabels(allAccounts);
  // what each bank account is made of: its mapped wallets and their total (from the live position)
  const accountMap = new Map((position?.entities || []).flatMap((e) => e.accounts || []).map((a) => [a.id, a]));
  const none = !(options?.entities || []).length;
  // delete asks first; the server refuses (and says why) while anything still hangs on the record
  const remove = (path, label) => { if (window.confirm(`Delete ${label}? This cannot be undone.`)) run(() => apiClient.delete(`/group-cash/${path}`), `${label} deleted`, 'Could not delete'); };
  return (
    <div className="space-y-5">
      {none && (
        <div className="rounded-2xl border border-primary-100 bg-primary-50/50 p-4 text-sm">
          <p className="font-medium text-tertiary-900">No legal entities yet.</p>
          <p className="text-tertiary-600">Delphic Global and Gulati Industries are both a company and a legal entity. Create their entity records in one click, or add your own below.</p>
          <button type="button" className="btn-primary mt-2" onClick={() => run(() => apiClient.post('/group-cash/entities/seed-defaults', {}), 'Entities created', 'Could not create')}>Create Delphic Global and Gulati Industries</button>
        </div>
      )}
      <GoLiveCard />
      <div className="grid gap-4 lg:grid-cols-3">
        <form className="space-y-2 rounded-2xl border border-tertiary-100 bg-white p-4" onSubmit={async (e) => { e.preventDefault(); if (await run(() => apiClient.post('/group-cash/entities', { ...entity, workspace_id: entity.workspace_id || null }), 'Legal entity added', 'Could not add')) setEntity({ name: '', workspace_id: '', gstin: '', pan: '' }); }}>
          <h3 className="font-heading font-semibold text-tertiary-900">New legal entity</h3>
          <label className={labelCls}>Name<input required className={inputCls} value={entity.name} onChange={(e) => setEntity((c) => ({ ...c, name: e.target.value }))} /></label>
          <label className={labelCls}>Same as company (optional)<select className={inputCls} value={entity.workspace_id} onChange={(e) => setEntity((c) => ({ ...c, workspace_id: e.target.value }))}><option value="">None</option>{(options?.workspaces || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2"><label className={labelCls}>GSTIN<input className={inputCls} value={entity.gstin} onChange={(e) => setEntity((c) => ({ ...c, gstin: e.target.value }))} /></label><label className={labelCls}>PAN<input className={inputCls} value={entity.pan} onChange={(e) => setEntity((c) => ({ ...c, pan: e.target.value }))} /></label></div>
          <button type="submit" className="btn-primary" disabled={!entity.name.trim()}>Add entity</button>
        </form>
        <form className="space-y-2 rounded-2xl border border-tertiary-100 bg-white p-4" onSubmit={async (e) => { e.preventDefault(); if (await run(() => apiClient.post('/group-cash/accounts', { ...account, legal_entity_id: account.legal_entity_id || null, minimum_balance: account.minimum_balance.trim() === '' ? null : account.minimum_balance, bank_name: account.bank_name || null, account_last4: account.account_last4 || null }), 'Bank account added', 'Could not add')) setAccount((c) => ({ ...c, name: '', bank_name: '', account_last4: '' })); }}>
          <h3 className="font-heading font-semibold text-tertiary-900">New bank account</h3>
          <label className={labelCls}>Legal entity (optional)<select className={inputCls} value={account.legal_entity_id} onChange={(e) => setAccount((c) => ({ ...c, legal_entity_id: e.target.value }))}><option value="">None</option>{(options?.entities || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className={labelCls}>Name<input required className={inputCls} value={account.name} onChange={(e) => setAccount((c) => ({ ...c, name: e.target.value }))} placeholder="e.g. HDFC Current" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className={labelCls}>Type<select className={inputCls} value={account.type} onChange={(e) => setAccount((c) => ({ ...c, type: e.target.value }))}>{Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className={labelCls}>Currency<select className={inputCls} value={account.currency} onChange={(e) => setAccount((c) => ({ ...c, currency: e.target.value }))}><option>INR</option><option>USD</option></select></label>
          </div>
          {account.type !== 'cash' && <div className="grid grid-cols-2 gap-2"><label className={labelCls}>Bank<input className={inputCls} value={account.bank_name} onChange={(e) => setAccount((c) => ({ ...c, bank_name: e.target.value }))} /></label><label className={labelCls}>Last 4 digits<input className={inputCls} maxLength={4} value={account.account_last4} onChange={(e) => setAccount((c) => ({ ...c, account_last4: e.target.value }))} /></label></div>}
          <div className="grid grid-cols-2 gap-2"><label className={labelCls}>Opening balance<input inputMode="decimal" className={inputCls} value={account.declared_opening_balance} onChange={(e) => setAccount((c) => ({ ...c, declared_opening_balance: e.target.value }))} /></label><label className={labelCls}>As on<input type="date" className={inputCls} value={account.opening_date} onChange={(e) => setAccount((c) => ({ ...c, opening_date: e.target.value }))} /></label></div>
          <label className={labelCls}>Minimum balance (optional)<input inputMode="decimal" className={inputCls} value={account.minimum_balance} onChange={(e) => setAccount((c) => ({ ...c, minimum_balance: e.target.value }))} placeholder="Alert when the balance falls below" /></label>
          <button type="submit" className="btn-primary" disabled={!account.name.trim()}>Add bank account</button>
        </form>
        <form className="space-y-2 rounded-2xl border border-tertiary-100 bg-white p-4" onSubmit={async (e) => {
          e.preventDefault();
          const [kind, id] = (wallet.owner || '').split(':');
          if (await run(() => apiClient.post('/group-cash/wallets', { bank_account_id: wallet.bank_account_id || null, ...(wallet.bank_account_id ? {} : { currency: wallet.currency }), purpose: wallet.purpose, name: wallet.name, opening_balance: wallet.opening_balance, ...(!id ? {} : kind === 'org' ? { owner_org_id: id } : { owner_legal_entity_id: id }) }), 'Wallet added', 'Could not add')) setWallet((c) => ({ ...c, name: '', opening_balance: '0' }));
        }}>
          <h3 className="font-heading font-semibold text-tertiary-900">New wallet</h3>
          <label className={labelCls}>Bank account (optional, you can map it later)<select className={inputCls} value={wallet.bank_account_id} onChange={(e) => setWallet((c) => ({ ...c, bank_account_id: e.target.value }))}><option value="">Not mapped</option>{(options?.accounts || []).map((a) => <option key={a.id} value={a.id}>{accountLabel.get(a.id) || a.name} ({a.currency})</option>)}</select></label>
          {!wallet.bank_account_id && <label className={labelCls}>Currency<select className={inputCls} value={wallet.currency} onChange={(e) => setWallet((c) => ({ ...c, currency: e.target.value }))}><option>INR</option><option>USD</option></select></label>}
          <label className={labelCls}>Whose money (optional)<select className={inputCls} value={wallet.owner} onChange={(e) => setWallet((c) => ({ ...c, owner: e.target.value }))}><option value="">No owner</option>{(options?.workspaces || []).map((w) => <option key={w.id} value={`org:${w.id}`}>{w.name}</option>)}{(options?.entities || []).map((x) => <option key={x.id} value={`entity:${x.id}`}>{x.name} (entity)</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2"><label className={labelCls}>Purpose<select className={inputCls} value={wallet.purpose} onChange={(e) => setWallet((c) => ({ ...c, purpose: e.target.value }))}><option value="general">General</option><option value="salary">Salary</option><option value="travel">Travel</option></select></label><label className={labelCls}>Opening balance<input inputMode="decimal" className={inputCls} value={wallet.opening_balance} onChange={(e) => setWallet((c) => ({ ...c, opening_balance: e.target.value }))} /></label></div>
          <label className={labelCls}>Name<input required className={inputCls} value={wallet.name} onChange={(e) => setWallet((c) => ({ ...c, name: e.target.value }))} placeholder="e.g. Zephyr salary" /></label>
          <button type="submit" className="btn-primary" disabled={!wallet.name.trim()}>Add wallet</button>
        </form>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-tertiary-100 bg-white p-4">
          <h3 className="mb-2 font-heading font-semibold text-tertiary-900">Legal entities</h3>
          <ul className="divide-y divide-tertiary-100 text-sm">
            {(entityList.data || []).map((x) => (
              <li key={x.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1"><span className="font-medium text-tertiary-900">{x.name}</span> <span className="text-xs text-tertiary-500">{x.workspace_name ? `= ${x.workspace_name} · ` : ''}{x.invoice_prefix ? `prefix ${x.invoice_prefix}` : 'no invoice prefix yet'}{x.gstin ? ` · ${x.gstin}` : ''}</span></span>
                <button type="button" className="rounded p-1 text-tertiary-400 hover:text-primary-600" title="Edit" onClick={() => setEditEntity(x)}><Pencil className="h-4 w-4" /></button>
                <button type="button" className="rounded p-1 text-tertiary-400 hover:text-danger-600" title="Delete" onClick={() => remove(`entities/${x.id}`, x.name)}><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
            {entityList.data && !entityList.data.length && <li className="py-2 text-tertiary-500">None yet.</li>}
          </ul>
        </div>
        <div className="rounded-2xl border border-tertiary-100 bg-white p-4">
          <h3 className="mb-2 font-heading font-semibold text-tertiary-900">Bank accounts</h3>
          <ul className="divide-y divide-tertiary-100 text-sm">
            {allAccounts.map((a) => (
              <li key={a.id} className="py-2">
                <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1"><span className="font-medium text-tertiary-900">{a.name}</span> {!a.active && <Pill tone="gray">Switched off</Pill>} <span className="text-xs text-tertiary-500">{a.legal_entity_name || 'No legal entity'} · {TYPE_LABEL[a.type]} · {a.currency}{a.payment_instructions ? '' : ' · no payment details for invoices'}</span></span>
                <button type="button" className="rounded p-1 text-tertiary-400 hover:text-primary-600" title="Edit" onClick={() => setEditAccount(a)}><Pencil className="h-4 w-4" /></button>
                <button type="button" className="rounded p-1 text-tertiary-400 hover:text-danger-600" title="Delete" onClick={() => remove(`accounts/${a.id}`, a.name)}><Trash2 className="h-4 w-4" /></button>
                </div>
                {(() => { const m = accountMap.get(a.id); const ws = m?.wallets || []; return (
                  <div className="mt-1 pl-1 text-xs text-tertiary-600">
                    {a.minimum_balance != null && <p className={m?.below_minimum ? 'font-medium text-danger-700' : ''}>Minimum balance <Money value={a.minimum_balance} currency={a.currency} />{m?.below_minimum ? ' · below the minimum' : ''}</p>}
                    {ws.length === 0 ? <span className="text-tertiary-400">No wallets mapped, so no balance yet. Map wallets from the Wallets list below.</span> : (
                      <>
                        <span className="font-medium text-tertiary-900">Balance <Money value={m.balance} currency={a.currency} /></span> = {ws.map((w, k) => <span key={w.id}>{k ? ' + ' : ''}{w.name} <Money value={w.balance} currency={a.currency} /></span>)}
                      </>
                    )}
                  </div>
                ); })()}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <EntityEditDrawer entity={editEntity} workspaces={options?.workspaces} onClose={() => setEditEntity(null)} onSaved={refreshAll} />
      <AccountEditDrawer account={editAccount} entities={options?.entities} onClose={() => setEditAccount(null)} onSaved={refreshAll} />
      <div className="rounded-2xl border border-tertiary-100 bg-white p-4">
        <h3 className="font-heading font-semibold text-tertiary-900">Wallets</h3>
        <p className="mb-2 text-xs text-tertiary-500">A bank account can have many wallets; a wallet belongs to one bank account at most. A bank balance is the sum of its wallets. Wallets set to &quot;Not mapped&quot; are not part of any bank balance.</p>
        <ul className="divide-y divide-tertiary-100 text-sm">
          {wallets.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1"><span className="font-medium text-tertiary-900">{w.name}</span> {!w.active && <Pill tone="gray">Switched off</Pill>} <span className="text-xs text-tertiary-500">{w.owner_name} · opening {formatMoney(w.opening_balance, w.currency)}</span></span>
              <label className="text-xs text-tertiary-500">Bank account
                <select className="ml-1 rounded-lg border border-tertiary-200 px-2 py-1 text-xs" value={w.bank_account_id || ''} onChange={(e) => run(() => apiClient.patch(`/group-cash/wallets/${w.id}`, { bank_account_id: e.target.value || null }), e.target.value ? 'Wallet mapped to the bank account' : 'Wallet un-mapped', 'Could not map')}>
                  <option value="">Not mapped</option>
                  {allAccounts.filter((a) => a.currency === w.currency && (a.active || a.id === w.bank_account_id)).map((a) => <option key={a.id} value={a.id}>{accountLabel.get(a.id)}</option>)}
                </select>
              </label>
              <Money value={w.balance} currency={w.currency} />
              <button type="button" className="rounded p-1 text-tertiary-400 hover:text-primary-600" title="Edit" onClick={() => setEditWallet({ id: w.id, name: w.name, opening_balance: w.opening_balance, purpose: w.purpose, owner: w.owner_org_id ? `org:${w.owner_org_id}` : w.owner_legal_entity_id ? `entity:${w.owner_legal_entity_id}` : '' })}><Pencil className="h-4 w-4" /></button>
              <button type="button" className="rounded p-1 text-tertiary-400 hover:text-danger-600" title="Delete" onClick={() => remove(`wallets/${w.id}`, w.name)}><Trash2 className="h-4 w-4" /></button>
              {w.purpose !== 'unallocated' && (w.active
                ? <button type="button" className="text-xs text-danger-600 hover:underline" onClick={() => run(() => apiClient.patch(`/group-cash/wallets/${w.id}`, { active: false }), 'Wallet switched off', 'Could not switch off')}>Switch off</button>
                : <button type="button" className="text-xs text-primary-700 hover:underline" onClick={() => run(() => apiClient.patch(`/group-cash/wallets/${w.id}`, { active: true }), 'Wallet switched on', 'Could not switch on')}>Switch on</button>)}
            </li>
          ))}
        </ul>
      </div>
      <Drawer open={Boolean(editWallet)} onClose={() => setEditWallet(null)} size="sm" tone="edit" title="Edit wallet">
        {editWallet && (
          <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const [kind, ownerId] = (editWallet.owner || '').split(':');
            const body = { name: editWallet.name, opening_balance: editWallet.opening_balance, ...(editWallet.purpose !== 'unallocated' ? { purpose: editWallet.purpose } : {}), ...(editWallet.owner ? (kind === 'org' ? { owner_org_id: ownerId, owner_legal_entity_id: null } : { owner_legal_entity_id: ownerId, owner_org_id: null }) : { owner_org_id: null, owner_legal_entity_id: null }) }; if (await run(() => apiClient.patch(`/group-cash/wallets/${editWallet.id}`, body), 'Wallet updated', 'Could not update')) setEditWallet(null); }}>
            <label className={labelCls}>Name<input required className={inputCls} value={editWallet.name} onChange={(e) => setEditWallet((c) => ({ ...c, name: e.target.value }))} /></label>
            <label className={labelCls}>Opening balance<input inputMode="decimal" className={inputCls} value={editWallet.opening_balance} onChange={(e) => setEditWallet((c) => ({ ...c, opening_balance: e.target.value }))} /></label>
            <label className={labelCls}>Whose money
              <select className={inputCls} value={editWallet.owner || ''} onChange={(e) => setEditWallet((c) => ({ ...c, owner: e.target.value }))}><option value="">No owner</option>{(options?.workspaces || []).map((w) => <option key={w.id} value={`org:${w.id}`}>{w.name}</option>)}{(options?.entities || []).map((x) => <option key={x.id} value={`entity:${x.id}`}>{x.name} (entity)</option>)}</select>
            </label>
            {editWallet.purpose !== 'unallocated' && <label className={labelCls}>Purpose<select className={inputCls} value={editWallet.purpose} onChange={(e) => setEditWallet((c) => ({ ...c, purpose: e.target.value }))}><option value="general">General</option><option value="salary">Salary</option><option value="travel">Travel</option></select></label>}
            <div className="flex justify-end"><button type="submit" className="btn-primary">Save</button></div>
          </form>
        )}
      </Drawer>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- the tab

/** Cash in hand only: the accounts of type "Cash in hand", totalled per currency, by company and entity (the Bank view mixes them with bank accounts). */
function CashView({ filters, selected, toggle, setOpenWallet, setOpenAccount }) {
  const { pushError } = useAlerts();
  const params = Object.fromEntries(Object.entries({ legal_entity_id: filters.legal_entity_id, workspace_id: filters.workspace_id, currency: filters.currency, type: 'cash' }).filter(([, v]) => v));
  const cash = useLiveData(() => api('/position', params), { intervalMs: 60000, deps: [filters.legal_entity_id, filters.workspace_id, filters.currency] });
  useEffect(() => { if (cash.error) pushError(apiErrorMessage(cash.error, 'Could not load the cash position'), 'Load failed'); }, [cash.error]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = cash.data;
  if (!p) return <Skeleton className="h-48" />;
  const accounts = p.entities.flatMap((e) => e.accounts);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[['Cash in hand, INR', p.totals.INR, 'INR'], ['Cash in hand, USD', p.totals.USD, 'USD']].map(([l, x, c]) => (
          <div key={l} className="rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card" data-testid="cash-total"><p className="text-xs text-tertiary-500">{l}</p><p className="font-heading text-xl font-semibold"><Money value={x} currency={c} /></p></div>
        ))}
        <div className="rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card"><p className="text-xs text-tertiary-500">Cash accounts</p><p className="font-heading text-xl font-semibold">{accounts.length}</p></div>
      </div>
      {accounts.length === 0
        ? <EmptyState icon={Banknote} title="No cash in hand yet" description="Add an account of type Cash in hand (Setup > Bank accounts), then record cash in and out against its wallet. It is totalled here, apart from the bank balances." />
        : <BankView position={p} selected={selected} toggle={toggle} setOpenWallet={setOpenWallet} setOpenAccount={setOpenAccount} />}
    </div>
  );
}

const SECTIONS = [
  { key: 'bank', label: 'Bank view', icon: Landmark },
  { key: 'cash', label: 'Cash', icon: Banknote },
  { key: 'fund', label: 'Fund view', icon: WalletIcon },
  { key: 'invoices', label: 'Invoices', icon: FileText },
  { key: 'receipts', label: 'Receipts', icon: Receipt },
  { key: 'statements', label: 'Statements', icon: FileText },
  { key: 'payments', label: 'Payments', icon: Receipt },
  { key: 'reconcile', label: 'Reconciliation', icon: Scale },
  { key: 'setup', label: 'Setup', icon: Banknote },
];

/** Group Dashboard > Book Keeping: where the group's money is, by bank account and by company. */
export default function GroupCashTab() {
  const { pushError } = useAlerts();
  const [section, setSection] = useState('bank');
  const [filters, setFilters] = useState({ legal_entity_id: '', workspace_id: '', type: '', currency: '' });
  const [selected, setSelected] = useState(() => new Set());
  const [openWallet, setOpenWallet] = useState(null);
  const [openAccount, setOpenAccount] = useState(null);
  const [stmtSeed, setStmtSeed] = useState(null);
  const [txOpen, setTxOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const position = useLiveData(() => api('/position', params), { intervalMs: 60000, deps: [filters.legal_entity_id, filters.workspace_id, filters.type, filters.currency] });
  const options = useLiveData(() => api('/options'), { deps: [] });
  useEffect(() => { if (position.error) pushError(apiErrorMessage(position.error, 'Could not load the cash position'), 'Load failed'); }, [position.error]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = useCallback(() => { position.refresh(); options.refresh(); }, [position, options]);
  const toggle = (key) => setSelected((c) => { const n = new Set(c); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const accounts = useMemo(() => (position.data?.entities || []).flatMap((e) => e.accounts), [position.data]);
  // the Fund view ticks wallets only, so its selection is totalled over the same accounts and wallets
  const picked = useMemo(() => selectionTotals(accounts, selected), [accounts, selected]);
  const p = position.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-lg font-semibold text-tertiary-900">Group Book Keeping</h2>
          <p className="text-xs text-tertiary-500">Balances are worked out from the entries; INR and USD are never added together.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => setTransferOpen(true)}><ArrowLeftRight className="h-4 w-4" />Transfer</button>
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setTxOpen(true)}><Plus className="h-4 w-4" />Money in / out</button>
        </div>
      </div>
      {p && (
        <div className="grid gap-3 sm:grid-cols-3">
          {[['Total INR', p.totals.INR, 'INR'], ['Total USD', p.totals.USD, 'USD']].map(([l, x, c]) => (
            <div key={l} className="rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card"><p className="text-xs text-tertiary-500">{l}</p><p className="font-heading text-xl font-semibold"><Money value={x} currency={c} /></p></div>
          ))}
          <div className="rounded-2xl border border-primary-100 bg-primary-50/40 p-3" data-testid="selected-total">
            <p className="text-xs text-tertiary-500">Ticked ({picked.accounts} account{picked.accounts === 1 ? '' : 's'}, {picked.wallets} wallet{picked.wallets === 1 ? '' : 's'})</p>
            <p className="font-heading text-xl font-semibold"><Totals totals={picked} /></p>
            {selected.size > 0 && <button type="button" className="text-xs text-primary-700 hover:underline" onClick={() => setSelected(new Set())}>Clear</button>}
          </div>
        </div>
      )}
      <SectionTabs tabs={SECTIONS} value={section} onChange={setSection} />
      {['bank', 'fund', 'cash'].includes(section) && <Filters options={options.data} filters={filters} setFilters={setFilters} />}
      {!p ? <Skeleton className="h-48" /> : (
        <>
          {section === 'bank' && <BankView position={p} selected={selected} toggle={toggle} setOpenWallet={setOpenWallet} setOpenAccount={setOpenAccount} />}
          {section === 'cash' && <CashView filters={filters} selected={selected} toggle={toggle} setOpenWallet={setOpenWallet} setOpenAccount={setOpenAccount} />}
          {section === 'fund' && <FundView position={p} selected={selected} toggle={toggle} setOpenWallet={setOpenWallet} />}
          {section === 'invoices' && <GroupInvoicesView options={options.data} onWalletsChanged={refresh} />}
          {section === 'receipts' && <ReceiptsView options={options.data} />}
          {section === 'statements' && <StatementsView options={options.data} filters={filters} seed={stmtSeed} />}
          {section === 'payments' && <PaymentsReportView options={options.data} />}
          {section === 'reconcile' && <ReconcileView position={p} onSaved={refresh} onOpenStatement={(accountId) => { setStmtSeed({ scope: 'account', id: accountId }); setSection('statements'); }} />}
          {section === 'setup' && <SetupView options={options.data} position={p} onChanged={refresh} />}
        </>
      )}
      <WalletDrawer walletId={openWallet} accountId={openAccount} options={options.data} onClose={() => { setOpenWallet(null); setOpenAccount(null); }} onChanged={refresh} />
      <TransactionDrawer open={txOpen} options={options.data} onClose={() => setTxOpen(false)} onSaved={refresh} />
      <TransferDrawer open={transferOpen} options={options.data} onClose={() => setTransferOpen(false)} onSaved={refresh} />
    </div>
  );
}
