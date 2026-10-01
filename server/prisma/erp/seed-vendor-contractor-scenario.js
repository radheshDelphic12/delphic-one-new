/**
 * Scenario seed: a VENDOR's contractor works on our client project.
 *
 *   - the contract covers a full month of 22 working days (Sept 2026 = 22 weekdays, on a
 *     dedicated calendar with no holidays so the contract is exactly 22 days);
 *   - the contractor filled and got APPROVED timesheets for only 20 of those 22 days
 *     (two days with no entry);
 *   - vendor payout is therefore rate x 20 / 22, not the full retainer.
 *
 *   Vendor rate INR 88,000 / month -> 4,000 per contract day:
 *     approved-hours basis (default) pays 20 x 4,000 = INR 80,000
 *     contract basis would pay the full INR 88,000.
 *   The client is billed by the contract (monthly retainer) INR 120,000, so the margin
 *   shows both sides side by side.
 *
 * Idempotent and non-destructive; every name starts with "Scenario". Run after
 * phase0-backfill + seed-locations-calendars. LOCAL / STAGING DEMO ONLY.
 *
 * Months: August and September 2026 by default (PERIODS="2026-08,2026-09"). A month with
 * fewer weekdays than WORKED_DAYS has fewer blank days (August 2026 has 21 weekdays, so 20
 * approved + 1 blank). The project agreement spans all listed months.
 *
 * Usage (from server/): node prisma/erp/seed-vendor-contractor-scenario.js
 *   PERIODS="2026-08,2026-09" overrides the months; WORKED_DAYS (default 20) the days filled.
 */
const bcrypt = require('bcryptjs');
const prisma = require('../../src/config/db');
const calendarsService = require('../../src/modules/calendars/calendars.service');
const { DEFAULT_SEED_PASSWORD } = require('../team-roster');

const ORG_SLUG = process.env.ORG_SLUG || 'delphic';
const PERIODS = (process.env.PERIODS || '2026-08,2026-09').split(',').map((x) => {
  const [y, m] = x.trim().split('-').map(Number);
  return { year: y, month: m };
});
const WORKED_DAYS = Number(process.env.WORKED_DAYS) || 20;
const VENDOR_RATE = 88000;
const CLIENT_RATE = 120000;

const ymd = (d) => d.toISOString().slice(0, 10);

function weekdays({ year, month }) {
  const out = [];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let d = 1; d <= last; d += 1) {
    const date = new Date(Date.UTC(year, month - 1, d));
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) out.push(ymd(date));
  }
  return out;
}

async function ensureAccount(org, owner, { type, name }) {
  const found = await prisma.account.findFirst({ where: { org_id: org.id, type, name } });
  if (found) return found;
  console.log(`  + ${type} account "${name}"`);
  return prisma.account.create({ data: { org_id: org.id, type, name, stage: 'active', owner_id: owner.id, origin_owner_id: owner.id } });
}

