/**
 * Gulati Foundation - demo workspace (LOCAL / STAGING DEMO ONLY; refuses a non-local database).
 *
 * Runs the non-destructive admin bootstrap first, then - only while the foundation has no campaigns - loads a small
 * foundation: a roster with a manager, a finance person and staff, six campaigns across the initiatives and locations,
 * a monthly plan on one of them, and six months of funding, approved commitments, paid spending, a refund and an
 * internal transfer. It writes through the same services as the API, so every figure is computed the way the app computes it.
 *
 * Usage (from server/):
 *   FOUNDATION_ADMIN_EMAIL=admin@gulatifoundation.in FOUNDATION_ADMIN_PASSWORD=Foundation@2026! node prisma/foundation/seed.js
 */
const bcrypt = require('bcryptjs');
const { assertNonProdDestructive } = require('../_guard');
const { run, prisma } = require('./seed-admin');

const PASSWORD = 'Foundation@2026!';
const LOGINS = [
  { name: 'Anita Shah', email: 'manager@gulatifoundation.in', access_role: 'manager', designation: 'Programme Manager' },
  { name: 'Kabir Mehta', email: 'finance@gulatifoundation.in', access_role: 'finance', designation: 'Finance Officer' },
  { name: 'Riya Patel', email: 'staff@gulatifoundation.in', access_role: 'staff', designation: 'Field Coordinator' },
];
const ymd = (d) => d.toISOString().slice(0, 10);
const monthsAgo = (n, day = 10) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n); d.setUTCDate(day); return ymd(d); };
const monthsAhead = (n, day = 28) => monthsAgo(-n, day);

