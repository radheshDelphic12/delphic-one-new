/**
 * Zklyrera Spirits - company bootstrap. NON-DESTRUCTIVE, safe for staging / production.
 *
 * Creates or updates only what Zklyrera needs: the `zklyrera` org (module `zklyrera`; an existing org keeps its
 * other modules and loses only the `coming_soon` marker), placed in the SAME holding group as the Delphic org so the group
 * Super Admin sees it on the Group Dashboard, the default settings, and an admin login that is a member of the org.
 * Nothing is deleted and no demo data is loaded (use `zklyrera:seed` locally for that). Categories are created by the app
 * the first time they are needed.
 *
 * Usage (from server/, DATABASE_URL pointed at the target DB):
 *   node prisma/zklyrera/seed-admin.js
 *
 * Admin: set ZKLYRERA_ADMIN_EMAIL (and ZKLYRERA_ADMIN_PASSWORD when that login does not exist yet). With no email,
 * every group Super Admin of the holding group becomes an admin of the zklyrera. An existing user keeps their password
 * unless ZKLYRERA_ADMIN_RESET_PASSWORD=1. Override the group with ZKLYRERA_GROUP_ORG_SLUG (default "delphic").
 */
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const GROUP_SLUG = process.env.ZKLYRERA_GROUP_ORG_SLUG || 'delphic';

async function ensureOrg() {
  const anchor = await prisma.org.findUnique({ where: { slug: GROUP_SLUG }, select: { org_group_id: true } });
  let org = await prisma.org.findUnique({ where: { slug: 'zklyrera' } });
  if (!org) {
    const groupId = anchor ? anchor.org_group_id : (await prisma.orgGroup.create({ data: { name: 'Zklyrera Spirits' } })).id;
    org = await prisma.org.create({
      data: { org_group_id: groupId, name: 'Zklyrera Spirits', slug: 'zklyrera', timezone: 'Asia/Kolkata', default_currency: 'INR', enabled_modules: ['zklyrera'] },
    });
    console.log(`  + org "Zklyrera Spirits" (${anchor ? `in the ${GROUP_SLUG} group` : 'in its own holding group - no Delphic org found'})`);
    return org;
  }
  const modules = org.enabled_modules.filter((m) => m !== 'coming_soon');
  if (!modules.includes('zklyrera')) modules.push('zklyrera');
  if (modules.join() !== org.enabled_modules.join()) {
    org = await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: modules } });
    console.log('  ~ enabled module "zklyrera" (coming_soon marker removed)');
  }
  if (anchor && org.org_group_id !== anchor.org_group_id) console.warn(`  ! Zklyrera is in a different holding group than "${GROUP_SLUG}"; left unchanged (move it with an UPDATE on orgs.org_group_id if the Super Admin should see it)`);
  return org;
}

async function ensureAdmins(org) {
  const email = (process.env.ZKLYRERA_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ZKLYRERA_ADMIN_PASSWORD;
  const admins = [];
  if (email) {
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      if (!password || password.length < 8) throw new Error('Set ZKLYRERA_ADMIN_PASSWORD (at least 8 characters) to create the admin login');
      user = await prisma.user.create({ data: { name: process.env.ZKLYRERA_ADMIN_NAME || 'Zklyrera Admin', email, password_hash: await bcrypt.hash(password, 10), role: 'admin', active: true } });
      console.log(`  + admin user ${email}`);
    } else if (process.env.ZKLYRERA_ADMIN_RESET_PASSWORD === '1') {
      if (!password || password.length < 8) throw new Error('Set ZKLYRERA_ADMIN_PASSWORD (at least 8 characters) to reset the password');
      await prisma.user.update({ where: { id: user.id }, data: { password_hash: await bcrypt.hash(password, 10), active: true } });
      console.log(`  ~ password reset for ${email}`);
    } else {
      console.log(`  = user ${email} exists (password unchanged)`);
    }
    admins.push(user);
  } else {
    const members = await prisma.orgGroupMembership.findMany({ where: { org_group_id: org.org_group_id }, select: { user_id: true } });
    const supers = await prisma.user.findMany({ where: { id: { in: members.map((m) => m.user_id) }, is_group_superadmin: true, active: true } });
    if (!supers.length) throw new Error('No group Super Admin found for this holding group. Set ZKLYRERA_ADMIN_EMAIL (and ZKLYRERA_ADMIN_PASSWORD) to create the zklyrera admin');
    admins.push(...supers);
    console.log(`  = admins: ${supers.map((u) => u.email).join(', ')} (the group Super Admin)`);
  }
  for (const u of admins) {
    if (u.role !== 'admin') console.warn(`  ! ${u.email} has role "${u.role}"; Zklyrera needs a role-admin login`);
    if (!(await prisma.orgMembership.findFirst({ where: { person_id: u.id, org_id: org.id } }))) {
      await prisma.orgMembership.create({ data: { person_id: u.id, org_id: org.id, role: 'admin' } });
      console.log(`  + org membership for ${u.email}`);
    }
  }
  return admins;
}

async function run() {
  try {
    await prisma.zkSetting.count();
  } catch (err) {
    throw new Error(`The Zklyrera tables are missing on this database. Run "npx prisma migrate deploy" first. (${err.message.split('\n').pop()})`);
  }
  const org = await ensureOrg();
  const admins = await ensureAdmins(org);
  await prisma.zkSetting.upsert({ where: { org_id: org.id }, update: {}, create: { org_id: org.id } });
  console.log('Zklyrera Spirits admin seed done.');
  return { org, admins };
}

module.exports = { run, prisma };

if (require.main === module) {
  run()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
