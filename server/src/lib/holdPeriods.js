// Contract hold periods on a project (Account.contract_hold_periods): a JSON list of
// { from: 'YYYY-MM-DD', resume: 'YYYY-MM-DD' | null }. The project is on hold from `from` up to the day
// BEFORE `resume`; no `resume` = still on hold. A project can be put on hold more than once.
// Only a MONTHLY-rate contract skips billing for these days (hourly bills approved hours, which a hold
// leaves at 0 anyway).
const DAY = 86400000;

function toDate(ymd) {
  return new Date(`${ymd}T00:00:00.000Z`);
}

// Stored JSON -> sorted [{ from: Date, resume: Date | null }]; junk entries are dropped.
function parse(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((p) => p && typeof p.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.from))
    .map((p) => ({ from: toDate(p.from), resume: typeof p.resume === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.resume) ? toDate(p.resume) : null }))
    .sort((a, b) => a.from - b.from);
}

function isHeld(periods, date) {
  return periods.some((p) => date >= p.from && (!p.resume || date < p.resume));
}

// Number of days in [from, to] (inclusive, UTC dates) that fall on a hold.
function heldDays(periods, from, to) {
  let n = 0;
  for (let t = +from; t <= +to; t += DAY) if (isHeld(periods, new Date(t))) n += 1;
  return n;
}

// Validates a submitted list: each resume after its from, and no two periods overlapping. Returns an error code or null.
function validate(list) {
  const periods = parse(list);
  if (periods.length !== (list || []).length) return 'hold_periods_invalid';
  for (let i = 0; i < periods.length; i += 1) {
    const p = periods[i];
    if (p.resume && p.resume <= p.from) return 'hold_resume_before_from';
    const next = periods[i + 1];
    if (next && (!p.resume || p.resume > next.from)) return 'hold_periods_overlap';
  }
  return null;
}

module.exports = { parse, isHeld, heldDays, validate };
