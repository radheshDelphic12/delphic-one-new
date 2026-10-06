/**
 * Zephyr Infrastructure - admin bootstrap. NON-DESTRUCTIVE, safe for staging / production.
 *
 * Creates only what is missing: the `zephyr` org (module `zephyr`) with its own holding group,
 * the default settings + categories, and one admin login that is a member of the org. It never
 * deletes or overwrites anything and loads no demo data (use `zephyr:seed` for that locally).
 * The admin then creates the other users and assigns Zephyr roles from the app.
 *
 * Usage (from server/, DATABASE_URL pointed at the target DB):
 *   node prisma/zephyr/seed-admin.js
 *
 * Defaults to admin@zephyrinfra.in / Zephyr@2026! (initial login - change it after first sign-in).
 * Override with ZEPHYR_ADMIN_EMAIL / ZEPHYR_ADMIN_PASSWORD / ZEPHYR_ADMIN_NAME.
 * An existing user keeps their password unless ZEPHYR_ADMIN_RESET_PASSWORD=1.
 */
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const EMAIL = (process.env.ZEPHYR_ADMIN_EMAIL || 'admin@zephyrinfra.in').trim().toLowerCase();
const PASSWORD = process.env.ZEPHYR_ADMIN_PASSWORD || 'Zephyr@2026!';
const NAME = process.env.ZEPHYR_ADMIN_NAME || 'Zephyr Admin';
const CATEGORIES = {
  revenue: ['Project billing', 'Property sale', 'Rental income', 'Consulting commission', 'Other income'],
  expense: ['Materials', 'Labour', 'Subcontractor', 'Equipment', 'Site overheads', 'Office', 'Maintenance & repairs', 'Property tax & utilities', 'Other expense'],
};

async function main() {
  if (PASSWORD.length < 8) throw new Error('ZEPHYR_ADMIN_PASSWORD must be at least 8 characters');

  let org = await prisma.org.findUnique({ where: { slug: 'zephyr' } });
  if (!org) {
    const group = await prisma.orgGroup.create({ data: { name: 'Zephyr Infrastructure' } });
    org = await prisma.org.create({
      data: {
        org_group_id: group.id,
        name: 'Zephyr Infrastructure',
        slug: 'zephyr',
        logo_url: '/zephyr-logo.png',
        timezone: 'Asia/Kolkata',
        default_currency: 'INR',
        enabled_modules: ['zephyr'],
      },
    });
    console.log('  + org "Zephyr Infrastructure"');
  } else if (!org.enabled_modules.includes('zephyr')) {
    // Additive only: keep whatever modules the org already had.
    org = await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: [...org.enabled_modules, 'zephyr'] } });
    console.log('  ~ enabled module "zephyr" on existing org');
  }

  let user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    const password_hash = await bcrypt.hash(PASSWORD, 10);
    user = await prisma.user.create({ data: { name: NAME, email: EMAIL, password_hash, role: 'admin', active: true } });
    console.log(`  + admin user ${EMAIL}`);
  } else {
    if (user.role !== 'admin') console.warn(`  ! ${EMAIL} already exists with role "${user.role}"; left unchanged - Zephyr admin needs role admin.`);
    if (process.env.ZEPHYR_ADMIN_RESET_PASSWORD === '1') {
      await prisma.user.update({ where: { id: user.id }, data: { password_hash: await bcrypt.hash(PASSWORD, 10), active: true } });
      console.log(`  ~ password reset for ${EMAIL}`);
    } else {
      console.log(`  = user ${EMAIL} exists (password unchanged)`);
    }
  }

  if (!(await prisma.orgMembership.findFirst({ where: { person_id: user.id, org_id: org.id } }))) {
    await prisma.orgMembership.create({ data: { person_id: user.id, org_id: org.id, role: 'admin' } });
    console.log('  + org membership');
  }

  await prisma.zxSetting.upsert({ where: { org_id: org.id }, update: {}, create: { org_id: org.id } });
  for (const [kind, names] of Object.entries(CATEGORIES)) {
    for (const [i, name] of names.entries()) {
      await prisma.zxCategory.upsert({
        where: { org_id_kind_name: { org_id: org.id, kind, name } },
        update: {},
        create: { org_id: org.id, kind, name, sort_order: i },
      });
    }
  }

  console.log('Zephyr admin seed done.');
  console.log(`  login ${EMAIL}${process.env.ZEPHYR_ADMIN_PASSWORD ? ' (password from env)' : ` / ${PASSWORD}`}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
