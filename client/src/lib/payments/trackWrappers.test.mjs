// Every company's payment wrapper asks "track in a wallet?" with the right kind, record id and amount, given the response shape the
// real server sends (checked against each module's routes). Run: node --test --experimental-test-module-mocks src/lib/payments/trackWrappers.test.mjs
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const U = (p) => new URL(p, import.meta.url).href;
let respond = {};
const calls = [];
const reply = (data) => Promise.resolve({ data: { data } });
const fakeClient = {
  post: (url, body) => { calls.push(['post', url, body]); return reply(respond[url] ?? {}); },
  put: (url, body) => { calls.push(['put', url, body]); return reply(respond[url] ?? {}); },
  get: () => reply({}),
  patch: () => reply({}),
  delete: () => reply({}),
};
mock.module(U('../apiClient.js'), { defaultExport: fakeClient });

const { registerTrackHandler } = await import('./trackInWallet.js');
const { zephyrApi: zxApi } = await import('../zephyr/api.js');
const { gulatiApi: guApi } = await import('../gulati/api.js');
const { acconcyApi: axApi } = await import('../acconcy/api.js');
const { nxApi } = await import('../novarex/api.js');
const { fxApi } = await import('../foundation/api.js');
const { zkApi } = await import('../zklyrera/api.js');
const { vtApi } = await import('../valterra/api.js');

let asked = [];
registerTrackHandler(async (cfg) => { asked.push(cfg); return { ok: true }; });
const run = async (fn, response, url) => {
  asked = [];
  respond = url ? { [url]: response } : {};
  await fn();
  return asked;
};
const D = '11111111-1111-4111-8111-111111111111';

test('Zephyr: rent is tracked by the due (the response is the due), salary by its record, group expense once for the whole amount', async () => {
  let a = await run(() => zxApi.payRent(D, { amount: 500, paid_on: '2026-10-01' }), { id: D, amount: 1000 }, `/zephyr/rent/dues/${D}/payments`);
  assert.deepEqual(a.map((x) => [x.kind, x.reference_id, x.amount]), [['rent_payment', D, 500]]);
  a = await run(() => zxApi.paySalary(D), { id: D, net: 42000 }, `/zephyr/salaries/${D}/pay`);
  assert.deepEqual(a.map((x) => [x.kind, x.reference_id, x.amount]), [['salary', D, 42000]]);
  a = await run(() => zxApi.createGroupExpense({ amount: 900, tax: 100, allocations: [{}, {}] }), { group_id: D, entries: [{}, {}] }, '/zephyr/ledger/group-expenses');
  assert.deepEqual(a.map((x) => [x.kind, x.reference_id, x.amount]), [['group_expense', D, 1000]]);
  a = await run(() => zxApi.createEntry({ type: 'revenue', amount: 300 }), { id: D }, '/zephyr/ledger');
  assert.deepEqual(a.map((x) => [x.kind, x.reference_id, x.amount]), [['ledger_income', D, 300]]);
  a = await run(() => zxApi.createEntry({ type: 'expense', amount: 80, tax: 20 }), { id: D }, '/zephyr/ledger');
  assert.deepEqual(a.map((x) => [x.kind, x.amount]), [['ledger_expense', 100]]);
});

test('Gulati: vendor payment out, client payment in, ledger entries by type', async () => {
  let a = await run(() => guApi.payPurchase(D, D, { amount: 250 }), { id: D }, `/gulati/deals/${D}/purchases/${D}/payments`);
  assert.deepEqual(a.map((x) => [x.kind, x.reference_id, x.amount]), [['deal_vendor_payment', D, 250]]);
  a = await run(() => guApi.paySale(D, D, { amount: 600 }), { id: D }, `/gulati/deals/${D}/sales/${D}/payments`);
  assert.deepEqual(a.map((x) => [x.kind, x.amount]), [['deal_client_payment', 600]]);
  a = await run(() => guApi.createEntry({ type: 'revenue', amount: 10 }), { id: D }, '/gulati/ledger');
  assert.equal(a[0].kind, 'ledger_income');
});

test('Acconcy: funding by the investee, salary from the record the server returns, ledger entries', async () => {
  let a = await run(() => axApi.fundInvestee(D, { amount: 100000 }), { id: D }, `/acconcy/investees/${D}/fund`);
  assert.deepEqual(a.map((x) => [x.kind, x.reference_id, x.amount]), [['investee_funding', D, 100000]]);
  a = await run(() => axApi.paySalary(D, {}), { id: D, net: 31000 }, `/acconcy/salaries/${D}/pay`);
  assert.deepEqual(a.map((x) => [x.kind, x.amount]), [['salary', 31000]]);
  a = await run(() => axApi.createEntry({ type: 'expense', amount: 5 }), { id: D }, '/acconcy/ledger');
  assert.equal(a[0].kind, 'ledger_expense');
});

test('Novarex: a sales / franchise invoice is money in, a purchase invoice is money out', async () => {
  let a = await run(() => nxApi.ops.pay(D, { amount: 700 }), { id: D, type: 'sales' }, `/novarex/ops/invoices/${D}/pay`);
  assert.deepEqual(a.map((x) => [x.kind, x.reference_id, x.amount]), [['invoice_payment', D, 700]]);
  a = await run(() => nxApi.ops.pay(D, { amount: 90 }), { id: D, type: 'purchase' }, `/novarex/ops/invoices/${D}/pay`);
  assert.deepEqual(a.map((x) => [x.kind, x.amount]), [['ledger_expense', 90]]);
});

test('Foundation, Zklyrera, Valterra: only money that actually moved is asked about', async () => {
  let a = await run(() => fxApi.createEntry({ kind: 'expense', amount: 40 }), { id: D, amount: 40 }, '/foundation/entries');
  assert.deepEqual(a.map((x) => [x.kind, x.amount]), [['ledger_expense', 40]]);
  a = await run(() => fxApi.createEntry({ kind: 'funding', amount: 900 }), { id: D, amount: 900 }, '/foundation/entries');
  assert.deepEqual(a.map((x) => [x.kind, x.amount]), [['other_in', 900]]);
  a = await run(() => fxApi.createEntry({ kind: 'transfer', amount: 5 }), { id: D, amount: 5 }, '/foundation/entries');
  assert.equal(a.length, 0);
  for (const [api, base] of [[zkApi, 'zklyrera'], [vtApi, 'valterra']]) {
    a = await run(() => api.createEntry({ kind: 'income', amount: 70, payment_status: 'paid' }), { id: D, amount: 70 }, `/${base}/entries`);
    assert.deepEqual(a.map((x) => [x.kind, x.amount]), [['ledger_income', 70]]);
    a = await run(() => api.createEntry({ kind: 'expense', amount: 20, payment_status: 'pending' }), { id: D, amount: 20 }, `/${base}/entries`);
    assert.equal(a.length, 0); // not paid yet: nothing moved
    a = await run(() => api.createEntry({ kind: 'transfer', amount: 20 }), { id: D, amount: 20 }, `/${base}/entries`);
    assert.equal(a.length, 0);
  }
});
