import { useEffect, useState } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';

function defaultExpiry() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

function grantStatus(grant) {
  if (grant.revoked_at) return 'revoked';
  if (new Date(grant.expires_at) < new Date()) return 'expired';
  return 'active';
}

/**
 * Guest/CA portal admin side: grant a read-only accounting-report token to
 * an external Legal/CA reviewer, and revoke it. The plaintext token is
 * shown exactly once, in the create response — copy it into the email you
 * send the reviewer, along with the link to the Guest Access page.
 */
export default function ExternalAccessTab() {
  const { pushError, pushInfo } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [expiresAt, setExpiresAt] = useState(defaultExpiry());
  const [saving, setSaving] = useState(false);
  const [issuedToken, setIssuedToken] = useState(null);

  function load() {
    setLoading(true);
    apiClient.get('/external-access').then(({ data }) => setRows(data.data || [])).catch((err) => pushError(apiErrorMessage(err, 'Failed to load access grants'), 'Something went wrong')).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const { data } = await apiClient.post('/external-access', { email: email.trim(), resources: ['accounting'], expires_at: expiresAt });
      setIssuedToken(data.data.token);
      setEmail('');
      setDrawerOpen(false);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to grant access'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function revoke(row) {
    try {
      await apiClient.post(`/external-access/${row.id}/revoke`);
      pushInfo('Access revoked');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to revoke access'), 'Something went wrong');
    }
  }

  const columns = [
    { key: 'email', header: 'Email' },
    { key: 'resources', header: 'Scope', render: (row) => (row.scope?.resources || []).join(', ') },
    { key: 'expires', header: 'Expires', render: (row) => new Date(row.expires_at).toLocaleDateString() },
    { key: 'used', header: 'Last used', render: (row) => (row.last_used_at ? new Date(row.last_used_at).toLocaleString() : 'Never') },
    { key: 'status', header: 'Status', render: (row) => <Badge value={grantStatus(row)} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (!row.revoked_at ? <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => revoke(row)}>Revoke</button> : null),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setDrawerOpen(true)}><Plus className="h-4 w-4" /> Grant CA/Legal access</button>
      </div>

      {issuedToken && (
        <div className="rounded-2xl border border-success-100 bg-success-50 px-4 py-3 text-sm text-success-800">
          <p className="font-medium">Access granted — copy this token now, it won&apos;t be shown again:</p>
          <p className="mt-1 break-all font-mono text-xs">{issuedToken}</p>
          <p className="mt-1 text-xs text-success-700">Share it with the reviewer along with the Guest Access page link. They paste it there to view read-only accounting reports.</p>
        </div>
      )}

      {!loading && rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No external access granted" description="Grant a CA or legal reviewer read-only access to accounting reports." />
      ) : (
        <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No access grants." />
      )}

      <Drawer open={drawerOpen} title="Grant CA/Legal access" onClose={() => setDrawerOpen(false)} size="sm" tone="create" footer={
        <>
          <button type="button" className="btn-secondary" onClick={() => setDrawerOpen(false)} disabled={saving}>Cancel</button>
          <button type="submit" form="external-access-form" className="btn-primary" disabled={saving || !email.trim() || !expiresAt}>{saving ? 'Granting…' : 'Grant access'}</button>
        </>
      }>
        <form id="external-access-form" onSubmit={submit} className="space-y-3">
          <label className="block text-xs font-medium text-tertiary-600">Reviewer email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-medium text-tertiary-600">Expires<input required type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
          <p className="text-xs text-tertiary-500">Scope is read-only accounting reports (trial balance, P&amp;L, balance sheet, tax records) — the only guest resource supported today.</p>
        </form>
      </Drawer>
    </div>
  );
}
