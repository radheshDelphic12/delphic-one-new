/**
 * Zephyr Infrastructure - demo business data (LOCAL / STAGING DEMO ONLY). Called by seed.js after
 * the org and logins exist. Idempotent: if the org already has parties it does nothing.
 *
 * Builds a believable construction company so every page has something to show: clients and
 * vendors, a lead pipeline, four projects (one converted from a won lead) with milestones and
 * vendor work orders, an employee / contractor roster with assignments, pay slips for the last
 * three finished months, eight months of ledger entries, monthly plans and a few closed months.
 */
const { PrismaClient } = require('@prisma/client');
const money = require('../../src/modules/zephyr/money.service');
const propsSvc = require('../../src/modules/zephyr/properties.service');
const rentSvc = require('../../src/modules/zephyr/rent.service');
const salesSvc = require('../../src/modules/zephyr/sales.service');
const ledgerSvc = require('../../src/modules/zephyr/ledger.service');
const tasksSvc = require('../../src/modules/zephyr/tasks.service');
const projSvc = require('../../src/modules/zephyr/projects.service');

const prisma = new PrismaClient();

const today = () => new Date().toISOString().slice(0, 10);
const monthsAgo = (n) => money.addMonths(money.currentMonth(), -n);
const dateIn = (month, day) => `${month}-${String(day).padStart(2, '0')}`;
const D = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function nextCode(orgId) {
  const s = await prisma.zxSetting.update({ where: { org_id: orgId }, data: { project_seq: { increment: 1 } } });
  return `${s.project_prefix}-${String(s.project_seq).padStart(3, '0')}`;
}

// Removes the demo business of one company; the company, its logins (and their roster rows), settings,
// categories and service types stay. Counters go back to zero so codes start again at 1.
async function resetDemo(orgId) {
  const where = { org_id: orgId };
  const steps = [
    'zxRentPayment', 'zxRentDue', 'zxLease', 'zxTenant', 'zxPropertySale', 'zxTask', 'zxPropertyEvent', 'zxPropertyValuation', 'zxPropertyLoan', 'zxPropertyUnit', 'zxProperty',
    'zxLedgerEntry', 'zxPlan', 'zxPeriodClose', 'zxSalaryRecord', 'zxAssignment', 'zxWorkOrder', 'zxMilestone', 'zxProject', 'zxLeadActivity', 'zxLead', 'zxDocument', 'zxParty', 'zxAudit',
  ];
  for (const model of steps) await prisma[model].deleteMany({ where });
  await prisma.zxPerson.deleteMany({ where: { ...where, user_id: null } });
  await prisma.zxSetting.updateMany({ where, data: { project_seq: 0, lead_seq: 0, property_seq: 0, task_seq: 0 } });
  console.log('  ~ Zephyr demo data cleared');
}

