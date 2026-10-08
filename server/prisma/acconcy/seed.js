/**
 * Acconcy Finance - standalone demo workspace (LOCAL / STAGING DEMO ONLY; refuses a non-local database).
 *
 * Creates, only where missing, its own holding group + the `acconcy` org (module `acconcy`), an admin / manager /
 * finance / staff / contractor login, a small roster with salaries, and a demo finance business spread over the last
 * six months: clients and vendors, leads in every stage across all six services, converted and direct deals with
 * revenue and expenses, investments (gold, silver, venture, one partly realised), assets, salary sheets and a few
 * recorded valuations. It uses the same services as the API, so every figure is computed the way the app computes it.
 * Idempotent: the demo business is only created while the org has no parties.
 *
 * Usage (from server/, DATABASE_URL pointed at the target DB):
 *   node prisma/acconcy/seed.js          (ACCONCY_NO_DEMO=1 skips the demo business)
 */
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { assertNonProdDestructive } = require('../_guard');

const prisma = new PrismaClient();
const PASSWORD = 'Acconcy@2026!';
const LOGINS = [
  { name: 'Acconcy Admin', email: 'admin@acconcy.in', role: 'admin', access_role: null },
  { name: 'Meera Kapoor', email: 'manager@acconcy.in', role: 'employee', access_role: 'manager', kind: 'employee', salary: 120000, designation: 'Associate Director' },
  { name: 'Rohan Desai', email: 'finance@acconcy.in', role: 'employee', access_role: 'finance', kind: 'employee', salary: 90000, designation: 'Finance Controller' },
  { name: 'Isha Verma', email: 'staff@acconcy.in', role: 'employee', access_role: 'staff', kind: 'employee', salary: 60000, designation: 'Analyst' },
  { name: 'Arjun Nair', email: 'contractor@acconcy.in', role: 'employee', access_role: 'contractor', kind: 'contractor', salary: 45000, designation: 'Valuation consultant' },
];

const ymd = (d) => d.toISOString().slice(0, 10);
const monthsAgo = (n, day = 10) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  d.setUTCDate(day);
  return ymd(d);
};
const monthKey = (n) => monthsAgo(n).slice(0, 7);
const daysFromNow = (n) => ymd(new Date(Date.now() + n * 86400000));

