/**
 * Local demo data for the features the other seed scripts leave empty, so every screen has something to show:
 * calendar (interview rounds with interviewers, past and upcoming, internal and client), overtime tickets,
 * expense claims, salary payments, vendor payments, website job postings + form submissions and the monthly
 * asset values of Gulati Industries and Zephyr.
 *
 * Idempotent (each block runs only while its own demo rows are missing; demo rows carry a "[demo]" marker or fixed
 * keys) and non-destructive. LOCAL ONLY: refuses a non-local database.
 *
 * Usage (from server/): node prisma/seed-demo-gaps.js
 */
const { PrismaClient } = require('@prisma/client');
const { assertNonProdDestructive } = require('./_guard');
const prisma = new PrismaClient();

const DAY = 86400000;
const at = (days, hour = 11) => { const d = new Date(Date.now() + days * DAY); d.setUTCHours(hour - 5, 30 - 0, 0, 0); return d; };
const ymd = (d) => d.toISOString().slice(0, 10);
const month = (offset) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + offset); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }; };
const log = (msg) => console.log(`  ${msg}`);

async function orgBy(test) {
  return (await prisma.org.findMany()).find(test) || null;
}

async function interviews(delphic, actor) {
  if (await prisma.interviewRound.count({ where: { round_name: { startsWith: '[demo]' } } })) return log('interviews: already seeded');
  const subs = await prisma.submission.findMany({ where: { OR: [{ org_id: delphic.id }, { org_id: null }] }, orderBy: { created_at: 'asc' }, take: 14, include: { seat: { include: { requirement: { select: { account_id: true } } } } } });
  if (!subs.length) return log('interviews: no submissions to attach to');
  const staff = await prisma.user.findMany({ where: { active: true, role: { in: ['admin', 'sales', 'recruiter'] } }, orderBy: { created_at: 'asc' }, take: 6, select: { id: true, name: true, email: true } }).catch(() => []);
  const people = staff.length ? staff : [{ id: actor.id, name: actor.name, email: actor.email }];
  // [day offset, round type, status, result]
  const plan = [
    [-6, 'internal_r1', 'completed', 'pass'], [-5, 'client_r1', 'completed', 'pass'], [-4, 'internal_r1', 'completed', 'fail'],
    [-3, 'client_r1', 'completed', 'no_show'], [-2, 'internal_r2', 'completed', 'pass'], [-1, 'client_r2', 'cancelled', 'pending'],
    [0, 'internal_r1', 'scheduled', 'pending'], [0, 'client_r1', 'scheduled', 'pending'], [1, 'client_r1', 'scheduled', 'pending'],
    [2, 'internal_r2', 'scheduled', 'pending'], [3, 'client_r2', 'scheduled', 'pending'], [4, 'hr_cto_ceo', 'scheduled', 'pending'],
    [6, 'client_r3', 'scheduled', 'pending'], [8, 'internal_r1', 'scheduled', 'pending'],
  ];
  let n = 0;
  for (const [i, [offset, type, status, result]] of plan.entries()) {
    const sub = subs[i % subs.length];
    const existing = await prisma.interviewRound.count({ where: { submission_id: sub.id } });
    const interviewer = people[i % people.length];
    const round = await prisma.interviewRound.create({
      data: {
        submission_id: sub.id, org_id: delphic.id, round_number: existing + 1, round_type: type, round_name: `[demo] ${type.replace('_', ' ')}`,
        scheduled_at: at(offset, 10 + (i % 6)), duration_minutes: type.startsWith('client') ? 60 : 45, interviewer_name: interviewer.name, interviewer_email: interviewer.email,
        meeting_link: 'https://meet.example.com/demo-room', status, result,
        feedback: result === 'pass' ? 'Strong fundamentals, good communication.' : result === 'fail' ? 'Not a fit for the role.' : null,
        rating: result === 'pass' ? 4 : result === 'fail' ? 2 : null,
        completed_at: status === 'completed' ? at(offset, 12) : null,
        cancelled_at: status === 'cancelled' ? at(offset, 9) : null, cancellation_reason: status === 'cancelled' ? 'Client asked to reschedule' : null,
        scheduled_by: actor.id,
        interviewers: { create: [{ user_id: interviewer.id }, ...(people.length > 1 ? [{ user_id: people[(i + 1) % people.length].id }] : [])].filter((x, k, a) => a.findIndex((y) => y.user_id === x.user_id) === k) },
      },
    });
    n += round ? 1 : 0;
  }
  log(`interviews: ${n} rounds (past results, today, upcoming, one cancelled)`);
}

