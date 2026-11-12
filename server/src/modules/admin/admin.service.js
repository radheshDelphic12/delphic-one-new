const bcrypt = require('bcryptjs');
const prisma = require('../../config/db');

const ENTITY_MODELS = {
  account: 'account',
  requirement: 'requirement',
  seat: 'requirementSeat',
  submission: 'submission',
};

async function unlock(entityType, entityId, reason, user) {
  const model = ENTITY_MODELS[entityType];
  if (!model) return { error: 'invalid_entity_type' };
  // BDA owns the account flow (like admin for accounts) but not requirement/submission unlock.
  if (user.role === 'bda' && entityType !== 'account') return { error: 'forbidden' };

  return prisma.$transaction(async (tx) => {
    const row = await tx[model].findUnique({ where: { id: entityId } });
    if (!row) return { error: 'not_found' };
    if (!row.is_locked) return { error: 'not_locked' };

    await tx[model].update({ where: { id: entityId }, data: { is_locked: false } });
    await tx.stageHistory.create({
      data: {
        entity_type: entityType,
        entity_id: entityId,
        from_stage: null,
        to_stage: 'unlocked',
        changed_by: user.id,
        reason,
      },
    });

    return {
      unlock: {
        entity_type: entityType,
        entity_id: entityId,
        unlocked_by: { id: user.id, name: user.name },
        reason,
      },
    };
  });
}

// --- Superadmin soft-delete -------------------------------------------------

// entity_type -> Prisma client model accessor
const SOFT_DELETE_MODELS = {
  account: 'account',
  requirement: 'requirement',
  submission: 'submission',
  profile: 'profile',
  interview_round: 'interviewRound',
  job_applicant: 'jobApplicant',
  // Phase 3: projects are accounts rows (is_project), employees are org memberships
  project: 'account',
  employee: 'orgMembership',
  expense_claim: 'expenseClaim',
  invoice: 'clientInvoice',
};

// Live-dependent counts, shown to the deleter as a heads-up (does not block —
// soft-delete is reversible via restore).
async function dependencyCounts(entityType, id) {
  switch (entityType) {
    case 'account':
      return {
        requirements: await prisma.requirement.count({ where: { account_id: id } }),
        vendor_profiles: await prisma.profile.count({ where: { vendor_account_id: id } }),
      };
    case 'requirement':
      return {
        seats: await prisma.requirementSeat.count({ where: { requirement_id: id } }),
        submissions: await prisma.submission.count({ where: { seat: { requirement_id: id } } }),
      };
    case 'submission':
      return { interview_rounds: await prisma.interviewRound.count({ where: { submission_id: id } }) };
    case 'profile':
      return { submissions: await prisma.submission.count({ where: { profile_id: id } }) };
    case 'project':
      return {
        allocations: await prisma.projectMemberAssignment.count({ where: { account_id: id } }),
        vendor_invoices: await prisma.projectVendorInvoice.count({ where: { account_id: id } }),
        timesheet_entries: await prisma.timesheetEntry.count({ where: { account_id: id } }),
        invoices: await prisma.clientInvoice.count({ where: { client_account_id: id } }),
      };
    case 'employee':
      return {
        allocations: await prisma.projectMemberAssignment.count({ where: { org_membership_id: id } }),
        attendance_records: await prisma.attendanceRecord.count({ where: { org_membership_id: id } }),
        payslips: await prisma.payslip.count({ where: { org_membership_id: id } }),
      };
    default:
      return {};
  }
}

// Records a locked month or a finalised payment depends on cannot be deleted at all: reopen them first.
async function lockedBlock(entityType, live) {
  if (entityType === 'employee') {
    if (await prisma.timesheetMonthLock.count({ where: { org_membership_id: live.id } })) return 'locked_attendance';
    if (await prisma.payslip.count({ where: { org_membership_id: live.id, payroll_run: { status: 'processed' } } })) return 'locked_payroll';
  }
  if (entityType === 'invoice' && live.status === 'paid') return 'locked_invoice_paid';
  if (entityType === 'expense_claim' && live.status === 'reimbursed') return 'locked_claim_reimbursed';
  return null;
}

/**
 * The soft delete itself (no password): used by the superadmin endpoint below and by screens that delete their own kind of
 * record. `orgId` keeps a company admin inside their own company. An invoice number is released so it can be reused; restoring
 * puts it back unless someone took it meanwhile.
 */
async function softDeleteRecord(entityType, entityId, reason, user, { orgId = null } = {}) {
  const model = SOFT_DELETE_MODELS[entityType];
  if (!model) return { error: 'invalid_entity_type' };

  // `deleted_at` in the where bypasses the global soft-delete filter.
  const live = await prisma[model].findFirst({ where: { id: entityId, deleted_at: null, ...(orgId ? { org_id: orgId } : {}) } });
  if (!live) {
    const gone = await prisma[model].findFirst({ where: { id: entityId, deleted_at: { not: null }, ...(orgId ? { org_id: orgId } : {}) } });
    return { error: gone ? 'already_deleted' : 'not_found' };
  }

  // A project is an accounts row but not a catalogue account: it is deleted as a "project", never as an account.
  if (entityType === 'account' && live.is_project) return { error: 'is_project' };
  if (entityType === 'project' && !live.is_project) return { error: 'not_a_project' };

  const locked = await lockedBlock(entityType, live);
  if (locked) return { error: locked };

  const dependency = await dependencyCounts(entityType, entityId);
  const data = { deleted_at: new Date(), deleted_by: user.id, delete_reason: reason };
  if (entityType === 'invoice' && live.invoice_number) data.invoice_number = `${live.invoice_number}~deleted~${String(entityId).slice(0, 8)}`;

  await prisma.$transaction(async (tx) => {
    await tx[model].update({ where: { id: entityId }, data });
    await tx.auditLog.create({
      data: {
        actor_id: user.id,
        action: 'soft_delete',
        entity_type: entityType,
        entity_id: entityId,
        reason,
        snapshot: JSON.parse(JSON.stringify(live)),
      },
    });
  });

  return {
    result: {
      entity_type: entityType,
      entity_id: entityId,
      deleted_by: { id: user.id, name: user.name },
      reason,
      dependency,
    },
  };
}

