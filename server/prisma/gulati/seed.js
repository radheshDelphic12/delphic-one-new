/**
 * Gulati Industries - standalone demo workspace (LOCAL / STAGING DEMO ONLY).
 *
 * Creates, only where missing, its own holding group + the `gulati` org (module `gulati`), an
 * admin / manager / finance / staff / contractor login, a small roster, the default masters
 * (trading types, units, categories) and a demo trading business: clients, vendors, leads in every
 * stage, a converted Copper Cathode deal with purchases, sales, expenses and payments, and tasks.
 * Uses the same services as the API, so every figure is computed the way the app computes it.
 * Idempotent: the demo business is only created while the org has no parties.
 *
 * Usage (from server/, DATABASE_URL pointed at the target DB):
 *   node prisma/gulati/seed.js          (GULATI_NO_DEMO=1 skips the demo business)
 */
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { assertNonProdDestructive } = require('../_guard');

const prisma = new PrismaClient();
const PASSWORD = 'Gulati@2026!';
const LOGINS = [
  { name: 'Gulati Admin', email: 'admin@gulatiindustries.in', role: 'admin', access_role: null },
  { name: 'Karan Gulati', email: 'manager@gulatiindustries.in', role: 'employee', access_role: 'manager', kind: 'employee' },
  { name: 'Neha Arora', email: 'finance@gulatiindustries.in', role: 'employee', access_role: 'finance', kind: 'employee' },
  { name: 'Vikram Singh', email: 'staff@gulatiindustries.in', role: 'employee', access_role: 'staff', kind: 'employee' },
  { name: 'Suresh Transport', email: 'contractor@gulatiindustries.in', role: 'employee', access_role: 'contractor', kind: 'contractor' },
];

const ymd = (d) => d.toISOString().slice(0, 10);
const daysFromNow = (n) => ymd(new Date(Date.now() + n * 86400000));

