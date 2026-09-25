/**
 * Multi-company ERP — demo data for testing workspace switching.
 *
 * Adds a second org ("Acconcy") to the same holding group as "Delphic" and a
 * user, group.admin@delphic.in, who is an admin in BOTH and a group superadmin.
 * Backs the "Multi-Org Admin" chip on the dev quick-login bar.
 *
 * Idempotent and non-destructive (creates only what's missing). LOCAL / STAGING
 * DEMO ONLY — the user gets the shared demo password, so never run this against
 * production.
 *
 * Usage (from server/, DATABASE_URL pointed at the target DB):
 *   node prisma/erp/seed-multi-org-demo.js
 */
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { DEFAULT_SEED_PASSWORD } = require('../team-roster');

const prisma = new PrismaClient();

const EMAIL = 'group.admin@delphic.in';

async function main() {
  const delphic = await prisma.org.findUnique({ where: { slug: 'delphic' } });
  if (!delphic) throw new Error('Org "delphic" not found. Run the phase-0 backfill first.');

  let acconcy = await prisma.org.findUnique({ where: { slug: 'acconcy' } });
  if (!acconcy) {
    acconcy = await prisma.org.create({
      data: { org_group_id: delphic.org_group_id, name: 'Acconcy Finance', slug: 'acconcy', timezone: 'Asia/Kolkata', default_currency: 'INR' },
    });
    console.log('  + org "Acconcy"');
  }

  let user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        name: 'Group Admin',
        email: EMAIL,
        password_hash: await bcrypt.hash(DEFAULT_SEED_PASSWORD, 10),
        role: 'admin',
        active: true,
        is_group_superadmin: true,
      },
    });
    console.log(`  + user ${EMAIL}`);
  }

  // Delphic first (earliest joined) so the default workspace is unchanged.
  const joins = [
    [delphic, new Date('2026-01-01T00:00:00Z')],
    [acconcy, new Date('2026-06-01T00:00:00Z')],
  ];
  for (const [org, joined_at] of joins) {
    const exists = await prisma.orgMembership.findFirst({ where: { person_id: user.id, org_id: org.id } });
    if (!exists) {
      await prisma.orgMembership.create({ data: { person_id: user.id, org_id: org.id, role: 'admin', joined_at } });
      console.log(`  + membership in "${org.name}"`);
    }
  }
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
