import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import InvoicingSection from './InvoicingSection.jsx';

const LEDGER_KINDS = ['asset', 'liability', 'equity', 'revenue', 'expense'];
const CURRENCIES = ['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP'];
const SUB_TABS = [
  { key: 'invoicing', label: 'Invoicing' },
  { key: 'ledger', label: 'Ledger accounts' },
  { key: 'journal', label: 'Journal entries' },
  { key: 'reports', label: 'Reports' },
  { key: 'tax', label: 'Tax records' },
];

function money(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function LedgerAccountsSection() {
  const { pushError, pushInfo } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('asset');
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    apiClient.get('/accounting/ledger-accounts').then(({ data }) => setRows(data.data || [])).catch((err) => pushError(apiErrorMessage(err, 'Failed to load ledger accounts'), 'Something went wrong')).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post('/accounting/ledger-accounts', { name: name.trim(), kind });
      pushInfo('Ledger account created');
      setName(''); setKind('asset'); setDrawerOpen(false);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to create ledger account'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'kind', header: 'Kind', render: (row) => <span className="capitalize">{row.kind}</span> },
    { key: 'active', header: 'Active', render: (row) => (row.is_active ? 'Yes' : 'No') },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setDrawerOpen(true)}><Plus className="h-4 w-4" /> Add ledger account</button>
      </div>
      {!loading && rows.length === 0 ? (
        <EmptyState title="No ledger accounts yet" description="Add asset, liability, equity, revenue, and expense accounts to start posting." />
      ) : (
        <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No ledger accounts." />
      )}
      <Drawer open={drawerOpen} title="Add ledger account" onClose={() => setDrawerOpen(false)} size="sm" tone="create" footer={
        <>
          <button type="button" className="btn-secondary" onClick={() => setDrawerOpen(false)} disabled={saving}>Cancel</button>
          <button type="submit" form="ledger-account-form" className="btn-primary" disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Add account'}</button>
        </>
      }>
        <form id="ledger-account-form" onSubmit={submit} className="space-y-3">
          <label className="block text-xs font-medium text-tertiary-600">Name<input required value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-medium text-tertiary-600">Kind
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
              {LEDGER_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
        </form>
      </Drawer>
    </div>
  );
}

function emptyLine() { return { ledger_account_id: '', debit: '', credit: '' }; }

function JournalEntrySection() {
  const { pushError, pushInfo } = useAlerts();
  const [accounts, setAccounts] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    apiClient.get('/accounting/ledger-entries', { params: { limit: 50 } }).then(({ data }) => setEntries(data.data || [])).catch((err) => pushError(apiErrorMessage(err, 'Failed to load ledger entries'), 'Something went wrong')).finally(() => setLoading(false));
  }
  useEffect(load, []);
  useEffect(() => {
    apiClient.get('/accounting/ledger-accounts').then(({ data }) => setAccounts(data.data || [])).catch(() => setAccounts([]));
  }, []);

  function setLine(index, key, value) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, [key]: value } : line)));
  }

  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  const balanced = lines.length >= 2 && totalDebit === totalCredit && totalDebit > 0;

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post('/accounting/journal-entries', {
        date,
        memo: memo.trim() || undefined,
        lines: lines.map((l) => ({ ledger_account_id: l.ledger_account_id, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
      });
      pushInfo('Journal entry posted');
      setMemo(''); setLines([emptyLine(), emptyLine()]); setDrawerOpen(false);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to post journal entry'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: 'date', header: 'Date', render: (row) => new Date(row.date).toLocaleDateString() },
    { key: 'account', header: 'Account', render: (row) => row.ledger_account?.name || '—' },
    { key: 'debit', header: 'Debit', render: (row) => Number(row.debit) > 0 ? money(row.debit) : '—' },
    { key: 'credit', header: 'Credit', render: (row) => Number(row.credit) > 0 ? money(row.credit) : '—' },
    { key: 'memo', header: 'Memo', render: (row) => row.memo || '—' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setDrawerOpen(true)}><Plus className="h-4 w-4" /> Post journal entry</button>
      </div>
      {!loading && entries.length === 0 ? (
        <EmptyState title="No ledger entries yet" description="Post a balanced journal entry (debits = credits) to start the books." />
      ) : (
        <DataTable columns={columns} rows={entries} loading={loading} emptyLabel="No ledger entries." />
      )}
      <Drawer open={drawerOpen} title="Post journal entry" onClose={() => setDrawerOpen(false)} size="lg" tone="create" footer={
        <>
          <button type="button" className="btn-secondary" onClick={() => setDrawerOpen(false)} disabled={saving}>Cancel</button>
          <button type="submit" form="journal-entry-form" className="btn-primary" disabled={saving || !balanced || lines.some((l) => !l.ledger_account_id)}>{saving ? 'Posting…' : 'Post entry'}</button>
        </>
      }>
        <form id="journal-entry-form" onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-tertiary-600">Date<input required type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
            <label className="block text-xs font-medium text-tertiary-600">Memo<input value={memo} onChange={(e) => setMemo(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
          </div>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="flex items-end gap-2">
                <select required value={line.ledger_account_id} onChange={(e) => setLine(index, 'ledger_account_id', e.target.value)} className="flex-1 rounded-xl border px-3 py-2 text-sm">
                  <option value="" disabled>Ledger account</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <input type="number" min="0" step="0.01" placeholder="Debit" value={line.debit} onChange={(e) => setLine(index, 'debit', e.target.value)} className="w-28 rounded-xl border px-3 py-2 text-sm" />
                <input type="number" min="0" step="0.01" placeholder="Credit" value={line.credit} onChange={(e) => setLine(index, 'credit', e.target.value)} className="w-28 rounded-xl border px-3 py-2 text-sm" />
                {lines.length > 2 && (
                  <button type="button" className="rounded-lg p-2 text-tertiary-400 hover:text-danger-600" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></button>
                )}
              </div>
            ))}
            <button type="button" className="btn-ghost text-xs" onClick={() => setLines((current) => [...current, emptyLine()])}>+ Add line</button>
          </div>
          <p className={`text-xs font-medium ${balanced ? 'text-success-700' : 'text-danger-600'}`}>
            Debit {money(totalDebit)} · Credit {money(totalCredit)} {balanced ? '· Balanced' : '· Must balance before posting'}
          </p>
        </form>
      </Drawer>
    </div>
  );
}

