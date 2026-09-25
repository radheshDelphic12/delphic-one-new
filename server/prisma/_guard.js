/**
 * Destructive-script guard.
 *
 * The CSV seed scripts (`seed.js`, `seed-accounts.js`, `seed-jira.js`,
 * `seed-vendors.js`) delete rows before re-importing. They are for local dev / CI
 * ONLY. Production is bootstrapped with the non-destructive `seed-admin.js`.
 *
 * This guard refuses to run when the target database looks like production —
 * `NODE_ENV=production`, or a `DATABASE_URL` host that is not obviously local —
 * unless the operator explicitly sets `ALLOW_DESTRUCTIVE_SEED=1` (which they
 * should only do with a fresh, verified backup in hand).
 */

const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'db', // docker-compose service name
  'postgres',
  'host.docker.internal',
]);

function dbHost() {
  try {
    return new URL(process.env.DATABASE_URL || '').hostname || '';
  } catch {
    return '';
  }
}

function assertNonProdDestructive(scriptName) {
  if (process.env.ALLOW_DESTRUCTIVE_SEED === '1') {
    console.warn(
      `[guard] ALLOW_DESTRUCTIVE_SEED=1 — ${scriptName} will DELETE rows in "${dbHost() || 'the configured database'}".`
    );
    return;
  }

  const host = dbHost();
  const reasons = [];
  if (process.env.NODE_ENV === 'production') reasons.push('NODE_ENV=production');
  if (host && !LOCAL_HOSTS.has(host)) reasons.push(`DATABASE_URL host "${host}" is not local`);

  if (reasons.length) {
    console.error(
      [
        '',
        `[guard] Refusing to run ${scriptName}: it deletes rows and ${reasons.join(' and ')}.`,
        '        This script is for local dev / CI only. Production data is never wiped by a seed —',
        '        use prisma/seed-admin.js (non-destructive) to bootstrap a prod admin.',
        '        If you truly intend to wipe this database and have a fresh verified backup,',
        '        re-run with ALLOW_DESTRUCTIVE_SEED=1.',
        '',
      ].join('\n')
    );
    process.exit(1);
  }
}

module.exports = { assertNonProdDestructive, dbHost };
