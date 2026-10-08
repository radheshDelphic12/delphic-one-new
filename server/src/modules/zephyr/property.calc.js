// Pure property finance formulas (no database), so every screen, report and test agrees.
//
//   total investment  = purchase + brokerage + documentation + registration + construction + renovation + other
//   appreciation      = current valuation - total investment          (UNREALIZED until the property sells)
//   appreciation %    = appreciation / total investment x 100
//   trading profit    = sale value - total investment - selling costs  (REALIZED, booked only by a sale)
//   cash flow         = rent income - operating expenses - financing (EMI)
//   commission        = transaction value x commission % / 100
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const n = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));

const COST_FIELDS = ['purchase_cost', 'brokerage', 'documentation_cost', 'registration_cost', 'construction_cost', 'renovation_cost', 'other_cost'];

function totalInvestment(p) {
  return round2(COST_FIELDS.reduce((sum, f) => sum + n(p[f]), 0));
}

function appreciation(invested, valuation) {
  if (valuation === null || valuation === undefined) return { amount: null, pct: null };
  const amount = round2(n(valuation) - n(invested));
  return { amount, pct: n(invested) > 0 ? round2((amount / n(invested)) * 100) : null };
}

function tradingProfit(saleValue, invested, sellingCosts) {
  return round2(n(saleValue) - n(invested) - n(sellingCosts));
}

// EMI per month for a loan, whatever its payment frequency.
function monthlyFinancing(loan) {
  if (loan.status === 'closed') return 0;
  const emi = n(loan.emi_amount);
  if (loan.emi_frequency === 'quarterly') return round2(emi / 3);
  if (loan.emi_frequency === 'yearly') return round2(emi / 12);
  return round2(emi);
}

function cashFlow({ income = 0, expenses = 0, financing = 0 }) {
  const net = round2(n(income) - n(expenses) - n(financing));
  return { income: round2(income), expenses: round2(expenses), financing: round2(financing), net, status: net > 0 ? 'positive' : net < 0 ? 'negative' : 'neutral' };
}

function commission(transactionValue, pct) {
  if (transactionValue === null || transactionValue === undefined || pct === null || pct === undefined) return null;
  return round2((n(transactionValue) * n(pct)) / 100);
}

// Cost basis of a single unit sold out of a property: the unit's own allocated cost when set,
// otherwise the property's total investment shared by area (or equally when areas are missing).
function unitCostBasis(unit, units, invested) {
  if (unit.allocated_cost !== null && unit.allocated_cost !== undefined) return round2(unit.allocated_cost);
  const all = units.filter((u) => !u.deleted_at);
  const areas = all.map((u) => n(u.area_value));
  const totalArea = areas.reduce((a, b) => a + b, 0);
  if (totalArea > 0 && n(unit.area_value) > 0) return round2((n(unit.area_value) / totalArea) * invested);
  return all.length ? round2(invested / all.length) : round2(invested);
}

module.exports = { round2, COST_FIELDS, totalInvestment, appreciation, tradingProfit, monthlyFinancing, cashFlow, commission, unitCostBasis };
