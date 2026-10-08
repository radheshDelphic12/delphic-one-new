const valuation = require('../src/modules/acconcy/valuation.calc');
const deal = require('../src/modules/acconcy/deal.calc');
const inv = require('../src/modules/acconcy/investment.calc');

const CR = 10000000;

describe('acconcy valuation formula: (profit x 240) + (asset value x 3)', () => {
  test('brief example: 10 Cr profit + 20 Cr assets = 2460 Cr', () => {
    const v = valuation.calculate(10 * CR, 20 * CR);
    expect(v.profit_component).toBe(2400 * CR);
    expect(v.asset_component).toBe(60 * CR);
    expect(v.total).toBe(2460 * CR);
    expect(v.profit_multiplier).toBe(240);
    expect(v.asset_multiplier).toBe(3);
  });
  test('zero profit, zero assets, negative profit', () => {
    expect(valuation.calculate(0, 100).total).toBe(300);
    expect(valuation.calculate(50, 0).total).toBe(12000);
    expect(valuation.calculate(0, 0).total).toBe(0);
    expect(valuation.calculate(-10, 100).total).toBe(-2400 + 300);
  });
  test('multipliers come from configuration, not the formula', () => {
    const v = valuation.calculate(10, 20, { profit: 100, asset: 5 });
    expect(v.total).toBe(10 * 100 + 20 * 5);
    expect(v.profit_multiplier).toBe(100);
    expect(valuation.calculate(10, 20, { profit: 0, asset: 0 }).total).toBe(0);
  });
  test('string / decimal inputs from the database are handled', () => {
    expect(valuation.calculate('1234.50', '10', { profit: '240', asset: '3' }).total).toBe(1234.5 * 240 + 30);
  });
});

describe('acconcy deal profit comes from ledger rows', () => {
  const entries = [
    { type: 'revenue', amount: '1000000' },
    { type: 'expense', amount: '300000' },
  ];
  test('profit = revenue - expenses, margin from revenue', () => {
    const s = deal.summarize({ status: 'active' }, entries);
    expect(s.revenue).toBe(1000000);
    expect(s.expense).toBe(300000);
    expect(s.profit).toBe(700000);
    expect(s.margin_pct).toBe(70);
  });
  test('no revenue: margin is null, loss is negative', () => {
    const s = deal.summarize({ status: 'active' }, [{ type: 'expense', amount: 5 }]);
    expect(s.profit).toBe(-5);
    expect(s.margin_pct).toBeNull();
  });
  test('a typed deal amount never changes profit', () => {
    expect(deal.summarize({ status: 'active', deal_amount: 99999999 }, entries).profit).toBe(700000);
  });
  test('delayed only for open deals past the expected end', () => {
    expect(deal.isDelayed({ status: 'active', expected_end: '2020-01-01' }, '2026-01-01')).toBe(true);
    expect(deal.isDelayed({ status: 'completed', expected_end: '2020-01-01' }, '2026-01-01')).toBe(false);
    expect(deal.isDelayed({ status: 'active', expected_end: null }, '2026-01-01')).toBe(false);
  });
});

describe('acconcy investment performance', () => {
  test('gain / loss = current value - amount; % on the amount', () => {
    const h = inv.holding({ amount: 100, current_value: 125, status: 'active' }, []);
    expect(h.gain_loss).toBe(25);
    expect(h.gain_loss_pct).toBe(25);
    expect(h.unrealised_gain).toBe(25);
    expect(h.realised_gain).toBe(0);
    expect(inv.holding({ amount: 100, current_value: 80, status: 'active' }, []).gain_loss).toBe(-20);
  });
  test('realised vs unrealised stay separate after a partial sale', () => {
    const h = inv.holding({ amount: 100, current_value: 70, status: 'partly_realised' }, [{ cost_released: 40, amount_received: 55 }]);
    expect(h.realised_gain).toBe(15);
    expect(h.unrealised_gain).toBe(10);
    expect(h.gain_loss).toBe(25);
  });
  test('a fully realised holding has no current value or unrealised gain', () => {
    const h = inv.holding({ amount: 100, current_value: 0, status: 'realised' }, [{ cost_released: 100, amount_received: 130 }]);
    expect(h.current_value).toBe(0);
    expect(h.unrealised_gain).toBe(0);
    expect(h.realised_gain).toBe(30);
  });
  test('zero amount does not divide by zero', () => {
    expect(inv.holding({ amount: 0, current_value: 0, status: 'active' }, []).gain_loss_pct).toBeNull();
    expect(inv.totals([]).gain_loss_pct).toBeNull();
  });
  test('metal profit needs quantity and both prices', () => {
    expect(inv.metalProfit({ quantity: 10, purchase_price: 5000, current_price: 5500 })).toBe(5000);
    expect(inv.metalProfit({ quantity: 10, purchase_price: 5000 })).toBeNull();
  });
});
