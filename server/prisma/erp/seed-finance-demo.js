/**
 * Finance demo data - exercises client billing, vendor payouts, leave and
 * billing adjustments end to end for a past month (default: September 2026).
 *
 * Creates (all names/emails prefixed "Demo", idempotent, non-destructive):
 *   - USD exchange rate (83) when the org has none
 *   - a vendor company, two client accounts, three projects:
 *       Demo Acme Support    monthly INR 210000, billed by contract (retainer)
 *       Demo Globex Platform monthly USD 5000,  billed by approved hours
 *       Demo Acme Hourly     hourly INR 1500
 *   - employees (Demo Dev 1/2/3) and a contractor (Demo Contractor, USD 2100/month)
 *     with approved timesheets (the contractor works 20 of the month's 22 days)
 *   - paid half-day + unpaid full-day approved leave and a pending leave
 *   - a +5000 billing adjustment and a draft client invoice
 *
 * Run after phase0-backfill + seed-locations-calendars (the Delphic org and its
 * default calendar must exist). LOCAL / STAGING DEMO ONLY.
 *
 * Usage (from server/): node prisma/erp/seed-finance-demo.js
 *   PERIOD_MONTH / PERIOD_YEAR override the month (must be fully in the past).
 */
const bcrypt = require('bcryptjs');
const prisma = require('../../src/config/db');
const calendarsService = require('../../src/modules/calendars/calendars.service');
const invoices = require('../../src/modules/billing/invoices.service');
const adjustments = require('../../src/modules/billing/adjustments.service');
const leaveService = require('../../src/modules/leave/leave.service');
const { DEFAULT_SEED_PASSWORD } = require('../team-roster');

const ORG_SLUG = process.env.ORG_SLUG || 'delphic';
const MONTH = Number(process.env.PERIOD_MONTH) || 9;
const YEAR = Number(process.env.PERIOD_YEAR) || 2026;
const PERIOD = { period_month: MONTH, period_year: YEAR };

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.toISOString().slice(0, 10);

function workingDays() {
  const days = [];
  const last = new Date(Date.UTC(YEAR, MONTH, 0)).getUTCDate();
  for (let d = 1; d <= last; d += 1) {
    const date = new Date(Date.UTC(YEAR, MONTH - 1, d));
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) days.push(ymd(date));
  }
  return days;
}

async function ensureAccount(org, owner, { type, name }) {
  const existing = await prisma.account.findFirst({ where: { org_id: org.id, type, name } });
  if (existing) return existing;
  console.log(`  + ${type} account "${name}"`);
  return prisma.account.create({ data: { org_id: org.id, type, name, stage: 'active', owner_id: owner.id, origin_owner_id: owner.id } });
}

async function ensureProject(org, admin, client, { name, rate_type, rate, currency, settings = {} }) {
  let project = await prisma.account.findFirst({ where: { org_id: org.id, name, is_project: true } });
  if (!project) {
    const created = await calendarsService.createProject(org.id, admin.id, { name, client_account_id: client.id, service_category: 'managed_services' });
    if (created.error) throw new Error(`createProject ${name}: ${created.error}`);
    project = await prisma.account.findFirst({ where: { org_id: org.id, name, is_project: true } });
    console.log(`  + project "${name}"`);
  }
  // Billing terms are applied once (a half-finished earlier run is completed, a configured project is left alone).
  // Plain writes (not billingService.updateProjectProfile): no interactive transaction, so a slow link can't time it out.
  if (!(await prisma.billingRate.count({ where: { account_id: project.id } }))) {
    await prisma.account.update({
      where: { id: project.id },
      data: { agreement_start_date: new Date('2026-01-01'), overtime_billable: false, client_billing_currency: currency, ...settings },
    });
    await prisma.billingRate.create({ data: { org_id: org.id, account_id: project.id, rate_type, rate, currency, effective_from: new Date('2026-01-01'), created_by: admin.id } });
    console.log(`    billing ${rate_type} ${currency} ${rate}`);
  }
  return project;
}

