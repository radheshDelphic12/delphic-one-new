/**
 * Multi-company ERP - demo data for the vertical modules.
 *
 * Adds Gulati Industries (trading), Zephyr Infrastructure (leads / contracts /
 * self projects) and switches Acconcy on for leads + recurring contracts, then
 * seeds a little data in each so every screen has something to show. Adds
 * group.admin@delphic.in as an admin in all of them.
 *
 * Run seed-multi-org-demo.js first. Idempotent and non-destructive. LOCAL /
 * STAGING DEMO ONLY.
 *
 * Usage (from server/): node prisma/erp/seed-verticals-demo.js
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const EMAIL = 'group.admin@delphic.in';

const monthsAgo = (n, day = 10) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, day));
};

async function ensureOrg(group, { name, slug, modules, multiple }) {
  let org = await prisma.org.findUnique({ where: { slug } });
  if (!org) {
    org = await prisma.org.create({
      data: { org_group_id: group, name, slug, timezone: 'Asia/Kolkata', default_currency: 'INR', enabled_modules: modules, valuation_method: 'revenue_multiple', valuation_multiple: multiple },
    });
    console.log(`  + org "${name}"`);
  } else if (JSON.stringify(org.enabled_modules) !== JSON.stringify(modules)) {
    org = await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: modules } });
    console.log(`  ~ modules for "${name}": ${modules.join(', ')}`);
  }
  // Demo default: value each company on a revenue multiple (only if nothing was chosen yet).
  if (org.valuation_method === 'manual' && org.valuation_multiple === null && !org.valuation) {
    org = await prisma.org.update({ where: { id: org.id }, data: { valuation_method: 'revenue_multiple', valuation_multiple: multiple } });
    console.log(`  ~ valuation for "${name}": revenue x${multiple}`);
  }
  return org;
}

async function ensureMembership(userId, org) {
  const exists = await prisma.orgMembership.findFirst({ where: { person_id: userId, org_id: org.id } });
  if (!exists) {
    await prisma.orgMembership.create({ data: { person_id: userId, org_id: org.id, role: 'admin', joined_at: monthsAgo(8, 1) } });
    console.log(`  + membership in "${org.name}"`);
  }
}

async function seedGulati(org, userId) {
  if ((await prisma.tradingPartner.count({ where: { org_id: org.id } })) > 0) return console.log('  = Gulati already seeded');

  const items = {};
  for (const [name, unit, category, hsn] of [
    ['TMT Steel Bar 12mm', 'tonne', 'Steel', '7214'],
    ['Cement OPC 53', 'bag', 'Cement', '2523'],
    ['Copper Wire 2.5mm', 'coil', 'Electricals', '7408'],
  ]) {
    items[name] = await prisma.tradeItem.create({ data: { org_id: org.id, name, unit, category, hsn_code: hsn } });
  }

  const checklist = { kyc_done: true, agreement_signed: true, rate_card_agreed: true, bank_details_received: true };
  const partnerRows = [
    { kind: 'supplier', name: 'Shree Steel Traders', city: 'Raipur', status: 'active', trading_status: 'trading', onboarding_checklist: checklist, onboarded_at: monthsAgo(6) },
    { kind: 'supplier', name: 'Bharat Cement Depot', city: 'Nagpur', status: 'active', trading_status: 'trading', onboarding_checklist: checklist, onboarded_at: monthsAgo(5) },
    { kind: 'supplier', name: 'Volt Cables Pvt Ltd', city: 'Surat', status: 'onboarding', onboarding_checklist: { kyc_done: true, agreement_signed: false } },
    { kind: 'consumer', name: 'Metro Infra Builders', city: 'Mumbai', status: 'active', trading_status: 'trading', onboarding_checklist: checklist, onboarded_at: monthsAgo(6) },
    { kind: 'consumer', name: 'Kaveri Constructions', city: 'Pune', status: 'active', trading_status: 'paused', onboarding_checklist: checklist, onboarded_at: monthsAgo(4) },
    { kind: 'consumer', name: 'Sunrise Developers', city: 'Indore', status: 'lead' },
  ];
  const partners = {};
  for (const row of partnerRows) {
    partners[row.name] = await prisma.tradingPartner.create({ data: { org_id: org.id, owner_id: userId, ...row } });
  }

  const rate = (partner, item, value, from) =>
    prisma.partnerItemRate.create({
      data: { org_id: org.id, partner_id: partners[partner].id, item_id: items[item].id, rate: value, effective_from: from, created_by: userId },
    });
  await rate('Shree Steel Traders', 'TMT Steel Bar 12mm', 52000, monthsAgo(6, 1));
  await rate('Bharat Cement Depot', 'Cement OPC 53', 360, monthsAgo(5, 1));
  await rate('Metro Infra Builders', 'TMT Steel Bar 12mm', 58500, monthsAgo(6, 1));
  await rate('Metro Infra Builders', 'Cement OPC 53', 410, monthsAgo(5, 1));
  await rate('Kaveri Constructions', 'Cement OPC 53', 405, monthsAgo(4, 1));

  const txn = (partner, item, type, qty, unitRate, when, status = 'completed') =>
    prisma.tradeTransaction.create({
      data: {
        org_id: org.id,
        partner_id: partners[partner].id,
        item_id: items[item].id,
        txn_type: type,
        quantity: qty,
        rate: unitRate,
        amount: Math.round(qty * unitRate * 100) / 100,
        status,
        txn_date: when,
        created_by: userId,
      },
    });
  for (let m = 4; m >= 0; m -= 1) {
    await txn('Shree Steel Traders', 'TMT Steel Bar 12mm', 'purchase', 20 + m * 2, 52000, monthsAgo(m, 5));
    await txn('Metro Infra Builders', 'TMT Steel Bar 12mm', 'sale', 18 + m * 2, 58500, monthsAgo(m, 12));
    await txn('Bharat Cement Depot', 'Cement OPC 53', 'purchase', 1500, 360, monthsAgo(m, 8));
    await txn('Metro Infra Builders', 'Cement OPC 53', 'sale', 1300 + m * 50, 410, monthsAgo(m, 18));
  }
  await txn('Kaveri Constructions', 'Cement OPC 53', 'sale', 800, 405, monthsAgo(0, 2), 'open');
  console.log('  + Gulati: 3 items, 6 partners, rate cards, transactions');
}

async function seedZephyr(org, userId) {
  if ((await prisma.selfProject.count({ where: { org_id: org.id } })) > 0) return console.log('  = Zephyr already seeded');

  const lead = (data) => prisma.lead.create({ data: { org_id: org.id, owner_id: userId, ...data } });
  const investorLead = await lead({ name: 'Riverside Residency Phase 2', category: 'self_project', self_project_basis: 'investor', investor_name: 'Aurum Capital', stage: 'qualified', estimated_value: 180000000 });
  await lead({ name: 'Tech Park Block C', category: 'self_project', self_project_basis: 'customer_deal', customer_deal_ref: 'DEAL-2291 (Nimbus Corp pre-lease)', stage: 'proposal', estimated_value: 95000000 });
  await lead({ name: 'Warehouse Cluster Nashik', category: 'self_project', self_project_basis: 'project_type', project_type: 'Logistics warehousing', stage: 'new', estimated_value: 42000000 });
  await lead({ name: 'Highway Service Plaza EPC', category: 'client_project', stage: 'contacted', estimated_value: 60000000 });

  const project = (data) => prisma.selfProject.create({ data: { org_id: org.id, created_by: userId, ...data } });
  const riverside = await project({ name: 'Riverside Residency Phase 1', project_type: 'Residential', status: 'active', location: 'Pune, Baner', investor_name: 'Aurum Capital', budget: 250000000, start_date: monthsAgo(9, 1), lead_id: investorLead.id });
  const mall = await project({ name: 'Central Mall Fit-out', project_type: 'Commercial', status: 'planning', location: 'Indore', customer_deal_ref: 'DEAL-1980', budget: 80000000, start_date: monthsAgo(1, 1) });

  const entry = (p, entry_type, amount, when, category, description) =>
    prisma.projectFinanceEntry.create({ data: { org_id: org.id, project_id: p.id, entry_type, amount, entry_date: when, category, description, created_by: userId } });
  for (let m = 5; m >= 0; m -= 1) {
    await entry(riverside, 'revenue', 14000000 + m * 500000, monthsAgo(m, 20), 'Unit bookings', 'Booking instalments received');
    await entry(riverside, 'expense', 6500000, monthsAgo(m, 6), 'Materials', 'Steel and cement');
    await entry(riverside, 'salary', 1800000, monthsAgo(m, 28), 'Site staff', 'Site engineers and labour payroll');
    await entry(riverside, 'other', 250000, monthsAgo(m, 15), 'Approvals', 'Statutory fees');
  }
  await entry(mall, 'expense', 900000, monthsAgo(0, 3), 'Design', 'Architect retainer');

  const doc = (p, category, title, reference_no, expires_on) =>
    prisma.projectDocument.create({ data: { org_id: org.id, project_id: p.id, category, title, reference_no, expires_on, uploaded_by: userId, issued_on: monthsAgo(8, 1) } });
  await doc(riverside, 'legal', 'Title deed', 'TD/PN/2291', null);
  await doc(riverside, 'legal', 'RERA registration', 'P52100045678', new Date(Date.UTC(new Date().getUTCFullYear() + 2, 5, 30)));
  await doc(riverside, 'site', 'Fire NOC', 'FNOC/2025/778', new Date(Date.now() + 20 * 86400000));
  await doc(riverside, 'permit', 'Environmental clearance', 'EC/MH/9911', monthsAgo(1, 1));
  await doc(mall, 'approval', 'Municipal building plan approval', 'BPA/IND/553', null);

  await prisma.contract.create({
    data: { org_id: org.id, kind: 'construction', title: 'Riverside Phase 1 - civil works', counterparty_name: 'BuildRight Contractors', project_id: riverside.id, value: 120000000, billed_to_date: 78000000, progress_percent: 65, status: 'active', start_date: monthsAgo(8, 1), end_date: new Date(Date.UTC(new Date().getUTCFullYear() + 1, 2, 31)), site_location: 'Baner, Pune', created_by: userId },
  });
  await prisma.contract.create({
    data: { org_id: org.id, kind: 'construction', title: 'Central Mall - interiors', counterparty_name: 'Studio Nine Interiors', project_id: mall.id, value: 30000000, billed_to_date: 0, progress_percent: 0, status: 'draft', start_date: monthsAgo(0, 15), created_by: userId },
  });
  console.log('  + Zephyr: leads, projects, finance entries, documents, contracts');
}

async function seedAcconcy(org, userId) {
  if ((await prisma.contract.count({ where: { org_id: org.id } })) > 0) return console.log('  = Acconcy already seeded');

  await prisma.lead.createMany({
    data: [
      { org_id: org.id, owner_id: userId, name: 'Orion Textiles', stage: 'proposal', expected_monthly: 150000, estimated_value: 1800000 },
      { org_id: org.id, owner_id: userId, name: 'Greenleaf Foods', stage: 'qualified', expected_monthly: 90000, estimated_value: 1080000 },
      { org_id: org.id, owner_id: userId, name: 'Vertex Logistics', stage: 'new', expected_monthly: 60000, estimated_value: 720000 },
    ],
  });
  const recurring = (title, counterparty_name, recurring_amount, billing_frequency, startAgo, status = 'active', endMonthsAhead = null) =>
    prisma.contract.create({
      data: {
        org_id: org.id,
        kind: 'recurring',
        title,
        counterparty_name,
        recurring_amount,
        billing_frequency,
        status,
        value: 0,
        start_date: monthsAgo(startAgo, 1),
        end_date: endMonthsAhead === null ? null : monthsAgo(-endMonthsAhead, 28),
        created_by: userId,
      },
    });
  await recurring('Outsourced accounting retainer', 'Sagar Steels', 120000, 'monthly', 10);
  await recurring('GST & compliance package', 'Lotus Pharma', 270000, 'quarterly', 7);
  await recurring('Annual audit assurance', 'Mehta Group', 960000, 'annual', 5, 'active', 7);
  await recurring('Payroll processing', 'Kiran Exports', 45000, 'monthly', 3, 'active', 2);
  console.log('  + Acconcy: leads and recurring contracts');
}

async function main() {
  const delphic = await prisma.org.findUnique({ where: { slug: 'delphic' } });
  if (!delphic) throw new Error('Org "delphic" not found. Run the phase-0 backfill first.');
  const admin = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!admin) throw new Error(`${EMAIL} not found. Run "npm run erp:seed:multi-org" first.`);

  const group = delphic.org_group_id;
  const acconcy = await ensureOrg(group, { name: 'Acconcy Finance', slug: 'acconcy', modules: ['leads', 'contracts'], multiple: 4 });
  const gulati = await ensureOrg(group, { name: 'Gulati Industries', slug: 'gulati', modules: ['trading'], multiple: 0.5 });
  const zephyr = await ensureOrg(group, { name: 'Zephyr Infrastructure', slug: 'zephyr', modules: ['leads', 'contracts', 'projects'], multiple: 3 });
  for (const org of [acconcy, gulati, zephyr]) await ensureMembership(admin.id, org);

  await seedGulati(gulati, admin.id);
  await seedZephyr(zephyr, admin.id);
  await seedAcconcy(acconcy, admin.id);
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
