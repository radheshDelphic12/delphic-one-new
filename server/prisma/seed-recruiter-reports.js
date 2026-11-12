/**
 * Local dev only — seed profiles submitted to the client by several recruiters across the last
 * few days, so Reports > Recruiter reports (and its click-to-open counts) has data.
 * Re-runnable: removes its own rows (profile names starting "[seed-rr] ") first.
 *
 *   node prisma/seed-recruiter-reports.js
 */
const { PrismaClient } = require('@prisma/client');
const { assertNonProdDestructive } = require('./_guard');

const prisma = new PrismaClient();
const PREFIX = '[seed-rr] ';
const NAMES = ['Aarav Sharma', 'Diya Patel', 'Kabir Nair', 'Meera Reddy', 'Rohan Iyer', 'Isha Bose', 'Vivaan Khan', 'Anaya Mehta', 'Arjun Gupta', 'Sara Rao', 'Dev Singh', 'Riya Das'];

async function main() {
  assertNonProdDestructive('seed-recruiter-reports');

  const old = await prisma.profile.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  if (old.length) {
    const subs = await prisma.submission.findMany({ where: { profile_id: { in: old.map((p) => p.id) } }, select: { id: true } });
    const subIds = subs.map((s) => s.id);
    await prisma.stageHistory.deleteMany({ where: { entity_type: 'submission', entity_id: { in: subIds } } });
    await prisma.submission.deleteMany({ where: { id: { in: subIds } } });
    await prisma.profile.deleteMany({ where: { id: { in: old.map((p) => p.id) } } });
  }

  const recruiters = await prisma.user.findMany({ where: { role: 'recruiter' }, orderBy: { name: 'asc' }, take: 3 });
  const seats = await prisma.requirementSeat.findMany({ take: 6 });
  if (!recruiters.length || !seats.length) throw new Error('Need recruiters and requirement seats in the DB first');

  let n = 0;
  for (let d = 0; d < 5; d++) {
    for (let r = 0; r < recruiters.length; r++) {
      const count = 1 + ((d + r) % 3); // 1..3 per recruiter per day
      for (let k = 0; k < count; k++) {
        const rec = recruiters[r];
        const seat = seats[(n + k) % seats.length];
        const at = new Date(Date.now() - d * 86400000);
        at.setUTCHours(6 + k, 0, 0, 0);
        const profile = await prisma.profile.create({
          data: {
            name: `${PREFIX}${NAMES[n % NAMES.length]} ${n + 1}`,
            added_by: rec.id,
            source: 'direct',
            total_experience_years: 3 + (n % 6),
            primary_skills: ['Node.js', 'React'],
          },
        });
        const sub = await prisma.submission.create({
          data: { requirement_seat_id: seat.id, profile_id: profile.id, submitted_by: rec.id, stage: 'submitted_to_client' },
        });
        await prisma.stageHistory.create({
          data: { entity_type: 'submission', entity_id: sub.id, from_stage: 'internal_screening', to_stage: 'submitted_to_client', changed_by: rec.id, changed_at: at },
        });
        n++;
      }
    }
  }
  console.log(`Seeded ${n} submitted-to-client profiles for: ${recruiters.map((r) => `${r.name} <${r.email}>`).join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