async function ensurePerson(org, { name, email, contractor = null }) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({ data: { name, email, password_hash: await bcrypt.hash(DEFAULT_SEED_PASSWORD, 10), role: 'employee', active: true } });
    console.log(`  + user ${email}`);
  }
  let membership = await prisma.orgMembership.findFirst({ where: { org_id: org.id, person_id: user.id } });
  if (!membership) {
    membership = await prisma.orgMembership.create({
      data: {
        org_id: org.id,
        person_id: user.id,
        role: 'employee',
        employment_status: 'active',
        joined_at: new Date('2026-01-01'),
        ...(contractor ? { worker_type: 'contractor', vendor_account_id: contractor.vendor.id, vendor_rate: contractor.rate, vendor_rate_currency: contractor.currency } : {}),
      },
    });
  }
  return membership;
}

async function assign(org, admin, project, membership) {
  const has = await prisma.projectMemberAssignment.findFirst({ where: { account_id: project.id, org_membership_id: membership.id } });
  if (!has) await prisma.projectMemberAssignment.create({ data: { org_id: org.id, account_id: project.id, org_membership_id: membership.id, created_by: admin.id } });
}

async function logApproved(org, admin, membership, project, dates, hours = 8) {
  const done = await prisma.timesheetEntry.count({ where: { org_membership_id: membership.id, account_id: project.id, date: { in: dates.map((d) => new Date(d)) } } });
  if (done) return;
  await prisma.timesheetEntry.createMany({
    data: dates.map((d) => ({ org_id: org.id, org_membership_id: membership.id, account_id: project.id, date: new Date(d), hours, billable: true, status: 'approved', approved_by: admin.id, approved_at: new Date() })),
  });
  console.log(`  + ${dates.length} approved timesheet days for ${project.project_name || project.name}`);
}

