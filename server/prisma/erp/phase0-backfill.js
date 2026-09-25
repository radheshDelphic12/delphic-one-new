/**
 * Multi-company ERP — Phase 0 backfill.
 *
 * Creates the initial OrgGroup + Org("Delphic") + one OrgMembership per
 * existing User, then stamps every tenant-scoped row with that Org's id.
 * Idempotent — safe to re-run (upserts the group/org, skips users/rows that
 * already have a membership / org_id).
 *
 * Non-destructive: only creates rows and fills a nullable column. Does not
 * touch or require prisma/_guard.js (that guard is for the CSV seed scripts,
 * which DELETE data before reimporting — this script never deletes).
 *
 * Usage (from server/, DATABASE_URL pointed at the target DB):
 *   node prisma/erp/phase0-backfill.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_GROUP_NAME = 'Delphic Group';
const ORG_NAME = 'Delphic Global';
const ORG_SLUG = 'delphic';

// Every existing model that gained a nullable org_id column in
// 20260915103201_phase0_org_tenancy_scaffold.
const ORG_SCOPED_MODELS = [
  'account',
  'requirement',
  'profile',
  'submission',
  'interviewRound',
  'stageHistory',
  'document',
  'comment',
  'notification',
  'notificationPreference',
  'auditLog',
];

async function ensureOrg() {
  let org = await prisma.org.findUnique({ where: { slug: ORG_SLUG } });
  if (org) {
    console.log('Org "%s" already exists (%s). Reusing.', org.name, org.id);
    return org;
  }

  const orgGroup = await prisma.orgGroup.create({ data: { name: ORG_GROUP_NAME } });
  org = await prisma.org.create({
    data: {
      org_group_id: orgGroup.id,
      name: ORG_NAME,
      slug: ORG_SLUG,
      timezone: 'Asia/Kolkata',
      default_currency: 'INR',
      status: 'active',
    },
  });
  console.log('Created OrgGroup "%s" (%s) and Org "%s" (%s).', orgGroup.name, orgGroup.id, org.name, org.id);
  return org;
}

async function ensureMemberships(org) {
  const users = await prisma.user.findMany({ select: { id: true, role: true, department_id: true, active: true } });
  let created = 0;

  for (const user of users) {
    const existing = await prisma.orgMembership.findUnique({
      where: { person_id_org_id: { person_id: user.id, org_id: org.id } },
    });
    if (existing) continue;

    await prisma.orgMembership.create({
      data: {
        person_id: user.id,
        org_id: org.id,
        role: user.role,
        department_id: user.department_id,
        employment_status: user.active ? 'active' : 'terminated',
      },
    });
    created += 1;
  }

  console.log('OrgMembership: %d created, %d already existed (of %d users).', created, users.length - created, users.length);
}

async function backfillOrgId(org) {
  for (const model of ORG_SCOPED_MODELS) {
    const result = await prisma[model].updateMany({
      where: { org_id: null },
      data: { org_id: org.id },
    });
    console.log('%s: %d rows stamped with org_id.', model, result.count);
  }
}

async function main() {
  const org = await ensureOrg();
  await ensureMemberships(org);
  await backfillOrgId(org);
  console.log('\nPhase 0 backfill complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
