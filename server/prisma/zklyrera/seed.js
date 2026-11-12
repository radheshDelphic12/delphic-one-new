/**
 * Zklyrera Spirits - demo workspace (LOCAL / STAGING DEMO ONLY; refuses a non-local database).
 *
 * Runs the non-destructive admin bootstrap first, then - only while the company has no investments - loads a small
 * set of books: a roster (manager, finance, staff and salaried employees), five investments with principal and
 * earnings returns, income, expenses, salaries (paid and unpaid), an internal transfer and projections for the
 * months around today. It writes through the same services as the API, so every figure is computed as the app computes it.
 *
 * Usage (from server/):
 *   ZKLYRERA_ADMIN_EMAIL=admin@zklyrera.in ZKLYRERA_ADMIN_PASSWORD=Zklyrera@2026! node prisma/zklyrera/seed.js
 */
const bcrypt = require('bcryptjs');
const { assertNonProdDestructive } = require('../_guard');
const { run, prisma } = require('./seed-admin');

const PASSWORD = 'Zklyrera@2026!';
const LOGINS = [
  { name: 'Meera Kapoor', email: 'manager@zklyrera.in', access_role: 'manager', designation: 'Operations Manager' },
  { name: 'Arjun Nair', email: 'finance@zklyrera.in', access_role: 'finance', designation: 'Finance Controller' },
  { name: 'Isha Verma', email: 'staff@zklyrera.in', access_role: 'staff', designation: 'Accounts Executive' },
];
const ymd = (d) => d.toISOString().slice(0, 10);
const monthsAgo = (n, day = 10) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n); d.setUTCDate(day); return ymd(d); };
const monthsAhead = (n, day = 28) => monthsAgo(-n, day);

