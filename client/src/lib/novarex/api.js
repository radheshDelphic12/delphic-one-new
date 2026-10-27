import { trackInWallet } from '../payments/trackInWallet.js';
import apiClient from '../apiClient.js';

// Thin wrapper over the Novarex Pharmaceuticals API (/api/v1/novarex). Every call returns the unwrapped `data` payload.
const unwrap = (res) => res.data.data;
const clean = (params) => Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined));
const get = (path, params) => apiClient.get(`/novarex${path}`, { params: clean(params) }).then(unwrap);
const getPage = (path, params) => apiClient.get(`/novarex${path}`, { params: clean(params) }).then((res) => res.data);
const post = (path, body) => apiClient.post(`/novarex${path}`, body || {}).then(unwrap);
const patch = (path, body) => apiClient.patch(`/novarex${path}`, body).then(unwrap);
const del = (path, params) => apiClient.delete(`/novarex${path}`, { params: clean(params) }).then(unwrap);

const ops = (p) => `/ops${p}`;
const crud = (res) => ({
  list: (params) => get(ops(`/m/${res}`), params),
  create: (body) => post(ops(`/m/${res}`), body),
  update: (id, body) => patch(ops(`/m/${res}/${id}`), body),
  archive: (id, reason) => del(ops(`/m/${res}/${id}`), reason ? { reason } : {}),
  restore: (id) => post(ops(`/m/${res}/${id}/restore`), {}),
});

