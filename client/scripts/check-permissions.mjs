/**
 * T0 assert demo for the permissions map (run with: node client/scripts/check-permissions.mjs).
 */
import { can } from '../src/lib/permissions.js';

const cases = [
  ['admin', 'viewReports', true],
  ['admin', 'manageUsers', true],
  ['admin', 'filterByDepartment', true],
  ['sales', 'viewReports', true],
  ['sales', 'exportReports', true],
  ['sales', 'manageUsers', false],
  ['recruiter', 'viewReports', true],
  ['recruiter', 'exportReports', false],
  ['recruiter', 'viewProfiles', true],
  ['bda', 'viewReports', false],
  ['bda', 'editAccount', true],
  ['bda', 'viewProfiles', false],
];

let failed = 0;
for (const [role, capability, expected] of cases) {
  const actual = can(role, capability);
  if (actual !== expected) {
    console.error(`FAIL can('${role}', '${capability}') => ${actual}, expected ${expected}`);
    failed += 1;
  }
}

if (failed) {
  console.error(`${failed} permission check(s) failed`);
  process.exit(1);
}
console.log(`OK ${cases.length} permission checks passed`);
