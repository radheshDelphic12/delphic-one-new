const prisma = require('../../config/db');

// A change dated inside a closed month never rewrites that month's snapshot; it only flags the
// close as stale so an admin can reopen and re-close. `date` is YYYY-MM-DD, a Date, or YYYY-MM.
async function markStale(orgId, date) {
  if (!date) return;
  const month = typeof date === 'string' ? date.slice(0, 7) : new Date(date).toISOString().slice(0, 7);
  await prisma.zxPeriodClose.updateMany({ where: { org_id: orgId, month, status: 'closed', stale: false }, data: { stale: true, stale_at: new Date() } });
}

async function isClosed(orgId, date) {
  const month = typeof date === 'string' ? date.slice(0, 7) : new Date(date).toISOString().slice(0, 7);
  return Boolean(await prisma.zxPeriodClose.findFirst({ where: { org_id: orgId, month, status: 'closed' }, select: { id: true } }));
}

module.exports = { markStale, isClosed };