async function softDelete(entityType, entityId, password, reason, user) {
  const model = SOFT_DELETE_MODELS[entityType];
  if (!model) return { error: 'invalid_entity_type' };

  const account = await prisma.user.findUnique({ where: { id: user.id } });
  if (!account) return { error: 'not_found' };
  const passwordOk = await bcrypt.compare(password, account.password_hash);
  if (!passwordOk) return { error: 'bad_password' };

  return softDeleteRecord(entityType, entityId, reason, user);
}

async function restore(entityType, entityId, reason, user) {
  const model = SOFT_DELETE_MODELS[entityType];
  if (!model) return { error: 'invalid_entity_type' };

  const gone = await prisma[model].findFirst({ where: { id: entityId, deleted_at: { not: null } } });
  if (!gone) {
    const live = await prisma[model].findFirst({ where: { id: entityId } });
    return { error: live ? 'not_deleted' : 'not_found' };
  }
  if (entityType === 'project' && !gone.is_project) return { error: 'not_a_project' };
  if (entityType === 'account' && gone.is_project) return { error: 'is_project' };

  try {
  await prisma.$transaction(async (tx) => {
    // an applicant gets its one-application-per-email key back; if the same person applied again meanwhile it cannot be restored
    const keyFix = model === 'jobApplicant' && gone.email ? { dedupe_key: String(gone.email).trim().toLowerCase() } : {};
    // an invoice gets its number back (it was released on delete); if someone took it meanwhile the restore is refused
    if (entityType === 'invoice' && gone.invoice_number && gone.invoice_number.includes('~deleted~')) {
      const original = gone.invoice_number.split('~deleted~')[0];
      if (await tx.clientInvoice.findFirst({ where: { org_id: gone.org_id, invoice_number: original } })) throw Object.assign(new Error('invoice_number_taken'), { code: 'invoice_number_taken' });
      keyFix.invoice_number = original;
    }
    await tx[model].update({
      where: { id: entityId },
      data: { deleted_at: null, deleted_by: null, delete_reason: null, ...keyFix },
    });
    await tx.auditLog.create({
      data: {
        actor_id: user.id,
        action: 'restore',
        entity_type: entityType,
        entity_id: entityId,
        reason,
        snapshot: JSON.parse(JSON.stringify(gone)),
      },
    });
  });

  } catch (err) {
    if (err?.code === 'invoice_number_taken' || err?.code === 'P2002') return { error: err.code === 'P2002' ? 'duplicate_on_restore' : 'invoice_number_taken' };
    throw err;
  }

  return { result: { entity_type: entityType, entity_id: entityId, restored_by: { id: user.id, name: user.name }, reason } };
}

async function namesByIds(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return Object.fromEntries(users.map((u) => [u.id, u.name]));
}

async function listDeleted(entityType) {
  const types = entityType ? [entityType] : Object.keys(SOFT_DELETE_MODELS);
  const out = [];
  for (const t of types) {
    const model = SOFT_DELETE_MODELS[t];
    const rows = await prisma[model].findMany({
      where: { deleted_at: { not: null } },
      orderBy: { deleted_at: 'desc' },
      take: 200,
    });
    for (const r of rows) {
      out.push({
        entity_type: t,
        entity_id: r.id,
        name: r.name || r.title || null,
        org_id: r.org_id || null,
        deleted_at: r.deleted_at,
        deleted_by: r.deleted_by,
        delete_reason: r.delete_reason,
      });
    }
  }
  const names = await namesByIds(out.map((r) => r.deleted_by));
  out.forEach((r) => {
    r.deleted_by_name = names[r.deleted_by] || null;
  });
  out.sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));
  return out;
}

// Full delete + restore trail (both actions), newest first.
async function listAudit({ entityType, limit = 100 } = {}) {
  const rows = await prisma.auditLog.findMany({
    where: entityType ? { entity_type: entityType } : {},
    orderBy: { created_at: 'desc' },
    take: Math.min(limit, 500),
  });
  const names = await namesByIds(rows.map((r) => r.actor_id));
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    name: r.snapshot?.name || r.snapshot?.title || null,
    reason: r.reason,
    actor_id: r.actor_id,
    actor_name: names[r.actor_id] || null,
    created_at: r.created_at,
  }));
}

module.exports = {
  unlock,
  ENTITY_MODELS,
  SOFT_DELETE_MODELS,
  softDelete,
  softDeleteRecord,
  restore,
  listDeleted,
  listAudit,
  dependencyCounts,
};
