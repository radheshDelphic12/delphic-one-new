import { useCallback, useEffect, useState } from 'react';
import { nxApi } from './api.js';

/** Option lists for the operations forms and filters (products, locations, parties, partners, vehicles). Each list loads only what the caller may read. */
export function useOpsPickers() {
  const [s, setS] = useState({ warehouses: [], products: [], suppliers: [], customers: [], partners: [], rateCards: [], vehicles: [], productCategories: [], raw: {} });
  const load = useCallback(() => {
    const m = (res) => nxApi.ops.master(res).list({}).catch(() => []);
    Promise.all([m('warehouses'), m('products'), m('suppliers'), m('customers'), m('logistics-partners'), m('rate-cards'), m('vehicles'), nxApi.categories('product_category').catch(() => [])]).then(([wh, pr, su, cu, pa, rc, ve, pc]) => {
      setS({
        warehouses: wh.filter((w) => w.status === 'active').map((w) => ({ value: w.id, label: `${w.name}${w.city ? ` (${w.city})` : ''}` })),
        products: pr.filter((p) => p.status === 'active').map((p) => ({ value: p.id, label: `${p.sku} ${p.name}` })),
        suppliers: su.filter((x) => x.status === 'active').map((x) => ({ value: x.id, label: x.name })),
        customers: cu.filter((x) => x.status === 'active').map((x) => ({ value: x.id, label: x.name })),
        partners: pa.filter((x) => x.status === 'active').map((x) => ({ value: x.id, label: x.name })),
        rateCards: rc.filter((x) => x.active).map((x) => ({ value: x.id, label: x.name, partner_id: x.partner_id })),
        vehicles: ve.filter((x) => x.status !== 'inactive').map((x) => ({ value: x.id, label: `${x.reg_no}${x.driver_name ? ` · ${x.driver_name}` : ''}` })),
        productCategories: pc.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name })),
        raw: { products: pr, warehouses: wh, customers: cu },
      });
    });
  }, []);
  useEffect(() => { load(); }, [load]);
  return { ...s, refresh: load };
}
