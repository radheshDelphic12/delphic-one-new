/**
 * Zephyr Infrastructure - standalone demo workspace (LOCAL / STAGING DEMO ONLY).
 *
 * Creates, only where missing, its own holding group + the `zephyr` org (module
 * `zephyr`), an admin / manager / staff login, a small people roster, and the
 * default categories + settings, then the demo business data (see demo.js; set ZEPHYR_NO_DEMO=1 to
 * skip it). Touches nothing else, so it is safe to run against a database that also holds other
 * companies. Idempotent.
 *
 * Usage (from server/, DATABASE_URL pointed at the target DB):
 *   node prisma/zephyr/seed.js
 */
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { assertNonProdDestructive } = require('../_guard');

const prisma = new PrismaClient();

const PASSWORD = 'Zephyr@2026!';
const LOGINS = [
  { name: 'Zephyr Admin', email: 'admin@zephyrinfra.in', role: 'admin', access_role: null },
  { name: 'Meera Kapoor', email: 'manager@zephyrinfra.in', role: 'employee', access_role: 'manager' },
  { name: 'Rohan Verma', email: 'staff@zephyrinfra.in', role: 'employee', access_role: 'staff' },
];
const ROSTER_ONLY = ['Site Supervisor - Arjun Nair', 'Civil Contractor - Patel Constructions', 'Electrician - Sanjay Rao'];
const CATEGORIES = {
  revenue: ['Project billing', 'Property sale', 'Rental income', 'Other income'],
  expense: ['Materials', 'Labour', 'Subcontractor', 'Equipment', 'Site overheads', 'Office', 'Other expense'],
};

async function main() {
  assertNonProdDestructive('zephyr/seed.js');

  let org = await prisma.org.findUnique({ where: { slug: 'zephyr' } });
  if (!org) {
    const group = await prisma.orgGroup.create({ data: { name: 'Zephyr Infrastructure' } });
    org = await prisma.org.create({
      data: {
        org_group_id: group.id,
        name: 'Zephyr Infrastructure',
        slug: 'zephyr',
        timezone: 'Asia/Kolkata',
        default_currency: 'INR',
        enabled_modules: ['zephyr'],
      },
    });
    console.log('  + org "Zephyr Infrastructure"');
  } else if (!org.enabled_modules.includes('zephyr') || org.enabled_modules.length !== 1) {
    org = await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['zephyr'] } });
    console.log('  ~ org modules set to [zephyr]');
  }

  const password_hash = await bcrypt.hash(PASSWORD, 10);
  for (const login of LOGINS) {
    let user = await prisma.user.findUnique({ where: { email: login.email } });
    if (!user) {
      user = await prisma.user.create({ data: { name: login.name, email: login.email, password_hash, role: login.role, active: true } });
      console.log(`  + user ${login.email}`);
    }
    if (!(await prisma.orgMembership.findFirst({ where: { person_id: user.id, org_id: org.id } }))) {
      await prisma.orgMembership.create({ data: { person_id: user.id, org_id: org.id, role: login.role } });
    }
    if (login.access_role && !(await prisma.zxPerson.findFirst({ where: { org_id: org.id, user_id: user.id } }))) {
      await prisma.zxPerson.create({ data: { org_id: org.id, name: login.name, user_id: user.id, access_role: login.access_role } });
    }
  }

  // The demo step renames these placeholders, so only create them on the very first run.
  if ((await prisma.zxParty.count({ where: { org_id: org.id } })) === 0) {
    for (const name of ROSTER_ONLY) {
      if (!(await prisma.zxPerson.findFirst({ where: { org_id: org.id, name } }))) {
        await prisma.zxPerson.create({ data: { org_id: org.id, name, access_role: 'none' } });
      }
    }
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

  if (process.env.ZEPHYR_NO_DEMO !== '1') {
    const demo = require('./demo');
    const admin = await prisma.user.findUnique({ where: { email: 'admin@zephyrinfra.in' } });
    await demo.seedDemo(org, admin.id);
    await demo.prisma.$disconnect();
  }

  console.log('Zephyr seed done.');
  console.log(`  admin    admin@zephyrinfra.in / ${PASSWORD}`);
  console.log(`  manager  manager@zephyrinfra.in / ${PASSWORD}`);
  console.log(`  staff    staff@zephyrinfra.in / ${PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
