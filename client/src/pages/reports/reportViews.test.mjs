import assert from 'node:assert/strict';
import {
  ALL_REPORTS,
  chartTypeForReport,
  columnsForReport,
  reportsForRole,
} from './reportViews.js';

assert.ok(ALL_REPORTS.some((r) => r.key === 'pipeline-explorer'));
// Hidden reports stay defined but are dropped from the role dropdown.
assert.ok(!reportsForRole('bda').some((r) => r.key === 'pipeline-explorer'));
assert.ok(!reportsForRole('admin').some((r) => r.key === 'pipeline-explorer'));
assert.ok(!reportsForRole('recruiter').some((r) => r.key === 'pipeline-explorer'));

// Visible dropdown reports per role.
assert.deepEqual(
  reportsForRole('admin').map((r) => r.key).sort(),
  ['bda-reports', 'clients-without-requirements', 'hr', 'joinings', 'recruiter-vendor-gaps', 'sales-reports', 'time-to-submit']
);
assert.deepEqual(reportsForRole('bda').map((r) => r.key).sort(), ['bda-reports', 'clients-without-requirements']);
assert.deepEqual(reportsForRole('recruiter').map((r) => r.key), ['recruiter-vendor-gaps']);
assert.deepEqual(
  reportsForRole('sales').map((r) => r.key).sort(),
  ['clients-without-requirements', 'joinings', 'sales-reports', 'time-to-submit']
);

const columns = columnsForReport('pipeline-explorer');
assert.ok(columns.some((c) => c.key === 'client'));
assert.ok(columns.some((c) => c.key === 'bda'));
assert.ok(columns.some((c) => c.key === 'sales'));
assert.ok(columns.some((c) => c.key === 'recruiters'));

const rendered = columns.find((c) => c.key === 'client').render({
  client: { name: 'Acme Corp' },
});
assert.equal(rendered, 'Acme Corp');

assert.equal(chartTypeForReport('pipeline-explorer'), 'pie');
assert.equal(chartTypeForReport('aging'), 'pie');

// Coverage-gap report tabs
assert.ok(reportsForRole('bda').some((r) => r.key === 'clients-without-requirements'));
assert.ok(reportsForRole('recruiter').some((r) => r.key === 'recruiter-vendor-gaps'));
assert.ok(!reportsForRole('recruiter').some((r) => r.key === 'clients-without-requirements'));
assert.ok(columnsForReport('clients-without-requirements').some((c) => c.key === 'sales_poc'));
assert.ok(columnsForReport('clients-without-requirements').some((c) => c.key === 'brought_by'));
assert.ok(columnsForReport('clients-without-requirements').some((c) => c.key === 'active_requirements_count'));
assert.ok(!columnsForReport('recruiter-vendor-gaps').some((c) => c.key === 'recruiters'));
assert.equal(
  columnsForReport('recruiter-vendor-gaps').find((c) => c.key === 'vendor').render({ vendor: { name: 'Acme Staffing' } }),
  'Acme Staffing'
);

console.log('reportViews.test.mjs: ok');
