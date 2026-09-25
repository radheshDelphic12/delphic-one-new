import { useState } from 'react';
import axios from 'axios';
import { FileSpreadsheet, KeyRound, ShieldCheck } from 'lucide-react';

const REPORTS = [
  { key: 'trial-balance', label: 'Trial balance' },
  { key: 'profit-and-loss', label: 'Profit & loss' },
  { key: 'balance-sheet', label: 'Balance sheet' },
  { key: 'tax-records', label: 'Tax records' },
];

function money(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Read-only CA/Legal guest portal. Deliberately outside the app's normal
 * login/AppLayout shell — a reviewer has no user account, just a bearer
 * token an admin issued from Finance → External Access. Uses a bare axios
 * instance (not the app's apiClient) so the token never touches the normal
 * JWT refresh/redirect-to-login machinery.
 */
export default function GuestPortalPage() {
  const [token, setToken] = useState('');
  const [connected, setConnected] = useState(false);
  const [reportType, setReportType] = useState('trial-balance');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadReport(type) {
    setLoading(true);
    setError('');
    try {
      const client = axios.create({ baseURL: '/api/v1', headers: { Authorization: `Bearer ${token.trim()}` } });
      const params = type === 'profit-and-loss' ? { from: new Date(new Date().setMonth(new Date().getMonth() - 3)).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) } : {};
      const { data } = await client.get(`/external-access/guest/accounting/${type}`, { params });
      setReport(data.data);
      setReportType(type);
      setConnected(true);
    } catch (err) {
      setConnected(false);
      setReport(null);
      setError(err.response?.data?.message || 'That token is invalid, expired, or revoked.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-3xl space-y-5">
        <div className="flex items-center gap-3">
          <img src="/Delphic_D-logo_transparent.png" alt="Delphic" className="h-10 w-10 object-contain" />
          <div>
            <h1 className="font-heading text-xl font-bold text-tertiary-900">Guest access — accounting reports</h1>
            <p className="text-sm text-tertiary-500">Read-only, for CA / legal / audit reviewers with a granted access token.</p>
          </div>
        </div>

        {!connected && (
          <form onSubmit={(e) => { e.preventDefault(); loadReport('trial-balance'); }} className="rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card">
            <label className="block text-xs font-medium text-tertiary-600">
              Access token
              <div className="mt-1 flex items-center gap-2 rounded-xl border px-3 py-2">
                <KeyRound className="h-4 w-4 text-tertiary-400" />
                <input
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="ext_..."
                  className="w-full text-sm outline-none"
                />
              </div>
            </label>
            {error && <p className="mt-2 text-sm text-danger-600">{error}</p>}
            <button type="submit" disabled={loading || !token.trim()} className="btn-primary mt-4 inline-flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> {loading ? 'Verifying…' : 'View reports'}
            </button>
          </form>
        )}

        {connected && (
          <div className="rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-tertiary-100 pb-3">
              <div className="flex flex-wrap gap-1">
                {REPORTS.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${reportType === r.key ? 'bg-primary-50 text-primary-700' : 'text-tertiary-500 hover:bg-tertiary-50'}`}
                    onClick={() => loadReport(r.key)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <button type="button" className="text-xs text-tertiary-400 hover:underline" onClick={() => { setConnected(false); setReport(null); }}>Use a different token</button>
            </div>

            <div className="mt-4">
              {loading && <p className="text-sm text-tertiary-400">Loading…</p>}
              {!loading && reportType === 'trial-balance' && report && (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase text-tertiary-400"><th className="py-1">Account</th><th>Kind</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th></tr></thead>
                  <tbody>
                    {report.accounts.map((r) => (
                      <tr key={r.ledger_account_id} className="border-t border-tertiary-100">
                        <td className="py-1.5">{r.name}</td>
                        <td className="capitalize text-tertiary-500">{r.kind}</td>
                        <td className="text-right">{money(r.debit_total)}</td>
                        <td className="text-right">{money(r.credit_total)}</td>
                        <td className="text-right font-medium">{money(r.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!loading && reportType === 'profit-and-loss' && report && (
                <>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs uppercase text-tertiary-400"><th className="py-1">Account</th><th>Kind</th><th className="text-right">Amount</th></tr></thead>
                    <tbody>
                      {report.lines.map((r) => (
                        <tr key={r.ledger_account_id} className="border-t border-tertiary-100">
                          <td className="py-1.5">{r.name}</td>
                          <td className="capitalize text-tertiary-500">{r.kind}</td>
                          <td className="text-right">{money(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-3 text-sm font-medium text-tertiary-800">Revenue {money(report.total_revenue)} · Expense {money(report.total_expense)} · Net profit {money(report.net_profit)}</p>
                </>
              )}
              {!loading && reportType === 'balance-sheet' && report && (
                <div className="grid gap-4 sm:grid-cols-3">
                  {['assets', 'liabilities', 'equity'].map((section) => (
                    <div key={section}>
                      <h4 className="mb-1 text-xs font-semibold uppercase text-tertiary-400 capitalize">{section}</h4>
                      <ul className="space-y-1 text-sm">
                        {report[section].map((r) => <li key={r.ledger_account_id} className="flex justify-between"><span>{r.name}</span><span>{money(r.balance)}</span></li>)}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
              {!loading && reportType === 'tax-records' && report && (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase text-tertiary-400"><th className="py-1">Period</th><th>Jurisdiction</th><th>Kind</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    {report.data.map((r) => (
                      <tr key={r.id} className="border-t border-tertiary-100">
                        <td className="py-1.5">{r.period_month}/{r.period_year}</td>
                        <td>{r.jurisdiction}</td>
                        <td>{r.kind}</td>
                        <td className="text-right">{r.currency} {money(r.amount)}</td>
                        <td className="capitalize">{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!loading && report && (reportType === 'trial-balance' ? report.accounts.length === 0 : reportType === 'profit-and-loss' ? report.lines.length === 0 : reportType === 'tax-records' ? report.data.length === 0 : false) && (
                <p className="flex items-center gap-2 py-6 text-sm text-tertiary-400"><FileSpreadsheet className="h-4 w-4" /> No data for this report yet.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
