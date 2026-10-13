/**
 * Valterra Resources - demo workspace (LOCAL / STAGING DEMO ONLY; refuses a non-local database).
 *
 * Runs the non-destructive admin bootstrap first, then - only while the company has no investments - loads a small
 * set of mining books: a roster, five mining sites (quarry, iron ore, gold exploration, coal lease, and a closed pit),
 * site-wise investments with principal and earnings returns, mined-material sales, site operating costs, salaries by site,
 * company-level overheads, a transfer and projections. It writes through the same services as the API, so every figure
 * is computed as the app computes it.
 *
 * Usage (from server/):
 *   VALTERRA_ADMIN_EMAIL=admin@valterra.in VALTERRA_ADMIN_PASSWORD=Valterra@2026! node prisma/valterra/seed.js
 */
const bcrypt = require('bcryptjs');
const { assertNonProdDestructive } = require('../_guard');
const { run, prisma } = require('./seed-admin');

const PASSWORD = 'Valterra@2026!';
const LOGINS = [
  { name: 'Meera Kapoor', email: 'manager@valterra.in', access_role: 'manager', designation: 'Operations Manager' },
  { name: 'Arjun Nair', email: 'finance@valterra.in', access_role: 'finance', designation: 'Finance Controller' },
  { name: 'Isha Verma', email: 'staff@valterra.in', access_role: 'staff', designation: 'Accounts Executive' },
];
const ymd = (d) => d.toISOString().slice(0, 10);
const monthsAgo = (n, day = 10) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n); d.setUTCDate(day); return ymd(d); };
const monthsAhead = (n, day = 28) => monthsAgo(-n, day);

