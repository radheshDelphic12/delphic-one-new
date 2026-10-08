// The ONLY place the valuation formula lives:  valuation = (profit x profit_multiplier) + (asset value x asset_multiplier).
// The multipliers come from AxSetting (default 240 and 3); nothing else in the server or client hardcodes them.
const { round2, num } = require('./deal.calc');

const DEFAULT_MULTIPLIERS = { profit: 240, asset: 3 };

function calculate(profit, assetValue, multipliers = DEFAULT_MULTIPLIERS) {
  const p = num(profit);
  const a = num(assetValue);
  const pm = multipliers.profit == null ? DEFAULT_MULTIPLIERS.profit : num(multipliers.profit);
  const am = multipliers.asset == null ? DEFAULT_MULTIPLIERS.asset : num(multipliers.asset);
  const profit_component = round2(p * pm);
  const asset_component = round2(a * am);
  return {
    profit: round2(p),
    asset_value: round2(a),
    profit_multiplier: pm,
    asset_multiplier: am,
    profit_component,
    asset_component,
    total: round2(profit_component + asset_component),
  };
}

module.exports = { calculate, DEFAULT_MULTIPLIERS };