async function demo(org, adminId) {
  const core = require('../../src/modules/gulati/core.service');
  const parties = require('../../src/modules/gulati/parties.service');
  const leads = require('../../src/modules/gulati/leads.service');
  const deals = require('../../src/modules/gulati/deals.service');
  const ledger = require('../../src/modules/gulati/ledger.service');
  const tasks = require('../../src/modules/gulati/tasks.service');
  const orgId = org.id;
  const ctx = { isAdmin: true, reason: 'demo seed' };

  if ((await prisma.gxParty.count({ where: { org_id: orgId } })) > 0) {
    console.log('  demo business already present, skipping');
    return;
  }
  await core.ensureCategories(orgId);
  await core.ensureUnits(orgId);
  await core.ensureTypes(orgId);

  const mk = async (input) => (await parties.create(orgId, adminId, parties.createPartySchema.parse(input))).party;
  const abc = await mk({ kind: 'client', name: 'ABC Industries', company_name: 'ABC Industries Pvt Ltd', contact_name: 'Rahul Mehta', phone: '9810011001', city: 'Mumbai', state: 'Maharashtra', country: 'India', payment_terms: '30 days' });
  const shree = await mk({ kind: 'client', name: 'Shree Metals Traders', contact_name: 'Anil Shah', phone: '9810022002', city: 'Ahmedabad', state: 'Gujarat', country: 'India' });
  const xyz = await mk({ kind: 'vendor', name: 'XYZ Metals', contact_name: 'Pooja Jain', phone: '9810033003', city: 'Jaipur', state: 'Rajasthan', country: 'India', vendor_category: 'Copper producer', materials_services: 'Copper Cathode, LME grade A' });
  const raj = await mk({ kind: 'vendor', name: 'Rajputana Copper', contact_name: 'Dev Rathore', phone: '9810044004', city: 'Udaipur', state: 'Rajasthan', country: 'India', vendor_category: 'Copper producer', materials_services: 'Copper Cathode, Copper Rod' });
  await mk({ kind: 'both', name: 'Bharat Commodities', contact_name: 'Ritu Bansal', phone: '9810055005', city: 'Delhi', state: 'Delhi', country: 'India', vendor_category: 'Trader' });

  const mkPerson = async (name, kind, designation) => prisma.gxPerson.findFirst({ where: { org_id: orgId, name } }) || prisma.gxPerson.create({ data: { org_id: orgId, name, kind, designation } });
  const sourcing = await prisma.gxPerson.findFirst({ where: { org_id: orgId, name: 'Vikram Singh' } });
  const transport = await prisma.gxPerson.findFirst({ where: { org_id: orgId, name: 'Suresh Transport' } });
  await mkPerson('Ananya Rao', 'employee', 'Documentation executive');

  const lead = async (input, stages = []) => {
    const created = (await leads.create(orgId, adminId, leads.createLeadSchema.parse(input))).lead;
    for (const stage of stages) await leads.changeStage(orgId, adminId, created.id, leads.stageSchema.parse(stage === 'dropped' ? { stage, lost_reason: 'Client went with another supplier' } : { stage }));
    return created;
  };
  const wonCopper = await lead(
    { name: 'Copper Cathode for ABC Industries', trading_type: 'copper_cathode', party_id: abc.id, vendor_id: xyz.id, contact_name: 'Rahul Mehta', location: 'Mumbai', source: 'Referral', assignee_id: sourcing?.id, contractor_id: transport?.id, product: 'Copper Cathode', material_type: 'LME Grade A', quantity: 100, unit: 'MT', expected_purchase_amount: 9000000, expected_sale_amount: 10000000, expected_start: daysFromNow(-40), expected_end: daysFromNow(-10), description: 'Client needs 100 MT Copper Cathode, LME Grade A, delivered ex-warehouse Mumbai in two lots. Payment 30 days from delivery. Material test certificate required with each lot.' },
    ['in_discussion', 'negotiation', 'sourcing', 'won']
  );
  await lead({ name: 'Copper Cathode for Shree Metals', trading_type: 'copper_cathode', party_id: shree.id, vendor_id: raj.id, location: 'Ahmedabad', product: 'Copper Cathode', quantity: 50, unit: 'MT', expected_purchase_amount: 4500000, expected_sale_amount: 5000000, assignee_id: sourcing?.id }, ['in_discussion', 'negotiation', 'sourcing']);
  await lead({ name: 'Surplus aluminium lot', trading_type: 'trading_deals', location: 'Pune', product: 'Aluminium Ingots', quantity: 20, unit: 'MT', expected_sale_amount: 3200000, description: 'Spot deal: surplus aluminium lot offered by a Pune mill, buyer yet to be found.' }, ['in_discussion']);
  await lead({ name: 'Brass scrap enquiry', trading_type: 'trading_deals', party_id: shree.id, product: 'Brass scrap', quantity: 8, unit: 'MT' });
  await lead({ name: 'Copper rod supply (lost)', trading_type: 'copper_cathode', party_id: abc.id, quantity: 30, unit: 'MT', expected_sale_amount: 3100000 }, ['in_discussion', 'dropped']);

  const deal = (await deals.convertLead(orgId, adminId, wonCopper.id, deals.convertSchema.parse({}))).deal;
  const m1 = daysFromNow(-35);
  const m2 = daysFromNow(-12);
  await deals.changeStatus(orgId, adminId, ctx, deal.id, { status: 'sourcing' });
  const p1 = await deals.createPurchase(orgId, adminId, ctx, deal.id, deals.purchaseCreateSchema.parse({ vendor_id: xyz.id, purchase_date: m1, quantity: 60, rate: 90000, reference: 'PO-XYZ-101' }));
  const p2 = await deals.createPurchase(orgId, adminId, ctx, deal.id, deals.purchaseCreateSchema.parse({ vendor_id: xyz.id, purchase_date: m2, quantity: 40, rate: 90000, reference: 'PO-XYZ-102' }));
  const s1 = await deals.createSale(orgId, adminId, ctx, deal.id, deals.saleCreateSchema.parse({ client_id: abc.id, sale_date: m1, quantity: 60, rate: 100000, reference: 'INV-0001' }));
  await deals.createSale(orgId, adminId, ctx, deal.id, deals.saleCreateSchema.parse({ client_id: abc.id, sale_date: m2, quantity: 40, rate: 100000, reference: 'INV-0002' }));
  await deals.addVendorPayment(orgId, adminId, ctx, deal.id, p1.id, deals.paymentSchema.parse({ amount: 5400000, paid_date: m1, mode: 'Bank transfer' }));
  await deals.addVendorPayment(orgId, adminId, ctx, deal.id, p2.id, deals.paymentSchema.parse({ amount: 1800000, paid_date: m2, mode: 'Bank transfer' }));
  await deals.addClientPayment(orgId, adminId, ctx, deal.id, s1.id, deals.paymentSchema.parse({ amount: 6000000, paid_date: daysFromNow(-5), mode: 'RTGS' }));
  const cats = (await core.listCategories(orgId, 'expense')).reduce((a, c) => ({ ...a, [c.name]: c.id }), {});
  for (const [name, amount, date] of [['Transportation', 100000, m1], ['Loading / Unloading', 20000, m1], ['Brokerage', 50000, m2], ['Documentation', 30000, m2]]) {
    await ledger.create(orgId, adminId, ctx, ledger.createEntrySchema.parse({ entry_date: date, type: 'expense', category_id: cats[name], deal_id: deal.id, amount, description: `${name} for ${deal.code}` }));
  }
  await deals.changeStatus(orgId, adminId, ctx, deal.id, { status: 'supplied' });

  // an in-flight deal with only sourcing started, so quantities show a partial position
  const open = (await deals.create(orgId, adminId, deals.createDealSchema.parse({ name: 'Copper Cathode for Shree Metals', trading_type: 'copper_cathode', party_id: shree.id, vendor_id: raj.id, status: 'sourcing', start_date: daysFromNow(-8), expected_end: daysFromNow(14), location: 'Ahmedabad', product: 'Copper Cathode', ordered_quantity: 50, unit: 'MT', expected_purchase_amount: 4500000, expected_sale_amount: 5000000, assignee_id: sourcing?.id }))).deal;
  await deals.createPurchase(orgId, adminId, ctx, open.id, deals.purchaseCreateSchema.parse({ vendor_id: raj.id, purchase_date: daysFromNow(-3), quantity: 20, rate: 91000, reference: 'PO-RC-55' }));

  const task = (input) => tasks.create(orgId, adminId, tasks.createTaskSchema.parse(input));
  await task({ title: 'Confirm vendor material availability', task_type: 'vendor_sourcing', deal_id: open.id, assignee_id: sourcing?.id, due_date: daysFromNow(2), priority: 'high' });
  await task({ title: 'Arrange transport for second lot', task_type: 'delivery_coordination', deal_id: open.id, contractor_id: transport?.id, due_date: daysFromNow(6) });
  await task({ title: 'Collect balance payment from ABC Industries', task_type: 'payment_follow_up', deal_id: deal.id, party_id: abc.id, assignee_id: sourcing?.id, due_date: daysFromNow(-1), priority: 'high' });
  console.log('  + demo business (parties, leads, 2 deals, tasks)');
}

