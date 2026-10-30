// Generic funnel helpers, kept free of any recruiting rules so another funnel (e.g. Sales: requirement created -> meetings ->
// submitted -> closed) can reuse them. A funnel is a list of ordered stages; every entity (a profile, a requirement ...) carries,
// per stage it reached, one outcome:
//   passed      cleared the stage
//   assumed     counted as cleared although the stage was not held (optional / skipped round)
//   dropped     left the funnel at this stage
//   pending     is at this stage now
//   unavailable moved on, but the data to say how it cleared this stage is missing
// An entity with no outcome for a stage never got that far.
// `times[stageKey]` is the number of days from the entity's start to the moment it reached the end of that stage (optional).

const OUTCOMES = ['passed', 'assumed', 'dropped', 'pending', 'unavailable'];
const DAY_MS = 24 * 60 * 60 * 1000;

const round1 = (n) => Math.round(n * 10) / 10;

function average(values) {
  const list = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return list.length ? round1(list.reduce((s, v) => s + v, 0) / list.length) : null;
}

function median(values) {
  const list = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return round1(list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2);
}

/** Days between two instants, never negative; null when either is missing. */
function daysBetween(from, to) {
  if (!from || !to) return null;
  const days = (new Date(to).getTime() - new Date(from).getTime()) / DAY_MS;
  return Number.isFinite(days) && days >= 0 ? days : null;
}

/** One row per stage: how many reached it and how they fared there. `stages`: [{ key, label, ...extras }]. */
function tallyFunnel(stages, entities) {
  return stages.map((stage) => {
    const row = { ...stage, reached: 0, passed: 0, assumed: 0, dropped: 0, pending: 0, unavailable: 0 };
    const days = [];
    for (const entity of entities) {
      const outcome = entity.outcomes[stage.key];
      if (!outcome) continue;
      row.reached += 1;
      if (OUTCOMES.includes(outcome)) row[outcome] += 1;
      if (entity.times?.[stage.key] != null) days.push(entity.times[stage.key]);
    }
    row.avg_days_from_start = average(days);
    return row;
  });
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Group an instant by IST calendar week (Monday start) or month: { key, label } for sorting and display. */
function bucketOf(date, groupBy) {
  const ist = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  if (groupBy === 'month') return { key: `${y}-${String(m + 1).padStart(2, '0')}`, label: `${MONTHS[m]} ${y}` };
  if (groupBy === 'week') {
    const monday = new Date(Date.UTC(y, m, ist.getUTCDate() - ((ist.getUTCDay() + 6) % 7)));
    const key = monday.toISOString().slice(0, 10);
    return { key, label: `Week of ${String(monday.getUTCDate()).padStart(2, '0')} ${MONTHS[monday.getUTCMonth()]} ${monday.getUTCFullYear()}` };
  }
  return { key: 'all', label: 'Whole period' };
}

module.exports = { OUTCOMES, DAY_MS, average, median, daysBetween, tallyFunnel, bucketOf };
