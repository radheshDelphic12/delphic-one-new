const crypto = require('crypto');
const env = require('../../config/env');
const prisma = require('../../config/db');
const saasGate = require('./saasGate');

// SOFT delete and restore of a customer (docs/features/SAAS-LAUNCH-BUILD-PLAN.md, "Delete customers"). Owner decision: NOTHING is ever physically removed.
// A delete only marks things as gone and switches access off; the data stays in the database and a restore puts back exactly what the delete changed.
//
//  - A customer WITHOUT a workspace (only the Delphic One record): the dox_customers row gets deleted_at/deleted_by/deleted_reason and disappears from
//    lists, counts and receivables (its invoices are kept but hidden).
//  - A customer WITH a workspace (saas_customers + its own group): additionally the customer status becomes 'deleted', the group's companies become
//    inactive, and the users who belong ONLY to that group are deactivated (so they cannot sign in or refresh; open sessions stop at once, see saasGate).
//
// Safeguards: only a group super admin of an OWNER group; never an owner group or company; a customer group user who also belongs to another group, or is a
// super admin or platform admin, blocks the delete (listed, never touched); a dry run comes first, then the exact company name typed again plus the dry-run
// token (which goes stale when anything it counted changes); everything in ONE transaction; an audit row and a deletion record are written that survive.

const TOKEN_MINUTES = 10;

// ---- who may -----------------------------------------------------------------------------------------------------------------
async function isOwnerSuperAdmin(userId) {
  if (!userId) return false;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { is_group_superadmin: true, active: true } });
  if (!u || !u.active || !u.is_group_superadmin) return false;
  return (await prisma.orgGroupMembership.count({ where: { user_id: userId, org_group: { kind: 'owner' } } })) > 0;
}

// ---- finding the target ------------------------------------------------------------------------------------------------------
async function resolve({ doxCustomerId, saasCustomerId, doxOrgId }) {
  let sc = null;
  let dox = null;
  if (saasCustomerId) {
    sc = await prisma.saasCustomer.findUnique({ where: { id: saasCustomerId } });
    if (!sc) return { error: 'customer_not_found' };
    if (sc.dox_customer_id) dox = await prisma.doxCustomer.findUnique({ where: { id: sc.dox_customer_id } });
  } else {
    dox = await prisma.doxCustomer.findFirst({ where: { id: doxCustomerId, ...(doxOrgId ? { org_id: doxOrgId } : {}) } }); // deleted ones too (restore)
    if (!dox) return { error: 'customer_not_found' };
    sc = await prisma.saasCustomer.findUnique({ where: { dox_customer_id: dox.id } });
  }
  return { dox, sc, name: (dox?.name || sc?.name || '').trim() };
}

const sha = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const tokenFor = (action, key, planHash, exp) => `${exp}.${crypto.createHmac('sha256', env.jwt.accessSecret).update(`${action}|${key}|${exp}|${planHash}`).digest('hex')}`;
function tokenOk(token, action, key, planHash) {
  const [exp, mac] = String(token || '').split('.');
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  const want = tokenFor(action, key, planHash, exp).split('.')[1];
  return want.length === mac.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac));
}

// Rows of the customer's companies that will be hidden (counted, never changed), per table.
async function orgRowCounts(orgIds) {
  if (!orgIds.length) return {};
  const tables = await prisma.$queryRawUnsafe("SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'org_id' AND table_name NOT LIKE 'saas\\_%' ORDER BY table_name");
  const sql = tables.map((t) => `SELECT '${t.table_name}' AS t, count(*)::int AS n FROM "${t.table_name}" WHERE org_id::text = ANY($1::text[])`).join(' UNION ALL ');
  const rows = await prisma.$queryRawUnsafe(sql, orgIds);
  return Object.fromEntries(rows.filter((r) => r.n > 0).map((r) => [r.t, r.n]));
}

