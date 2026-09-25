// Shared IST ("Asia/Kolkata", fixed +05:30, no DST) calendar-day helper.
// Mirrors reports.service.js's asIst()/dayKey() — pulled out here because the
// ERP attendance/leave modules (Phase 2) need "today" on the business
// calendar, not the server's UTC clock, same reasoning as the reports module.
const IST_OFFSET_MS = 330 * 60 * 1000;

function asIst(value) {
  return new Date(new Date(value).getTime() + IST_OFFSET_MS);
}

/** IST calendar day of an instant, as `YYYY-MM-DD`. */
function dayKeyIst(value) {
  return asIst(value).toISOString().slice(0, 10);
}

/** Today's IST calendar date, as a UTC-midnight Date (safe for a @db.Date column). */
function todayIst() {
  return new Date(`${dayKeyIst(new Date())}T00:00:00.000Z`);
}

module.exports = { asIst, dayKeyIst, todayIst };
