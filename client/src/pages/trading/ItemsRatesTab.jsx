import { useState } from 'react';
import { Plus } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { dateLabel, isoDate, money } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import FormDrawer from '../../components/ui/FormDrawer.jsx';
import Pill from '../../components/ui/Pill.jsx';

export function useTradeLookups(enabled = true) {
  const partners = useLiveData(() => apiClient.get('/trading/partners', { params: { limit: 100 } }).then((r) => r.data.data), { enabled });
  const items = useLiveData(() => apiClient.get('/trading/items').then((r) => r.data.data), { enabled });
  return {
    partnerOptions: (partners.data || []).map((p) => ({ value: p.id, label: p.name, hint: `${p.kind} - ${p.status}` })),
    activePartnerOptions: (partners.data || []).filter((p) => p.status === 'active').map((p) => ({ value: p.id, label: p.name, hint: p.kind })),
    itemOptions: (items.data || []).map((i) => ({ value: i.id, label: i.name, hint: i.unit })),
    refreshItems: items.refresh,
  };
}

/** Goods master and per-partner rate cards. A new rate closes the previous one automatically. */
export default function ItemsRatesTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [drawer, setDrawer] = useState(null);
  const [partnerFilter, setPartnerFilter] = useState('');
  const lookups = useTradeLookups();
  const items = useLiveData(() => apiClient.get('/trading/items', { params: { include_inactive: true } }).then((r) => r.data.data));
  const rates = useLiveData(() => apiClient.get('/trading/rates', { params: partnerFilter ? { partner_id: partnerFilter } : {} }).then((r) => r.data.data), { deps: [partnerFilter] });

  async function save(kind, values) {
    try {
      await apiClient.post(kind === 'item' ? '/trading/items' : '/trading/rates', values);
      pushSuccess(kind === 'item' ? 'Item added' : 'Rate added');
      items.refresh();
      rates.refresh();
      lookups.refreshItems();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save'), 'Could not save');
      throw err;
    }
  }

  const today = isoDate();
  const itemCols = [
    { key: 'name', header: 'Item', render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'sku', header: 'SKU', render: (r) => r.sku || '-' },
    { key: 'unit', header: 'Unit' },
    { key: 'category', header: 'Category', render: (r) => r.category || '-' },
    { key: 'hsn_code', header: 'HSN', render: (r) => r.hsn_code || '-' },
  ];
  const rateCols = [
    { key: 'partner', header: 'Partner', render: (r) => <span className="font-medium">{r.partner.name}</span> },
    { key: 'kind', header: 'Type', render: (r) => <Pill value={r.partner.kind} tone="purple" /> },
    { key: 'item', header: 'Item', render: (r) => r.item.name },
    { key: 'rate', header: 'Rate', render: (r) => `${money(r.rate)} ${r.currency} / ${r.item.unit}` },
    { key: 'from', header: 'From', render: (r) => dateLabel(r.effective_from) },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={!r.effective_to || r.effective_to.slice(0, 10) >= today ? 'green' : 'gray'}>{!r.effective_to || r.effective_to.slice(0, 10) >= today ? 'Current' : `Ended ${dateLabel(r.effective_to)}`}</Pill> },
  ];

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center justify-between"><h2 className="font-heading text-sm font-semibold text-tertiary-900">Goods / items</h2><button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setDrawer('item')}><Plus className="h-4 w-4" />New item</button></div>
        <DataTable columns={itemCols} rows={items.data || []} loading={items.loading} emptyLabel="No items yet" />
      </section>
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-sm font-semibold text-tertiary-900">Rate cards</h2>
          <div className="flex gap-2">
            <select value={partnerFilter} onChange={(e) => setPartnerFilter(e.target.value)} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Filter by partner"><option value="">All partners</option>{lookups.partnerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer('rate')}><Plus className="h-4 w-4" />New rate</button>
          </div>
        </div>
        <DataTable columns={rateCols} rows={rates.data || []} loading={rates.loading} emptyLabel="No rate cards yet" />
      </section>

      <FormDrawer open={drawer === 'item'} onClose={() => setDrawer(null)} title="New item" submitLabel="Add item" onSubmit={(v) => save('item', v)} fields={[
        { name: 'name', label: 'Item name', required: true }, { name: 'sku', label: 'SKU' }, { name: 'unit', label: 'Unit', default: 'unit', required: true, hint: 'tonne, bag, kg...' }, { name: 'category', label: 'Category' }, { name: 'hsn_code', label: 'HSN code' },
      ]} />
      <FormDrawer open={drawer === 'rate'} onClose={() => setDrawer(null)} title="New rate card line" submitLabel="Save rate" intro="From the effective date this rate applies and the partner's previous rate for the item is closed the day before." onSubmit={(v) => save('rate', v)} fields={[
        { name: 'partner_id', label: 'Partner', type: 'search', options: lookups.partnerOptions, required: true },
        { name: 'item_id', label: 'Item', type: 'search', options: lookups.itemOptions, required: true },
        { name: 'rate', label: 'Rate per unit', type: 'number', required: true, min: 0 },
        { name: 'currency', label: 'Currency', type: 'select', required: true, default: 'INR', options: ['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP'].map((c) => ({ value: c, label: c })) },
        { name: 'effective_from', label: 'Effective from', type: 'date', required: true, default: today },
        { name: 'effective_to', label: 'Effective to', type: 'date', hint: 'optional' },
      ]} />
    </div>
  );
}
