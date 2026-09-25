import { useState } from 'react';
import { Plus } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { dateLabel, money, titleCase } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import FormDrawer from '../../components/ui/FormDrawer.jsx';
import Pill from '../../components/ui/Pill.jsx';

const CHECKLIST = [
  ['kyc_done', 'KYC / documents verified'],
  ['agreement_signed', 'Agreement signed'],
  ['rate_card_agreed', 'Rate card agreed'],
  ['bank_details_received', 'Bank details received'],
];

const PARTNER_FIELDS = [
  { name: 'kind', label: 'Type', type: 'select', required: true, options: [{ value: 'supplier', label: 'Supplier' }, { value: 'consumer', label: 'Consumer' }] },
  { name: 'name', label: 'Company name', required: true },
  { name: 'contact_name', label: 'Contact person' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'phone', label: 'Phone' },
  { name: 'city', label: 'City' },
  { name: 'gst_or_tax_id', label: 'GST / tax ID' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

function PartnerDrawer({ partnerId, onClose, onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const { data, loading, refresh } = useLiveData(() => apiClient.get(`/trading/partners/${partnerId}`).then((r) => r.data.data), { enabled: Boolean(partnerId), deps: [partnerId] });
  const partner = data?.partner;

  async function patch(body, okMessage) {
    try {
      await apiClient.patch(`/trading/partners/${partnerId}`, body);
      if (okMessage) pushSuccess(okMessage);
      refresh();
      onChanged();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Update failed'), 'Could not update partner');
    }
  }

  const checklist = partner?.onboarding_checklist || {};
  const complete = CHECKLIST.every(([key]) => checklist[key] === true);

  return (
    <Drawer open={Boolean(partnerId)} title={partner?.name || 'Partner'} onClose={onClose} size="lg" tone="info">
      {loading && !partner ? <p className="text-sm text-tertiary-500">Loading...</p> : partner && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Pill value={partner.kind} tone="purple" />
            <Pill value={partner.status} />
            <Pill value={partner.trading_status} />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {[['Contact', partner.contact_name], ['Email', partner.email], ['Phone', partner.phone], ['City', partner.city], ['Tax ID', partner.gst_or_tax_id], ['Owner', partner.owner?.name], ['Onboarded', partner.onboarded_at ? dateLabel(partner.onboarded_at) : null]].map(([k, v]) => (
              <div key={k}><dt className="text-xs text-tertiary-500">{k}</dt><dd className="text-tertiary-900">{v || '-'}</dd></div>
            ))}
          </dl>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-tertiary-900">Onboarding checklist</h3>
            <div className="space-y-1.5">
              {CHECKLIST.map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm text-tertiary-700">
                  <input type="checkbox" checked={checklist[key] === true} disabled={partner.status === 'active' || partner.status === 'inactive'} onChange={(e) => patch({ onboarding_checklist: { [key]: e.target.checked } })} />
                  {label}
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {partner.status === 'lead' && <button type="button" className="btn-secondary" onClick={() => patch({ status: 'onboarding' }, 'Moved to onboarding')}>Start onboarding</button>}
              {(partner.status === 'lead' || partner.status === 'onboarding') && <button type="button" className="btn-primary" disabled={!complete} title={complete ? '' : 'Tick every step first'} onClick={() => patch({ status: 'active' }, 'Partner activated')}>Activate</button>}
              {partner.status === 'active' && (
                <>
                  <select value={partner.trading_status} onChange={(e) => patch({ trading_status: e.target.value })} className="rounded-xl border px-2 py-1.5 text-sm" aria-label="Trading status">
                    <option value="not_trading">Not trading</option><option value="trading">Trading</option><option value="paused">Paused</option>
                  </select>
                  <button type="button" className="btn-secondary" onClick={() => patch({ status: 'inactive' }, 'Partner deactivated')}>Deactivate</button>
                </>
              )}
              {partner.status === 'inactive' && <button type="button" className="btn-secondary" onClick={() => patch({ status: 'onboarding' })}>Re-onboard</button>}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-tertiary-900">Rate card</h3>
            <DataTable embedded emptyLabel="No rates yet. Add them under Items & rate cards."
              columns={[{ key: 'item', header: 'Item', render: (r) => r.item.name }, { key: 'rate', header: `Rate / unit`, render: (r) => `${money(r.rate)} ${r.currency}` }, { key: 'from', header: 'From', render: (r) => dateLabel(r.effective_from) }, { key: 'to', header: 'To', render: (r) => (r.effective_to ? dateLabel(r.effective_to) : 'Current') }]}
              rows={data.rate_card} />
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-tertiary-900">Recent transactions</h3>
            <DataTable embedded emptyLabel="No transactions yet"
              columns={[{ key: 'd', header: 'Date', render: (r) => dateLabel(r.txn_date) }, { key: 'i', header: 'Item', render: (r) => r.item.name }, { key: 'q', header: 'Qty', render: (r) => r.quantity }, { key: 'a', header: 'Amount', render: (r) => money(r.amount) }, { key: 's', header: 'Status', render: (r) => <Pill value={r.status} /> }]}
              rows={data.recent_transactions} />
          </section>
        </div>
      )}
    </Drawer>
  );
}

export default function PartnersTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [filters, setFilters] = useState({ kind: '', status: '', search: '' });
  const [create, setCreate] = useState(false);
  const [openId, setOpenId] = useState(null);
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const list = useLiveData(() => apiClient.get('/trading/partners', { params }).then((r) => r.data.data), { deps: [filters.kind, filters.status, filters.search] });

  async function createPartner(values) {
    try {
      await apiClient.post('/trading/partners', values);
      pushSuccess('Partner added as a lead');
      list.refresh();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to add partner'), 'Could not save');
      throw err;
    }
  }

  const cols = [
    { key: 'name', header: 'Partner', render: (r) => <span className="font-medium text-tertiary-900">{r.name}</span> },
    { key: 'kind', header: 'Type', render: (r) => <Pill value={r.kind} tone="purple" /> },
    { key: 'city', header: 'City', render: (r) => r.city || '-' },
    { key: 'status', header: 'Status', render: (r) => <Pill value={r.status} /> },
    { key: 'trading_status', header: 'Trading', render: (r) => <Pill value={r.trading_status} /> },
    { key: 'checklist', header: 'Onboarding', render: (r) => `${CHECKLIST.filter(([k]) => r.onboarding_checklist?.[k]).length}/${CHECKLIST.length}` },
    { key: 'owner', header: 'Owner', render: (r) => r.owner?.name || '-' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <input value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} placeholder="Search partners" className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Search partners" />
          <select value={filters.kind} onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value }))} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Type"><option value="">All types</option><option value="supplier">Suppliers</option><option value="consumer">Consumers</option></select>
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Status"><option value="">All statuses</option>{['lead', 'onboarding', 'active', 'inactive'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</select>
        </div>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setCreate(true)}><Plus className="h-4 w-4" />New partner</button>
      </div>
      <DataTable columns={cols} rows={list.data || []} loading={list.loading} onRowClick={(r) => setOpenId(r.id)} emptyLabel="No partners yet" />
      <FormDrawer open={create} onClose={() => setCreate(false)} title="New supplier / consumer" submitLabel="Add lead" onSubmit={createPartner} fields={PARTNER_FIELDS} />
      <PartnerDrawer partnerId={openId} onClose={() => setOpenId(null)} onChanged={list.refresh} />
    </div>
  );
}
