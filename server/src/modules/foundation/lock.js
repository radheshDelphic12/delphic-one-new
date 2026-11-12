const { isClosed, markStale } = require('./periods');

// Money dated inside a closed month is locked. A non-admin is refused; an admin may edit with a reason
// (the close is then flagged stale so it can be reopened and re-closed). `ctx` = { isAdmin, reason }.
async function guard(orgId, dates, ctx = {}) {
  for (const d of dates) {
    if (d && (await isClosed(orgId, d))) {
      if (!ctx.isAdmin) return { error: 'period_closed' };
      if (!ctx.reason) return { error: 'period_reason_required' };
      return null;
    }
  }
  return null;
}

async function touch(orgId, dates) {
  for (const d of dates) await markStale(orgId, d);
}

module.exports = { guard, touch };