export const nxApi = {
  ops: {
    master: (res) => crud(res),
    dashboard: (params) => get(ops('/dashboard'), params),
    reportList: () => get(ops('/reports')),
    report: (name, params) => get(ops(`/reports/${name}`), params),
    onHand: (params) => get(ops('/stock/on-hand'), params),
    productStock: (params) => get(ops('/stock/products'), params),
    ledger: (params) => get(ops('/stock/ledger'), params),
    batches: (params) => get(ops('/stock/batches'), params),
    updateBatch: (id, body) => patch(ops(`/stock/batches/${id}`), body),
    adjust: (body) => post(ops('/stock/adjust'), body),
    adjustments: (params) => get(ops('/stock/adjustments'), params),
    alerts: () => get(ops('/stock/alerts')),
    trace: (batchId) => get(ops(`/stock/trace/${batchId}`)),
    valuation: (params) => get(ops('/stock/valuation'), params),
    pos: (params) => get(ops('/purchase-orders'), params),
    po: (id) => get(ops(`/purchase-orders/${id}`)),
    createPo: (body) => post(ops('/purchase-orders'), body),
    updatePo: (id, body) => patch(ops(`/purchase-orders/${id}`), body),
    actPo: (id, action, body) => post(ops(`/purchase-orders/${id}/${action}`), body),
    receipts: (params) => get(ops('/receipts'), params),
    receipt: (id) => get(ops(`/receipts/${id}`)),
    createReceipt: (body) => post(ops('/receipts'), body),
    updateReceipt: (id, body) => patch(ops(`/receipts/${id}`), body),
    postReceipt: (id) => post(ops(`/receipts/${id}/post`), {}),
    deleteReceipt: (id, reason) => del(ops(`/receipts/${id}`), reason ? { reason } : {}),
    supplierLedger: (id) => get(ops(`/suppliers/${id}/ledger`)),
    transfers: (params) => get(ops('/transfers'), params),
    transfer: (id) => get(ops(`/transfers/${id}`)),
    createTransfer: (body) => post(ops('/transfers'), body),
    updateTransfer: (id, body) => patch(ops(`/transfers/${id}`), body),
    actTransfer: (id, action, body) => post(ops(`/transfers/${id}/${action}`), body),
    orders: (params) => get(ops('/orders'), params),
    order: (id) => get(ops(`/orders/${id}`)),
    createOrder: (body) => post(ops('/orders'), body),
    updateOrder: (id, body) => patch(ops(`/orders/${id}`), body),
    actOrder: (id, action, body) => post(ops(`/orders/${id}/${action}`), body),
    shipments: (params) => get(ops('/shipments'), params),
    shipment: (id) => get(ops(`/shipments/${id}`)),
    createShipment: (body) => post(ops('/shipments'), body),
    updateShipment: (id, body) => patch(ops(`/shipments/${id}`), body),
    shipmentStatus: (id, body) => post(ops(`/shipments/${id}/status`), body),
    trips: (params) => get(ops('/trips'), params),
    saveTrip: (id, body) => (id ? patch(ops(`/trips/${id}`), body) : post(ops('/trips'), body)),
    estimateFreight: (body) => post(ops('/freight/estimate'), body),
    invoices: (params) => get(ops('/invoices'), params),
    invoice: (id) => get(ops(`/invoices/${id}`)),
    invoiceShipment: (shipmentId, body) => post(ops(`/invoices/from-shipment/${shipmentId}`), body),
    pay: async (id, body) => {
      const r = await post(ops(`/invoices/${id}/pay`), body);
      await trackInWallet({ kind: 'invoice_payment', reference_id: id, amount: body?.amount, title: 'Invoice payment received', category: 'Invoice payment' });
      return r;
    },
    cancelInvoice: (id, body) => post(ops(`/invoices/${id}/cancel`), body),
    returns: (params) => get(ops('/returns'), params),
    createReturn: (body) => post(ops('/returns'), body),
    resolveReturn: (id, body) => post(ops(`/returns/${id}/resolve`), body),
    recalls: () => get(ops('/recalls')),
    createRecall: (body) => post(ops('/recalls'), body),
    closeRecall: (id, body) => post(ops(`/recalls/${id}/close`), body),
    agreements: (params) => get(ops('/franchise/agreements'), params),
    createAgreement: (body) => post(ops('/franchise/agreements'), body),
    updateAgreement: (id, body) => patch(ops(`/franchise/agreements/${id}`), body),
    archiveAgreement: (id, reason) => del(ops(`/franchise/agreements/${id}`), reason ? { reason } : {}),
    settlements: (params) => get(ops('/franchise/settlements'), params),
    createSettlement: (body) => post(ops('/franchise/settlements'), body),
    updateSettlement: (id, body) => patch(ops(`/franchise/settlements/${id}`), body),
    invoiceSettlement: (id, body) => post(ops(`/franchise/settlements/${id}/invoice`), body),
    franchiseReport: (outletId, params) => get(ops(`/franchise/report/${outletId}`), params),
  },
  me: () => get('/me'),
  settings: () => get('/settings'),
  updateSettings: (body) => patch('/settings', body),
  categories: (scope) => get('/categories', scope ? { scope } : {}),
  createCategory: (body) => post('/categories', body),
  updateCategory: (id, body) => patch(`/categories/${id}`, body),
  deleteCategory: (id) => del(`/categories/${id}`),
  audit: (params) => get('/audit', params),
  users: (params) => get('/users', params),
  createUser: (body) => post('/users', body),
  updateUser: (id, body) => patch(`/users/${id}`, body),
  setUserActive: (id, body) => post(`/users/${id}/status`, body),

  outlets: (params) => get('/outlets', params),
  outlet: (id) => get(`/outlets/${id}`),
  createOutlet: (body) => post('/outlets', body),
  updateOutlet: (id, body) => patch(`/outlets/${id}`, body),
  outletDashboard: (id, params) => get(`/outlets/${id}/dashboard`, params),

  people: (params) => get('/people', params),
  createPerson: (body) => post('/people', body),
  updatePerson: (id, body) => patch(`/people/${id}`, body),
  deletePerson: (id) => del(`/people/${id}`),

  investments: (params) => getPage('/investments', params),
  investment: (id) => get(`/investments/${id}`),
  createInvestment: (body) => post('/investments', body),
  updateInvestment: (id, body) => patch(`/investments/${id}`, body),
  deleteInvestment: (id, reason) => del(`/investments/${id}`, reason ? { reason } : {}),
  addReturn: (id, body) => post(`/investments/${id}/returns`, body),
  updateReturn: (id, body) => patch(`/returns/${id}`, body),
  deleteReturn: (id, reason) => del(`/returns/${id}`, reason ? { reason } : {}),

  entries: (params) => getPage('/entries', params),
  createEntry: (body) => post('/entries', body),
  updateEntry: (id, body) => patch(`/entries/${id}`, body),
  deleteEntry: (id, reason) => del(`/entries/${id}`, reason ? { reason } : {}),

  projections: (params) => get('/projections', params),
  projectionCompare: (params) => get('/projections/compare', params),
  createProjection: (body) => post('/projections', body),
  updateProjection: (id, body) => patch(`/projections/${id}`, body),
  deleteProjection: (id) => del(`/projections/${id}`),

  dashboard: (params) => get('/dashboard', params),
  monthlyReport: (params) => get('/monthly-report', params),
  transactions: (params) => getPage('/transactions', params),
  report: (params) => get('/reports', params),
  valuation: (params) => get('/finance/valuation', params),
  periods: () => get('/finance/periods'),
  closeMonth: (month, body) => post(`/finance/periods/${month}/close`, body),
  reopenMonth: (month, body) => post(`/finance/periods/${month}/reopen`, body),
};

/** The message to show for a failed call. */
export function novarexError(error, fallback = 'Something went wrong') {
  const data = error?.response?.data;
  return data?.errors?.[0]?.message || data?.message || fallback;
}