// ---- the plan (what a delete or restore would touch) ---------------------------------------------------------------------------
async function plan(action, target) {
  const { dox, sc } = target;
  const out = { action, name: target.name, workspace: Boolean(sc), will: [], users: [], counts: {} };

  if (action === 'delete') {
    if ((sc && sc.status === 'deleted') || (!sc && dox?.deleted_at)) return { error: 'already_deleted' };
  } else {
    const hasRecord = await prisma.saasCustomerDeletion.findFirst({ where: { restored_at: null, OR: [...(dox ? [{ dox_customer_id: dox.id }] : []), ...(sc ? [{ saas_customer_id: sc.id }] : [])] }, orderBy: { deleted_at: 'desc' } });
    const isDeleted = (sc && sc.status === 'deleted') || (dox && dox.deleted_at);
    if (!isDeleted) return { error: 'not_deleted' };
    out.record = hasRecord;
  }

  // dox side: records that are hidden (kept)
  if (dox) {
    const invoices = await prisma.doxInvoice.findMany({ where: { customer_id: dox.id }, select: { id: true } });
    const ids = invoices.map((i) => i.id);
    out.counts.dox_invoices = ids.length;
    out.counts.dox_invoice_payments = ids.length ? await prisma.doxInvoicePayment.count({ where: { invoice_id: { in: ids }, deleted_at: null } }) : 0;
    out.counts.invoice_followups = ids.length ? await prisma.invoiceFollowup.count({ where: { invoice_kind: 'dox_invoice', invoice_id: { in: ids } } }) : 0;
    out.counts.linked_leads = await prisma.doxLead.count({ where: { customer_id: dox.id } });
    out.will.push(action === 'delete' ? 'The customer and its invoices are hidden from Delphic One lists, totals and collection follow-ups (kept in the database).' : 'The customer and its invoices show again in Delphic One.');
  }

  if (sc) {
    const group = await prisma.orgGroup.findUnique({ where: { id: sc.org_group_id } });
    if (!group || group.kind === 'owner') return { error: 'owner_group' };
    const orgs = await prisma.org.findMany({ where: { org_group_id: group.id }, select: { id: true, name: true, status: true } });
    if (!orgs.length) return { error: 'no_company' };
    // never an owner group or company, whatever the customer row says
    out.group = { id: group.id, kind: group.kind };
    out.orgs = orgs;
    const orgIds = orgs.map((o) => o.id);
    if (orgs.some((o) => o.id === dox?.org_id)) return { error: 'owner_group' };

    // users of the customer group: the ones who belong ONLY here are affected; anyone shared blocks the delete
    const members = await prisma.orgMembership.findMany({ where: { org_id: { in: orgIds } }, select: { person_id: true, person: { select: { id: true, name: true, email: true, active: true, is_superadmin: true, is_group_superadmin: true } } } });
    const people = [...new Map(members.map((m) => [m.person_id, m.person])).values()];
    const blocked = [];
    for (const p of people) {
      const reasons = [];
      if (await prisma.orgMembership.count({ where: { person_id: p.id, org_id: { notIn: orgIds } } })) reasons.push('also belongs to another company');
      if (p.is_group_superadmin) reasons.push('is a group super admin');
      if (p.is_superadmin) reasons.push('is a super admin');
      if (await prisma.platformAdmin.count({ where: { user_id: p.id } })) reasons.push('is a platform admin');
      if (await prisma.orgGroupMembership.count({ where: { user_id: p.id, org_group_id: { not: group.id } } })) reasons.push('belongs to another group');
      if (reasons.length) blocked.push({ id: p.id, name: p.name, email: p.email, reasons });
    }
    if (action === 'delete' && blocked.length) return { error: 'shared_users', users: blocked };
    out.users = people.filter((p) => !blocked.some((b) => b.id === p.id)).map((p) => ({ id: p.id, name: p.name, email: p.email, active: p.active }));
    out.counts.users = out.users.length;
    out.counts.companies = orgs.length;
    out.counts.slots = await prisma.saasSlot.count({ where: { customer_id: sc.id } });
    out.counts.orders = await prisma.saasOrder.count({ where: { customer_id: sc.id } });
    out.counts.company_rows = await orgRowCounts(orgIds);
    out.will.push(action === 'delete'
      ? 'The workspace is switched off: its companies become inactive and its users are deactivated (they cannot sign in; open sessions stop). All its data stays in the database, hidden from our reports and from other customers.'
      : 'The workspace is switched back on: exactly the companies and users that the delete changed are reactivated.');
  }
  out.hash = sha({ action, name: out.name, counts: out.counts, users: out.users.map((u) => `${u.id}:${u.active}`).sort(), orgs: (out.orgs || []).map((o) => `${o.id}:${o.status}`).sort(), rec: out.record?.id || null });
  out.key = `${dox?.id || ''}|${sc?.id || ''}`;
  return out;
}