async function main() {
  assertNonProdDestructive('gulati/seed.js');

  let org = await prisma.org.findUnique({ where: { slug: 'gulati' } });
  if (!org) {
    const group = await prisma.orgGroup.create({ data: { name: 'Gulati Industries' } });
    org = await prisma.org.create({
      data: { org_group_id: group.id, name: 'Gulati Industries', slug: 'gulati', logo_url: '/gulati-logo.svg', timezone: 'Asia/Kolkata', default_currency: 'INR', enabled_modules: ['gulati'] },
    });
    console.log('  + org "Gulati Industries"');
  } else if (!org.enabled_modules.includes('gulati') || org.enabled_modules.length !== 1) {
    org = await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['gulati'] } });
    console.log('  ~ org modules set to [gulati]');
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
    if (login.access_role && !(await prisma.gxPerson.findFirst({ where: { org_id: org.id, user_id: user.id } }))) {
      await prisma.gxPerson.create({ data: { org_id: org.id, name: login.name, user_id: user.id, access_role: login.access_role, kind: login.kind || 'employee' } });
    }
  }
  await prisma.gxSetting.upsert({ where: { org_id: org.id }, update: {}, create: { org_id: org.id } });

  if (process.env.GULATI_NO_DEMO !== '1') {
    const admin = await prisma.user.findUnique({ where: { email: 'admin@gulatiindustries.in' } });
    await demo(org, admin.id);
  }

  console.log('Gulati seed done.');
  for (const l of LOGINS) console.log(`  ${(l.access_role || 'admin').padEnd(10)} ${l.email} / ${PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