async function overtime(delphic, actor) {
  if (await prisma.overtimeTicket.count({ where: { org_id: delphic.id } })) return log('overtime: already seeded');
  const members = await prisma.orgMembership.findMany({ where: { org_id: delphic.id, left_at: null, employment_status: { not: 'terminated' }, worker_type: { not: 'contractor' } }, take: 5 });
  const rows = [['pending', -2, 2], ['approved', -5, 3], ['rejected', -8, 4], ['approved', -12, 1.5], ['pending', -1, 2.5]];
  let n = 0;
  for (const [i, [status, offset, hours]] of rows.entries()) {
    const m = members[i % Math.max(1, members.length)];
    if (!m) break;
    const decided = status !== 'pending';
    const t = await prisma.overtimeTicket.create({
      data: { org_id: delphic.id, org_membership_id: m.id, date: new Date(`${ymd(at(offset))}T00:00:00Z`), hours, reason: '[demo] Release support after hours', status, decided_by: decided ? actor.id : null, decided_at: decided ? at(offset + 1) : null, decision_reason: status === 'rejected' ? 'Not pre-approved' : null },
    });
    await prisma.overtimeTicketEvent.create({ data: { ticket_id: t.id, actor_id: actor.id, action: 'created', note: 'Raised' } }).catch(() => null);
    n += 1;
  }
  log(`overtime: ${n} tickets (pending, approved, rejected)`);
}

async function expenseClaims(delphic, actor) {
  if (await prisma.expenseClaim.count({ where: { org_id: delphic.id } })) return log('expense claims: already seeded');
  const location = await prisma.location.findFirst({ where: { org_id: delphic.id } });
  const members = await prisma.orgMembership.findMany({ where: { org_id: delphic.id, left_at: null }, take: 4 });
  if (!location || !members.length) return log('expense claims: no location or members');
  const rows = [['Travel', 4200, 'pending'], ['Meals', 1350, 'approved'], ['Internet', 999, 'reimbursed'], ['Client gift', 2500, 'rejected'], ['Travel', 8800, 'pending']];
  for (const [i, [category, amount, status]] of rows.entries()) {
    const m = members[i % members.length];
    await prisma.expenseClaim.create({
      data: {
        org_id: delphic.id, org_membership_id: m.id, location_id: location.id, category, amount, status, expense_date: new Date(`${ymd(at(-3 - i))}T00:00:00Z`),
        description: `[demo] ${category} claim`, submitted_by: m.person_id || actor.id,
        decided_by: ['approved', 'rejected', 'reimbursed'].includes(status) ? actor.id : null, decided_at: ['approved', 'rejected', 'reimbursed'].includes(status) ? at(-2) : null,
        decision_reason: status === 'rejected' ? 'Over the gifting limit' : null, reimbursed_at: status === 'reimbursed' ? at(-1) : null,
      },
    });
  }
  log(`expense claims: ${rows.length} (pending, approved, reimbursed, rejected)`);
}

async function salaryPayments(delphic, actor) {
  if (await prisma.salaryPayment.count({ where: { org_id: delphic.id } })) return log('salary payments: already seeded');
  const members = await prisma.orgMembership.findMany({ where: { org_id: delphic.id, left_at: null, worker_type: { not: 'contractor' } }, take: 8 });
  const prev = month(-1);
  let n = 0;
  for (const [i, m] of members.entries()) {
    if (i % 3 === 2) continue; // leave a few unpaid so the dashboard shows both
    await prisma.salaryPayment.create({
      data: { org_id: delphic.id, org_membership_id: m.id, period_month: prev.month, period_year: prev.year, paid_on: new Date(`${ymd(at(-8))}T00:00:00Z`), amount_paid: 30000 + i * 2500, payment_mode: i % 2 ? 'upi' : 'bank_transfer', transaction_id: `DEMO${prev.key.replace('-', '')}${String(i).padStart(3, '0')}`, bank_name: 'HDFC Bank', notes: '[demo]', updated_by: actor.id },
    });
    n += 1;
  }
  log(`salary payments: ${n} paid for ${prev.key} (some left unpaid on purpose)`);
}

