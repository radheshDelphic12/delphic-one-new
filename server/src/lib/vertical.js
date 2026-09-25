const prisma = require('../config/db');

const num = (v) => (v === null || v === undefined ? null : Number(v));
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function pageArgs({ page = 1, limit = 50 } = {}) {
  return { skip: (page - 1) * limit, take: limit };
}

function pagination(page, limit, total) {
  return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}

// id -> { id, name } for a set of user ids (owner / creator display names).
async function userNames(ids) {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u]));
}

function monthKey(date) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// [start, endExclusive) of a calendar month in UTC.
function monthBounds(year, month) {
  return [new Date(Date.UTC(year, month - 1, 1)), new Date(Date.UTC(year, month, 1))];
}

module.exports = { num, round2, pageArgs, pagination, userNames, monthKey, monthBounds };
