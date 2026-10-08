// Effective-dated allocations — the one place that answers "on this date,
// which projects was this person allocated to, at what share, and which team
// were they on?". Project allocations (ProjectMemberAssignment) and team
// membership (TeamMembershipPeriod) are spans of days, never a "current"
// pointer, so a past date always resolves to what applied then; moving
// someone ends one span and starts another instead of rewriting a row.
//
// A span's start_date / end_date are inclusive; null start = "from the
// beginning", null end = "still open". Dates are UTC-midnight Dates (@db.Date).

const DAY = 86400000;

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function toDate(value) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
}

function addDays(date, n) {
  return new Date(date.getTime() + n * DAY);
}

/** Is the span active on `date`? */
function activeOn(span, date) {
  const d = toDate(date);
  return (!span.start_date || toDate(span.start_date) <= d) && (!span.end_date || toDate(span.end_date) >= d);
}

/** Does the span overlap [from, to] (either bound may be null = open)? */
function overlaps(span, from, to) {
  const f = toDate(from);
  const t = toDate(to);
  return (!span.start_date || !t || toDate(span.start_date) <= t) && (!span.end_date || !f || toDate(span.end_date) >= f);
}

/** Every Mon–Fri of [from, to] — the days a month's cost is spread over. */
function weekdaysBetween(from, to) {
  const out = [];
  for (let d = toDate(from); d <= toDate(to); d = addDays(d, 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d);
  }
  return out;
}

/**
 * One person's share of their capacity/cost on each project on `date`.
 * An explicit allocation_percent is that share; a null one splits evenly
 * across the projects the person is allocated to THAT day (the old
 * "even split" rule, now counted per day instead of across all time).
 * Returns Map(account_id -> share 0..1).
 */
function sharesOn(personSpans, date) {
  const active = personSpans.filter((s) => activeOn(s, date));
  const even = active.length ? 1 / active.length : 0;
  const shares = new Map();
  for (const s of active) {
    const share = s.allocation_percent !== null && s.allocation_percent !== undefined ? Number(s.allocation_percent) / 100 : even;
    // Two overlapping spans on one project (shouldn't happen, but never double-count).
    shares.set(s.account_id, Math.max(shares.get(s.account_id) || 0, share));
  }
  return shares;
}

/**
 * A person's average share on each project across the weekdays of
 * [from, to] — how a month's salary / vendor cost is split when allocations
 * change mid-month. With no change in the period this equals the flat share,
 * so months without movement calculate exactly as before.
 * Returns Map(account_id -> share 0..1).
 */
function periodShares(personSpans, from, to) {
  const days = weekdaysBetween(from, to);
  const totals = new Map();
  if (!days.length) return totals;
  for (const day of days) {
    for (const [accountId, share] of sharesOn(personSpans, day)) totals.set(accountId, (totals.get(accountId) || 0) + share);
  }
  for (const [accountId, sum] of totals) totals.set(accountId, sum / days.length);
  return totals;
}

/** Group rows by org_membership_id. */
function byMembership(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.org_membership_id)) map.set(r.org_membership_id, []);
    map.get(r.org_membership_id).push(r);
  }
  return map;
}

/** Team a person was on on `date`, from their TeamMembershipPeriods (or null). */
function teamOn(periods, date) {
  const hit = periods.filter((p) => activeOn(p, date)).sort((a, b) => (toDate(b.start_date)?.getTime() || 0) - (toDate(a.start_date)?.getTime() || 0))[0];
  return hit ? hit.team_id : null;
}

/**
 * Split an open span at `effective` (the first day of the new state): the old
 * span ends the day before. Returns the end_date to write, or 'delete' when
 * the span never took effect (it starts on/after `effective`).
 */
function endBefore(span, effective) {
  const eff = toDate(effective);
  if (span.start_date && toDate(span.start_date) >= eff) return 'delete';
  return addDays(eff, -1);
}

module.exports = { DAY, ymd, toDate, addDays, activeOn, overlaps, weekdaysBetween, sharesOn, periodShares, byMembership, teamOn, endBefore };
