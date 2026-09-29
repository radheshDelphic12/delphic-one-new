// Operational-data change hook for the finance calculation lock system.
// Attendance, leave, timesheet and salary writes call this AFTER their own
// write succeeds; if the change lands in a month whose billing / salary /
// resource revenue / vendor payments / financials are locked, the locked
// figures are left untouched and a "Calculation Change Detected" flag is
// raised instead (see modules/calculations/calculations.service.js).
// Required lazily so the modules calling it don't pull the calculation
// engines (which build on some of those same modules) in at load time.
// Never throws: a failure is logged there and the caller's write stands.
async function detectFinanceChange(orgId, change) {
  if (!orgId) return { flagged: 0 };
  return require('../modules/calculations/calculations.service').notifySourceChange(orgId, change);
}

module.exports = { detectFinanceChange };