async function main() {
  const org = await prisma.org.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`org "${ORG_SLUG}" not found - run phase0-backfill first`);
  const adminMembership = await prisma.orgMembership.findFirst({ where: { org_id: org.id, role: 'admin' }, include: { person: true }, orderBy: { created_at: 'asc' } });
  if (!adminMembership) throw new Error('no admin in the org');
  const admin = adminMembership.person;
  const first = PERIODS[0];
  const last = PERIODS[PERIODS.length - 1];
  const agreementStart = new Date(Date.UTC(first.year, first.month - 1, 1));
  const agreementEnd = new Date(Date.UTC(last.year, last.month, 0));
  console.log(`[vendor-scenario] ${org.name}, months ${PERIODS.map((p) => `${p.month}/${p.year}`).join(', ')}, ${WORKED_DAYS} days filled per month`);

  // A calendar with no holidays, so the contract is exactly the month's weekdays.
  let calendar = await prisma.calendar.findFirst({ where: { org_id: org.id, name: 'Scenario Calendar (no holidays)' } });
  if (!calendar) {
    calendar = await prisma.calendar.create({ data: { org_id: org.id, name: 'Scenario Calendar (no holidays)', is_default: false } });
    console.log('  + calendar "Scenario Calendar (no holidays)"');
  }

  const vendor = await ensureAccount(org, admin, { type: 'vendor', name: 'Scenario Vendor Pvt Ltd' });
  const client = await ensureAccount(org, admin, { type: 'client', name: 'Scenario Client Corp' });

  // Our project for the client, on the no-holiday calendar, contract = the whole month.
  const projectName = 'Scenario Client Project';
  let project = await prisma.account.findFirst({ where: { org_id: org.id, name: projectName, is_project: true } });
  if (!project) {
    const created = await calendarsService.createProject(org.id, admin.id, { name: projectName, client_account_id: client.id, service_category: 'managed_services', calendar_id: calendar.id });
    if (created.error) throw new Error(`createProject: ${created.error}`);
    project = await prisma.account.findFirst({ where: { org_id: org.id, name: projectName, is_project: true } });
    console.log(`  + project "${projectName}"`);
  }
  // Agreement spans every seeded month; the rate is in force from the first one (re-aligned on every run).
  await prisma.account.update({
    where: { id: project.id },
    data: { agreement_start_date: agreementStart, agreement_end_date: agreementEnd, overtime_billable: false, client_billing_basis: 'contract', vendor_payout_basis: 'approved_hours', client_billing_currency: 'INR' },
  });
  const rate = await prisma.billingRate.findFirst({ where: { account_id: project.id, requirement_id: null }, orderBy: { created_at: 'asc' } });
  if (!rate) {
    await prisma.billingRate.create({ data: { org_id: org.id, account_id: project.id, rate_type: 'monthly', rate: CLIENT_RATE, currency: 'INR', effective_from: agreementStart, created_by: admin.id } });
    console.log(`    client billing: monthly INR ${CLIENT_RATE} (contract), vendor payout: approved hours`);
  } else if (rate.effective_from.getTime() !== agreementStart.getTime()) {
    await prisma.billingRate.update({ where: { id: rate.id }, data: { effective_from: agreementStart } });
    console.log(`    client rate now effective from ${ymd(agreementStart)}`);
  }

  // The vendor's contractor.
  const email = 'scenario.contractor@delphic.in';
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({ data: { name: 'Ravi Kumar (Scenario Vendor)', email, password_hash: await bcrypt.hash(DEFAULT_SEED_PASSWORD, 10), role: 'employee', active: true } });
    console.log(`  + user ${email}`);
  }
  let membership = await prisma.orgMembership.findFirst({ where: { org_id: org.id, person_id: user.id } });
  if (!membership) {
    membership = await prisma.orgMembership.create({
      data: { org_id: org.id, person_id: user.id, role: 'employee', employment_status: 'active', joined_at: new Date(`${YEAR}-01-01`), worker_type: 'contractor', vendor_account_id: vendor.id, vendor_rate: VENDOR_RATE, vendor_rate_currency: 'INR' },
    });
    console.log(`  + contractor of "${vendor.name}", vendor rate INR ${VENDOR_RATE}/month`);
  }
  if (!(await prisma.projectMemberAssignment.findFirst({ where: { account_id: project.id, org_membership_id: membership.id } }))) {
    await prisma.projectMemberAssignment.create({ data: { org_id: org.id, account_id: project.id, org_membership_id: membership.id, resource_type: 'contractor', allocation_percent: 100, created_by: admin.id } });
  }

  // Per month: WORKED_DAYS approved days (8h); the blank days are spread through the month.
  for (const period of PERIODS) {
    const days = weekdays(period);
    const blanks = Math.max(0, days.length - WORKED_DAYS);
    const skipped = new Set([days[Math.floor(days.length * 0.3)], days[Math.floor(days.length * 0.75)]].slice(0, blanks));
    const worked = days.filter((d) => !skipped.has(d)).slice(0, WORKED_DAYS);
    const range = { gte: new Date(days[0]), lte: new Date(days[days.length - 1]) };
    if (!(await prisma.timesheetEntry.count({ where: { org_membership_id: membership.id, account_id: project.id, date: range } }))) {
      await prisma.timesheetEntry.createMany({
        data: worked.map((d) => ({ org_id: org.id, org_membership_id: membership.id, account_id: project.id, date: new Date(d), hours: 8, billable: true, status: 'approved', approved_by: admin.id, approved_at: new Date() })),
      });
      console.log(`  + ${period.month}/${period.year}: ${worked.length} approved days of ${days.length} (no entry on ${[...skipped].join(', ') || '-'})`);
    }
  }

  // Show what the engine makes of each month.
  const vendorEngine = require('../../src/modules/calculations/engines/vendorPayment.engine');
  for (const period of PERIODS) {
    const res = await vendorEngine.computeVendorPayments(org.id, { period_month: period.month, period_year: period.year, vendor_account_id: vendor.id });
    const line = res.lines.find((l) => l.org_membership_id === membership.id);
    if (!line) { console.log(`[vendor-scenario] ${period.month}/${period.year}: no payout line`); continue; }
    console.log(`[vendor-scenario] ${period.month}/${period.year} payout: ${line.payable_days} of ${line.contract_working_days} contract days -> ${line.currency} ${line.amount} (full retainer ${VENDOR_RATE}), approved hours ${line.approved_hours}`);
  }
  console.log('[vendor-scenario] done. See Live Analytics > Vendors / Billing & Sales for August and September 2026.');
}

main()
  .catch((err) => { console.error('[vendor-scenario] failed:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
