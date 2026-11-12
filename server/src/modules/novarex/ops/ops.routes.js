const express = require('express');
const { ok, fail } = require('../../../utils/response');
const { nxAuthorize } = require('../access');
const { OpsError, ERR, scopeOf } = require('./common');
const masters = require('./masters.service');
const stock = require('./stock.service');
const purchasing = require('./purchasing.service');
const transfers = require('./transfers.service');
const sales = require('./sales.service');
const logistics = require('./logistics.service');
const billing = require('./billing.service');
const returns = require('./returns.service');
const franchise = require('./franchise.service');
const reports = require('./opsReports.service');
const core = require('../core.service');
const prisma = require('../../../config/db');

// Operations API (mounted at /api/v1/novarex/ops). Authorisation is on the server for every call; users bound to outlets
// (outlet_manager, franchise_partner) only ever see their own outlets' records.
const router = express.Router();
const can = nxAuthorize;
const ANY_OPS = ['products', 'stock', 'sales', 'purchasing', 'logistics', 'billing', 'franchise', 'opsReports'];

const W = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof OpsError) {
      const [status, message] = ERR[err.code] || [422, err.code];
      return res.status(status).json({ success: false, message, code: err.code, ...(err.detail ? { detail: err.detail } : {}) });
    }
    return next(err);
  }
};
const org = (req) => req.user.org_id;
const me = (req) => req.user.id;
const ctxOf = (req) => ({ isAdmin: req.nx.role === 'admin', reason: (req.body && req.body.reason) || req.query.reason || undefined });
const scope = (req) => scopeOf(req);
const created = (res, data) => ok(res, data, {}, 201);

// ---------- master data ----------
const MASTER_CAPS = {
  products: [['products', 'stock', 'sales', 'purchasing', 'billing'], ['productsEdit']],
  warehouses: [ANY_OPS, ['stockEdit']],
  suppliers: [['purchasing', 'stock'], ['purchasingEdit']],
  customers: [['sales', 'billing', 'franchise'], ['salesEdit']],
  'logistics-partners': [['logistics', 'sales'], ['logisticsEdit']],
  'rate-cards': [['logistics'], ['logisticsEdit']],
  vehicles: [['logistics'], ['logisticsEdit']],
};
const masterGuard = (write) => (req, res, next) => {
  const caps = MASTER_CAPS[req.params.res];
  if (!caps) return fail(res, 404, 'Unknown resource');
  return can(...caps[write ? 1 : 0])(req, res, next);
};
router.get('/m/:res', masterGuard(false), W(async (req, res) => {
  const sc = scope(req);
  const extra = {};
  if (sc && req.params.res === 'warehouses') extra.outlet_id = { in: sc };
  if (sc && req.params.res === 'customers') extra.outlet_id = { in: sc };
  ok(res, await masters.list(org(req), req.params.res, req.query, extra));
}));
router.get('/m/:res/:id', masterGuard(false), W(async (req, res) => ok(res, await masters.get(org(req), req.params.res, req.params.id))));
router.post('/m/:res', masterGuard(true), W(async (req, res) => created(res, await masters.create(org(req), me(req), req.params.res, req.body))));
router.patch('/m/:res/:id', masterGuard(true), W(async (req, res) => ok(res, await masters.update(org(req), me(req), req.params.res, req.params.id, req.body))));
router.delete('/m/:res/:id', masterGuard(true), W(async (req, res) => ok(res, await masters.archive(org(req), me(req), req.params.res, req.params.id, req.query.reason))));
router.post('/m/:res/:id/restore', masterGuard(true), W(async (req, res) => ok(res, await masters.restore(org(req), me(req), req.params.res, req.params.id))));

