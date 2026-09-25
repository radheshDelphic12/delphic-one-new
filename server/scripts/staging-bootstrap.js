/**
 * Staging boot step: apply migrations, then (optionally) seed demo data.
 * Run by Dockerfile.render before the API starts; also runnable by hand:
 *
 *   cd server && DATABASE_URL=<neon direct url> SEED_STAGING=true node scripts/staging-bootstrap.js
 *
 * 1. `prisma migrate deploy` always runs. A failure exits non-zero, so the API
 *    never starts against a half-migrated schema.
 * 2. Seeding only runs when SEED_STAGING=true, and never fails the boot:
 *    - The destructive CSV seed (prisma/seed.js) runs ONLY when the users table
 *      is empty (a brand-new database), so redeploys never wipe data.
 *    - Everything after it is idempotent and non-destructive: Phase 0 backfill
 *      (Delphic org + memberships), locations/calendars, multi-org demo
 *      (Acconcy Finance + group admin), verticals demo (Gulati, Zephyr data).
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const serverDir = path.resolve(__dirname, '..');

function run(label, command, args, extraEnv = {}) {
  console.log(`\n[bootstrap] ${label}`);
  const result = spawnSync(command, args, {
    cwd: serverDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });
  return result.status === 0;
}

async function isEmptyDatabase() {
  const prisma = new PrismaClient();
  try {
    return (await prisma.user.count()) === 0;
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  if (!run('applying migrations (prisma migrate deploy)', 'npx', ['prisma', 'migrate', 'deploy'])) {
    console.error('[bootstrap] migrations failed - not starting the API');
    process.exit(1);
  }

  if (process.env.SEED_STAGING !== 'true') {
    console.log('[bootstrap] SEED_STAGING is not "true" - skipping seed');
    return;
  }

  try {
    if (await isEmptyDatabase()) {
      // Safe: nothing to delete on an empty DB. The guard is bypassed only for this case.
      if (!run('empty database - importing base team data', 'node', ['prisma/seed.js'], { ALLOW_DESTRUCTIVE_SEED: '1' })) {
        throw new Error('base seed failed');
      }
    } else {
      console.log('[bootstrap] users already exist - skipping the base (destructive) seed');
    }

    const steps = [
      ['Phase 0 backfill (Delphic org + memberships)', 'prisma/erp/phase0-backfill.js'],
      ['locations and calendars', 'prisma/erp/seed-locations-calendars.js'],
      ['multi-org demo (Acconcy Finance + group admin)', 'prisma/erp/seed-multi-org-demo.js'],
      ['verticals demo (Gulati, Zephyr, Acconcy data)', 'prisma/erp/seed-verticals-demo.js'],
    ];
    for (const [label, script] of steps) {
      if (!run(label, 'node', [script])) throw new Error(`${script} failed`);
    }
    console.log('\n[bootstrap] seed complete');
  } catch (err) {
    // A seed problem must not take the staging API down; the log explains what to re-run.
    console.error(`[bootstrap] seeding stopped: ${err.message}. The API will still start.`);
  }
}

main().catch((err) => {
  console.error('[bootstrap] unexpected error', err);
  process.exit(1);
});
