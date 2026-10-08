// Pure investment arithmetic. Unrealised appreciation is reported here and NEVER posted to revenue / P&L:
// only a realisation (cash actually received) produces a ledger entry.
const { round2, num, sum } = require('./deal.calc');

// Gain / loss of one holding: current value of what is still held minus the cost still held.
function holding(inv, realisations = []) {
  const amount = num(inv.amount);
  const costReleased = round2(sum(realisations, (r) => r.cost_released));
  const received = round2(sum(realisations, (r) => r.amount_received));
  const remainingCost = Math.max(0, round2(amount - costReleased));
  const open = inv.status !== 'realised';
  const currentValue = open ? round2(num(inv.current_value)) : 0;
  const unrealised = open ? round2(currentValue - remainingCost) : 0;
  const realised = round2(received - costReleased);
  return {
    amount: round2(amount),
    current_value: currentValue,
    remaining_cost: open ? remainingCost : 0,
    cost_released: costReleased,
    amount_received: received,
    realised_gain: realised,
    unrealised_gain: unrealised,
    // Gain / loss = current value - investment amount while nothing is sold; once part is realised it is
    // realised gain + unrealised gain, so a partial sale does not read as a loss. % is on the amount invested.
    gain_loss: round2(realised + unrealised),
    gain_loss_pct: amount > 0 ? Math.round(((realised + unrealised) / amount) * 1000) / 10 : null,
  };
}

// Gold / silver profit from quantity and prices when they exist, otherwise value based.
function metalProfit(inv) {
  if (inv.quantity != null && inv.purchase_price != null && inv.current_price != null) {
    return round2(num(inv.quantity) * (num(inv.current_price) - num(inv.purchase_price)));
  }
  return null;
}

function totals(rows) {
  const invested = round2(sum(rows, (r) => r.amount));
  const realised = round2(sum(rows, (r) => r.realised_gain));
  const unrealised = round2(sum(rows, (r) => r.unrealised_gain));
  return {
    invested,
    open_cost: round2(sum(rows, (r) => r.remaining_cost)),
    current_value: round2(sum(rows, (r) => r.current_value)),
    realised_gain: realised,
    unrealised_gain: unrealised,
    gain_loss: round2(realised + unrealised),
    gain_loss_pct: invested > 0 ? Math.round(((realised + unrealised) / invested) * 1000) / 10 : null,
  };
}

module.exports = { holding, metalProfit, totals };