async function demo(org, admin) {
  assertNonProdDestructive('prisma/foundation/seed.js (demo foundation)');
  const core = require('../../src/modules/foundation/core.service');
  const campaigns = require('../../src/modules/foundation/campaigns.service');
  const entries = require('../../src/modules/foundation/entries.service');
  if ((await prisma.fxCampaign.count({ where: { org_id: org.id } })) > 0) { console.log('  = demo skipped (the foundation already has campaigns)'); return; }
  await core.ensureCategories(org.id);
  const hash = await bcrypt.hash(PASSWORD, 10);
  const people = {};
  for (const l of LOGINS) {
    let user = await prisma.user.findUnique({ where: { email: l.email } });
    if (!user) user = await prisma.user.create({ data: { name: l.name, email: l.email, password_hash: hash, role: 'employee', active: true } });
    if (!(await prisma.orgMembership.findFirst({ where: { person_id: user.id, org_id: org.id } }))) await prisma.orgMembership.create({ data: { person_id: user.id, org_id: org.id, role: 'employee' } });
    people[l.access_role] = await prisma.fxPerson.create({ data: { org_id: org.id, name: l.name, user_id: user.id, access_role: l.access_role, designation: l.designation, kind: 'employee' } });
  }
  const cats = await prisma.fxCategory.findMany({ where: { org_id: org.id } });
  const cat = (scope, name) => cats.find((c) => c.scope === scope && c.name === name)?.id;
  const ctx = { isAdmin: true, canOverride: true, canApprove: true, canEditCounted: true };
  const make = async (body, extra = {}) => {
    const r = await campaigns.create(org.id, admin.id, { status: 'active', allocated_budget: 0, planned_investment: 0, ...body });
    if (r.error) throw new Error(`campaign ${body.name}: ${r.error}`);
    for (const [k, v] of Object.entries(extra)) if (k === 'status') await campaigns.setStatus(org.id, admin.id, ctx, r.campaign.id, { to: v, reason: 'Demo' });
    return r.campaign;
  };
  const C = {
    childcare: await make({ name: 'Child Care - Ahmedabad', category_id: cat('initiative', 'Child Care'), city: 'Ahmedabad', state: 'Gujarat', area: 'Naroda', objective: 'Daycare and nutrition for 200 children', planned_start: monthsAgo(3, 1), planned_end: monthsAhead(3), allocated_budget: 1000000, planned_investment: 800000, manager_id: people.manager.id }),
    school: await make({ name: 'Rural School Kits - Surat', category_id: cat('initiative', 'Education'), city: 'Surat', state: 'Gujarat', objective: 'Books and uniforms for 1,500 students', planned_start: monthsAgo(2, 1), planned_end: monthsAhead(4), allocated_budget: 1500000, planned_investment: 1200000, manager_id: people.manager.id }),
    health: await make({ name: 'Mobile Health Camps - Rajkot', category_id: cat('initiative', 'Healthcare'), city: 'Rajkot', state: 'Gujarat', planned_start: monthsAgo(5, 1), planned_end: monthsAhead(1), allocated_budget: 600000, planned_investment: 480000, manager_id: people.manager.id }),
    food: await make({ name: 'Community Kitchen - Vadodara', category_id: cat('initiative', 'Food Distribution'), city: 'Vadodara', state: 'Gujarat', planned_start: monthsAgo(6, 1), planned_end: monthsAgo(1, 28), allocated_budget: 400000, planned_investment: 350000 }),
    women: await make({ name: 'Women Skills Centre - Gandhinagar', status: 'planned', category_id: cat('initiative', 'Women Empowerment'), city: 'Gandhinagar', state: 'Gujarat', planned_start: monthsAhead(1, 1), planned_end: monthsAhead(7), allocated_budget: 900000, planned_investment: 700000 }),
    trees: await make({ name: 'Green Belt Plantation - Kutch', status: 'draft', category_id: cat('initiative', 'Environmental Protection'), city: 'Bhuj', state: 'Gujarat', allocated_budget: 250000, planned_investment: 200000 }),
  };
  const add = async (kind, c, monthsBack, amount, { day = 12, ...extra } = {}) => {
    const r = await entries.create(org.id, admin.id, ctx, { kind, campaign_id: c?.id, amount, entry_date: monthsAgo(monthsBack, day), ...extra });
    if (r.error) throw new Error(`${kind} ${amount}: ${r.error}`);
    return r.entry;
  };
  for (const [c, plan] of [[C.childcare, 5], [C.school, 4], [C.health, 6], [C.food, 6]]) {
    await add('funding', c, plan - 1, Math.round(Number(c.allocated_budget) * 0.6), { status: 'received', category_id: cat('funding', 'Donation'), party_name: 'Gulati Family Trust' });
  }
  await add('funding', C.school, 1, 300000, { status: 'pledged', category_id: cat('funding', 'Grant'), party_name: 'State education grant' });
  // spending: child care and school on a steady pace, health nearly spent, food finished
  const paid = (c, back, amount, extra = {}) => add('expense', c, back, amount, { status: 'paid', category_id: cat('expense', 'Campaign expenditure'), party_name: 'Vendor', payment_method: 'Bank transfer', ...extra });
  await paid(C.childcare, 2, 140000); await paid(C.childcare, 1, 160000); await paid(C.childcare, 0, 120000, { day: 3 });
  await paid(C.school, 1, 220000); await paid(C.school, 0, 180000, { day: 4 });
  await paid(C.health, 4, 90000); await paid(C.health, 3, 110000); await paid(C.health, 2, 100000); await paid(C.health, 1, 120000); await paid(C.health, 0, 110000, { day: 2 });
  await paid(C.food, 5, 110000); await paid(C.food, 4, 100000); await paid(C.food, 3, 90000); await paid(C.food, 2, 50000);
  await paid(C.childcare, 1, 30000, { expense_class: 'operational', category_id: cat('expense', 'Operational expense') });
  const refund = await paid(C.school, 1, 15000, { category_id: cat('expense', 'Equipment / material purchase') });
  await entries.setStatus(org.id, admin.id, ctx, refund.id, { to: 'reversed', reason: 'Returned by the vendor' });
  await add('expense', C.childcare, 0, 90000, { status: 'approved', category_id: cat('expense', 'Service payment'), party_name: 'Caterer', day: 5 });
  await add('expense', C.school, 0, 60000, { status: 'pending', category_id: cat('expense', 'Travel / logistics'), day: 6 });
  await add('transfer', null, 1, 500000, { status: 'recorded', party_name: 'Savings to current account' });
  await campaigns.setStatus(org.id, admin.id, ctx, C.food.id, { to: 'completed', reason: 'Demo' }).catch(() => {});
  await campaigns.setPlan(org.id, admin.id, C.childcare.id, { rows: Array.from({ length: 7 }, (_, i) => ({ month: monthsAgo(3 - i, 1).slice(0, 7), planned_amount: i < 6 ? 130000 : 20000 })) });
  console.log('  + demo foundation: 6 campaigns, a roster, funding, spending, a refund and a transfer');
  console.log(`    logins (password ${PASSWORD}): ${LOGINS.map((l) => l.email).join(', ')}`);
}

(async () => {
  if (!process.env.FOUNDATION_ADMIN_EMAIL) process.env.FOUNDATION_ADMIN_EMAIL = 'admin@gulatifoundation.in';
  if (!process.env.FOUNDATION_ADMIN_PASSWORD) process.env.FOUNDATION_ADMIN_PASSWORD = PASSWORD;
  const { org, admins } = await run();
  if (process.env.FOUNDATION_NO_DEMO !== '1') await demo(org, admins[0]);
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
