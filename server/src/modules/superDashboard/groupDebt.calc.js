// Pure loan arithmetic for the group's debt management: the repayment schedule (reducing balance), and what a schedule says about a
// loan on a given day. No database here.

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const PER_YEAR = { monthly: 12, quarterly: 4, yearly: 1 };
const FREQUENCIES = Object.keys(PER_YEAR);

/** YYYY-MM-DD, `n` whole months after `iso`, keeping the day of the month where it exists (31 Jan + 1 month = 28/29 Feb). */
function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = m - 1 + n;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** The instalment that repays `principal` over `periods` instalments at `annualRatePct` a year. */
function emiFor(principal, annualRatePct, periods, frequency = 'monthly') {
  const p = Number(principal);
  if (!(p > 0) || !(periods > 0)) return 0;
  const r = Number(annualRatePct || 0) / 100 / PER_YEAR[frequency];
  if (r === 0) return round2(p / periods);
  const f = (1 + r) ** periods;
  return round2((p * r * f) / (f - 1));
}

/**
 * One row per instalment. `emi` is the agreed instalment (worked out when omitted); the last row clears whatever is left, so the
 * balance always ends at 0. `firstDue` is the date of the first instalment (one period after the start when omitted).
 */
function buildSchedule({ principal, annualRatePct, periods, frequency = 'monthly', startDate, firstDue, emi }) {
  const p = round2(principal);
  const n = Math.max(0, Math.round(periods || 0));
  if (!(p > 0) || !n) return [];
  const step = 12 / PER_YEAR[frequency];
  const r = Number(annualRatePct || 0) / 100 / PER_YEAR[frequency];
  const pay = emi > 0 ? round2(emi) : emiFor(p, annualRatePct, n, frequency);
  const rows = [];
  let balance = p;
  for (let i = 1; i <= n; i += 1) {
    const interest = round2(balance * r);
    const last = i === n;
    const principalPart = last ? balance : Math.min(balance, Math.max(0, round2(pay - interest)));
    const amount = last ? round2(balance + interest) : round2(principalPart + interest);
    balance = round2(balance - principalPart);
    rows.push({
      seq: i,
      due_date: addMonths(firstDue || addMonths(startDate, step), (i - 1) * step),
      amount,
      principal_part: principalPart,
      interest_part: interest,
      balance_after: balance,
    });
    if (balance <= 0 && !last) break;
  }
  return rows;
}

/** What a loan's rows say on `today` (YYYY-MM-DD). Rows carry `status` ('paid' | 'pending'). */
function summarise(loan, rows, today) {
  const principal = Number(loan.principal);
  const paid = rows.filter((r) => r.status === 'paid');
  const pending = rows.filter((r) => r.status !== 'paid');
  const lastPaid = paid.length ? paid.reduce((a, r) => (r.seq > a.seq ? r : a)) : null;
  const sum = (list, k) => round2(list.reduce((a, r) => a + Number(r[k] || 0), 0));
  const overdue = pending.filter((r) => String(r.due_date).slice(0, 10) < today);
  const next = pending.filter((r) => String(r.due_date).slice(0, 10) >= today).sort((a, b) => a.seq - b.seq)[0] || null;
  return {
    emis_total: rows.length,
    emis_paid: paid.length,
    emis_pending: pending.length,
    emis_overdue: overdue.length,
    // outstanding principal = the balance after the last paid instalment (the whole principal while none is paid)
    outstanding: rows.length ? (lastPaid ? Number(lastPaid.balance_after) : principal) : principal,
    principal_paid: sum(paid, 'principal_part'),
    interest_paid: sum(paid, 'interest_part'),
    interest_remaining: sum(pending, 'interest_part'),
    total_remaining: sum(pending, 'amount'),
    next_due: next ? { seq: next.seq, due_date: String(next.due_date).slice(0, 10), amount: Number(next.amount) } : null,
    end_date: rows.length ? String(rows[rows.length - 1].due_date).slice(0, 10) : null,
    progress_pct: rows.length ? Math.round((paid.length / rows.length) * 1000) / 10 : null,
  };
}

/** Debt against the chosen base, and how it stands against the limit. */
function ratio(debt, base, limitPct) {
  if (!(base > 0)) return { ratio_pct: null, status: 'unknown', headroom: null };
  const pct = Math.round((debt / base) * 1000) / 10;
  const status = pct > limitPct ? 'over' : pct > limitPct * 0.8 ? 'warning' : 'ok';
  return { ratio_pct: pct, status, headroom: round2((limitPct / 100) * base - debt) };
}

module.exports = { round2, addMonths, emiFor, buildSchedule, summarise, ratio, FREQUENCIES, PER_YEAR };
