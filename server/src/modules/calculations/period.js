// Period helpers shared by every calculation engine (billing, salary,
// resource revenue, vendor payments, financials) so they agree on what "a
// month" and "a quarter" are.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function monthBounds(month, year) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start, end, days: end.getUTCDate() };
}

// Every date of a month, as UTC-midnight Dates.
function monthDates(month, year) {
  const { days } = monthBounds(month, year);
  return Array.from({ length: days }, (_, i) => new Date(Date.UTC(year, month - 1, i + 1)));
}

// The months a reporting period covers: one month, or the three of a quarter
// (`quarter` 1-4). Monthly is the unit everything locks at.
function periodMonths({ period = 'month', period_month, period_year, quarter }) {
  if (period === 'quarter') {
    const q = quarter || Math.floor((period_month - 1) / 3) + 1;
    return [0, 1, 2].map((i) => ({ period_month: (q - 1) * 3 + 1 + i, period_year }));
  }
  return [{ period_month, period_year }];
}

function isWeekend(date) {
  const dow = date.getUTCDay();
  return dow === 0 || dow === 6;
}

// Today in IST as a UTC-midnight Date (the business calendar day).
function todayIst(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60 * 1000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

// Live "as of" cut-off for a month: today while the month is running, null
// (= the whole month) once it's over, and the day before the month for a
// future month (nothing incurred yet).
function liveAsOf(month, year, now = new Date()) {
  const today = todayIst(now);
  const { start, end } = monthBounds(month, year);
  if (today > end) return null;
  if (today < start) return new Date(start.getTime() - 86400000);
  return today;
}

module.exports = { round2, ymd, monthBounds, monthDates, periodMonths, isWeekend, todayIst, liveAsOf };