function ReportsSection() {
  const { pushError } = useAlerts();
  const [reportType, setReportType] = useState('trial-balance');
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [from, setFrom] = useState(new Date(new Date().setDate(1)).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const params = reportType === 'profit-and-loss' ? { from, to } : { as_of: asOf };
      const { data } = await apiClient.get(`/accounting/reports/${reportType}`, { params });
      setReport(data.data);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load report'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { run(); }, [reportType]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-xs font-medium text-tertiary-600">Report
          <select value={reportType} onChange={(e) => setReportType(e.target.value)} className="mt-1 rounded-xl border px-3 py-2 text-sm">
            <option value="trial-balance">Trial balance</option>
            <option value="profit-and-loss">Profit &amp; loss</option>
            <option value="balance-sheet">Balance sheet</option>
          </select>
        </label>
        {reportType === 'profit-and-loss' ? (
          <>
            <label className="block text-xs font-medium text-tertiary-600">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 rounded-xl border px-3 py-2 text-sm" /></label>
            <label className="block text-xs font-medium text-tertiary-600">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 rounded-xl border px-3 py-2 text-sm" /></label>
          </>
        ) : (
          <label className="block text-xs font-medium text-tertiary-600">As of<input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="mt-1 rounded-xl border px-3 py-2 text-sm" /></label>
        )}
        <button type="button" className="btn-secondary" onClick={run} disabled={loading}>{loading ? 'Loading…' : 'Run report'}</button>
      </div>

      {report && reportType === 'trial-balance' && (
        <DataTable
          columns={[
            { key: 'name', header: 'Account' },
            { key: 'kind', header: 'Kind', render: (r) => <span className="capitalize">{r.kind}</span> },
            { key: 'debit_total', header: 'Debit', render: (r) => money(r.debit_total) },
            { key: 'credit_total', header: 'Credit', render: (r) => money(r.credit_total) },
            { key: 'balance', header: 'Balance', render: (r) => money(r.balance) },
          ]}
          rows={report.accounts.map((r, i) => ({ id: i, ...r }))}
          emptyLabel="No ledger activity yet."
        />
      )}
      {report && reportType === 'trial-balance' && (
        <p className={`text-sm font-medium ${report.is_balanced ? 'text-success-700' : 'text-danger-600'}`}>
          Total debit {money(report.totals.debit_total)} · Total credit {money(report.totals.credit_total)} {report.is_balanced ? '· Balanced' : '· Out of balance'}
        </p>
      )}

      {report && reportType === 'profit-and-loss' && (
        <>
          <DataTable
            columns={[
              { key: 'name', header: 'Account' },
              { key: 'kind', header: 'Kind', render: (r) => <span className="capitalize">{r.kind}</span> },
              { key: 'amount', header: 'Amount', render: (r) => money(r.amount) },
            ]}
            rows={report.lines.map((r, i) => ({ id: i, ...r }))}
            emptyLabel="No revenue or expense activity in this period."
          />
          <p className="text-sm font-medium text-tertiary-800">
            Revenue {money(report.total_revenue)} · Expense {money(report.total_expense)} · Net profit {money(report.net_profit)}
          </p>
        </>
      )}

      {report && reportType === 'balance-sheet' && (
        <div className="grid gap-4 md:grid-cols-3">
          {['assets', 'liabilities', 'equity'].map((section) => (
            <div key={section}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500 capitalize">{section}</h4>
              <ul className="space-y-1 text-sm">
                {report[section].map((r) => <li key={r.ledger_account_id} className="flex justify-between"><span>{r.name}</span><span>{money(r.balance)}</span></li>)}
                {report[section].length === 0 && <li className="text-tertiary-400">None</li>}
              </ul>
            </div>
          ))}
          <p className="col-span-full text-sm font-medium text-tertiary-800">
            Assets {money(report.total_assets)} − (Liabilities {money(report.total_liabilities)} + Equity {money(report.total_equity)}) = {money(report.balances)}
            {Number(report.balances) !== 0 && <span className="ml-2 text-xs font-normal text-tertiary-500">(unclosed net profit for the period — no period-close posting yet)</span>}
          </p>
        </div>
      )}
    </div>
  );
}

