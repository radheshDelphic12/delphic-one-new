/**
 * Dry run for the `auto` attendance source. READ ONLY: prints how many rows the backfill migration
 * (20261021100100_attendance_auto_backfill) will change, and what it will leave alone. Safe on any database.
 * Also counts the "hidden leave" days: an approved full-day leave that still has an automatic present entry.
 *
 * Usage:  node server/scripts/attendance-auto-dryrun.js
 * Run it BEFORE `prisma migrate deploy` (it works both before and after the migration).
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const [{ ok: hasAuto }] = await prisma.$queryRawUnsafe(`SELECT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'AttendanceSource' AND e.enumlabel = 'auto') AS ok`);
  const [row] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*) FILTER (WHERE source::text = 'manual' AND regularized_reason = 'auto_daily' AND regularized_by IS NULL AND check_in_at IS NULL AND check_out_at IS NULL) AS will_become_auto,
      COUNT(*) FILTER (WHERE source::text = 'manual' AND regularized_reason = 'auto_daily' AND (regularized_by IS NOT NULL OR check_in_at IS NOT NULL OR check_out_at IS NOT NULL)) AS auto_reason_but_touched_by_a_person,
      COUNT(*) FILTER (WHERE source::text = 'manual' AND (regularized_reason IS DISTINCT FROM 'auto_daily')) AS other_manual_untouched,
      COUNT(*) FILTER (WHERE source::text IN ('web', 'mobile')) AS real_checkins_untouched,
      COUNT(*) FILTER (WHERE source::text = 'auto') AS already_auto,
      COUNT(*) AS total_rows
    FROM attendance_records`);
  const [hidden] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS n FROM attendance_records a
    WHERE a.status::text IN ('present', 'half_day')
      AND (a.source::text = 'auto' OR (a.source::text = 'manual' AND a.regularized_reason = 'auto_daily' AND a.regularized_by IS NULL AND a.check_in_at IS NULL AND a.check_out_at IS NULL))
      AND EXISTS (SELECT 1 FROM leave_requests l WHERE l.org_membership_id = a.org_membership_id AND l.status::text = 'approved' AND l.is_half_day = false AND l.from_date <= a.date AND l.to_date >= a.date)`);
  const out = { enum_value_auto_exists: hasAuto };
  for (const [k, v] of Object.entries({ ...row, hidden_leave_days_with_auto_entry: hidden.n })) out[k] = Number(v);
  console.log(JSON.stringify(out, null, 2));
  console.log('\nwill_become_auto = rows the migration marks `auto`. auto_reason_but_touched_by_a_person stay `manual` (a person edited them).');
  console.log('hidden_leave_days_with_auto_entry = approved full-day leave days currently hidden by an automatic present entry.');
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
