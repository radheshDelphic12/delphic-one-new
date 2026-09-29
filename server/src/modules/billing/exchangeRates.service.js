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

module.exports = { FOREIGN_CURRENCIES, listRates, setRates, inrRates };