function TaxRecordsSection() {
  const { pushError, pushInfo } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fields, setFields] = useState({ period_month: new Date().getMonth() + 1, period_year: new Date().getFullYear(), jurisdiction: '', kind: '', amount: '', currency: 'INR' });
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    apiClient.get('/accounting/tax-records', { params: { limit: 50 } }).then(({ data }) => setRows(data.data || [])).catch((err) => pushError(apiErrorMessage(err, 'Failed to load tax records'), 'Something went wrong')).finally(() => setLoading(false));
  }
  useEffect(load, []);

  function set(key, value) { setFields((current) => ({ ...current, [key]: value })); }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post('/accounting/tax-records', { ...fields, amount: Number(fields.amount), period_month: Number(fields.period_month), period_year: Number(fields.period_year) });
      pushInfo('Tax record created');
      setDrawerOpen(false);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to create tax record'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function file(row) {
    try { await apiClient.post(`/accounting/tax-records/${row.id}/file`); pushInfo('Marked filed'); load(); }
    catch (err) { pushError(apiErrorMessage(err, 'Failed to file'), 'Something went wrong'); }
  }
  async function pay(row) {
    try { await apiClient.post(`/accounting/tax-records/${row.id}/pay`); pushInfo('Marked paid'); load(); }
    catch (err) { pushError(apiErrorMessage(err, 'Failed to pay'), 'Something went wrong'); }
  }

  const columns = [
    { key: 'period', header: 'Period', render: (r) => `${r.period_month}/${r.period_year}` },
    { key: 'jurisdiction', header: 'Jurisdiction' },
    { key: 'kind', header: 'Kind' },
    { key: 'amount', header: 'Amount', render: (r) => `${r.currency} ${money(r.amount)}` },
    { key: 'status', header: 'Status', render: (r) => <Badge value={r.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <div className="flex gap-2">
          {r.status === 'pending' && <button type="button" className="btn-ghost text-xs" onClick={() => file(r)}>Mark filed</button>}
          {r.status === 'filed' && <button type="button" className="btn-ghost text-xs" onClick={() => pay(r)}>Mark paid</button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setDrawerOpen(true)}><Plus className="h-4 w-4" /> Add tax record</button>
      </div>
      {!loading && rows.length === 0 ? (
        <EmptyState title="No tax records yet" description="Track filing periods and payment status per jurisdiction." />
      ) : (
        <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No tax records." />
      )}
      <Drawer open={drawerOpen} title="Add tax record" onClose={() => setDrawerOpen(false)} size="sm" tone="create" footer={
        <>
          <button type="button" className="btn-secondary" onClick={() => setDrawerOpen(false)} disabled={saving}>Cancel</button>
          <button type="submit" form="tax-record-form" className="btn-primary" disabled={saving || !fields.jurisdiction.trim() || !fields.kind.trim() || !fields.amount}>{saving ? 'Saving…' : 'Add record'}</button>
        </>
      }>
        <form id="tax-record-form" onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-tertiary-600">Month<input required type="number" min="1" max="12" value={fields.period_month} onChange={(e) => set('period_month', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
            <label className="block text-xs font-medium text-tertiary-600">Year<input required type="number" value={fields.period_year} onChange={(e) => set('period_year', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
          </div>
          <label className="block text-xs font-medium text-tertiary-600">Jurisdiction<input required value={fields.jurisdiction} onChange={(e) => set('jurisdiction', e.target.value)} placeholder="e.g. GST, TDS, Federal" className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-medium text-tertiary-600">Kind<input required value={fields.kind} onChange={(e) => set('kind', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-tertiary-600">Amount<input required type="number" min="0" step="0.01" value={fields.amount} onChange={(e) => set('amount', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
            <label className="block text-xs font-medium text-tertiary-600">Currency
              <select value={fields.currency} onChange={(e) => set('currency', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
        </form>
      </Drawer>
    </div>
  );
}

/** Accounting sub-hub: Ledger accounts / Journal entries / Reports / Tax records. Admin-only (backend gates the whole module). */
export default function AccountingTab() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('atab') || 'invoicing';
  const tab = SUB_TABS.some((t) => t.key === requested) ? requested : 'invoicing';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-tertiary-200">
        {SUB_TABS.map(({ key, label }) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500'}`} onClick={() => setParams({ section: 'accounting', atab: key })}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'invoicing' && <InvoicingSection />}
      {tab === 'ledger' && <LedgerAccountsSection />}
      {tab === 'journal' && <JournalEntrySection />}
      {tab === 'reports' && <ReportsSection />}
      {tab === 'tax' && <TaxRecordsSection />}
    </div>
  );
}
