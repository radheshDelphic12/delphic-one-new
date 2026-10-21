// "Increment review due": when an employee completes another year from their joining date, the Super Admin users are told.
// Nothing here changes salary. A reminder stays pending (and keeps showing) until it is marked Completed or Ignored.
const prisma = require('../../config/db');
const { notify } = require('../../lib/notifications');
const { todayIst } = require('../../lib/istDate');

const DAY = 86400000;
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

/** Active users with the Super Admin role for this company: the company's super admins and the group's super admins. */
async function recipientsFor(orgGroupId) {
  const rows = await prisma.user.findMany({
    where: {
      active: true,
      OR: [{ is_superadmin: true }, { is_group_superadmin: true, ...(orgGroupId ? { OR: [{ org_group_memberships: { some: { org_group_id: orgGroupId } } }, { org_group_memberships: { none: {} } }] } : {}) }],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Creates the reminders for anniversaries on or in the last `lookbackDays` days (so a missed night is caught up) and
 * notifies the Super Admins about each new one. Idempotent: a (person, years) pair gets one reminder, ever.
 */
async function generate({ today = todayIst(), lookbackDays = 7 } = {}) {
  const orgs = await prisma.org.findMany({ where: { status: 'active' }, select: { id: true, org_group_id: true } });
  let created = 0;
  for (const org of orgs) {
    const people = await prisma.orgMembership.findMany({
      where: { org_id: org.id, worker_type: { not: 'contractor' }, employment_status: { in: ['active', 'on_leave', 'notice_period'] } },
      select: { id: true, joined_at: true, person: { select: { name: true } } },
    });
    let recipients = null;
    for (const p of people) {
      for (let back = 0; back <= lookbackDays; back += 1) {
        const day = new Date(today.getTime() - back * DAY);
        if (day.getUTCMonth() !== p.joined_at.getUTCMonth() || day.getUTCDate() !== p.joined_at.getUTCDate()) continue;
        const years = day.getUTCFullYear() - p.joined_at.getUTCFullYear();
        if (years < 1) continue;
        const exists = await prisma.incrementReminder.findUnique({ where: { org_membership_id_years_completed: { org_membership_id: p.id, years_completed: years } } });
        if (exists) continue;
        const reminder = await prisma.incrementReminder.create({ data: { org_id: org.id, org_membership_id: p.id, years_completed: years, due_date: day } });
        created += 1;
        recipients = recipients || (await recipientsFor(org.org_group_id));
        await notify(prisma, {
          type: 'increment_review_due',
          recipientIds: recipients,
          context: { skipAdmins: true, employeeName: p.person?.name, years, dueDate: ymd(day), reminderId: reminder.id },
        });
      }
    }
  }
  return { created };
}

/** Which companies this user's reminders come from: their group's companies (group super admin) or their own (super admin). */
async function scopeFor(user) {
  const u = await prisma.user.findUnique({ where: { id: user.id }, select: { is_superadmin: true, is_group_superadmin: true, active: true, org_group_memberships: { select: { org_group_id: true } } } });
  if (!u || !u.active) return null;
  if (u.is_group_superadmin) {
    const groupIds = u.org_group_memberships.map((m) => m.org_group_id);
    const orgs = await prisma.org.findMany({ where: groupIds.length ? { org_group_id: { in: groupIds } } : {}, select: { id: true } });
    return orgs.map((o) => o.id);
  }
  if (u.is_superadmin) return [user.org_id];
  return null;
}

async function list(user, { status = 'pending' } = {}) {
  const orgIds = await scopeFor(user);
  if (!orgIds) return { error: 'forbidden' };
  const rows = await prisma.incrementReminder.findMany({
    where: { org_id: { in: orgIds }, ...(status === 'all' ? {} : { status }) },
    orderBy: [{ due_date: 'asc' }],
    include: { org_membership: { select: { employee_code: true, joined_at: true, person: { select: { name: true } }, department: { select: { name: true } }, designation: { select: { name: true } } } }, org: { select: { name: true } } },
    take: 300,
  });
  return {
    rows: rows.map((r) => ({
      id: r.id,
      org_membership_id: r.org_membership_id,
      company: r.org?.name || null,
      name: r.org_membership?.person?.name || null,
      employee_code: r.org_membership?.employee_code || null,
      department: r.org_membership?.department?.name || null,
      designation: r.org_membership?.designation?.name || null,
      joined_at: r.org_membership?.joined_at ? ymd(r.org_membership.joined_at) : null,
      years_completed: r.years_completed,
      due_date: ymd(r.due_date),
      status: r.status,
      decided_at: r.decided_at,
    })),
  };
}

async function decide(user, id, status) {
  const orgIds = await scopeFor(user);
  if (!orgIds) return { error: 'forbidden' };
  const row = await prisma.incrementReminder.findFirst({ where: { id, org_id: { in: orgIds } } });
  if (!row) return { error: 'not_found' };
  const updated = await prisma.incrementReminder.update({ where: { id }, data: { status, decided_by: user.id, decided_at: new Date() } });
  return { reminder: updated };
}

module.exports = { generate, list, decide, scopeFor };