// ---------- stock ----------
const whScope = async (req) => { const sc = scope(req); return sc ? (await prisma.nxWarehouse.findMany({ where: { org_id: org(req), outlet_id: { in: sc } }, select: { id: true } })).map((w) => w.id) : undefined; };
router.get('/stock/on-hand', can('stock'), W(async (req, res) => ok(res, await stock.onHand(org(req), { ...req.query, scope_warehouse_ids: await whScope(req) }))));
router.get('/stock/products', can('stock', 'products'), W(async (req, res) => ok(res, await stock.productStock(org(req), req.query))));
router.get('/stock/ledger', can('stock'), W(async (req, res) => ok(res, await stock.ledger(org(req), req.query))));
router.get('/stock/batches', can('stock', 'products'), W(async (req, res) => ok(res, await stock.listBatches(org(req), req.query))));
router.patch('/stock/batches/:id', can('stockEdit', 'productsEdit'), W(async (req, res) => ok(res, await stock.updateBatch(org(req), me(req), req.params.id, req.body))));
router.post('/stock/adjust', can('stockEdit'), W(async (req, res) => created(res, await stock.adjust(org(req), me(req), req.body))));
router.get('/stock/adjustments', can('stock'), W(async (req, res) => ok(res, await stock.listAdjustments(org(req), req.query))));
router.get('/stock/alerts', can('stock'), W(async (req, res) => ok(res, await stock.alerts(org(req), await whScope(req)))));
router.get('/stock/trace/:batchId', can('stock', 'opsReports'), W(async (req, res) => ok(res, await stock.traceBatch(org(req), req.params.batchId))));
router.get('/stock/valuation', can('stock', 'opsReports'), W(async (req, res) => ok(res, await stock.valuation(org(req), { ...req.query, scope_warehouse_ids: await whScope(req) }))));

// ---------- purchasing ----------
router.get('/purchase-orders', can('purchasing'), W(async (req, res) => ok(res, await purchasing.listPO(org(req), req.query))));
router.get('/purchase-orders/:id', can('purchasing'), W(async (req, res) => ok(res, await purchasing.getPO(org(req), req.params.id))));
router.post('/purchase-orders', can('purchasingEdit'), W(async (req, res) => created(res, await purchasing.createPO(org(req), me(req), req.body))));
router.patch('/purchase-orders/:id', can('purchasingEdit'), W(async (req, res) => ok(res, await purchasing.updatePO(org(req), me(req), req.params.id, req.body))));
router.post('/purchase-orders/:id/:action', can('purchasingEdit'), W(async (req, res) => ok(res, await purchasing.actPO(org(req), me(req), req.params.id, req.params.action, req.body && req.body.reason))));
router.get('/receipts', can('purchasing', 'stock'), W(async (req, res) => ok(res, await purchasing.listReceipts(org(req), req.query))));
router.get('/receipts/:id', can('purchasing', 'stock'), W(async (req, res) => ok(res, await purchasing.getReceipt(org(req), req.params.id))));
router.post('/receipts', can('purchasingEdit', 'stockEdit'), W(async (req, res) => created(res, await purchasing.createReceipt(org(req), me(req), req.body))));
router.patch('/receipts/:id', can('purchasingEdit', 'stockEdit'), W(async (req, res) => ok(res, await purchasing.updateReceipt(org(req), me(req), req.params.id, req.body))));
router.post('/receipts/:id/post', can('purchasingEdit', 'stockEdit'), W(async (req, res) => ok(res, await purchasing.postReceipt(org(req), me(req), req.params.id))));
router.delete('/receipts/:id', can('purchasingEdit', 'stockEdit'), W(async (req, res) => ok(res, await purchasing.deleteReceipt(org(req), me(req), req.params.id, req.query.reason))));
router.get('/suppliers/:id/ledger', can('purchasing', 'billing'), W(async (req, res) => ok(res, await purchasing.supplierLedger(org(req), req.params.id))));