async function seedDemo(org, adminUserId) {
  const orgId = org.id;
  if ((await prisma.zxParty.count({ where: { org_id: orgId } })) > 0) {
    console.log('  = Zephyr demo data already present');
    return;
  }
  await prisma.zxSetting.upsert({ where: { org_id: orgId }, update: {}, create: { org_id: orgId } });
  const cats = await prisma.zxCategory.findMany({ where: { org_id: orgId } });
  const cat = (kind, name) => cats.find((c) => c.kind === kind && c.name === name).id;
  const users = await prisma.user.findMany({ where: { email: { in: ['manager@zephyrinfra.in', 'staff@zephyrinfra.in'] } }, select: { id: true, email: true } });
  const managerUser = users.find((u) => u.email === 'manager@zephyrinfra.in');

  // ---- clients and vendors ----
  const mkParty = (name, kind, extra = {}) => prisma.zxParty.create({ data: { org_id: orgId, name, kind, created_by: adminUserId, status: 'active', ...extra } });
  const skyline = await mkParty('Skyline Builders Pvt Ltd', 'client', { company_name: 'Skyline Builders', state: 'Maharashtra', country: 'India', interested_services: ['civil_construction', 'interior_design'], contact_name: 'Anil Rao', phone: '9822001101', email: 'anil@skyline.example', city: 'Pune', gstin: '27AABCS1234F1Z5', pan: 'AABCS1234F', payment_terms: 'Net 30, 10% advance' });
  const lotus = await mkParty('Lotus Realty', 'client', { company_name: 'Lotus Realty LLP', state: 'Madhya Pradesh', country: 'India', interested_services: ['interior_design', 'property_management'], contact_name: 'Meena Joshi', phone: '9893002202', email: 'meena@lotus.example', city: 'Indore', gstin: '23AAACL5678K1Z2', payment_terms: 'Milestone based' });
  const green = await mkParty('Green Valley Developers', 'client', { state: 'Madhya Pradesh', country: 'India', interested_services: ['civil_construction', 'interior_design'], contact_name: 'Harish Gupta', phone: '9425003303', city: 'Bhopal', payment_terms: 'Net 45' });
  const steel = await mkParty('Steel India Pvt Ltd', 'vendor', { vendor_category: 'Material supplier', materials_services: 'TMT rebar, structural steel', state: 'Maharashtra', country: 'India', contact_name: 'Rakesh Das', phone: '9811004404', city: 'Mumbai', gstin: '27AAACS9999M1ZP', payment_terms: '30 days from delivery' });
  const rmc = await mkParty('Ready Mix Concrete Co', 'vendor', { vendor_category: 'Material supplier', materials_services: 'RMC M20-M40, pumping', state: 'Maharashtra', country: 'India', contact_name: 'Suresh Pillai', phone: '9890005505', city: 'Pune', payment_terms: 'Weekly settlement' });
  const patel = await mkParty('Patel Constructions', 'vendor', { vendor_category: 'Civil contractor', materials_services: 'Block work, plastering, RCC', state: 'Gujarat', country: 'India', contact_name: 'Jayesh Patel', phone: '9879006606', city: 'Ahmedabad', payment_terms: 'Per running bill' });
  const sharma = await mkParty('Sharma Electricals', 'vendor', { vendor_category: 'Service provider', materials_services: 'Electrical works, lighting', state: 'Madhya Pradesh', country: 'India', contact_name: 'Vikas Sharma', phone: '9826007707', city: 'Indore' });
  const orbit = await mkParty('Orbit Equipment Rentals', 'both', { vendor_category: 'Service provider', materials_services: 'Scaffolding, lift rental', interested_services: ['civil_construction'], state: 'Maharashtra', country: 'India', contact_name: 'Neha Kulkarni', phone: '9850008808', city: 'Pune', payment_terms: 'Monthly rental invoice' });
  await mkParty('Old Quarry Supplies', 'vendor', { status: 'inactive', vendor_category: 'Material supplier', notes: 'Stopped supplying in 2025' });
  const mehta = await mkParty('Mehta Family Office', 'client', { contact_name: 'Rajesh Mehta', phone: '9820012345', email: 'rajesh@mehta.example', city: 'Mumbai', state: 'Maharashtra', country: 'India', interested_services: ['real_estate_consulting', 'property_trading'], payment_terms: 'Commission on closing' });
  await mkParty('Horizon Labour Contractors', 'vendor', { vendor_category: 'Labour contractor', materials_services: 'Skilled and unskilled labour gangs', city: 'Indore', state: 'Madhya Pradesh', country: 'India', status: 'hold', notes: 'On hold until the pending dues are settled' });
  const buyer = await mkParty('Anand Traders', 'client', { contact_name: 'Anand Shah', phone: '9825054321', city: 'Pune', state: 'Maharashtra', country: 'India', interested_services: ['property_trading'] });

  // ---- people ----
  const person = async (name, kind, designation, basis, rate, extra = {}) =>
    prisma.zxPerson.create({ data: { org_id: orgId, name, kind, designation, pay_basis: basis, rate, joining_date: D(dateIn(monthsAgo(14), 5)), access_role: 'none', ...extra } });
  const existing = await prisma.zxPerson.findMany({ where: { org_id: orgId } });
  const byName = (n) => existing.find((p) => p.name === n);
  const meera = byName('Meera Kapoor');
  const rohan = byName('Rohan Verma');
  await prisma.zxPerson.update({ where: { id: meera.id }, data: { designation: 'Project Manager', pay_basis: 'monthly', rate: 85000, joining_date: D(dateIn(monthsAgo(20), 1)), phone: '9820010010', email: 'manager@zephyrinfra.in' } });
  await prisma.zxPerson.update({ where: { id: rohan.id }, data: { designation: 'Site Supervisor', pay_basis: 'monthly', rate: 32000, joining_date: D(dateIn(monthsAgo(11), 1)), phone: '9820010011', email: 'staff@zephyrinfra.in' } });
  const arjun = byName('Site Supervisor - Arjun Nair');
  await prisma.zxPerson.update({ where: { id: arjun.id }, data: { name: 'Arjun Nair', designation: 'Site Supervisor', pay_basis: 'monthly', rate: 38000, joining_date: D(dateIn(monthsAgo(16), 1)) } });
  const patelPerson = byName('Civil Contractor - Patel Constructions');
  await prisma.zxPerson.update({ where: { id: patelPerson.id }, data: { name: 'Jayesh Patel', kind: 'contractor', designation: 'Civil contractor', vendor_party_id: patel.id, pay_basis: 'daily', rate: 1800, joining_date: D(dateIn(monthsAgo(12), 1)) } });
  const sanjay = byName('Electrician - Sanjay Rao');
  await prisma.zxPerson.update({ where: { id: sanjay.id }, data: { name: 'Sanjay Rao', kind: 'contractor', designation: 'Electrician', vendor_party_id: sharma.id, pay_basis: 'daily', rate: 1100, joining_date: D(dateIn(monthsAgo(9), 1)) } });
  const priya = await person('Priya Nair', 'employee', 'Accountant', 'monthly', 55000, { phone: '9820010012', email: 'priya@zephyrinfra.in' });
  const karan = await person('Karan Mehta', 'employee', 'Site Engineer', 'monthly', 62000, { phone: '9820010013' });
  const divya = await person('Divya Rao', 'employee', 'Architect', 'monthly', 70000, { phone: '9820010014' });
  const imran = await person('Imran Khan', 'contractor', 'Mason', 'daily', 900, { phone: '9820010015' });
  await person('Ritu Sen', 'employee', 'Site Engineer', 'monthly', 58000, { active: false, leaving_date: D(dateIn(monthsAgo(5), 28)), joining_date: D(dateIn(monthsAgo(24), 1)) });

  // ---- leads ----
  const leadSeq = { n: 0 };
  const lead = (name, service_type, stage, extra = {}) => {
    leadSeq.n += 1;
    return prisma.zxLead.create({ data: { org_id: orgId, name, service_type, stage, code: `ZL-${String(leadSeq.n).padStart(4, '0')}`, owner_id: managerUser?.id || adminUserId, created_by: adminUserId, ...extra } });
  };
  const act = (leadId, kind, summary, extra = {}) => prisma.zxLeadActivity.create({ data: { org_id: orgId, lead_id: leadId, kind, summary, created_by: adminUserId, ...extra } });
  const l1 = await lead('Orchid Heights Tower C', 'civil_construction', 'negotiation', {
    party_id: skyline.id, company: 'Skyline Builders', contact_name: 'Anil Rao', estimated_value: 12500000, expected_profit: 2200000, expected_start: D(inDays(60)), expected_end: D(inDays(420)), location: 'Baner, Pune', city: 'Pune', state: 'Maharashtra',
    source: 'Repeat client', assignee_id: karan.id, contractor_id: patelPerson.id, description: 'Structure and finishing of Tower C, 18 floors.', details: [{ label: 'Floors', value: '18' }, { label: 'Built-up area', value: '2.4 lakh sq ft' }],
  });
  await act(l1.id, 'meeting', 'Shared drawings and the draft BOQ', { follow_up_date: D(inDays(3)) });
  const l2 = await lead('Riverside Row Houses', 'civil_construction', 'in_discussion', { company: 'R. Mehta (investor)', estimated_value: 8000000, expected_profit: 1300000, expected_close: D(inDays(25)), location: 'Kolar Road, Bhopal', city: 'Bhopal', source: 'Investor network', assignee_id: karan.id });
  await act(l2.id, 'call', 'Investor wants a 24-month schedule', { follow_up_date: D(inDays(-2)) });
  const l3 = await lead('Lotus Mall Fit-out', 'interior_design', 'in_discussion', { party_id: lotus.id, estimated_value: 3200000, expected_profit: 640000, expected_close: D(inDays(60)), location: 'Vijay Nagar, Indore', city: 'Indore', assignee_id: divya.id });
  await act(l3.id, 'visit', 'Site visit booked for next week', { follow_up_date: D(inDays(6)) });
  await lead('Green Valley Clubhouse', 'interior_design', 'new', { party_id: green.id, estimated_value: 2100000, source: 'Website enquiry', assignee_id: divya.id });
  await lead('Orchid Arcade maintenance contract', 'property_management', 'new', { company: 'Orchid Arcade Owners Association', estimated_value: 900000, city: 'Pune', source: 'Referral', description: 'Annual management of a 24-shop arcade: rent collection, upkeep and tenant follow-up.' });
  const hold = await lead('Super Corridor plot purchase', 'property_trading', 'on_hold', { estimated_value: 6000000, expected_profit: 1200000, city: 'Indore', location: 'Super Corridor', description: 'Buy, hold and resell. Waiting for the seller to clear title.' });
  await act(hold.id, 'note', 'Stage: in_discussion -> on_hold (title not clear yet)');
  const lost = await lead('City Mall Parking', 'civil_construction', 'dropped', { estimated_value: 4500000, lost_reason: 'Client chose a competitor on price', closed_at: new Date(), source: 'Tender' });
  await act(lost.id, 'note', 'Stage: negotiation -> dropped (Client chose a competitor on price)');
  await lead('Hotel feasibility study', 'real_estate_consulting', 'closed', { estimated_value: 400000, closed_at: new Date(), notes: 'Study delivered, client not proceeding.' });

  // won leads become projects
  const wonA = await lead('Skyline Towers - Phase 1', 'civil_construction', 'won', { party_id: skyline.id, estimated_value: 48000000, expected_profit: 8000000, location: 'Hinjewadi, Pune', closed_at: new Date() });
  const wonC = await lead('Meadow Villas', 'civil_construction', 'won', { company: 'Own development', estimated_value: 30000000, location: 'Sehore Road, Bhopal', closed_at: new Date(), description: 'Gated villa community developed by Zephyr itself.' });
  const wonE = await lead('Mumbai apartment purchase for Mehta', 'real_estate_consulting', 'won', { party_id: mehta.id, estimated_value: 300000, location: 'Mumbai', city: 'Mumbai', closed_at: new Date(), description: 'Find and close a Rs 3 crore apartment in Mumbai on a 1% brokerage.' });
  await prisma.zxSetting.update({ where: { org_id: orgId }, data: { lead_seq: leadSeq.n } });

  // ---- projects ----
  const mkProject = async (fields) => {
    const code = await nextCode(orgId);
    return prisma.zxProject.create({ data: { org_id: orgId, code, created_by: adminUserId, manager_id: managerUser?.id || adminUserId, ...fields } });
  };
  const pA = await mkProject({ service_type: 'civil_construction', assignee_id: karan.id, contractor_id: patelPerson.id, agreement_ref: 'AGR-SKY-2025-01', description: 'Two-tower RCC structure and finishing.', details: { site: 'Hinjewadi Phase 2', units_count: 2, scope: 'Excavation to handover', phases: [{ name: 'Excavation and foundation', status: 'done' }, { name: 'Structure', status: 'in_progress' }, { name: 'Finishing', status: 'pending' }] }, expected_profit: 8000000, name: wonA.name, kind: 'client', party_id: skyline.id, lead_id: wonA.id, location: wonA.location, status: 'active', start_date: D(dateIn(monthsAgo(7), 1)), end_date: D(dateIn(money.addMonths(money.currentMonth(), 14), 1)), contract_value: 48000000, budget: 39000000 });
  const pB = await mkProject({ service_type: 'interior_design', assignee_id: divya.id, details: { property: 'Lotus Plaza, 2nd floor', design_scope: 'Retail fit-out and lighting', renovation_scope: 'False ceiling, flooring, joinery', material_cost: 6500000, labour_cost: 2400000, vendor_cost: 1700000, other_expenses: 300000 }, name: 'Lotus Plaza Interiors', kind: 'client', party_id: lotus.id, location: 'Vijay Nagar, Indore', status: 'active', start_date: D(dateIn(monthsAgo(5), 10)), end_date: D(dateIn(money.addMonths(money.currentMonth(), 4), 1)), contract_value: 18000000, budget: 14000000 });
  const pC = await mkProject({ service_type: 'civil_construction', assignee_id: karan.id, details: { site: 'Meadow Villas, Sehore Road', units_count: 24, phases: [{ name: 'Land development', status: 'done' }, { name: 'Phase 1 villas', status: 'in_progress' }, { name: 'Phase 2 villas', status: 'pending' }] }, name: wonC.name, kind: 'self', lead_id: wonC.id, location: wonC.location, status: 'active', start_date: D(dateIn(monthsAgo(6), 1)), end_date: D(dateIn(money.addMonths(money.currentMonth(), 18), 1)), contract_value: 42000000, budget: 30000000 });
  const pD = await mkProject({ service_type: 'civil_construction', name: 'Old Mill Renovation', kind: 'client', party_id: green.id, location: 'Bhopal', status: 'completed', start_date: D(dateIn(monthsAgo(12), 1)), end_date: D(dateIn(monthsAgo(3), 20)), contract_value: 9000000, budget: 7000000, progress_pct: 100 });
  const pE = await mkProject({
    service_type: 'real_estate_consulting', name: wonE.name, kind: 'client', party_id: mehta.id, lead_id: wonE.id, location: 'Mumbai', status: 'completed', start_date: D(inDays(-70)), end_date: D(inDays(-12)), actual_end: D(inDays(-12)), progress_pct: 100,
    details: { desired_property_type: '3 BHK apartment', required_location: 'Bandra West, Mumbai', client_budget: 30000000, property_value: 29500000, commission_pct: 1, commission_amount: 295000, deal_date: inDays(-20), closing_date: inDays(-12) },
  });
  await prisma.zxLead.update({ where: { id: wonE.id }, data: { project_id: pE.id } });
  await prisma.zxLead.update({ where: { id: wonA.id }, data: { project_id: pA.id } });
  await prisma.zxLead.update({ where: { id: wonC.id }, data: { project_id: pC.id } });
  await act(wonA.id, 'note', `Converted to project ${pA.code}`);
  await act(wonC.id, 'note', `Converted to project ${pC.code}`);

  // ---- milestones ----
  const ms = (project, rows) =>
    Promise.all(rows.map((r, i) => prisma.zxMilestone.create({
      data: { org_id: orgId, project_id: project.id, name: r.name, due_date: D(r.due), weight: r.weight, percent_done: r.pct, status: r.pct >= 100 ? 'done' : r.pct > 0 ? 'in_progress' : 'pending', billing_amount: r.bill, billed: Boolean(r.billed), sort_order: i },
    })));
  await ms(pA, [
    { name: 'Excavation and foundation', due: dateIn(monthsAgo(4), 15), weight: 3, pct: 100, bill: 7200000, billed: true },
    { name: 'Plinth and basement slab', due: dateIn(monthsAgo(2), 20), weight: 3, pct: 100, bill: 7200000, billed: true },
    { name: 'Structure up to 8th floor', due: inDays(-6), weight: 4, pct: 70, bill: 9600000 },
    { name: 'Structure up to 16th floor', due: inDays(75), weight: 4, pct: 0, bill: 9600000 },
    { name: 'Finishing and handover', due: inDays(400), weight: 6, pct: 0, bill: 14400000 },
  ]);
  await ms(pB, [
    { name: 'Design sign-off', due: dateIn(monthsAgo(4), 5), weight: 1, pct: 100, bill: 1800000, billed: true },
    { name: 'False ceiling and electrical', due: dateIn(monthsAgo(1), 25), weight: 3, pct: 100, bill: 5400000, billed: true },
    { name: 'Flooring and joinery', due: inDays(20), weight: 3, pct: 55, bill: 5400000 },
    { name: 'Snagging and handover', due: inDays(110), weight: 1, pct: 0, bill: 5400000 },
  ]);
  await ms(pC, [
    { name: 'Land development and roads', due: dateIn(monthsAgo(3), 28), weight: 2, pct: 100 },
    { name: 'Phase 1 villas (12 units)', due: inDays(120), weight: 5, pct: 40 },
    { name: 'Phase 2 villas (12 units)', due: inDays(330), weight: 5, pct: 0 },
  ]);
  await ms(pD, [{ name: 'Strengthening and repairs', due: dateIn(monthsAgo(4), 10), weight: 1, pct: 100, bill: 9000000, billed: true }]);

  // ---- vendor work orders ----
  const wo = (project, vendor, n, scope, value, billed, status) =>
    prisma.zxWorkOrder.create({ data: { org_id: orgId, project_id: project.id, vendor_id: vendor.id, wo_number: `${project.code}-WO${n}`, scope, value, billed_to_date: billed, status, issued_on: D(dateIn(monthsAgo(4), 12)), created_by: adminUserId } });
  const woSteel = await wo(pA, steel, 1, 'Supply of TMT rebar, Fe 500D', 6200000, 4100000, 'in_progress');
  const woRmc = await wo(pA, rmc, 2, 'RMC M30 supply and pumping', 4800000, 3300000, 'in_progress');
  const woPatel = await wo(pA, patel, 3, 'Block work and plastering, towers 1-2', 2800000, 900000, 'issued');
  const woSharma = await wo(pB, sharma, 1, 'Electrical works and lighting', 1700000, 1550000, 'in_progress');
  await wo(pC, patel, 1, 'Road and drainage works', 2200000, 2200000, 'completed');
  await wo(pB, orbit, 2, 'Scaffolding and lift rental', 420000, 0, 'draft');

  // ---- assignments ----
  const assign = (p, project, role, pct, from) => prisma.zxAssignment.create({ data: { org_id: orgId, person_id: p.id, project_id: project.id, role, allocation_pct: pct, from_date: D(from || dateIn(monthsAgo(6), 1)) } });
  await assign(meera, pA, 'Project manager', 50);
  await assign(meera, pB, 'Project manager', 30);
  await assign(meera, pC, 'Project manager', 20);
  await assign(rohan, pA, 'Site supervisor', 100);
  await assign(arjun, pB, 'Site supervisor', 100);
  await assign(karan, pA, 'Site engineer', 60);
  await assign(karan, pC, 'Site engineer', 40);
  await assign(divya, pB, 'Interior architect', 60);
  await assign(divya, pC, 'Architect', 40);
  await assign(priya, pA, 'Accounts', 40);
  await assign(priya, pB, 'Accounts', 30);
  await assign(priya, pC, 'Accounts', 30);
  await assign(patelPerson, pA, 'Civil contractor', 100);
  await assign(sanjay, pB, 'Electrician', 100);
  await assign(imran, pA, 'Mason', 100);

  // ---- pay slips for the last three finished months ----
  const payroll = await prisma.zxPerson.findMany({ where: { org_id: orgId, deleted_at: null, pay_basis: { not: null } } });
  const allAssignments = await prisma.zxAssignment.findMany({ where: { org_id: orgId } });
  for (const back of [3, 2, 1]) {
    const month = monthsAgo(back);
    for (const p of payroll) {
      if (!p.active && (!p.leaving_date || money.monthOf(p.leaving_date) < month)) continue;
      const mine = allAssignments.filter((a) => a.person_id === p.id);
      const total = mine.reduce((a, r) => a + r.allocation_pct, 0);
      const rate = money.num(p.rate);
      const days = p.pay_basis === 'daily' ? 22 : null;
      const gross = p.pay_basis === 'daily' ? rate * 22 : rate;
      const deductions = p.pay_basis === 'monthly' ? Math.round(gross * 0.05) : 0;
      const net = gross - deductions;
      const split = total ? mine.map((a) => ({ project_id: a.project_id, pct: money.round2((a.allocation_pct / total) * 100), amount: money.round2((net * a.allocation_pct) / total) })) : undefined;
      const paid = back > 1;
      await prisma.zxSalaryRecord.create({
        data: { org_id: orgId, person_id: p.id, month, pay_basis: p.pay_basis, rate, days, gross, deductions, net, status: paid ? 'paid' : 'approved', project_split: split, paid_on: paid ? D(dateIn(money.addMonths(month, 1), 3)) : null, approved_by: adminUserId, approved_at: new Date() },
      });
    }
  }
  // this month: draft slips ready to review
  for (const p of payroll.filter((x) => x.active)) {
    const rate = money.num(p.rate);
    await prisma.zxSalaryRecord.create({ data: { org_id: orgId, person_id: p.id, month: money.currentMonth(), pay_basis: p.pay_basis, rate, days: p.pay_basis === 'daily' ? 0 : null, gross: p.pay_basis === 'daily' ? 0 : rate, deductions: 0, net: p.pay_basis === 'daily' ? 0 : rate, status: 'draft' } });
  }

  // ---- ledger: eight finished months plus this month so far ----
  const entry = (month, day, type, categoryName, amount, extra = {}) =>
    prisma.zxLedgerEntry.create({
      data: { org_id: orgId, entry_date: D(dateIn(month, day)), type, category_id: cat(type, categoryName), amount, tax: Math.round(amount * 0.18), status: 'actual', payment_mode: 'bank', created_by: adminUserId, ...extra },
    });
  for (let back = 8; back >= 0; back -= 1) {
    const month = monthsAgo(back);
    const grow = 1 + (8 - back) * 0.06;
    const upto = back === 0 ? Math.min(Number(today().slice(8, 10)), 28) : 28;
    const at = (d) => Math.min(d, upto);
    const r = (n) => Math.round((n * grow) / 1000) * 1000;
    if (back <= 7) await entry(month, at(8), 'revenue', 'Project billing', r(3600000), { project_id: pA.id, party_id: skyline.id, reference: `INV-A-${month}` });
    if (back <= 5) await entry(month, at(18), 'revenue', 'Project billing', r(1400000), { project_id: pB.id, party_id: lotus.id, reference: `INV-B-${month}` });
    if (back === 3) await entry(month, 20, 'revenue', 'Project billing', 9000000, { project_id: pD.id, party_id: green.id, reference: 'INV-D-FINAL' });
    await entry(month, at(5), 'expense', 'Materials', r(1100000), { project_id: pA.id, party_id: steel.id, work_order_id: woSteel.id, reference: `STL-${month}` });
    await entry(month, at(10), 'expense', 'Materials', r(800000), { project_id: pA.id, party_id: rmc.id, work_order_id: woRmc.id, reference: `RMC-${month}` });
    await entry(month, at(12), 'expense', 'Labour', r(520000), { project_id: pA.id, payment_mode: 'cash' });
    if (back <= 5) await entry(month, at(14), 'expense', 'Subcontractor', r(300000), { project_id: pB.id, party_id: sharma.id, work_order_id: woSharma.id });
    if (back <= 6) await entry(month, at(16), 'expense', 'Equipment', r(220000), { project_id: pC.id, party_id: orbit.id });
    if (back <= 4) await entry(month, at(20), 'expense', 'Labour', r(240000), { project_id: pC.id, payment_mode: 'cash' });
    await entry(month, at(2), 'expense', 'Office', 65000, { description: 'Office rent and utilities', tax: 0 });
    await entry(month, at(22), 'expense', 'Site overheads', r(90000), { project_id: pA.id });
    if (back === 3) await entry(month, 12, 'expense', 'Materials', 2400000, { project_id: pD.id, party_id: steel.id, reference: 'STL-OLDMILL' });
  }
  // expected money: next two months
  for (const ahead of [1, 2]) {
    const month = money.addMonths(money.currentMonth(), ahead);
    await entry(month, 10, 'revenue', 'Project billing', 4800000, { project_id: pA.id, party_id: skyline.id, status: 'planned', reference: 'Milestone 3 billing' });
    await entry(month, 15, 'expense', 'Materials', 1700000, { project_id: pA.id, party_id: steel.id, work_order_id: woSteel.id, status: 'planned' });
    await entry(month, 20, 'expense', 'Subcontractor', 600000, { project_id: pA.id, party_id: patel.id, work_order_id: woPatel.id, status: 'planned' });
  }

  // ---- real estate: properties, units, tenants, rent, loans, valuation, a sale, tasks, a shared expense ----
  const fin = { isAdmin: true, canFinance: true };
  const mkProp = async (body) => (await propsSvc.create(orgId, adminUserId, fin, propsSvc.createPropertySchema.parse(body))).property;
  const mkUnit = async (propertyId, body) => propsSvc.addUnit(orgId, adminUserId, fin, propertyId, propsSvc.unitCreateSchema.parse(body));
  const xyz = await mkProp({ name: 'XYZ Commercial Complex', property_type: 'commercial_complex', address: 'MG Road', city: 'Indore', state: 'Madhya Pradesh', location: 'MG Road, near Regal Square', area_value: 5200, current_use: 'Rental', purchase_date: dateIn(monthsAgo(14), 8), purchase_cost: 12000000, brokerage: 120000, documentation_cost: 40000, registration_cost: 600000, construction_cost: 6500000 });
  for (const [name, floor, area] of [['Shop 1', 'Ground', 600], ['Shop 2', 'Ground', 550], ['Shop 3', 'Ground', 500], ['Shop 4', 'First', 450], ['Shop 5', 'First', 450]]) await mkUnit(xyz.id, { name, floor, area_value: area, unit_type: 'Shop' });
  const xyzUnits = (await propsSvc.get(orgId, fin, xyz.id)).property.units;
  const unit = (n) => xyzUnits.find((u) => u.name === n);
  await propsSvc.addLoan(orgId, adminUserId, fin, xyz.id, propsSvc.loanCreateSchema.parse({ financing_type: 'bank_loan', lender: 'State Bank of India', loan_amount: 8000000, outstanding_amount: 7400000, emi_amount: 85000, emi_frequency: 'monthly', interest_rate: 9.1, start_date: dateIn(monthsAgo(13), 1), end_date: dateIn(money.addMonths(money.currentMonth(), 100), 1) }));
  await propsSvc.addValuation(orgId, adminUserId, fin, xyz.id, { value: 17500000, as_of: inDays(-120), notes: 'Broker opinion, shell complete' });
  await propsSvc.addValuation(orgId, adminUserId, fin, xyz.id, { value: 24000000, as_of: inDays(-9), notes: 'Registered valuer report' });
  await propsSvc.addNote(orgId, adminUserId, fin, xyz.id, { kind: 'construction', event_date: dateIn(monthsAgo(8), 1), title: 'Construction started', amount: null });
  await propsSvc.addNote(orgId, adminUserId, fin, xyz.id, { kind: 'construction', event_date: dateIn(monthsAgo(3), 12), title: 'Construction completed', amount: 6500000 });

  const tenantsAll = {};
  for (const [key, name, company, phone] of [['abc', 'ABC Pvt Ltd', 'ABC Pvt Ltd', '9810011111'], ['sun', 'Sunrise Pharmacy', 'Sunrise Healthcare', '9810022222'], ['qm', 'Quick Mart', 'Quick Mart Retail', '9810033333']]) {
    tenantsAll[key] = (await rentSvc.createTenant(orgId, adminUserId, rentSvc.tenantCreateSchema.parse({ name, company_name: company, phone }))).tenant;
  }
  const lease = async (tenant, u, startMonthsAgo, rentAmount, deposit, dueDay, method) => (await rentSvc.createLease(orgId, adminUserId, rentSvc.leaseCreateSchema.parse({ tenant_id: tenant.id, unit_id: unit(u).id, start_date: dateIn(monthsAgo(startMonthsAgo), 1), monthly_rent: rentAmount, security_deposit: deposit, due_day: dueDay, payment_method: method }))).lease;
  const lAbc = await lease(tenantsAll.abc, 'Shop 3', 6, 60000, 180000, 1, 'bank_transfer');
  const lSun = await lease(tenantsAll.sun, 'Shop 4', 6, 45000, 135000, 5, 'cash');
  const lQm = await lease(tenantsAll.qm, 'Shop 2', 3, 52000, 156000, 1, 'upi');
  // every earlier month is paid on time; Sunrise paid only part of last month; this month ABC has paid
  for (const l of [lAbc, lSun, lQm]) {
    const dues = await prisma.zxRentDue.findMany({ where: { lease_id: l.id }, orderBy: { period: 'asc' } });
    for (const d of dues) {
      const isThis = d.period === money.currentMonth();
      const isLast = d.period === monthsAgo(1);
      if (isThis && l.id !== lAbc.id) continue;
      if (isThis && dateIn(d.period, l.due_day + 1) > today()) continue;
      const amount = isLast && l.id === lSun.id ? 20000 : Number(d.amount);
      await rentSvc.recordPayment(orgId, adminUserId, d.id, { amount, paid_on: isThis ? today() : dateIn(d.period, l.due_day + 1), method: l.id === lSun.id ? 'cash' : l.payment_method || 'bank_transfer', reference: `RCPT-${d.period}`, collected_by_person_id: l.id === lSun.id ? arjun.id : null, notes: null });
    }
  }
  // Shop 1 sold two months ago
  await salesSvc.create(orgId, adminUserId, xyz.id, salesSvc.saleSchema.parse({ unit_id: unit('Shop 1').id, sale_value: 6500000, sale_date: dateIn(monthsAgo(2), 14), selling_costs: 65000, buyer_party_id: buyer.id, notes: 'Sold to Anand Traders' }));
  await propsSvc.updateUnit(orgId, adminUserId, fin, xyz.id, unit('Shop 5').id, { status: 'under_renovation', notes: 'Fit-out for a future tenant' });
  // property operating expenses
  const propEntry = (month, day, categoryName, amount, description) => prisma.zxLedgerEntry.create({ data: { org_id: orgId, entry_date: D(dateIn(month, day)), type: 'expense', category_id: cat('expense', categoryName), amount, tax: 0, status: 'actual', payment_mode: 'bank', created_by: adminUserId, property_id: xyz.id, service_type: 'property_management', description } });
  for (const back of [5, 4, 3, 2, 1]) {
    await propEntry(monthsAgo(back), 6, 'Maintenance & repairs', 12000 + back * 1500, 'Common area maintenance');
    await propEntry(monthsAgo(back), 9, 'Property tax & utilities', 8500, 'Electricity and water, common areas');
  }

  const plot = await mkProp({ name: 'Super Corridor Plot', property_type: 'plot', city: 'Indore', state: 'Madhya Pradesh', location: 'Super Corridor, Sector B', area_value: 4000, current_use: 'Held for resale', status: 'held', purchase_date: dateIn(monthsAgo(5), 20), purchase_cost: 4200000, brokerage: 42000, documentation_cost: 18000, registration_cost: 252000 });
  await propsSvc.addValuation(orgId, adminUserId, fin, plot.id, { value: 5200000, as_of: inDays(-15), notes: 'Nearby plots sold at higher rates' });
  const lake = await mkProp({ name: 'Lakeview Flats', property_type: 'building', city: 'Bhopal', state: 'Madhya Pradesh', location: 'Kolar Road', area_value: 3200, current_use: 'Under development', status: 'under_construction', purchase_date: dateIn(monthsAgo(9), 3), purchase_cost: 7500000, registration_cost: 450000, construction_cost: 3800000 });
  for (const [name, floor] of [['Flat 101', 'First'], ['Flat 102', 'First'], ['Flat 201', 'Second'], ['Flat 202', 'Second']]) await mkUnit(lake.id, { name, floor, unit_type: '2 BHK', area_value: 800, status: 'under_construction' });
  await propsSvc.addValuation(orgId, adminUserId, fin, lake.id, { value: 14500000, as_of: inDays(-30), notes: 'Estimated on completion' });
  const godown = await mkProp({ name: 'Old Godown, Pune', property_type: 'building', city: 'Pune', state: 'Maharashtra', current_use: 'Sold', status: 'held', purchase_date: dateIn(monthsAgo(14), 2), purchase_cost: 9000000, brokerage: 90000, registration_cost: 540000, renovation_cost: 500000 });
  await salesSvc.create(orgId, adminUserId, godown.id, salesSvc.saleSchema.parse({ sale_value: 12400000, sale_date: dateIn(monthsAgo(3), 15), selling_costs: 150000, buyer_party_id: buyer.id, notes: 'Whole property sold after renovation' }));

  // consulting commission on the completed Mumbai deal
  await ledgerSvc.bookCommission(orgId, adminUserId, pE.id);
  await prisma.zxLedgerEntry.create({ data: { org_id: orgId, entry_date: D(inDays(-15)), type: 'expense', category_id: cat('expense', 'Other expense'), amount: 18000, tax: 0, status: 'actual', payment_mode: 'upi', created_by: adminUserId, project_id: pE.id, service_type: 'real_estate_consulting', description: 'Site visits and travel for the buyer' } });

  // one security contract shared by two projects and a property
  await ledgerSvc.createGroupExpense(orgId, adminUserId, ledgerSvc.groupExpenseSchema.parse({ entry_date: dateIn(monthsAgo(1), 15), category_id: cat('expense', 'Site overheads'), amount: 90000, basis: 'equal', description: 'Shared security agency, monthly', allocations: [{ project_id: pA.id, share: 1 }, { project_id: pB.id, share: 1 }, { property_id: xyz.id, share: 1 }] }));

  // operational tasks
  const sunDue = await prisma.zxRentDue.findFirst({ where: { lease_id: lSun.id, period: money.currentMonth() } });
  const mk = (body) => tasksSvc.create(orgId, adminUserId, tasksSvc.createTaskSchema.parse(body));
  if (sunDue) await mk({ title: 'Collect this month rent from Sunrise Pharmacy (Shop 4)', task_type: 'collect_rent', person_id: arjun.id, property_id: xyz.id, rent_due_id: sunDue.id, due_date: inDays(-1), priority: 'high' });
  await mk({ title: 'Inspect Lakeview Flats: slab and plumbing progress', task_type: 'inspect', person_id: rohan.id, property_id: lake.id, due_date: inDays(3) });
  await mk({ title: 'Verify block work quality, Tower 1 (Skyline)', task_type: 'verify_work', person_id: karan.id, project_id: pA.id, due_date: inDays(5), priority: 'high' });
  await mk({ title: 'Collect NOC and tax receipts for the Super Corridor plot', task_type: 'collect_documents', person_id: priya.id, property_id: plot.id, due_date: inDays(10) });
  await mk({ title: 'Follow up with Quick Mart on lease renewal', task_type: 'follow_up_tenant', person_id: arjun.id, property_id: xyz.id, due_date: inDays(14), priority: 'low' });

  // ---- plans (company-wide) for six months back and three ahead ----
  for (let back = 6; back >= -3; back -= 1) {
    const month = monthsAgo(back);
    await prisma.zxPlan.create({ data: { org_id: orgId, month, planned_revenue: 5200000, planned_expense: 3400000, planned_salaries: 520000, notes: back === 0 ? 'Budget for the current month' : null } });
  }

  // ---- close the three oldest finished months ----
  for (const back of [3, 2]) {
    const month = monthsAgo(back);
    const from = money.monthStart(month);
    const to = money.monthEnd(month);
    const [summary, byProject] = await Promise.all([money.summary(orgId, from, to), money.byProject(orgId, from, to)]);
    await prisma.zxPeriodClose.create({ data: { org_id: orgId, month, status: 'closed', snapshot: { summary, by_project: byProject }, closed_by: adminUserId, closed_at: new Date() } });
  }

  // settings: show the three valuation modes are all editable, start on revenue multiple
  await prisma.zxSetting.update({ where: { org_id: orgId }, data: { valuation_method: 'revenue_multiple', valuation_multiple: 2.5 } });
  console.log('  + Zephyr demo: clients and vendors, leads for all five services, 5 projects, 4 properties with units, tenants, rent, a loan, valuations and two sales, tasks, shared expense, 9 months of ledger, plans, closed months');
}

module.exports = { seedDemo, resetDemo, prisma };
