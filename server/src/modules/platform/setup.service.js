const prisma = require('../../config/db');
const credits = require('./credits.service');

// First-steps checklist for a customer's own admin (SaaS plan section 22, "setup wizard"): what is already set up in their new, clean company and where to
// do the rest. Read-only and cheap; { applies: false } for every company that is not a SaaS customer, so nothing changes for our own companies.
async function mySetup(user) {
  if (!user?.org_id) return { applies: false };
  const customer = await prisma.saasCustomer.findUnique({ where: { org_id: user.org_id } });
  if (!customer) return { applies: false };
  const orgId = user.org_id;
  const [departments, offices, calendars, people, policies] = await Promise.all([
    prisma.department.count({ where: { org_id: orgId } }),
    prisma.location.count({ where: { org_id: orgId } }),
    prisma.calendar.count({ where: { org_id: orgId } }),
    prisma.orgMembership.count({ where: { org_id: orgId, employment_status: 'active' } }),
    prisma.policy.count({ where: { org_id: orgId } }),
  ]);
  const steps = [
    { key: 'offices', label: 'Add your offices', count: offices, done: offices > 0, where: '/offices' },
    { key: 'departments', label: 'Add your departments', count: departments, done: departments > 0, where: '/people' },
    { key: 'calendar', label: 'Set up a holiday calendar', count: calendars, done: calendars > 0, where: '/calendar' },
    { key: 'people', label: 'Add your team', count: people, done: people > 1, where: '/people' },
    { key: 'policies', label: 'Upload your policies', count: policies, done: policies > 0, where: '/policies' },
  ];
  const today = credits.dayStr();
  const end = customer.trial_ends_on ? customer.trial_ends_on.toISOString().slice(0, 10) : null;
  const daysLeft = end ? Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000) : null;
  return { applies: true, status: customer.status, trial_ends_on: end, trial_days_left: customer.status === 'trial' ? daysLeft : null, max_users: customer.max_users, steps, done: steps.filter((s) => s.done).length, total: steps.length };
}

module.exports = { mySetup };
