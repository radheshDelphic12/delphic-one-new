// Owner (POC from our end) of a client / vendor account, by date.
//
// accounts.owner_id is only the CURRENT owner. Every change is also written to account_owner_history with the date it takes effect,
// so a report about a past day asks "who was the owner on that day" instead of "who is the owner now": changing a POC never moves
// earlier records or earlier revenue to the new person.
const prisma = require('../../config/db');

const IST_OFFSET_MS = 330 * 60000;
const istDay = (value) => new Date(new Date(value).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
const istToday = () => istDay(Date.now());
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const toDate = (day) => new Date(`${day}T00:00:00.000Z`);
const dayOf = (value) => new Date(value).toISOString().slice(0, 10);

/**
 * "From <effectiveFrom> the owner is <ownerId>". Anything recorded from that day onwards is replaced (the new owner holds the account
 * from then on, so the latest row always matches accounts.owner_id). When the account has no history yet, its previous owner is
 * recorded from the day it was created first, so earlier days keep their owner.
 * `tx` is a Prisma client or transaction.
 */
async function setOwnerFrom(tx, { accountId, ownerId, effectiveFrom, previousOwnerId, createdAt, actorId }) {
  const existing = await tx.accountOwnerHistory.count({ where: { account_id: accountId } });
  if (existing === 0 && previousOwnerId) {
    await tx.accountOwnerHistory.create({ data: { account_id: accountId, owner_id: previousOwnerId, effective_from: toDate(istDay(createdAt)), created_by: actorId || null } });
  }
  await tx.accountOwnerHistory.deleteMany({ where: { account_id: accountId, effective_from: { gte: toDate(effectiveFrom) } } });
  return tx.accountOwnerHistory.create({ data: { account_id: accountId, owner_id: ownerId, effective_from: toDate(effectiveFrom), created_by: actorId || null } });
}

/** The first owner of a new account, from the day it was created. */
async function recordFirstOwner(tx, { accountId, ownerId, actorId }) {
  return tx.accountOwnerHistory.create({ data: { account_id: accountId, owner_id: ownerId, effective_from: toDate(istToday()), created_by: actorId || null } });
}

/** Map account id -> [{ from: 'YYYY-MM-DD', owner_id }] sorted oldest first. Accounts with no rows are simply absent. */
async function loadTimelines(accountIds, client = prisma) {
  const ids = [...new Set((accountIds || []).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const rows = await client.accountOwnerHistory.findMany({ where: { account_id: { in: ids } }, orderBy: [{ account_id: 'asc' }, { effective_from: 'asc' }], select: { account_id: true, owner_id: true, effective_from: true } });
  for (const r of rows) {
    if (!map.has(r.account_id)) map.set(r.account_id, []);
    map.get(r.account_id).push({ from: dayOf(r.effective_from), owner_id: r.owner_id });
  }
  return map;
}

/**
 * Owner on `day` ('YYYY-MM-DD') from one account's timeline: the latest row that has started by then. A day before the first row gets
 * the first owner; an account without a timeline falls back to `currentOwnerId`.
 */
function ownerOn(timeline, day, currentOwnerId = null) {
  if (!timeline || !timeline.length) return currentOwnerId;
  let found = timeline[0].owner_id;
  for (const t of timeline) {
    if (t.from <= day) found = t.owner_id; else break;
  }
  return found;
}

module.exports = { istDay, istToday, isDay, setOwnerFrom, recordFirstOwner, loadTimelines, ownerOn };