async function preview(action, input, actorId) {
  if (!(await isOwnerSuperAdmin(actorId))) return { error: 'not_allowed' };
  const target = await resolve(input);
  if (target.error) return target;
  const p = await plan(action, target);
  if (p.error) return p;
  const exp = Date.now() + TOKEN_MINUTES * 60000;
  return {
    name: p.name, workspace: p.workspace, will: p.will, counts: p.counts, users: p.users, companies: (p.orgs || []).map((o) => ({ id: o.id, name: o.name, status: o.status })),
    confirm_with: p.name, token: tokenFor(action, p.key, p.hash, exp), token_minutes: TOKEN_MINUTES, kept: true,
  };
}

async function execute(action, input, actorId, { confirm_name: confirmName, token, reason }) {
  if (!(await isOwnerSuperAdmin(actorId))) return { error: 'not_allowed' };
  const target = await resolve(input);
  if (target.error) return target;
  const p = await plan(action, target);
  if (p.error) return p;
  if (String(confirmName || '').trim() !== p.name) return { error: 'wrong_confirmation' };
  if (!tokenOk(token, action, p.key, p.hash)) return { error: 'stale_token' };
  const { dox, sc } = target;
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    let changes;
    if (action === 'delete') {
      changes = { dox: null, saas: null, orgs: [], users: [] };
      if (dox && !dox.deleted_at) {
        await tx.doxCustomer.update({ where: { id: dox.id }, data: { deleted_at: now, deleted_by: actorId, deleted_reason: reason || null } });
        changes.dox = { id: dox.id };
      }
      if (sc) {
        await tx.saasCustomer.update({ where: { id: sc.id }, data: { status: 'deleted', deleted_at: now, deleted_by: actorId, deleted_reason: reason || null } });
        changes.saas = { id: sc.id, status_before: sc.status };
        for (const o of p.orgs.filter((x) => x.status !== 'inactive')) {
          await tx.org.update({ where: { id: o.id }, data: { status: 'inactive' } });
          changes.orgs.push({ id: o.id, status_before: o.status });
        }
        const toOff = p.users.filter((u) => u.active).map((u) => u.id);
        if (toOff.length) await tx.user.updateMany({ where: { id: { in: toOff } }, data: { active: false } });
        changes.users = toOff;
      }
      await tx.saasCustomerDeletion.create({ data: { name: p.name, dox_customer_id: dox?.id || null, saas_customer_id: sc?.id || null, deleted_by: actorId, reason: reason || null, counts: p.counts, changes } });
    } else {
      const was = p.record?.changes || {};
      if (dox && dox.deleted_at && (!p.record || was.dox)) await tx.doxCustomer.update({ where: { id: dox.id }, data: { deleted_at: null, deleted_by: null, deleted_reason: null } });
      if (sc && sc.status === 'deleted') {
        await tx.saasCustomer.update({ where: { id: sc.id }, data: { status: was.saas?.status_before || 'suspended', deleted_at: null, deleted_by: null, deleted_reason: null } });
      }
      for (const o of was.orgs || []) await tx.org.update({ where: { id: o.id }, data: { status: o.status_before } });
      if ((was.users || []).length) await tx.user.updateMany({ where: { id: { in: was.users } }, data: { active: true } });
      if (p.record) await tx.saasCustomerDeletion.update({ where: { id: p.record.id }, data: { restored_at: now, restored_by: actorId } });
      changes = was;
    }
    await tx.saasAudit.create({
      data: {
        actor_id: actorId, action: action === 'delete' ? 'customer_deleted' : 'customer_restored', entity: 'customer', entity_id: p.name,
        before: action === 'delete' ? { status: sc?.status || dox?.status || null } : { status: 'deleted' },
        after: { counts: p.counts, reason: reason || null, users: (changes.users || []).length, companies: (changes.orgs || []).length, soft: true },
      },
    });
    return { ok: true };
  }, { timeout: 60000 });

  saasGate.clearCache(); // the open-session block and the module table must see the change at once
  return result;
}

module.exports = { isOwnerSuperAdmin, preview, execute, resolve };
