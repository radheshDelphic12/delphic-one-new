import { Navigate } from 'react-router-dom';
import { useNovarex, nxCan } from '../../lib/novarex/useNovarex.js';
import { useOpsPickers } from '../../lib/novarex/opsPickers.js';
import MasterPage, { statusPill } from '../../components/novarex/ops/MasterPage.jsx';
import { Money } from '../../components/novarex/ops/common.jsx';

const FORM_STATUS = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'discontinued', label: 'Discontinued' }];

/** Product master: pharmaceutical products with tax, price, regulatory and reorder settings. Batches and expiry live under Stock. */
export default function NovarexProductsPage() {
  const { me, loading } = useNovarex();
  const pk = useOpsPickers();
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !nxCan(me, 'products')) return <Navigate to="/novarex" replace />;
  const fields = [
    { key: 'name', label: 'Product name', required: true, span: 2 },
    { key: 'sku', label: 'SKU / product code', placeholder: 'Leave blank to generate' },
    { key: 'barcode', label: 'Barcode' },
    { key: 'brand', label: 'Brand' },
    { key: 'generic_name', label: 'Generic name' },
    { key: 'category_id', label: 'Category', type: 'select', options: pk.productCategories },
    { key: 'manufacturer', label: 'Manufacturer' },
    { key: 'strength', label: 'Composition / strength' },
    { key: 'dosage_form', label: 'Dosage form', placeholder: 'Tablet, syrup, injection...' },
    { key: 'pack_size', label: 'Pack size' },
    { key: 'uom', label: 'Unit of measure', default: 'unit' },
    { key: 'hsn', label: 'HSN code' },
    { key: 'gst_rate', label: 'GST rate %', type: 'num', default: 12, hint: 'Per product: not every medicine has the same rate' },
    { key: 'mrp', label: 'MRP', type: 'num' },
    { key: 'purchase_price', label: 'Purchase price', type: 'num' },
    { key: 'selling_price', label: 'Selling price', type: 'num' },
    { key: 'reorder_level', label: 'Minimum stock (reorder level)', type: 'num' },
    { key: 'shelf_life_days', label: 'Shelf life (days)', type: 'num' },
    { key: 'regulatory_class', label: 'Regulatory classification', placeholder: 'e.g. Schedule H, OTC' },
    { key: 'status', label: 'Status', type: 'select', options: FORM_STATUS, default: 'active', required: true },
    { key: 'requires_prescription', label: 'Requires a prescription', type: 'bool' },
    { key: 'cold_chain', label: 'Cold-chain product', type: 'bool' },
    { key: 'notes', label: 'Notes', type: 'area' },
  ];
  const columns = [
    { key: 'name', header: 'Product', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{r.sku}{r.brand ? ` · ${r.brand}` : ''}{r.generic_name ? ` · ${r.generic_name}` : ''}</span></span> },
    { key: 'form', header: 'Form / pack', render: (r) => [r.dosage_form, r.strength, r.pack_size].filter(Boolean).join(' · ') || '-' },
    { key: 'gst', header: 'GST', render: (r) => `${r.gst_rate}%` },
    { key: 'mrp', header: 'MRP', render: (r) => (r.mrp === null || r.mrp === undefined ? '-' : <Money v={r.mrp} />) },
    { key: 'buy', header: 'Purchase', render: (r) => <Money v={r.purchase_price} /> },
    { key: 'sell', header: 'Selling', render: (r) => <Money v={r.selling_price} /> },
    { key: 'flags', header: 'Handling', render: (r) => [r.requires_prescription ? 'Rx' : null, r.cold_chain ? 'Cold chain' : null].filter(Boolean).join(' · ') || '-' },
    { key: 'status', header: 'Status', render: statusPill },
  ];
  return (
    <div className="mt-4 space-y-4">
      <MasterPage resource="products" singular="Product" columns={columns} fields={fields} canEdit={nxCan(me, 'productsEdit')} statusOptions={['active', 'inactive', 'discontinued']} searchHint="Search name, SKU, brand, generic, manufacturer, barcode, HSN..." onChanged={pk.refresh}
        extraFilters={[{ key: 'category_id', label: 'All categories', options: pk.productCategories }]} intro="Every pharmaceutical product the company buys or sells. Tax rate, regulatory class and cold-chain handling are set per product." />
    </div>
  );
}
