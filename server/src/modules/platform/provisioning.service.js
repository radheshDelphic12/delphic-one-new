const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../../config/db');
const { nextEmployeeCode, withEmployeeCodeRetry } = require('../../lib/employeeCode');
const platform = require('./platform.service');
const credits = require('./credits.service');
const switches = require('./switches.service');

// Creating a customer workspace from a Delphic One customer (docs/features/SAAS-LAUNCH-BUILD-PLAN.md, phase 1.5; SaaS plan sections 21 and 22).
//
// Off unless the "Customer workspaces" switch is on (platform screen; env SAAS_CUSTOMER_PROVISIONING is only the initial fallback). A customer gets a NEW group (kind 'trial') with one clean company in it: never a company inside our own
// group, never any data copied from our companies. The company is created exactly like "add a company" does (an empty company and its first admin).
// Trial length and number of users come from the platform settings (15 days and 2 users by default).

const enabled = () => switches.isOn('provisioning');
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'customer';

// A readable one-time password for the customer's first admin (shown once to our team, who pass it on; the customer should change it).
const tempPassword = () => `${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(4).toString('hex')}`;

async function provision({ doxCustomerId, doxOrgId, actorId }) {
  if (!(await enabled())) return { error: 'disabled' };
  const dox = await prisma.doxCustomer.findFirst({ where: { id: doxCustomerId, org_id: doxOrgId, deleted_at: null } });
  if (!dox) return { error: 'customer_not_found' };
  if (!dox.contact_email) return { error: 'no_email' };
  if (await prisma.saasCustomer.findUnique({ where: { dox_customer_id: dox.id } })) return { error: 'already_provisioned' };
  const email = dox.contact_email.trim().toLowerCase();
  // A person already in the system (ours or another customer's) is not attached automatically: one person in two groups needs the checks of plan section 21 first.
  const holder = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, active: true } });
  if (holder) {
    // a login that belongs to a deleted customer is kept reserved, never freed silently: restore that customer instead
    const orgIds = (await prisma.orgMembership.findMany({ where: { person_id: holder.id }, select: { org_id: true } })).map((m) => m.org_id);
    const gone = orgIds.length ? await prisma.saasCustomer.count({ where: { status: 'deleted', org_id: { in: orgIds } } }) : 0;
    return { error: gone ? 'email_reserved_deleted' : 'email_in_use' };
  }

  const trialDays = await platform.settingNumber('trial_days', 15);
  const trialUsers = await platform.settingNumber('trial_users', 2);
  const today = credits.dayStr();
  const endsOn = credits.addDays(today, trialDays);
  const password = tempPassword();
  const password_hash = await bcrypt.hash(password, 10);
  const slug = `${slugify(dox.name)}-${crypto.randomBytes(2).toString('hex')}`;

  const made = await withEmployeeCodeRetry(() => prisma.$transaction(async (tx) => {
    const group = await tx.orgGroup.create({ data: { name: dox.name, kind: 'trial' } });
    const org = await tx.org.create({ data: { org_group_id: group.id, name: dox.name, slug, timezone: 'Asia/Kolkata', default_currency: 'INR', is_master_workspace: false } });
    const user = await tx.user.create({ data: { name: dox.contact_name || dox.name, email, password_hash, role: 'admin', phone: dox.contact_phone || null } });
    await tx.orgMembership.create({ data: { person_id: user.id, org_id: org.id, role: 'admin', employee_code: await nextEmployeeCode(tx, org.id) } });
    const customer = await tx.saasCustomer.create({
      data: { dox_customer_id: dox.id, org_group_id: group.id, org_id: org.id, name: dox.name, status: 'trial', plan_name: dox.plan_name, trial_starts_on: credits.toDate(today), trial_ends_on: credits.toDate(endsOn), max_users: trialUsers, created_by: actorId },
    });
    await tx.saasSlot.create({ data: { customer_id: customer.id, email, user_id: user.id, is_admin: true, label: 'Admin' } });
    await tx.doxCustomer.update({ where: { id: dox.id }, data: { status: 'trial', trial_ends_on: credits.toDate(endsOn), started_on: dox.started_on || credits.toDate(today), users_count: trialUsers } });
    return { group, org, user, customer };
  }));
  require('../../config/tenantGuard').clearCache(); // the new company is a customer from this moment: the tenant read guard must know at once
  return { customer_id: made.customer.id, org_id: made.org.id, org_group_id: made.group.id, admin_email: email, temp_password: password, trial_ends_on: endsOn, max_users: trialUsers };
}

module.exports = { provision, enabled };
