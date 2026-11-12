/**
 * READ ONLY. Lists applicants who applied more than once to the same requirement with the same email (the database now
 * allows one). The oldest application of each person keeps working as before; the later ones are kept but are not
 * unique-keyed. Nothing is changed or deleted. Run it before `prisma migrate deploy`.
 *
 * Usage:  node server/scripts/applicants-duplicates.js
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const groups = await prisma.$queryRawUnsafe(`
    SELECT a.requirement_id, r.title, lower(btrim(a.email)) AS email, COUNT(*) AS applications,
           array_agg(a.id::text ORDER BY a.applied_at, a.id) AS applicant_ids,
           array_agg(a.status ORDER BY a.applied_at, a.id) AS statuses
    FROM job_applicants a JOIN requirements r ON r.id = a.requirement_id
    WHERE a.email IS NOT NULL AND btrim(a.email) <> ''
    GROUP BY a.requirement_id, r.title, lower(btrim(a.email))
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, r.title`);
  const [{ n }] = await prisma.$queryRawUnsafe('SELECT COUNT(*) AS n FROM job_applicants');
  console.log(JSON.stringify({ total_applicants: Number(n), duplicate_groups: groups.length, extra_rows: groups.reduce((s, g) => s + Number(g.applications) - 1, 0) }, null, 2));
  for (const g of groups) console.log(`- ${g.title}: ${g.email} applied ${g.applications}x (${g.statuses.join(', ')})  ids: ${g.applicant_ids.join(' ')}`);
  if (!groups.length) console.log('No duplicates: the unique index can be added as is.');
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
