const prisma = require('../../config/db');
const { projectListWhere } = require('../../lib/projectScope');

const hhmm = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// The 24-hour day: every running project with its work start / end time, and every shift with the people on it. Reporting only.
async function daySchedule(orgId) {
  const [projects, shifts, members] = await Promise.all([
    prisma.account.findMany({
      where: projectListWhere(orgId),
      select: { id: true, name: true, project_name: true, project_code: true, client_name: true, client_account: { select: { name: true } }, work_start_time: true, work_end_time: true, contract_status: true },
      orderBy: { name: 'asc' },
    }),
    prisma.shift.findMany({ where: { org_id: orgId }, orderBy: { start_minutes: 'asc' } }),
    prisma.orgMembership.findMany({
      where: { org_id: orgId, shift_id: { not: null }, employment_status: { in: ['active', 'on_leave', 'notice_period'] } },
      select: { shift_id: true, employee_code: true, person: { select: { id: true, name: true } }, team: { select: { name: true } } },
    }),
  ]);
  const people = new Map();
  for (const m of members) people.set(m.shift_id, [...(people.get(m.shift_id) || []), { id: m.person.id, name: m.person.name, employee_code: m.employee_code, team: m.team?.name || null }]);
  return {
    projects: projects.map((p) => ({
      id: p.id,
      name: p.project_name || p.name,
      code: p.project_code,
      client: p.client_account?.name || p.client_name || null,
      start: p.work_start_time,
      end: p.work_end_time,
      on_hold: p.contract_status === 'on_hold',
    })),
    shifts: shifts.map((s) => ({
      id: s.id,
      name: s.name,
      start: hhmm(s.start_minutes),
      end: hhmm(s.end_minutes),
      start_minutes: s.start_minutes,
      end_minutes: s.end_minutes,
      people: (people.get(s.id) || []).sort((a, b) => a.name.localeCompare(b.name)),
    })),
  };
}

module.exports = { daySchedule };