async function demo(org, admin) {
  assertNonProdDestructive('prisma/valterra/seed.js (demo company)');
  const core = require('../../src/modules/valterra/core.service');
  const sitesSvc = require('../../src/modules/valterra/sites.service');
  const investments = require('../../src/modules/valterra/investments.service');
  const entries = require('../../src/modules/valterra/entries.service');
  const projections = require('../../src/modules/valterra/projections.service');
  if ((await prisma.vtInvestment.count({ where: { org_id: org.id } })) > 0) { console.log('  = demo skipped (the company already has investments)'); return; }
  await core.ensureCategories(org.id);
  const hash = await bcrypt.hash(PASSWORD, 10);
  const staff = [];
  for (const l of LOGINS) {
    let user = await prisma.user.findUnique({ where: { email: l.email } });
    if (!user) user = await prisma.user.create({ data: { name: l.name, email: l.email, password_hash: hash, role: 'employee', active: true } });
    if (!(await prisma.orgMembership.findFirst({ where: { person_id: user.id, org_id: org.id } }))) await prisma.orgMembership.create({ data: { person_id: user.id, org_id: org.id, role: 'employee' } });
    staff.push((await prisma.vtPerson.findFirst({ where: { org_id: org.id, user_id: user.id, deleted_at: null } })) || (await prisma.vtPerson.create({ data: { org_id: org.id, name: l.name, user_id: user.id, access_role: l.access_role, designation: l.designation, kind: 'employee' } })));
  }
  const extra = [['Rohan Desai', 'Site Supervisor'], ['Kavya Iyer', 'Geologist'], ['Sameer Khan', 'Plant Operator']];
  const crew = [];
  for (const [name, designation] of extra) crew.push((await prisma.vtPerson.findFirst({ where: { org_id: org.id, name, deleted_at: null } })) || (await prisma.vtPerson.create({ data: { org_id: org.id, name, designation, kind: 'employee', access_role: 'none' } })));

  const cats = await prisma.vtCategory.findMany({ where: { org_id: org.id } });
  const cat = (scope, name) => cats.find((c) => c.scope === scope && c.name === name)?.id;
  const ctx = { isAdmin: true, payroll: true };
  const mk = async (body) => { const r = await sitesSvc.create(org.id, admin.id, body); if (r.error) throw new Error(`site ${body.name}: ${r.error}`); return r.site; };
  const quarry = await mk({ name: 'Kalyanpur Granite Quarry', location: 'Kalyanpur, Jodhpur', state: 'Rajasthan', district: 'Jodhpur', country: 'India', latitude: 26.2389, longitude: 73.0243, mining_type_id: cat('mining_type', 'Stone / quarry'), material_id: cat('material', 'Granite'), additional_materials: ['Aggregate'], description: 'Open-cast granite quarry supplying dressed blocks and aggregate.', status: 'active', start_date: monthsAgo(9, 1), manager_name: 'Rohan Desai' });
  const iron = await mk({ name: 'Bellary Iron Ore Block', location: 'Sandur, Bellary', state: 'Karnataka', district: 'Bellary', country: 'India', mining_type_id: cat('mining_type', 'Iron ore'), material_id: cat('material', 'Iron ore'), description: 'Leased iron ore block, haulage to the rail siding.', status: 'active', start_date: monthsAgo(8, 1), manager_name: 'Rohan Desai' });
  const gold = await mk({ name: 'Kolar Gold Exploration', location: 'Kolar Gold Fields', state: 'Karnataka', district: 'Kolar', country: 'India', mining_type_id: cat('mining_type', 'Gold'), material_id: cat('material', 'Gold ore'), description: 'Exploration drilling; no sales yet.', status: 'active', start_date: monthsAgo(6, 1), manager_name: 'Kavya Iyer' });
  const coal = await mk({ name: 'Jharia Coal Lease', location: 'Jharia, Dhanbad', state: 'Jharkhand', district: 'Dhanbad', country: 'India', mining_type_id: cat('mining_type', 'Coal'), material_id: cat('material', 'Coal'), description: 'Lease on hold pending clearance.', status: 'inactive', start_date: monthsAgo(7, 1) });
  const pit = await mk({ name: 'Old Sand Pit - Banas', location: 'Banas river bed', state: 'Rajasthan', district: 'Tonk', mining_type_id: cat('mining_type', 'Other mineral'), material_id: cat('material', 'Sand and aggregate'), description: 'Completed and closed; history kept.', status: 'active', start_date: monthsAgo(8, 1) });

  const inv = async (body) => { const r = await investments.create(org.id, admin.id, ctx, body); if (r.error) throw new Error(`investment ${body.name}: ${r.error}`); return r.investment; };
  const ret = async (i, back, principal, earnings, day = 12) => { const r = await investments.addReturn(org.id, admin.id, ctx, i.id, { return_date: monthsAgo(back, day), principal, earnings }); if (r.error) throw new Error(`return ${i.name}: ${r.error}`); };
  const add = async (body) => { const r = await entries.create(org.id, admin.id, ctx, body); if (r.error) throw new Error(`entry ${body.kind} ${body.amount}: ${r.error}`); };
  const I = (name) => cat('investment', name);

  const qDev = await inv({ name: 'Quarry development and benches', site_id: quarry.id, category_id: I('Site development'), investor: 'Valterra treasury', investment_date: monthsAgo(8, 4), amount: 4000000, expected_return_amount: 4800000, expected_return_date: monthsAhead(5, 15), reference: 'QD-01' });
  const qEq = await inv({ name: 'Crusher and loader', site_id: quarry.id, category_id: I('Equipment purchase'), investment_date: monthsAgo(7, 10), amount: 1800000, expected_return_amount: 2000000, expected_return_date: monthsAhead(2, 10) });
  const iLease = await inv({ name: 'Iron ore lease premium', site_id: iron.id, category_id: I('Land / lease'), investor: 'Partner fund', investment_date: monthsAgo(7, 18), amount: 6000000, expected_return_amount: 7200000, expected_return_date: monthsAhead(6, 18) });
  const gExp = await inv({ name: 'Exploration drilling programme', site_id: gold.id, category_id: I('Exploration'), investment_date: monthsAgo(5, 6), amount: 2500000, reference: 'GX-01' });
  const cLease = await inv({ name: 'Coal lease deposit', site_id: coal.id, category_id: I('Land / lease'), investment_date: monthsAgo(6, 12), amount: 1500000 });
  const pitInv = await inv({ name: 'Sand pit permit and setup', site_id: pit.id, category_id: I('Site development'), investment_date: monthsAgo(8, 20), amount: 500000, expected_return_amount: 560000, expected_return_date: monthsAgo(3, 20) });
  const corp = await inv({ name: 'Working capital line (company level)', category_id: I('Working capital'), investment_date: monthsAgo(6, 3), amount: 1000000, expected_return_amount: 1060000, expected_return_date: monthsAhead(3, 3) });
  await inv({ name: 'Second quarry bench (planned)', site_id: quarry.id, category_id: I('Site development'), status: 'planned', investment_date: monthsAhead(2, 5), amount: 2200000 });

  await ret(qDev, 4, 300000, 90000); await ret(qDev, 2, 400000, 140000); await ret(qDev, 1, 300000, 150000);
  await ret(qEq, 2, 200000, 40000); await ret(qEq, 1, 200000, 60000);
  await ret(iLease, 3, 500000, 120000); await ret(iLease, 1, 700000, 260000);
  await ret(pitInv, 5, 200000, 30000); await ret(pitInv, 3, 300000, 60000, 20);
  await ret(corp, 2, 0, 18000);

  const E = (n) => cat('expense', n);
  const R = (n) => cat('income', n);
  const bySite = [
    { site: quarry, sales: 520000, ops: 150000, fuel: 65000, rent: 35000, crew: [crew[0]] },
    { site: iron, sales: 690000, ops: 210000, fuel: 120000, rent: 60000, crew: [crew[0], crew[2]] },
    { site: gold, sales: 0, ops: 175000, fuel: 40000, rent: 25000, crew: [crew[1]] },
  ];
  for (let back = 5; back >= 0; back -= 1) {
    for (const [k, s] of bySite.entries()) {
      if (s.sales) await add({ kind: 'income', site_id: s.site.id, amount: s.sales + back * 9000 + k * 4000, entry_date: monthsAgo(back, 16), category_id: R('Mined material sales'), party_name: k === 0 ? 'Stone merchant' : 'Steel mill' });
      await add({ kind: 'expense', site_id: s.site.id, amount: s.ops + (back % 3) * 8000, entry_date: monthsAgo(back, 8), category_id: E('Site operations'), party_name: 'Site contractor' });
      await add({ kind: 'expense', site_id: s.site.id, amount: s.fuel, entry_date: monthsAgo(back, 12), category_id: E('Fuel and transport'), party_name: 'Fuel depot' });
      await add({ kind: 'expense', site_id: s.site.id, amount: s.rent, entry_date: monthsAgo(back, 2), category_id: E('Site rent / lease'), party_name: 'Land owner' });
      for (const [i, person] of s.crew.entries()) await add({ kind: 'salary', site_id: s.site.id, amount: 32000 + i * 6000, entry_date: monthsAgo(back, back === 0 ? 5 : 28), person_id: person.id });
    }
    // company level: overheads that belong to no single site (never spread over the sites)
    await add({ kind: 'expense', amount: 95000, entry_date: monthsAgo(back, 4), category_id: E('Administration'), party_name: 'Head office - Mumbai' });
    if (back % 2 === 0) await add({ kind: 'expense', amount: 28000, entry_date: monthsAgo(back, 18), category_id: E('Service charges'), party_name: 'Chartered accountant' });
    await add({ kind: 'salary', amount: 42000, entry_date: monthsAgo(back, back === 0 ? 5 : 28), person_id: staff[0].id });
    if (back >= 3) await add({ kind: 'income', site_id: pit.id, amount: 140000, entry_date: monthsAgo(back, 15), category_id: R('Mined material sales'), party_name: 'Builder' });
  }
  await add({ kind: 'expense', site_id: quarry.id, amount: 240000, entry_date: monthsAgo(2, 22), category_id: E('Equipment rental and maintenance'), party_name: 'Crane hire', expense_class: 'other' });
  await add({ kind: 'expense', site_id: iron.id, amount: 86000, entry_date: monthsAgo(0, 5), category_id: E('Repairs and maintenance'), payment_status: 'unpaid', due_date: monthsAhead(0, 25), party_name: 'Workshop' });
  await add({ kind: 'income', site_id: iron.id, amount: 310000, entry_date: monthsAgo(1, 25), category_id: R('Mined material sales'), payment_status: 'unpaid', due_date: monthsAgo(0, 1), party_name: 'Steel mill' });
  await add({ kind: 'transfer', amount: 800000, entry_date: monthsAgo(1, 6), party_name: 'Savings to current account' });

  const plan = async (month, line, amount, name, extraBody = {}) => { const r = await projections.create(org.id, admin.id, { name, month, line, amount, status: 'approved', ...extraBody }); if (r.error) throw new Error(`projection ${name}: ${r.error}`); };
  for (let k = -3; k <= 8; k += 1) {
    const m = monthsAgo(-k, 1).slice(0, 7);
    await plan(m, 'other_income', 560000 + k * 8000, `Quarry sales plan ${m}`, { site_id: quarry.id });
    await plan(m, 'other_income', 720000 + k * 6000, `Iron ore sales plan ${m}`, { site_id: iron.id });
    await plan(m, 'operating_expense', 320000, `Quarry and iron ore operating budget ${m}`);
    await plan(m, 'operating_expense', 190000, `Iron ore operating budget ${m}`, { site_id: iron.id });
    await plan(m, 'salary', 120000, `Salary plan ${m}`);
    if (k % 2 === 0) await plan(m, 'investment_earnings', 85000, `Expected earnings ${m}`, { site_id: iron.id });
  }
  await plan(monthsAhead(2, 1).slice(0, 7), 'new_investment', 2200000, 'Second quarry bench', { status: 'draft', site_id: quarry.id });
  await plan(monthsAhead(5, 1).slice(0, 7), 'principal_recovery', 1500000, 'Iron ore principal recovery (expected)', { investment_id: iLease.id, site_id: iron.id });
  await sitesSvc.update(org.id, admin.id, pit.id, { status: 'closed', reason: 'Pit exhausted' });
  void gExp; void cLease;
  console.log('  + demo company: 5 mining sites (one closed), site-wise investments, returns, sales, costs, salaries, company overheads, a transfer and projections');
  console.log(`    logins (password ${PASSWORD}): ${LOGINS.map((l) => l.email).join(', ')}`);
}

(async () => {
  if (!process.env.VALTERRA_ADMIN_EMAIL) process.env.VALTERRA_ADMIN_EMAIL = 'admin@valterra.in';
  if (!process.env.VALTERRA_ADMIN_PASSWORD) process.env.VALTERRA_ADMIN_PASSWORD = PASSWORD;
  const { org, admins } = await run();
  if (process.env.VALTERRA_NO_DEMO !== '1') await demo(org, admins[0]);
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
