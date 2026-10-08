/**
 * Acconcy Finance - admin bootstrap. NON-DESTRUCTIVE, safe for staging / production.
 *
 * Creates or updates only what Acconcy needs: the `acconcy` org (module `acconcy`; an existing org keeps its other
 * modules and loses only the `coming_soon` marker, which is what makes the workspace live), the default settings, and
 * one admin login that is a member of the org. Nothing is deleted and no demo data is loaded (use `acconcy:seed`
 * locally for that). Categories are created by the app the first time they are needed. The admin then creates the
 * other users and assigns Acconcy roles from the app.
 *
 * Usage (from server/, DATABASE_URL pointed at the target DB):
 *   node prisma/acconcy/seed-admin.js
 *
 * Defaults to admin@acconcy.in (set ACCONCY_ADMIN_PASSWORD; there is no default password in this script).
 * Override with ACCONCY_ADMIN_EMAIL / ACCONCY_ADMIN_NAME. An existing user keeps their password unless
 * ACCONCY_ADMIN_RESET_PASSWORD=1.
 */
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const EMAIL = (process.env.ACCONCY_ADMIN_EMAIL || 'admin@acconcy.in').trim().toLowerCase();
const PASSWORD = process.env.ACCONCY_ADMIN_PASSWORD;
const NAME = process.env.ACCONCY_ADMIN_NAME || 'Acconcy Admin';

async function main() {
  try {
    await prisma.axSetting.count();
  } catch (err) {
    throw new Error(`The Acconcy tables are missing on this database. Run "npx prisma migrate deploy" first. (${err.message.split('\n').pop()})`);
  }

  let org = await prisma.org.findUnique({ where: { slug: 'acconcy' } });
  if (!org) {
    const group = await prisma.orgGroup.create({ data: { name: 'Acconcy Finance' } });
    org = await prisma.org.create({
      data: { org_group_id: group.id, name: 'Acconcy Finance', slug: 'acconcy', logo_url: '/acconcy-logo.png', timezone: 'Asia/Kolkata', default_currency: 'INR', enabled_modules: ['acconcy'] },
    });
    console.log('  + org "Acconcy Finance"');
  } else {
    const modules = org.enabled_modules.filter((m) => m !== 'coming_soon');
    if (!modules.includes('acconcy')) modules.push('acconcy');
    if (modules.join() !== org.enabled_modules.join()) {
      org = await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: modules } });
      console.log('  ~ enabled module "acconcy" (coming_soon marker removed)');
    }
  }

  let user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    if (!PASSWORD || PASSWORD.length < 8) throw new Error('Set ACCONCY_ADMIN_PASSWORD (at least 8 characters) to create the admin login');
    user = await prisma.user.create({ data: { name: NAME, email: EMAIL, password_hash: await bcrypt.hash(PASSWORD, 10), role: 'admin', active: true } });
    console.log(`  + admin user ${EMAIL}`);
  } else {
    if (user.role !== 'admin') console.warn(`  ! ${EMAIL} already exists with role "${user.role}"; left unchanged - Acconcy admin needs role admin.`);
    if (process.env.ACCONCY_ADMIN_RESET_PASSWORD === '1') {
      if (!PASSWORD || PASSWORD.length < 8) throw new Error('Set ACCONCY_ADMIN_PASSWORD (at least 8 characters) to reset the password');
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
  await prisma.axSetting.upsert({ where: { org_id: org.id }, update: {}, create: { org_id: org.id } });

  console.log('Acconcy admin seed done.');
  console.log(`  login ${EMAIL}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
