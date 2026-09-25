/**
 * IT itemized timesheet — demo data.
 *
 * Creates the "IT" department, the two real IT staff (Deepanshu Chauhan,
 * Radhesh Shrivastava) tagged into it, and the five named internal/client
 * projects as Accounts so they show up in the timesheet's project picker.
 * Idempotent and non-destructive. Run after erp:phase0:backfill.
 *
 * Usage (from server/, DATABASE_URL pointed at the target DB):
 *   node prisma/erp/seed-it-timesheets-demo.js
 */
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { DEFAULT_SEED_PASSWORD } = require('../team-roster');

const prisma = new PrismaClient();

const PROJECT_NAMES = ['Delphic Global', 'Tax Portal', 'TakeZone Project', 'Gaming Project', 'TankPros'];

async function ensureDepartment(orgId, name) {
  const existing = await prisma.department.findFirst({ where: { org_id: orgId, name } });
  if (existing) return existing;
  const created = await prisma.department.create({ data: { org_id: orgId, name } });
  console.log(`  + department "${name}"`);
  return created;
}

async function ensureDesignation(orgId, name) {
  const existing = await prisma.designation.findFirst({ where: { org_id: orgId, name } });
  if (existing) return existing;
  const created = await prisma.designation.create({ data: { org_id: orgId, name } });
  console.log(`  + designation "${name}"`);
  return created;
}

async function ensureItUser(orgId, itDept, designation, location, { name, email, joinedAt }) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { name, email, password_hash: await bcrypt.hash(DEFAULT_SEED_PASSWORD, 10), role: 'employee', active: true, department_id: itDept.id },
    });
    console.log(`  + user ${email}`);
  } else {
    const patch = {};
    if (user.department_id !== itDept.id) patch.department_id = itDept.id;
    // Low-privilege self-service role, not full admin — see requireItDepartment's
    // admin bypass, which is for oversight by OTHER leads, not for IT staff themselves.
    if (user.role === 'admin') patch.role = 'employee';
    if (Object.keys(patch).length > 0) {
      user = await prisma.user.update({ where: { id: user.id }, data: patch });
      console.log(`  ~ updated ${email} (${Object.keys(patch).join(', ')})`);
    }
  }

  const membership = await prisma.orgMembership.findFirst({ where: { person_id: user.id, org_id: orgId } });
  if (!membership) {
    await prisma.orgMembership.create({
      data: {
        person_id: user.id,
        org_id: orgId,
        role: 'employee',
        department_id: itDept.id,
        designation_id: designation.id,
        location_id: location?.id,
        joined_at: joinedAt,
      },
    });
    console.log(`  + membership for ${email}`);
  } else if (membership.role === 'admin') {
    await prisma.orgMembership.update({ where: { id: membership.id }, data: { role: 'employee' } });
    console.log(`  ~ membership role for ${email} -> employee`);
  }
  return user;
}

async function ensureProjectAccount(orgId, ownerId, name) {
  const existing = await prisma.account.findFirst({ where: { org_id: orgId, name, type: 'client' } });
  if (existing) return existing;
  const created = await prisma.account.create({
    data: { org_id: orgId, type: 'client', name, stage: 'active', owner_id: ownerId, origin_owner_id: ownerId },
  });
  console.log(`  + project account "${name}"`);
  return created;
}

async function main() {
  const org = await prisma.org.findUnique({ where: { slug: 'delphic' } });
  if (!org) throw new Error('Org "delphic" not found. Run the phase-0 backfill first.');

  const itDept = await ensureDepartment(org.id, 'IT');
  const designation = await ensureDesignation(org.id, 'Software Analyst');
  const location = await prisma.location.findFirst({ where: { org_id: org.id, name: 'Ahmedabad' } });

  const deepanshu = await ensureItUser(org.id, itDept, designation, location, {
    name: 'Deepanshu Chauhan',
    email: 'deepanshu.chauhan@delphic.in',
    joinedAt: new Date('2026-02-09'),
  });
  await ensureItUser(org.id, itDept, designation, location, {
    name: 'Radhesh Shrivastava',
    email: 'radhesh.shrivastava@delphic.in',
    joinedAt: new Date('2026-02-09'),
  });

  const projects = [];
  for (const name of PROJECT_NAMES) projects.push(await ensureProjectAccount(org.id, deepanshu.id, name));

  // IT staff can only log hours on projects assigned to them (Employee <-> Project).
  for (const email of ['deepanshu.chauhan@delphic.in', 'radhesh.shrivastava@delphic.in']) {
    const person = await prisma.user.findUnique({ where: { email } });
    const membership = await prisma.orgMembership.findFirst({ where: { person_id: person.id, org_id: org.id } });
    for (const project of projects) {
      const existing = await prisma.projectMemberAssignment.findFirst({ where: { account_id: project.id, org_membership_id: membership.id } });
      if (!existing) {
        await prisma.projectMemberAssignment.create({ data: { org_id: org.id, account_id: project.id, org_membership_id: membership.id, created_by: deepanshu.id } });
        console.log(`  + ${email} assigned to "${project.name}"`);
      }
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
