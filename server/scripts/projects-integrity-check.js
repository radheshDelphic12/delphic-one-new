/**
 * READ ONLY. Looks for project data that is missing or inconsistent, because projects were reported deleted and nobody
 * could tell what happened. Run it on any database; it never changes anything.
 *
 * Usage:  node server/scripts/projects-integrity-check.js
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const CHECKS = [
  ['Projects (accounts marked is_project)', `SELECT COUNT(*) n FROM accounts WHERE is_project AND deleted_at IS NULL`],
  ['Projects already soft-deleted (restorable)', `SELECT COUNT(*) n FROM accounts WHERE is_project AND deleted_at IS NOT NULL`],
  ['Active project with NO client account', `SELECT COUNT(*) n FROM accounts WHERE is_project AND deleted_at IS NULL AND client_account_id IS NULL`],
  ['Project whose client account is soft-deleted', `SELECT COUNT(*) n FROM accounts p JOIN accounts c ON c.id = p.client_account_id WHERE p.is_project AND p.deleted_at IS NULL AND c.deleted_at IS NOT NULL`],
  ['Active project with no project name', `SELECT COUNT(*) n FROM accounts WHERE is_project AND deleted_at IS NULL AND (project_name IS NULL OR btrim(project_name) = '')`],
  ['Active project with no project code', `SELECT COUNT(*) n FROM accounts WHERE is_project AND deleted_at IS NULL AND (project_code IS NULL OR btrim(project_code) = '')`],
  ['Active project with no holiday calendar mapping (falls back to Ahmedabad)', `SELECT COUNT(*) n FROM accounts a WHERE a.is_project AND a.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM project_calendars pc WHERE pc.account_id = a.id)`],
  ['Active project with no billing rate / rule set', `SELECT COUNT(*) n FROM accounts a WHERE a.is_project AND a.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM billing_rates b WHERE b.account_id = a.id)`],
  ['Agreement end date before the start date', `SELECT COUNT(*) n FROM accounts WHERE is_project AND deleted_at IS NULL AND agreement_start_date IS NOT NULL AND agreement_end_date IS NOT NULL AND agreement_end_date < agreement_start_date`],
  ['Allocations on a soft-deleted project', `SELECT COUNT(*) n FROM project_member_assignments pm JOIN accounts a ON a.id = pm.account_id WHERE a.deleted_at IS NOT NULL`],
  ['Allocations of a person who has left/was deleted', `SELECT COUNT(*) n FROM project_member_assignments pm JOIN org_memberships m ON m.id = pm.org_membership_id WHERE m.deleted_at IS NOT NULL`],
  ['Timesheet entries on a soft-deleted project', `SELECT COUNT(*) n FROM timesheet_entries t JOIN accounts a ON a.id = t.account_id WHERE a.deleted_at IS NOT NULL`],
  ['Client invoices on a soft-deleted project', `SELECT COUNT(*) n FROM client_invoices i JOIN accounts a ON a.id = i.client_account_id WHERE a.deleted_at IS NOT NULL AND i.deleted_at IS NULL`],
  ['Vendor invoices on a soft-deleted project', `SELECT COUNT(*) n FROM project_vendor_invoices v JOIN accounts a ON a.id = v.account_id WHERE a.deleted_at IS NOT NULL`],
  ['Active projects with allocations but none currently running', `SELECT COUNT(*) n FROM accounts a WHERE a.is_project AND a.deleted_at IS NULL AND EXISTS (SELECT 1 FROM project_member_assignments pm WHERE pm.account_id = a.id) AND NOT EXISTS (SELECT 1 FROM project_member_assignments pm WHERE pm.account_id = a.id AND (pm.end_date IS NULL OR pm.end_date >= CURRENT_DATE))`],
];

async function main() {
  for (const [label, sql] of CHECKS) {
    try {
      const [row] = await prisma.$queryRawUnsafe(sql);
      console.log(`${String(Number(row.n)).padStart(6)}  ${label}`);
    } catch (err) {
      console.log(`  skip  ${label}  (${err.message.split('\n').pop().slice(0, 80)})`);
    }
  }
  const recent = await prisma.$queryRawUnsafe(`SELECT id, project_name, deleted_at, delete_reason FROM accounts WHERE is_project AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 20`);
  if (recent.length) { console.log('\nSoft-deleted projects:'); for (const r of recent) console.log(`- ${r.project_name} (${r.id}) deleted ${r.deleted_at.toISOString().slice(0, 10)} ${r.delete_reason || ''}`); }
  console.log('\nA project removed permanently (no deleted_at) leaves no trace here: from now on the change log records it.');
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