async function demo(org, adminId) {
  const core = require('../../src/modules/acconcy/core.service');
  const parties = require('../../src/modules/acconcy/parties.service');
  const leads = require('../../src/modules/acconcy/leads.service');
  const deals = require('../../src/modules/acconcy/deals.service');
  const ledger = require('../../src/modules/acconcy/ledger.service');
  const tasks = require('../../src/modules/acconcy/tasks.service');
  const investments = require('../../src/modules/acconcy/investments.service');
  const salaries = require('../../src/modules/acconcy/salaries.service');
  const finance = require('../../src/modules/acconcy/finance.service');
  const orgId = org.id;
  const ctx = { isAdmin: true, reason: 'demo seed' };

  if ((await prisma.axParty.count({ where: { org_id: orgId } })) > 0) {
    console.log('  demo business already present, skipping');
    return;
  }
  await core.ensureCategories(orgId);

  const mk = async (input) => (await parties.create(orgId, adminId, parties.createPartySchema.parse(input))).party;
  const nova = await mk({ kind: 'client', name: 'Nova Textiles Ltd', contact_name: 'Sanjay Rao', phone: '9820011001', email: 'sanjay@novatextiles.example', city: 'Mumbai', state: 'Maharashtra', country: 'India' });
  const helios = await mk({ kind: 'client', name: 'Helios Energy Pvt Ltd', contact_name: 'Priya Menon', phone: '9820022002', city: 'Bengaluru', state: 'Karnataka', country: 'India' });
  const zenith = await mk({ kind: 'client', name: 'Zenith Foods', contact_name: 'Amit Khanna', phone: '9820033003', city: 'Delhi', state: 'Delhi', country: 'India' });
  const kiran = await mk({ kind: 'client', name: 'Kiran Family Office', contact_name: 'Kiran Patel', phone: '9820044004', city: 'Ahmedabad', state: 'Gujarat', country: 'India' });
  const legal = await mk({ kind: 'vendor', name: 'Lexis Legal Partners', contact_name: 'Rhea Sethi', phone: '9820055005', city: 'Mumbai', state: 'Maharashtra', country: 'India', vendor_category: 'Legal', materials_services: 'Due diligence legal support' });
  const bullion = await mk({ kind: 'vendor', name: 'Shree Bullion House', contact_name: 'Dilip Soni', phone: '9820066006', city: 'Mumbai', state: 'Maharashtra', country: 'India', vendor_category: 'Bullion dealer', materials_services: 'Gold and silver bars' });
  const valuer = await mk({ kind: 'vendor', name: 'Prime Valuers & Co', contact_name: 'Naveen Joshi', phone: '9820077007', city: 'Pune', state: 'Maharashtra', country: 'India', vendor_category: 'Valuer' });

  const person = (name) => prisma.axPerson.findFirst({ where: { org_id: orgId, name } });
  const manager = await person('Meera Kapoor');
  const analyst = await person('Isha Verma');
  const consultant = await person('Arjun Nair');

  const lead = async (input, stages = []) => {
    const created = (await leads.create(orgId, adminId, leads.createLeadSchema.parse(input))).lead;
    for (const stage of stages) await leads.changeStage(orgId, adminId, created.id, leads.stageSchema.parse(stage === 'dropped' ? { stage, lost_reason: 'Client chose an in-house team' } : { stage }));
    return created;
  };
  const WON = ['in_discussion', 'qualification', 'proposal', 'negotiation', 'won'];
  const L = {
    consulting: await lead({ name: 'Group financial restructuring: Nova Textiles', service_type: 'financial_consulting', party_id: nova.id, assignee_id: manager?.id, location: 'Mumbai', source: 'Referral', expected_amount: 1200000, expected_revenue: 1200000, expected_profit: 800000, expected_start: monthsAgo(5, 1), expected_end: monthsAgo(1, 28), description: 'Review the capital structure of the group, propose a debt refinancing plan and a 3-year cash-flow model.' }, WON),
    advisory: await lead({ name: 'Buy-side advisory: Helios Energy acquisition', service_type: 'transaction_advisory', party_id: helios.id, assignee_id: manager?.id, location: 'Bengaluru', source: 'Event', expected_amount: 3500000, expected_revenue: 3500000, expected_profit: 2000000, expected_start: monthsAgo(4, 1), expected_end: daysFromNow(30), description: 'Financial due diligence and transaction structuring for the acquisition of a solar developer.' }, WON),
    valuation: await lead({ name: 'Valuation: Zenith Foods ESOP', service_type: 'valuation', party_id: zenith.id, contractor_id: consultant?.id, location: 'Delhi', source: 'Website', expected_amount: 450000, expected_revenue: 450000, expected_start: monthsAgo(3, 1), expected_end: monthsAgo(2, 20), description: 'Fair value of equity for ESOP grants, DCF and comparable multiples.' }, WON),
    corporate: await lead({ name: 'Term-loan syndication: Helios Energy', service_type: 'corporate_finance', party_id: helios.id, assignee_id: analyst?.id, location: 'Bengaluru', source: 'Referral', expected_amount: 2500000 }, ['in_discussion', 'qualification', 'proposal']),
    vc: await lead({ name: 'Seed round: AgriGrid Technologies', service_type: 'venture_capital', assignee_id: manager?.id, location: 'Hyderabad', source: 'Event', expected_amount: 5000000, description: 'Seed-stage agritech startup; term sheet under discussion.' }, ['in_discussion', 'qualification', 'proposal', 'negotiation']),
    gold: await lead({ name: 'Gold accumulation plan: Kiran Family Office', service_type: 'gold_silver', party_id: kiran.id, assignee_id: analyst?.id, location: 'Ahmedabad', source: 'Referral', expected_amount: 8000000 }, ['in_discussion']),
  };
  await lead({ name: 'Valuation enquiry: logistics start-up', service_type: 'valuation', location: 'Pune', source: 'Website' });
  await lead({ name: 'Business plan review (lost)', service_type: 'financial_consulting', party_id: zenith.id, expected_amount: 300000 }, ['in_discussion', 'dropped']);
  await lead({ name: 'Debt restructuring (on hold)', service_type: 'corporate_finance', party_id: nova.id, expected_amount: 1800000 }, ['on_hold']);

  const conv = async (l, status) => {
    const d = (await deals.convertLead(orgId, adminId, l.id, deals.convertSchema.parse({}))).deal;
    if (status) await deals.changeStatus(orgId, adminId, ctx, d.id, { status });
    return d;
  };
  const dConsult = await conv(L.consulting, 'active');
  const dAdvisory = await conv(L.advisory, 'active');
  const dValuation = await conv(L.valuation, 'active');
  const dDirect = (await deals.create(orgId, adminId, deals.createDealSchema.parse({ name: 'Bullion sourcing mandate: Kiran Family Office', service_type: 'gold_silver', party_id: kiran.id, vendor_id: bullion.id, status: 'active', start_date: monthsAgo(5, 5), expected_end: daysFromNow(60), deal_amount: 2500000, assignee_id: analyst?.id, location: 'Mumbai', description: 'Sourcing and safekeeping of gold bars for the family office.' }))).deal;
  const dVc = (await deals.create(orgId, adminId, deals.createDealSchema.parse({ name: 'Portfolio monitoring: Startup X', service_type: 'venture_capital', status: 'planned', start_date: daysFromNow(5), deal_amount: 1000000 }))).deal;

  const cat = async (kind) => (await core.listCategories(orgId, kind)).reduce((a, c) => ({ ...a, [c.name]: c.id }), {});
  const rev = await cat('revenue');
  const exp = await cat('expense');
  const entry = (input) => ledger.create(orgId, adminId, ctx, ledger.createEntrySchema.parse(input));
  const R = (n, deal, name, amount, extra = {}) => entry({ entry_date: monthsAgo(n, 12), type: 'revenue', category_id: rev[name], deal_id: deal?.id, party_id: deal?.party_id, amount, ...extra });
  const E = (n, deal, name, amount, extra = {}) => entry({ entry_date: monthsAgo(n, 18), type: 'expense', category_id: exp[name], deal_id: deal?.id, amount, ...extra });
  // consulting: retainer billed monthly
  for (const [n, a] of [[5, 300000], [4, 300000], [3, 300000], [2, 300000]]) await R(n, dConsult, 'Consulting fees', a, { description: `Retainer ${monthKey(n)}` });
  await E(4, dConsult, 'Professional fees', 90000, { vendor_id: legal.id });
  await E(2, dConsult, 'Travel', 35000);
  // advisory: milestones
  await R(4, dAdvisory, 'Advisory fees', 700000, { description: 'Milestone 1' });
  await R(3, dAdvisory, 'Transaction fees', 900000, { description: 'Milestone 2' });
  await R(1, dAdvisory, 'Transaction fees', 1100000, { description: 'Milestone 3' });
  await E(3, dAdvisory, 'Professional fees', 250000, { vendor_id: legal.id });
  await E(3, dAdvisory, 'Documentation', 40000);
  await E(1, dAdvisory, 'Legal', 180000, { vendor_id: legal.id });
  // valuation engagement
  await R(2, dValuation, 'Valuation fees', 450000);
  await E(2, dValuation, 'Professional fees', 120000, { vendor_id: valuer.id });
  // bullion mandate: small advisory fee
  await R(3, dDirect, 'Advisory fees', 150000);
  await E(3, dDirect, 'Bank charges', 8000);
  // company level
  await entry({ entry_date: monthsAgo(2, 20), type: 'revenue', category_id: rev['Other income'], amount: 25000, description: 'Interest on deposits' });
  for (const n of [5, 4, 3, 2, 1, 0]) await entry({ entry_date: monthsAgo(n, 3), type: 'expense', category_id: exp.Office, amount: 45000, description: 'Office rent' });

  // investments
  const inv = async (input) => (await investments.create(orgId, adminId, ctx, investments.createInvestmentSchema.parse(input))).investment;
  const gold = await inv({ name: '1 kg gold bars (999)', type: 'gold', deal_id: dDirect.id, investment_date: monthsAgo(5, 8), amount: 6200000, quantity: 1000, unit: 'g', purchase_price: 6200, current_price: 7050, current_value: 7050000, purity: '999', storage_location: 'Bank locker, Mumbai' });
  await inv({ name: 'Silver coins lot', type: 'silver', investment_date: monthsAgo(4, 15), amount: 400000, quantity: 5000, unit: 'g', purchase_price: 80, current_price: 78, current_value: 390000 });
  await inv({ name: 'AgriGrid Technologies (seed)', type: 'venture', startup_name: 'AgriGrid Technologies Pvt Ltd', equity_pct: 4.5, investment_date: monthsAgo(3, 20), amount: 2500000, current_value: 3200000 });
  const exited = await inv({ name: 'FinPay Labs (early exit)', type: 'venture', startup_name: 'FinPay Labs', investment_date: monthsAgo(5, 20), amount: 1000000, current_value: 1400000 });
  await investments.realise(orgId, adminId, ctx, exited.id, investments.realiseSchema.parse({ realised_date: monthsAgo(1, 15), amount_received: 700000, cost_released: 500000, remaining_value: 760000, notes: 'Partial secondary sale' }));

  // assets
  for (const [name, category, value, n] of [['Office premises (Mumbai)', 'property', 18000000, 5], ['Operating bank balance', 'cash_bank', 6500000, 5], ['Computers and equipment', 'equipment', 900000, 5]]) {
    await investments.createAsset(orgId, adminId, ctx, investments.createAssetSchema.parse({ name, category, value, as_of_date: monthsAgo(n, 1) }));
  }

  // salaries: generate, approve and pay the last four closed months, approve the current one
  for (const n of [4, 3, 2, 1, 0]) {
    const month = monthKey(n);
    await salaries.generate(orgId, adminId, ctx, { month });
    for (const r of (await salaries.list(orgId, { month })).data) {
      await salaries.setStatus(orgId, adminId, ctx, r.id, 'approved');
      if (n > 0) await salaries.setStatus(orgId, adminId, ctx, r.id, 'paid', { paid_on: monthsAgo(n - 1, 1) });
    }
  }

  // tasks
  const task = (input) => tasks.create(orgId, adminId, tasks.createTaskSchema.parse(input));
  await task({ title: 'Collect financials for due diligence', task_type: 'due_diligence', deal_id: dAdvisory.id, assignee_id: analyst?.id, due_date: daysFromNow(3), priority: 'high' });
  await task({ title: 'Finalise DCF model', task_type: 'valuation_analysis', deal_id: dValuation.id, contractor_id: consultant?.id, due_date: daysFromNow(7) });
  await task({ title: 'Quarterly review meeting with Nova Textiles', task_type: 'client_meeting', deal_id: dConsult.id, party_id: nova.id, assignee_id: manager?.id, due_date: daysFromNow(-1), priority: 'high' });
  await task({ title: 'Update gold rate and holdings', task_type: 'investment_monitoring', deal_id: dVc.id, assignee_id: analyst?.id, due_date: daysFromNow(2) });

  // close the oldest complete month, so locking and the valuation history can be seen
  await finance.closeMonth(orgId, adminId, monthKey(4), { note: 'Demo close' });
  await finance.recordValuation(orgId, adminId, { month: monthKey(1), notes: 'Demo valuation' });
  console.log('  + demo business (parties, leads, deals, ledger, investments, assets, salaries, tasks, valuations)');
  return gold;
}