async function main() {
  const org = await prisma.org.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`org "${ORG_SLUG}" not found - run phase0-backfill first`);
  const adminMembership = await prisma.orgMembership.findFirst({ where: { org_id: org.id, role: 'admin' }, include: { person: true }, orderBy: { created_at: 'asc' } });
  if (!adminMembership) throw new Error('no admin in the org');
  const admin = adminMembership.person;
  console.log(`[finance-demo] ${org.name}, ${MONTH}/${YEAR}, admin ${admin.email}`);

  if (!(await calendarsService.defaultCalendar(org.id))) throw new Error('no default calendar - run seed-locations-calendars first');

  await prisma.exchangeRate.upsert({ where: { org_id_currency: { org_id: org.id, currency: 'USD' } }, update: {}, create: { org_id: org.id, currency: 'USD', rate_to_inr: 83 } });

  const vendor = await ensureAccount(org, admin, { type: 'vendor', name: 'Demo Vendor Co' });
  const acme = await ensureAccount(org, admin, { type: 'client', name: 'Demo Acme Ltd' });
  const globex = await ensureAccount(org, admin, { type: 'client', name: 'Demo Globex Inc' });

  const acmeSupport = await ensureProject(org, admin, acme, { name: 'Demo Acme Support', rate_type: 'monthly', rate: 210000, currency: 'INR' });
  const globexPlatform = await ensureProject(org, admin, globex, { name: 'Demo Globex Platform', rate_type: 'monthly', rate: 5000, currency: 'USD', settings: { client_billing_basis: 'approved_hours', vendor_payout_basis: 'approved_hours' } });
  const acmeHourly = await ensureProject(org, admin, acme, { name: 'Demo Acme Hourly', rate_type: 'hourly', rate: 1500, currency: 'INR' });

  const dev1 = await ensurePerson(org, { name: 'Demo Dev 1', email: 'demo.dev1@delphic.in' });
  const dev2 = await ensurePerson(org, { name: 'Demo Dev 2', email: 'demo.dev2@delphic.in' });
  const dev3 = await ensurePerson(org, { name: 'Demo Dev 3', email: 'demo.dev3@delphic.in' });
  const contractor = await ensurePerson(org, { name: 'Demo Contractor', email: 'demo.contractor@delphic.in', contractor: { vendor, rate: 2100, currency: 'USD' } });

  const days = workingDays();
  await assign(org, admin, acmeSupport, dev1);
  await assign(org, admin, globexPlatform, dev2);
  await assign(org, admin, globexPlatform, contractor);
  await assign(org, admin, acmeHourly, dev3);
  await logApproved(org, admin, dev1, acmeSupport, days);
  await logApproved(org, admin, dev2, globexPlatform, days.slice(0, days.length - 1)); // one day short of the month
  await logApproved(org, admin, contractor, globexPlatform, days.slice(0, days.length - 2)); // 20 of 22 -> payout 20/22 of the rate
  await logApproved(org, admin, dev3, acmeHourly, days.slice(0, 15));

  // Leave on Demo Dev 1's non-timesheet days would conflict, so use Demo Dev 3 (hours stop at day 15).
  const types = await leaveService.listTypes(org.id);
  const paid = types.find((t) => t.paid);
  const unpaid = types.find((t) => !t.paid) || (await prisma.leaveType.upsert({ where: { org_id_name: { org_id: org.id, name: 'Unpaid Leave' } }, update: {}, create: { org_id: org.id, name: 'Unpaid Leave', paid: false } }));
  if (paid && !(await prisma.leaveRequest.count({ where: { org_membership_id: dev3.id, from_date: new Date(days[16]) } }))) {
    const approve = { status: 'approved', approver_id: adminMembership.id, decided_at: new Date() };
    await prisma.leaveRequest.create({ data: { org_id: org.id, org_membership_id: dev3.id, leave_type_id: paid.id, from_date: new Date(days[16]), to_date: new Date(days[16]), is_half_day: true, half_day_session: 'FIRST_HALF', reason: 'Demo paid half day', ...approve } });
    await prisma.leaveRequest.create({ data: { org_id: org.id, org_membership_id: dev3.id, leave_type_id: unpaid.id, from_date: new Date(days[17]), to_date: new Date(days[17]), reason: 'Demo unpaid full day', ...approve } });
    await prisma.leaveRequest.create({ data: { org_id: org.id, org_membership_id: dev3.id, leave_type_id: paid.id, from_date: new Date(days[19]), to_date: new Date(days[19]), reason: 'Demo pending request' } });
    console.log('  + demo leave (paid half day, unpaid full day, one pending)');
  }

  // A +5000 tweak on the retainer project, and a draft invoice from the month.
  const existingAdj = await prisma.billingAdjustment.count({ where: { account_id: acmeSupport.id, ...PERIOD } });
  if (!existingAdj) {
    const adj = await adjustments.createAdjustment(org.id, admin, acmeSupport.id, { ...PERIOD, amount: 5000, reason: 'Demo: extra weekend support' });
    if (adj.error) throw new Error(`adjustment: ${adj.error}`);
    console.log('  + billing adjustment +5000 on Demo Acme Support');
  }
  const hasInvoice = await prisma.clientInvoice.count({ where: { client_account_id: acmeSupport.id, ...PERIOD } });
  if (!hasInvoice) {
    const inv = await invoices.generateClientInvoice(org.id, admin, { account_id: acmeSupport.id, ...PERIOD });
    console.log(inv.error ? `  ! invoice not generated: ${inv.error}` : `  + draft invoice ${inv.invoice.invoice_number} (${inv.invoice.currency} ${inv.invoice.amount})`);
  }
  console.log('[finance-demo] done. Logins: demo.dev1@delphic.in ... (password = seed default). Check Live Analytics > Billing & Sales / Vendors for the month.');
}

main()
  .catch((err) => { console.error('[finance-demo] failed:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
