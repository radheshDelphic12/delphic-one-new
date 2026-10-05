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
  const skyline = await mkParty('Skyline Builders Pvt Ltd', 'client', { contact_name: 'Anil Rao', phone: '9822001101', email: 'anil@skyline.example', city: 'Pune', gstin: '27AABCS1234F1Z5', pan: 'AABCS1234F', payment_terms: 'Net 30, 10% advance' });
  const lotus = await mkParty('Lotus Realty', 'client', { contact_name: 'Meena Joshi', phone: '9893002202', email: 'meena@lotus.example', city: 'Indore', gstin: '23AAACL5678K1Z2', payment_terms: 'Milestone based' });
  const green = await mkParty('Green Valley Developers', 'client', { contact_name: 'Harish Gupta', phone: '9425003303', city: 'Bhopal', payment_terms: 'Net 45' });
  const steel = await mkParty('Steel India Pvt Ltd', 'vendor', { contact_name: 'Rakesh Das', phone: '9811004404', city: 'Mumbai', gstin: '27AAACS9999M1ZP', payment_terms: '30 days from delivery' });
  const rmc = await mkParty('Ready Mix Concrete Co', 'vendor', { contact_name: 'Suresh Pillai', phone: '9890005505', city: 'Pune', payment_terms: 'Weekly settlement' });
  const patel = await mkParty('Patel Constructions', 'vendor', { contact_name: 'Jayesh Patel', phone: '9879006606', city: 'Ahmedabad', payment_terms: 'Per running bill' });
  const sharma = await mkParty('Sharma Electricals', 'vendor', { contact_name: 'Vikas Sharma', phone: '9826007707', city: 'Indore' });
  const orbit = await mkParty('Orbit Equipment Rentals', 'both', { contact_name: 'Neha Kulkarni', phone: '9850008808', city: 'Pune', payment_terms: 'Monthly rental invoice' });
  await mkParty('Old Quarry Supplies', 'vendor', { status: 'inactive', notes: 'Stopped supplying in 2025' });

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
  const lead = (name, category, stage, extra = {}) =>
    prisma.zxLead.create({ data: { org_id: orgId, name, category, stage, owner_id: managerUser?.id || adminUserId, created_by: adminUserId, ...extra } });
  const act = (leadId, kind, summary, extra = {}) => prisma.zxLeadActivity.create({ data: { org_id: orgId, lead_id: leadId, kind, summary, created_by: adminUserId, ...extra } });
  const l1 = await lead('Orchid Heights Tower C', 'client_project', 'proposal', { party_id: skyline.id, estimated_value: 12500000, expected_close: D(inDays(40)), location: 'Baner, Pune', source: 'Repeat client', contact_name: 'Anil Rao' });
  await act(l1.id, 'meeting', 'Shared drawings and the draft BOQ', { follow_up_date: D(inDays(3)) });
  const l2 = await lead('Riverside Row Houses', 'self_project', 'negotiation', { self_project_basis: 'investor', basis_value: 'R. Mehta', estimated_value: 8000000, expected_close: D(inDays(25)), location: 'Kolar Road, Bhopal', source: 'Investor network' });
  await act(l2.id, 'call', 'Investor wants a 24-month schedule', { follow_up_date: D(inDays(-2)) });
  const l3 = await lead('Lotus Mall Fit-out', 'client_project', 'site_visit', { party_id: lotus.id, estimated_value: 3200000, expected_close: D(inDays(60)), location: 'Vijay Nagar, Indore' });
  await act(l3.id, 'visit', 'Site visit booked for next week', { follow_up_date: D(inDays(6)) });
  await lead('Green Valley Clubhouse', 'client_project', 'new', { party_id: green.id, estimated_value: 2100000, source: 'Website enquiry' });
  const lost = await lead('City Mall Parking', 'client_project', 'lost', { estimated_value: 4500000, lost_reason: 'Client chose a competitor on price', closed_at: new Date(), source: 'Tender' });
  await act(lost.id, 'note', 'Stage: negotiation -> lost (Client chose a competitor on price)');

  // won leads become projects
  const wonA = await lead('Skyline Towers - Phase 1', 'client_project', 'won', { party_id: skyline.id, estimated_value: 48000000, location: 'Hinjewadi, Pune', closed_at: new Date() });
  const wonC = await lead('Meadow Villas', 'self_project', 'won', { self_project_basis: 'project_type', basis_value: 'Gated villa community', estimated_value: 30000000, location: 'Sehore Road, Bhopal', closed_at: new Date() });

  // ---- projects ----
  const mkProject = async (fields) => {
    const code = await nextCode(orgId);
    return prisma.zxProject.create({ data: { org_id: orgId, code, created_by: adminUserId, manager_id: managerUser?.id || adminUserId, ...fields } });
  };
  const pA = await mkProject({ name: wonA.name, kind: 'client', party_id: skyline.id, lead_id: wonA.id, location: wonA.location, status: 'active', start_date: D(dateIn(monthsAgo(7), 1)), end_date: D(dateIn(money.addMonths(money.currentMonth(), 14), 1)), contract_value: 48000000, budget: 39000000 });
  const pB = await mkProject({ name: 'Lotus Plaza Interiors', kind: 'client', party_id: lotus.id, location: 'Vijay Nagar, Indore', status: 'active', start_date: D(dateIn(monthsAgo(5), 10)), end_date: D(dateIn(money.addMonths(money.currentMonth(), 4), 1)), contract_value: 18000000, budget: 14000000 });
  const pC = await mkProject({ name: wonC.name, kind: 'self', lead_id: wonC.id, location: wonC.location, status: 'active', start_date: D(dateIn(monthsAgo(6), 1)), end_date: D(dateIn(money.addMonths(money.currentMonth(), 18), 1)), contract_value: 42000000, budget: 30000000 });
  const pD = await mkProject({ name: 'Old Mill Renovation', kind: 'client', party_id: green.id, location: 'Bhopal', status: 'completed', start_date: D(dateIn(monthsAgo(12), 1)), end_date: D(dateIn(monthsAgo(3), 20)), contract_value: 9000000, budget: 7000000, progress_pct: 100 });
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
    if (back % 3 === 0) await entry(month, at(25), 'revenue', 'Rental income', 180000, { reference: `RENT-${month}` });
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
  console.log('  + Zephyr demo: 9 parties, 7 leads, 4 projects, 10 people, pay slips, 9 months of ledger, plans, closed months');
}

module.exports = { seedDemo, prisma };