// ---------- transfers ----------
router.get('/transfers', can('stock'), W(async (req, res) => ok(res, await transfers.list(org(req), req.query, await whScope(req)))));
router.get('/transfers/:id', can('stock'), W(async (req, res) => ok(res, await transfers.get(org(req), req.params.id))));
router.post('/transfers', can('stockEdit'), W(async (req, res) => created(res, await transfers.create(org(req), me(req), req.body))));
router.patch('/transfers/:id', can('stockEdit'), W(async (req, res) => ok(res, await transfers.update(org(req), me(req), req.params.id, req.body))));
router.post('/transfers/:id/:action', can('stockEdit'), W(async (req, res) => ok(res, await transfers.act(org(req), me(req), req.params.id, req.params.action, req.body))));

// ---------- sales orders ----------
router.get('/orders', can('sales'), W(async (req, res) => ok(res, await sales.list(org(req), req.query, scope(req)))));
router.get('/orders/:id', can('sales'), W(async (req, res) => ok(res, await sales.get(org(req), req.params.id, scope(req)))));
router.post('/orders', can('salesEdit'), W(async (req, res) => created(res, await sales.create(org(req), me(req), req.body, scope(req)))));
router.patch('/orders/:id', can('salesEdit'), W(async (req, res) => ok(res, await sales.update(org(req), me(req), req.params.id, req.body, scope(req)))));
router.post('/orders/:id/confirm', can('salesEdit'), W(async (req, res) => ok(res, await sales.confirm(org(req), me(req), req.params.id, scope(req)))));
router.post('/orders/:id/allocate', can('salesEdit'), W(async (req, res) => ok(res, await sales.allocate(org(req), me(req), req.params.id, scope(req)))));
router.post('/orders/:id/cancel', can('salesEdit'), W(async (req, res) => ok(res, await sales.cancel(org(req), me(req), req.params.id, req.body && req.body.reason, scope(req)))));

// ---------- shipments, freight, trips ----------
router.get('/shipments', can('sales', 'logistics'), W(async (req, res) => ok(res, await logistics.list(org(req), req.query, scope(req)))));
router.get('/shipments/:id', can('sales', 'logistics'), W(async (req, res) => ok(res, await logistics.get(org(req), req.params.id, scope(req)))));
router.post('/shipments', can('logisticsEdit', 'stockEdit'), W(async (req, res) => created(res, await logistics.create(org(req), me(req), req.body, scope(req)))));
router.patch('/shipments/:id', can('logisticsEdit'), W(async (req, res) => ok(res, await logistics.update(org(req), me(req), req.params.id, req.body, ctxOf(req)))));
router.post('/shipments/:id/status', can('logisticsEdit', 'stockEdit', 'salesEdit'), W(async (req, res) => ok(res, await logistics.setStatus(org(req), me(req), req.params.id, req.body && req.body.status, req.body || {}, ctxOf(req), scope(req)))));
router.get('/trips', can('logistics'), W(async (req, res) => ok(res, await logistics.listTrips(org(req), req.query))));
router.post('/trips', can('logisticsEdit'), W(async (req, res) => created(res, await logistics.saveTrip(org(req), me(req), null, req.body, ctxOf(req)))));
router.patch('/trips/:id', can('logisticsEdit'), W(async (req, res) => ok(res, await logistics.saveTrip(org(req), me(req), req.params.id, req.body, ctxOf(req)))));
router.post('/freight/estimate', can('logistics', 'sales'), W(async (req, res) => {
  const card = await prisma.nxRateCard.findFirst({ where: { id: req.body.rate_card_id, org_id: org(req) } });
  ok(res, { estimated_freight: logistics.calcFreight(card, req.body) });
}));

