/**
 * One-off fix: move a single requirement OUT of the terminal `dropped` state back
 * to `open`, clear the lock, and record it in stage_history.
 *
 * `dropped` and `closed` have no outbound transitions in stageMachines.js, so the
 * normal `POST /requirements/:id/status` route rejects this. This script writes the
 * change directly. Prefer the superadmin override endpoint once it ships; this is
 * for the one requirement already stuck.
 *
 * Dry-run by default — prints what it would do. Pass --commit to apply.
 *
 * Usage:
 *   node server/scripts/reopen-dropped-requirement.js --title "Gen AI Architect" --account Girnar
 *   node server/scripts/reopen-dropped-requirement.js --id <uuid> --by admin@delphic.in --commit
 *   node server/scripts/reopen-dropped-requirement.js --id <uuid> --to in_progress --commit
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

async function resolveRequirement() {
  const id = arg('id');
  if (id) {
    return prisma.requirement.findUnique({ where: { id }, include: { account: true } });
  }
  const title = arg('title');
  const account = arg('account');
  if (!title) throw new Error('Pass --id <uuid> or --title "<title>" [--account <name fragment>]');
  const matches = await prisma.requirement.findMany({
    where: {
      title,
      ...(account ? { account: { name: { contains: account, mode: 'insensitive' } } } : {}),
    },
    include: { account: true },
  });
  if (matches.length === 0) throw new Error(`No requirement titled "${title}"${account ? ` under account ~"${account}"` : ''}`);
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous — ${matches.length} requirements match. Re-run with --id <uuid>:\n` +
        matches.map((m) => `  ${m.id}  ${m.title}  (${m.account?.name}, ${m.status})`).join('\n')
    );
  }
  return matches[0];
}

async function resolveActorId() {
  const by = arg('by');
  if (by && by !== true) {
    const u = await prisma.user.findFirst({ where: { email: by } });
    if (!u) throw new Error(`No user with email ${by}`);
    return u.id;
  }
  const su = await prisma.user.findFirst({ where: { is_superadmin: true, active: true }, orderBy: { created_at: 'asc' } });
  if (su) return su.id;
  const admin = await prisma.user.findFirst({ where: { role: 'admin', active: true }, orderBy: { created_at: 'asc' } });
  if (!admin) throw new Error('No superadmin/admin user found — pass --by <email>');
  return admin.id;
}

async function main() {
  const commit = Boolean(arg('commit', false));
  const toStatus = arg('to', 'open');
  if (!['open', 'in_progress', 'on_hold'].includes(toStatus)) {
    throw new Error(`--to must be one of open | in_progress | on_hold (got "${toStatus}")`);
  }

  const req = await resolveRequirement();
  if (!req) throw new Error('Requirement not found');

  console.log('\nRequirement:');
  console.table([
    {
      id: req.id,
      title: req.title,
      account: req.account?.name ?? null,
      status: req.status,
      is_locked: req.is_locked,
      closed_at: req.closed_at ? req.closed_at.toISOString() : null,
    },
  ]);

  if (req.status !== 'dropped' && req.status !== 'closed') {
    console.log(`\nStatus is already "${req.status}" — nothing to do.`);
    return;
  }

  const actorId = await resolveActorId();
  const plan = {
    'status': `${req.status} -> ${toStatus}`,
    'is_locked': `${req.is_locked} -> false`,
    'closed_at': `${req.closed_at ? req.closed_at.toISOString() : null} -> null`,
    'stage_history': `insert { from_stage: "${req.status}", to_stage: "${toStatus}", changed_by: ${actorId}, reason: "[manual] reopened via reopen-dropped-requirement.js" }`,
  };
  console.log('\nPlanned change:');
  console.table(plan);

  if (!commit) {
    console.log('\nDry run — pass --commit to apply.\n');
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.requirement.update({
      where: { id: req.id },
      data: { status: toStatus, is_locked: false, closed_at: null },
    });
    await tx.stageHistory.create({
      data: {
        entity_type: 'requirement',
        entity_id: req.id,
        from_stage: req.status,
        to_stage: toStatus,
        changed_by: actorId,
        reason: '[manual] reopened via reopen-dropped-requirement.js',
      },
    });
  });

  console.log(`\nDone — requirement ${req.id} is now "${toStatus}" and unlocked.\n`);
}

main()
  .catch((e) => {
    console.error('\n' + e.message + '\n');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
