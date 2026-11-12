const prisma = require('../../config/db');
const { todayIst } = require('../../lib/istDate');

const DAY = 86400000;

/** The next time a month/day falls on or after `today` (UTC-midnight dates). 29 Feb is celebrated on 28 Feb in other years. */
function nextOccurrence(date, today) {
  const month = date.getUTCMonth();
  let day = date.getUTCDate();
  const make = (year) => {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return new Date(Date.UTC(year, month, month === 1 && day === 29 && !isLeap ? 28 : day));
  };
  let next = make(today.getUTCFullYear());
  if (next < today) next = make(today.getUTCFullYear() + 1);
  return next;
}

/**
 * Upcoming birthdays and work anniversaries of the company's employees in the next `days` days (today included).
 * Contractors, people who left and deleted people are left out. A birthday carries no year; an anniversary carries the
 * number of years (an employee who joined this year has none yet).
 */
async function upcoming(orgId, { days = 14, today = todayIst() } = {}) {
  const people = await prisma.orgMembership.findMany({
    where: { org_id: orgId, worker_type: { not: 'contractor' }, employment_status: { in: ['active', 'on_leave', 'notice_period'] } },
    select: { id: true, date_of_birth: true, joined_at: true, person: { select: { name: true } }, department: { select: { name: true } } },
  });
  const birthdays = [];
  const anniversaries = [];
  for (const p of people) {
    if (p.date_of_birth) {
      const next = nextOccurrence(p.date_of_birth, today);
      const away = Math.round((next - today) / DAY);
      if (away <= days) birthdays.push({ org_membership_id: p.id, name: p.person?.name || null, department: p.department?.name || null, date: next.toISOString().slice(0, 10), days_away: away });
    }
    if (p.joined_at) {
      const next = nextOccurrence(p.joined_at, today);
      const away = Math.round((next - today) / DAY);
      const years = next.getUTCFullYear() - p.joined_at.getUTCFullYear();
      if (away <= days && years >= 1) anniversaries.push({ org_membership_id: p.id, name: p.person?.name || null, department: p.department?.name || null, date: next.toISOString().slice(0, 10), days_away: away, years });
    }
  }
  const order = (a, b) => a.days_away - b.days_away || String(a.name).localeCompare(String(b.name));
  return { days, birthdays: birthdays.sort(order), anniversaries: anniversaries.sort(order) };
}

module.exports = { upcoming, nextOccurrence };
