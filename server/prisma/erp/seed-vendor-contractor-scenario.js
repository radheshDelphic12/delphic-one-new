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
 * Usage (from server/): node prisma/erp/seed-vendor-contractor-scenario.js
 *   PERIOD_MONTH / PERIOD_YEAR override the month; WORKED_DAYS (default 20) the days filled.
 */
const bcrypt = require('bcryptjs');
const prisma = require('../../src/config/db');
const calendarsService = require('../../src/modules/calendars/calendars.service');
const { DEFAULT_SEED_PASSWORD } = require('../team-roster');

const ORG_SLUG = process.env.ORG_SLUG || 'delphic';
const MONTH = Number(process.env.PERIOD_MONTH) || 9;
const YEAR = Number(process.env.PERIOD_YEAR) || 2026;
const WORKED_DAYS = Number(process.env.WORKED_DAYS) || 20;
const VENDOR_RATE = 88000;
const CLIENT_RATE = 120000;

const ymd = (d) => d.toISOString().slice(0, 10);

function weekdays() {
  const out = [];
  const last = new Date(Date.UTC(YEAR, MONTH, 0)).getUTCDate();
  for (let d = 1; d <= last; d += 1) {
    const date = new Date(Date.UTC(YEAR, MONTH - 1, d));
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
  const days = weekdays();
  console.log(`[vendor-scenario] ${org.name}, ${MONTH}/${YEAR}: ${days.length} contract working days, ${WORKED_DAYS} filled`);

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
  if (!(await prisma.billingRate.count({ where: { account_id: project.id } }))) {
    await prisma.account.update({
      where: { id: project.id },
      data: {
        agreement_start_date: new Date(`${YEAR}-${String(MONTH).padStart(2, '0')}-01`),
        agreement_end_date: new Date(Date.UTC(YEAR, MONTH, 0)),
        overtime_billable: false,
        client_billing_basis: 'contract',
        vendor_payout_basis: 'approved_hours',
        client_billing_currency: 'INR',
      },
    });
    await prisma.billingRate.create({ data: { org_id: org.id, account_id: project.id, rate_type: 'monthly', rate: CLIENT_RATE, currency: 'INR', effective_from: new Date(`${YEAR}-${String(MONTH).padStart(2, '0')}-01`), created_by: admin.id } });
    console.log(`    client billing: monthly INR ${CLIENT_RATE} (contract), vendor payout: approved hours`);
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

  // 20 of the 22 days filled and approved; the two days left blank are spread through the month.
  const skipped = new Set([days[Math.floor(days.length * 0.3)], days[Math.floor(days.length * 0.75)]]);
  const worked = days.filter((d) => !skipped.has(d)).slice(0, WORKED_DAYS);
  if (!(await prisma.timesheetEntry.count({ where: { org_membership_id: membership.id, account_id: project.id } }))) {
    await prisma.timesheetEntry.createMany({
      data: worked.map((d) => ({ org_id: org.id, org_membership_id: membership.id, account_id: project.id, date: new Date(d), hours: 8, billable: true, status: 'approved', approved_by: admin.id, approved_at: new Date() })),
    });
    console.log(`  + ${worked.length} approved timesheet days (no entry on ${[...skipped].join(', ')})`);
  }

  // Show what the engine makes of it.
  const vendorEngine = require('../../src/modules/calculations/engines/vendorPayment.engine');
  const res = await vendorEngine.computeVendorPayments(org.id, { period_month: MONTH, period_year: YEAR, vendor_account_id: vendor.id });
  const line = res.lines.find((l) => l.org_membership_id === membership.id);
  console.log(`[vendor-scenario] payout check: ${line.payable_days} of ${line.contract_working_days} contract days -> ${line.currency} ${line.amount} (full retainer would be ${VENDOR_RATE}), approved hours ${line.approved_hours}`);
  console.log('[vendor-scenario] done. See Live Analytics > Vendors / Billing & Sales for the month.');
}

main()
  .catch((err) => { console.error('[vendor-scenario] failed:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