// ---------- invoices, payments ----------
router.get('/invoices', can('billing', 'franchise'), W(async (req, res) => ok(res, await billing.list(org(req), req.query, scope(req)))));
router.get('/invoices/:id', can('billing', 'franchise'), W(async (req, res) => ok(res, await billing.get(org(req), req.params.id, scope(req)))));
router.post('/invoices/from-shipment/:shipmentId', can('billingEdit'), W(async (req, res) => created(res, await billing.invoiceShipment(org(req), me(req), req.params.shipmentId, { ...ctxOf(req), date: req.body && req.body.date }))));
router.post('/invoices/:id/pay', can('billingEdit'), W(async (req, res) => ok(res, await billing.pay(org(req), me(req), req.params.id, req.body, ctxOf(req)))));
router.post('/invoices/:id/cancel', can('billingEdit'), W(async (req, res) => ok(res, await billing.cancel(org(req), me(req), req.params.id, ctxOf(req)))));

// ---------- returns and recalls ----------
router.get('/returns', can('stock', 'sales'), W(async (req, res) => ok(res, await returns.list(org(req), req.query))));
router.post('/returns', can('stockEdit', 'salesEdit'), W(async (req, res) => created(res, await returns.create(org(req), me(req), req.body))));
router.post('/returns/:id/resolve', can('stockEdit', 'billingEdit'), W(async (req, res) => ok(res, await returns.resolve(org(req), me(req), req.params.id, req.body, ctxOf(req)))));
router.get('/recalls', can('stock'), W(async (req, res) => ok(res, await returns.listRecalls(org(req)))));
router.post('/recalls', can('stockEdit'), W(async (req, res) => created(res, await returns.createRecall(org(req), me(req), req.body))));
router.post('/recalls/:id/close', can('stockEdit'), W(async (req, res) => ok(res, await returns.closeRecall(org(req), me(req), req.params.id, req.body))));

// ---------- franchise ----------
router.get('/franchise/agreements', can('franchise'), W(async (req, res) => ok(res, await franchise.list(org(req), req.query, scope(req)))));
router.get('/franchise/agreements/:id', can('franchise'), W(async (req, res) => ok(res, await franchise.get(org(req), req.params.id, scope(req)))));
router.post('/franchise/agreements', can('franchiseEdit'), W(async (req, res) => created(res, await franchise.create(org(req), me(req), req.body))));
router.patch('/franchise/agreements/:id', can('franchiseEdit'), W(async (req, res) => ok(res, await franchise.update(org(req), me(req), req.params.id, req.body))));
router.delete('/franchise/agreements/:id', can('franchiseEdit'), W(async (req, res) => ok(res, await franchise.archive(org(req), me(req), req.params.id, req.query.reason))));
router.get('/franchise/settlements', can('franchise'), W(async (req, res) => ok(res, await franchise.listSettlements(org(req), req.query, scope(req)))));
router.post('/franchise/settlements', can('franchiseEdit'), W(async (req, res) => created(res, await franchise.createSettlement(org(req), me(req), req.body, scope(req)))));
router.patch('/franchise/settlements/:id', can('franchiseEdit'), W(async (req, res) => ok(res, await franchise.updateSettlement(org(req), me(req), req.params.id, req.body))));
router.post('/franchise/settlements/:id/invoice', can('franchiseEdit', 'billingEdit'), W(async (req, res) => created(res, await franchise.invoiceSettlement(org(req), me(req), req.params.id, req.body, ctxOf(req)))));
router.get('/franchise/report/:outletId', can('franchise'), W(async (req, res) => ok(res, await franchise.report(org(req), req.params.outletId, scope(req), req.query))));

// ---------- dashboard and reports ----------
router.get('/dashboard', can('opsReports'), W(async (req, res) => ok(res, await reports.dashboard(org(req), req.query, scope(req)))));
router.get('/reports', can('opsReports'), W(async (req, res) => ok(res, reports.REPORTS.map(([key, label]) => ({ key, label })))));
router.get('/reports/:name', can('opsReports'), W(async (req, res) => ok(res, await reports.report(org(req), req.params.name, req.query, scope(req)))));
router.get('/settings', can('opsReports', 'settings'), W(async (req, res) => ok(res, await core.getSettings(org(req)))));

module.exports = router;
