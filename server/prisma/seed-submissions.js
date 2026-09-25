/**
 * Local dev only — seed a spread of candidate profiles + submissions so the
 * pipeline boards, vendor-name cards, stage filter, and coverage-gap reports
 * have something to show. Re-runnable: wipes its own tagged rows first.
 *
 *   node prisma/seed-submissions.js
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const TAG = 'seed:submissions';
const NOREQ_PREFIX = '[seed] NoReq ';

const STAGES = [
  'sourced',
  'internal_screening',
  'submitted_to_client',
  'interview_scheduled',
  'interview_result',
  'offer_sent',
  'bgv',
  'closed',
  'backout',
  'rejected',
];

const FIRST = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Isha', 'Vivaan', 'Anaya', 'Arjun', 'Sara', 'Reyansh', 'Kiara', 'Aditya', 'Myra', 'Ishaan', 'Aadhya', 'Dev', 'Riya', 'Yash', 'Tara'];
const LAST = ['Sharma', 'Patel', 'Nair', 'Reddy', 'Iyer', 'Bose', 'Khan', 'Mehta', 'Gupta', 'Rao'];
const SKILLS = [['Node.js', 'React'], ['Java', 'Spring'], ['Python', 'Django'], ['ServiceNow'], ['AWS', 'Terraform'], ['Go', 'Kubernetes']];

async function main() {
  // 1. Clean prior seed rows
  const priorProfiles = await prisma.profile.findMany({ where: { recruiter_notes: TAG }, select: { id: true } });
  const priorIds = priorProfiles.map((p) => p.id);
  if (priorIds.length) {
    await prisma.interviewRound.deleteMany({ where: { submission: { profile_id: { in: priorIds } } } });
    await prisma.submission.deleteMany({ where: { profile_id: { in: priorIds } } });
    await prisma.profile.deleteMany({ where: { id: { in: priorIds } } });
  }
  await prisma.requirement.deleteMany({ where: { account: { name: { startsWith: NOREQ_PREFIX } } } }).catch(() => {});
  await prisma.account.deleteMany({ where: { name: { startsWith: NOREQ_PREFIX } } });

  // 2. Reference data
  const recruiters = await prisma.user.findMany({ where: { role: 'recruiter', active: true } });
  const bda = await prisma.user.findFirst({ where: { role: 'bda', active: true } });
  const vendors = await prisma.account.findMany({ where: { type: 'vendor' }, take: 8 });
  const seats = await prisma.requirementSeat.findMany({
    where: { seat_status: 'open', is_locked: false },
    take: 20,
    include: { requirement: { select: { title: true } } },
  });

  if (!recruiters.length || !bda || !seats.length) {
    throw new Error('Need recruiters, a BDA, and open requirement seats first (run seed / seed:accounts / seed:jira).');
  }
  if (!vendors.length) console.warn('No vendor accounts found — vendor-sourced profiles will be skipped.');

  // 3. Clients with no requirements (for the coverage-gap report)
  for (const suffix of ['Alpha', 'Bravo']) {
    await prisma.account.create({
      data: {
        type: 'client',
        name: `${NOREQ_PREFIX}${suffix}`,
        stage: 'active',
        owner_id: bda.id,
        origin_owner_id: bda.id,
      },
    });
  }

  // 4. Profiles + submissions
  let made = 0;
  let vendorGapCount = 0;
  for (let i = 0; i < 20; i += 1) {
    const isVendor = vendors.length && i % 5 < 2; // ~40% vendor-sourced
    const recruiter = recruiters[i % recruiters.length];
    const vendor = isVendor ? vendors[i % vendors.length] : null;
    const name = `${FIRST[i % FIRST.length]} ${LAST[i % LAST.length]}`;

    const profile = await prisma.profile.create({
      data: {
        name,
        total_experience_years: 3 + (i % 8),
        primary_skills: SKILLS[i % SKILLS.length],
        source: isVendor ? 'vendor' : (i % 3 === 0 ? 'linkedin' : 'direct'),
        vendor_account_id: vendor ? vendor.id : null,
        added_by: recruiter.id,
        recruiter_notes: TAG,
        expected_ctc: 1200000 + i * 50000,
        notice_period_days: [0, 15, 30, 60][i % 4],
        on_bench: !isVendor && i % 4 === 0,
      },
    });

    // Leave two vendor-sourced profiles unsubmitted -> recruiter-vendor-gaps rows
    if (isVendor && vendorGapCount < 2) {
      vendorGapCount += 1;
      continue;
    }

    const seat = seats[i % seats.length];
    const stage = STAGES[i % STAGES.length];
    const proposed = 90 + (i % 6) * 10;
    const vendorRate = isVendor ? proposed - (10 + (i % 3) * 5) : null;

    await prisma.submission.create({
      data: {
        requirement_seat_id: seat.id,
        profile_id: profile.id,
        submitted_by: recruiter.id,
        stage,
        proposed_rate: proposed,
        proposed_rate_currency: 'INR',
        proposed_rate_type: 'hourly',
        ...(isVendor
          ? {
              vendor_rate: vendorRate,
              vendor_rate_currency: 'INR',
              vendor_rate_type: 'hourly',
              margin: proposed - vendorRate,
              margin_percentage: Number((((proposed - vendorRate) / proposed) * 100).toFixed(2)),
            }
          : {}),
        ...(stage === 'closed' ? { actual_joining_date: new Date() } : {}),
      },
    });
    made += 1;
  }

  console.log(`Seeded: 20 profiles, ${made} submissions across stages, ${vendorGapCount} vendor gaps, 2 no-requirement clients.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