async function main() {
  assertNonProdDestructive('acconcy/seed.js');

  let org = await prisma.org.findUnique({ where: { slug: 'acconcy' } });
  if (!org) {
    const group = await prisma.orgGroup.create({ data: { name: 'Acconcy Finance' } });
    org = await prisma.org.create({
      data: { org_group_id: group.id, name: 'Acconcy Finance', slug: 'acconcy', logo_url: '/acconcy-logo.png', timezone: 'Asia/Kolkata', default_currency: 'INR', enabled_modules: ['acconcy'] },
    });
    console.log('  + org "Acconcy Finance"');
  } else if (!org.enabled_modules.includes('acconcy') || org.enabled_modules.length !== 1) {
    org = await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['acconcy'] } });
    console.log('  ~ org modules set to [acconcy]');
  }

  const password_hash = await bcrypt.hash(PASSWORD, 10);
  for (const login of LOGINS) {
    let user = await prisma.user.findUnique({ where: { email: login.email } });
    if (!user) {
      user = await prisma.user.create({ data: { name: login.name, email: login.email, password_hash, role: login.role, active: true } });
      console.log(`  + user ${login.email}`);
    }
    if (!(await prisma.orgMembership.findFirst({ where: { person_id: user.id, org_id: org.id } }))) {
      await prisma.orgMembership.create({ data: { person_id: user.id, org_id: org.id, role: login.role } });
    }
    if (login.access_role && !(await prisma.axPerson.findFirst({ where: { org_id: org.id, user_id: user.id } }))) {
      await prisma.axPerson.create({ data: { org_id: org.id, name: login.name, user_id: user.id, access_role: login.access_role, kind: login.kind || 'employee', designation: login.designation, monthly_salary: login.salary } });
    }
  }
  await prisma.axSetting.upsert({ where: { org_id: org.id }, update: {}, create: { org_id: org.id } });

  if (process.env.ACCONCY_NO_DEMO !== '1') {
    const admin = await prisma.user.findUnique({ where: { email: 'admin@acconcy.in' } });
    await demo(org, admin.id);
  }

  console.log('Acconcy seed done.');
  for (const l of LOGINS) console.log(`  ${(l.access_role || 'admin').padEnd(10)} ${l.email} / ${PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