async function demo(org, admin) {
  assertNonProdDestructive('prisma/zklyrera/seed.js (demo company)');
  const core = require('../../src/modules/zklyrera/core.service');
  const investments = require('../../src/modules/zklyrera/investments.service');
  const entries = require('../../src/modules/zklyrera/entries.service');
  const projections = require('../../src/modules/zklyrera/projections.service');
  if ((await prisma.zkInvestment.count({ where: { org_id: org.id } })) > 0) { console.log('  = demo skipped (the company already has investments)'); return; }
  await core.ensureCategories(org.id);
  const hash = await bcrypt.hash(PASSWORD, 10);
  const staff = [];
  for (const l of LOGINS) {
    let user = await prisma.user.findUnique({ where: { email: l.email } });
    if (!user) user = await prisma.user.create({ data: { name: l.name, email: l.email, password_hash: hash, role: 'employee', active: true } });
    if (!(await prisma.orgMembership.findFirst({ where: { person_id: user.id, org_id: org.id } }))) await prisma.orgMembership.create({ data: { person_id: user.id, org_id: org.id, role: 'employee' } });
    staff.push((await prisma.zkPerson.findFirst({ where: { org_id: org.id, user_id: user.id, deleted_at: null } })) || (await prisma.zkPerson.create({ data: { org_id: org.id, name: l.name, user_id: user.id, access_role: l.access_role, designation: l.designation, kind: 'employee' } })));
  }
  const extra = [['Rohan Desai', 'Master Blender'], ['Kavya Iyer', 'Brand Manager'], ['Sameer Khan', 'Distribution Lead']];
  const salaried = [...staff];
  for (const [name, designation] of extra) salaried.push((await prisma.zkPerson.findFirst({ where: { org_id: org.id, name, deleted_at: null } })) || (await prisma.zkPerson.create({ data: { org_id: org.id, name, designation, kind: 'employee', access_role: 'none' } })));

  const cats = await prisma.zkCategory.findMany({ where: { org_id: org.id } });
  const cat = (scope, name) => cats.find((c) => c.scope === scope && c.name === name)?.id;
  const ctx = { isAdmin: true, payroll: true };
  const inv = async (body) => { const r = await investments.create(org.id, admin.id, ctx, body); if (r.error) throw new Error(`investment ${body.name}: ${r.error}`); return r.investment; };
  const ret = async (i, back, principal, earnings, day = 12) => { const r = await investments.addReturn(org.id, admin.id, ctx, i.id, { return_date: monthsAgo(back, day), principal, earnings }); if (r.error) throw new Error(`return ${i.name}: ${r.error}`); };
  const add = async (body) => { const r = await entries.create(org.id, admin.id, ctx, body); if (r.error) throw new Error(`entry ${body.kind} ${body.amount}: ${r.error}`); };

  const equity = await inv({ name: 'Heritage Spirits Equity', category_id: cat('investment', 'Equity'), investor: 'Zklyrera treasury', investment_date: monthsAgo(6, 4), amount: 2500000, expected_return_amount: 2900000, expected_return_date: monthsAhead(4, 15), reference: 'EQ-2026-01' });
  const fd = await inv({ name: 'Fixed deposit - HDFC', category_id: cat('investment', 'Fixed deposit'), investment_date: monthsAgo(5, 10), amount: 1000000, expected_return_amount: 1065000, expected_return_date: monthsAgo(1, 10), reference: 'FD-77821' });
  const lend = await inv({ name: 'Distributor working-capital loan', category_id: cat('investment', 'Debt / lending'), investor: 'Sharma Distributors', investment_date: monthsAgo(4, 18), amount: 600000, expected_return_amount: 648000, expected_return_date: monthsAhead(2, 18) });
  const done = await inv({ name: 'Short-term liquid fund', category_id: cat('investment', 'Fund / portfolio'), investment_date: monthsAgo(6, 20), amount: 400000, expected_return_amount: 412000, expected_return_date: monthsAgo(3, 20) });
  await inv({ name: 'Warehouse expansion (planned)', category_id: cat('investment', 'Real estate'), status: 'planned', investment_date: monthsAhead(2, 5), amount: 1800000 });

  await ret(equity, 3, 0, 55000); await ret(equity, 1, 300000, 40000);
  await ret(lend, 2, 100000, 9000); await ret(lend, 1, 100000, 8500);
  await ret(done, 4, 150000, 3000); await ret(done, 3, 250000, 9000, 20);
  await ret(fd, 0, 0, 14000, 3);

  const E = { rent: cat('expense', 'Rent and utilities'), ops: cat('expense', 'Operations'), mkt: cat('expense', 'Marketing and business development'), pro: cat('expense', 'Professional and service fees'), travel: cat('expense', 'Travel and transport'), equip: cat('expense', 'Equipment and assets'), inc: cat('income', 'Sales'), com: cat('income', 'Commission'), rental: cat('income', 'Rental income') };
  for (let back = 5; back >= 0; back -= 1) {
    await add({ kind: 'expense', amount: 85000, entry_date: monthsAgo(back, 2), category_id: E.rent, party_name: 'Landlord - Andheri unit' });
    await add({ kind: 'expense', amount: 62000 + back * 3000, entry_date: monthsAgo(back, 8), category_id: E.ops, party_name: 'Bottling vendor' });
    await add({ kind: 'expense', amount: 38000 + (back % 3) * 9000, entry_date: monthsAgo(back, 14), category_id: E.mkt, party_name: 'Brand agency' });
    if (back % 2 === 0) await add({ kind: 'expense', amount: 24000, entry_date: monthsAgo(back, 18), category_id: E.pro, party_name: 'Chartered accountant' });
    await add({ kind: 'income', amount: 410000 + back * 12000, entry_date: monthsAgo(back, 16), category_id: E.inc, party_name: 'Retail partner' });
    if (back % 3 === 0) await add({ kind: 'income', amount: 45000, entry_date: monthsAgo(back, 21), category_id: E.rental, party_name: 'Sublet - ground floor' });
    for (const [i, person] of salaried.entries()) await add({ kind: 'salary', amount: 24000 + i * 3500, entry_date: monthsAgo(back, back === 0 ? 5 : 28), person_id: person.id });
  }
  await add({ kind: 'expense', amount: 210000, entry_date: monthsAgo(2, 22), category_id: E.equip, party_name: 'Still maker', expense_class: 'other' });
  await add({ kind: 'expense', amount: 31000, entry_date: monthsAgo(0, 5), category_id: E.travel, payment_status: 'unpaid', due_date: monthsAhead(0, 25), party_name: 'Travel desk' });
  await add({ kind: 'expense', amount: 56000, entry_date: monthsAgo(1, 12), category_id: E.pro, payment_status: 'unpaid', due_date: monthsAgo(0, 2), party_name: 'Legal counsel' });
  await add({ kind: 'income', amount: 68000, entry_date: monthsAgo(1, 25), category_id: E.com, payment_status: 'unpaid', due_date: monthsAgo(0, 1), party_name: 'Export agent' });
  await add({ kind: 'salary', amount: 24000, entry_date: monthsAgo(0, 9), person_id: salaried[0].id, payment_status: 'unpaid', due_date: monthsAhead(0, 25) });
  await add({ kind: 'transfer', amount: 500000, entry_date: monthsAgo(1, 6), party_name: 'Savings to current account' });

  const plan = async (month, line, amount, name, extraBody = {}) => { const r = await projections.create(org.id, admin.id, { name, month, line, amount, status: 'approved', ...extraBody }); if (r.error) throw new Error(`projection ${name}: ${r.error}`); };
  for (let k = -3; k <= 8; k += 1) {
    const m = monthsAgo(-k, 1).slice(0, 7);
    await plan(m, 'operating_expense', 190000, `Operating budget ${m}`);
    await plan(m, 'salary', 150000 + (k > 2 ? 30000 : 0), `Salary plan ${m}`);
    await plan(m, 'other_income', 400000 + k * 4000, `Sales plan ${m}`);
    if (k % 2 === 0) await plan(m, 'investment_earnings', 35000, `Expected earnings ${m}`);
  }
  await plan(monthsAhead(2, 1).slice(0, 7), 'new_investment', 1800000, 'Warehouse expansion', { status: 'draft' });
  await plan(monthsAhead(4, 1).slice(0, 7), 'principal_recovery', 2000000, 'Equity exit (expected)', { investment_id: equity.id });
  console.log('  + demo company: 5 investments with returns, 6 months of income / expenses / salaries, a transfer and projections');
  console.log(`    logins (password ${PASSWORD}): ${LOGINS.map((l) => l.email).join(', ')}`);
}

(async () => {
  if (!process.env.ZKLYRERA_ADMIN_EMAIL) process.env.ZKLYRERA_ADMIN_EMAIL = 'admin@zklyrera.in';
  if (!process.env.ZKLYRERA_ADMIN_PASSWORD) process.env.ZKLYRERA_ADMIN_PASSWORD = PASSWORD;
  const { org, admins } = await run();
  if (process.env.ZKLYRERA_NO_DEMO !== '1') await demo(org, admins[0]);
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
