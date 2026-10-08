// Finance-set exchange rates: how many INR one unit of each foreign currency is
// worth. INR is the base (salaries are INR) and is never stored.

const prisma = require('../../config/db');

const FOREIGN_CURRENCIES = ['USD', 'AED', 'SAR', 'EUR', 'GBP'];

// Every foreign currency, with its rate or null when finance hasn't set one.
async function listRates(orgId) {
  const rows = await prisma.exchangeRate.findMany({ where: { org_id: orgId }, select: { currency: true, rate_to_inr: true, updated_at: true } });
  const byCurrency = new Map(rows.map((r) => [r.currency, r]));
  return FOREIGN_CURRENCIES.map((currency) => {
    const row = byCurrency.get(currency);
    return { currency, rate_to_inr: row ? Number(row.rate_to_inr) : null, updated_at: row?.updated_at || null };
  });
}

// Upserts the given rates; a null rate clears that currency.
async function setRates(orgId, rates) {
  await prisma.$transaction(rates.map(({ currency, rate_to_inr }) => (
    rate_to_inr === null
      ? prisma.exchangeRate.deleteMany({ where: { org_id: orgId, currency } })
      : prisma.exchangeRate.upsert({
        where: { org_id_currency: { org_id: orgId, currency } },
        create: { org_id: orgId, currency, rate_to_inr },
        update: { rate_to_inr },
      })
  )));
  return listRates(orgId);
}

// currency -> INR per unit, INR included as 1. Currencies without a rate are absent.
async function inrRates(orgId) {
  const rows = await prisma.exchangeRate.findMany({ where: { org_id: orgId }, select: { currency: true, rate_to_inr: true } });
  return new Map([['INR', 1], ...rows.map((r) => [r.currency, Number(r.rate_to_inr)])]);
}

// The one INR conversion every finance screen uses (Project P&L, Finance →
// Projects, …): amount x the org's rate for that currency, to 2 decimals. A
// currency with no rate converts to 0 and is recorded in `missing`, so callers
// can name it instead of guessing. `rateFor` is null for such a currency.
function inrConverter(fx) {
  const missing = new Set();
  const rateFor = (currency) => {
    const cur = currency || 'INR';
    return fx.has(cur) ? fx.get(cur) : null;
  };
  const toInr = (amount, currency) => {
    const rate = rateFor(currency);
    if (rate === null) { missing.add(currency || 'INR'); return 0; }
    return Math.round(Number(amount || 0) * rate * 100) / 100;
  };
  return { toInr, rateFor, missing };
}

module.exports = { FOREIGN_CURRENCIES, listRates, setRates, inrRates, inrConverter };
