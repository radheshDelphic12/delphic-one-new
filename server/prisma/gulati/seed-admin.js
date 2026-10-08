/**
 * Gulati Industries - admin bootstrap. NON-DESTRUCTIVE, safe for staging / production.
 *
 * Creates only what is missing: the `gulati` org (module `gulati`) with its own holding group, the
 * default settings, and one admin login that is a member of the org. It never deletes or overwrites
 * anything and loads no demo data (use `gulati:seed` for that locally). The default trading types,
 * units and categories are created by the app the first time they are needed. The admin then creates
 * the other users and assigns Gulati roles from the app.
 *
 * Usage (from server/, DATABASE_URL pointed at the target DB):
 *   node prisma/gulati/seed-admin.js
 *
 * Defaults to admin@gulatiindustries.in / Gulati@2026! (initial login - change it after first sign-in).
 * Override with GULATI_ADMIN_EMAIL / GULATI_ADMIN_PASSWORD / GULATI_ADMIN_NAME.
 * An existing user keeps their password unless GULATI_ADMIN_RESET_PASSWORD=1.
 */
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const EMAIL = (process.env.GULATI_ADMIN_EMAIL || 'admin@gulatiindustries.in').trim().toLowerCase();
const PASSWORD = process.env.GULATI_ADMIN_PASSWORD || 'Gulati@2026!';
const NAME = process.env.GULATI_ADMIN_NAME || 'Gulati Admin';

async function main() {
  if (PASSWORD.length < 8) throw new Error('GULATI_ADMIN_PASSWORD must be at least 8 characters');

  // Fail before creating anything if the Gulati tables are not on this database yet (run `prisma migrate deploy` first).
  try {
    await prisma.gxSetting.count();
  } catch (err) {
    throw new Error(`The Gulati tables are missing on this database. Run "npx prisma migrate deploy" first. (${err.message.split('\n').pop()})`);
  }

  let org = await prisma.org.findUnique({ where: { slug: 'gulati' } });
  if (!org) {
    const group = await prisma.orgGroup.create({ data: { name: 'Gulati Industries' } });
    org = await prisma.org.create({
      data: {
        org_group_id: group.id,
        name: 'Gulati Industries',
        slug: 'gulati',
        logo_url: '/gulati-logo.svg',
        timezone: 'Asia/Kolkata',
        default_currency: 'INR',
        enabled_modules: ['gulati'],
      },
    });
    console.log('  + org "Gulati Industries"');
  } else if (!org.enabled_modules.includes('gulati')) {
    // Additive only: keep whatever modules the org already had.
    org = await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: [...org.enabled_modules, 'gulati'] } });
    console.log('  ~ enabled module "gulati" on existing org');
  }

  let user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    const password_hash = await bcrypt.hash(PASSWORD, 10);
    user = await prisma.user.create({ data: { name: NAME, email: EMAIL, password_hash, role: 'admin', active: true } });
    console.log(`  + admin user ${EMAIL}`);
  } else {
    if (user.role !== 'admin') console.warn(`  ! ${EMAIL} already exists with role "${user.role}"; left unchanged - Gulati admin needs role admin.`);
    if (process.env.GULATI_ADMIN_RESET_PASSWORD === '1') {
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

  await prisma.gxSetting.upsert({ where: { org_id: org.id }, update: {}, create: { org_id: org.id } });

  console.log('Gulati admin seed done.');
  console.log(`  login ${EMAIL}${process.env.GULATI_ADMIN_PASSWORD ? ' (password from env)' : ` / ${PASSWORD}`}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