async function vendorPayments(delphic, actor) {
  if (await prisma.vendorPayment.count({ where: { org_id: delphic.id } })) return log('vendor payments: already seeded');
  const vendor = await prisma.account.findFirst({ where: { org_id: delphic.id, name: { contains: 'Vendor' } }, select: { id: true, name: true } });
  const prev = month(-1);
  const rows = [['pending', 80000, 'contractor'], ['approved', 88000, 'contractor'], ['paid', 45000, 'external_resource'], ['rejected', 15000, 'third_party']];
  for (const [i, [status, amount, type]] of rows.entries()) {
    await prisma.vendorPayment.create({
      data: { org_id: delphic.id, vendor_name: vendor?.name || `Demo Vendor ${i + 1}`, vendor_type: type, vendor_account_id: vendor?.id || null, amount, period_month: i === 2 ? month(-2).month : prev.month, period_year: i === 2 ? month(-2).year : prev.year, status, created_by: actor.id, decided_by: status === 'pending' ? null : actor.id, decided_at: status === 'pending' ? null : at(-3), decision_reason: status === 'rejected' ? 'Invoice mismatch' : null, paid_at: status === 'paid' ? at(-2) : null },
    });
  }
  log(`vendor payments: ${rows.length} (pending, approved, paid, rejected)`);
}

async function website(delphic, actor) {
  if (!(await prisma.websiteJobPosting.count({ where: { org_id: delphic.id } }))) {
    const reqs = await prisma.requirement.findMany({ where: { OR: [{ org_id: delphic.id }, { org_id: null }], status: { in: ['open', 'in_progress'] }, deleted_at: null }, take: 3, select: { id: true, title: true } });
    for (const [i, r] of reqs.entries()) {
      await prisma.websiteJobPosting.create({ data: { org_id: delphic.id, requirement_id: r.id, title: r.title, department: 'Engineering', location: 'Indore / Remote', employment_type: 'Full time', public_description: '[demo] Join our team and work on client projects.', status: i === 2 ? 'closed' : 'published', last_synced_at: at(-1), created_by: actor.id } });
    }
    log(`website: ${reqs.length} job postings`);
  } else log('website postings: already seeded');
  if (!(await prisma.websiteSubmission.count({ where: { external_id: { startsWith: 'demo-' } } }))) {
    const rows = [
      ['contact', 'Rahul Verma', 'rahul@example.com', { message: 'We need a staffing partner for 5 developers.', company: 'Verma Tech' }, 'new'],
      ['contact', 'Neha Kapoor', 'neha@example.com', { message: 'Please share your service rates.', company: 'Kapoor Retail' }, 'new'],
      ['career', 'Aditya Joshi', 'aditya@example.com', { role: 'Java Developer', experience: '4 years', notice_period: '30 days' }, 'new'],
      ['career', 'Sneha Pillai', 'sneha@example.com', { role: 'QA Engineer', experience: '3 years', notice_period: 'Immediate' }, 'dismissed'],
      ['secure', 'Anonymous', null, { message: 'Report: demo secure-form entry.' }, 'new'],
    ];
    for (const [i, [form_type, name, email, payload, status]] of rows.entries()) {
      await prisma.websiteSubmission.create({ data: { org_id: delphic.id, form_type, external_id: `demo-${i + 1}`, sheet_row: i + 2, payload, name, email, submitted_at: at(-i), status } });
    }
    log(`website: ${rows.length} form submissions (contact, career, secure)`);
  } else log('website submissions: already seeded');
}

async function assetValues(gulati, zephyr, actor) {
  for (const [org, model, base] of [[gulati, 'gxAssetValue', 5000000], [zephyr, 'zxAssetValue', 20000000]]) {
    if (!org || (await prisma[model].count({ where: { org_id: org.id } }))) { log(`${model}: skipped`); continue; }
    for (const off of [-5, -4, -3, -2, -1, 0]) {
      const m = month(off);
      await prisma[model].create({ data: { org_id: org.id, month: m.key, asset_value: base + (off + 5) * 250000, notes: '[demo]', updated_by: actor.id } });
    }
    log(`${model}: 6 months`);
  }
}

async function main() {
  assertNonProdDestructive('seed-demo-gaps');
  const delphic = await orgBy((o) => !(o.enabled_modules || []).some((x) => ['gulati', 'zephyr', 'acconcy', 'foundation', 'zklyrera', 'valterra', 'coming_soon'].includes(x)));
  if (!delphic) throw new Error('Delphic Global org not found');
  const gulati = await orgBy((o) => (o.enabled_modules || []).includes('gulati'));
  const zephyr = await orgBy((o) => (o.enabled_modules || []).includes('zephyr'));
  const actor = await prisma.user.findFirst({ where: { is_group_superadmin: true, active: true } }) || await prisma.user.findFirst({ where: { active: true } });
  console.log(`Seeding demo gaps for ${delphic.name} as ${actor.email}`);
  await interviews(delphic, actor);
  await overtime(delphic, actor);
  await expenseClaims(delphic, actor);
  await salaryPayments(delphic, actor);
  await vendorPayments(delphic, actor);
  await website(delphic, actor);
  await assetValues(gulati, zephyr, actor);
  console.log('Done.');
}

main().catch((e) => { console.error('seed-demo-gaps failed:', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
