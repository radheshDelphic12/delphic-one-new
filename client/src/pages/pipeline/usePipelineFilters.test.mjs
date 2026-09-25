import assert from 'node:assert/strict';
import {
  applyFiltersToSearchParams,
  emptyPipelineFilters,
  filtersFromSearchParams,
  filtersToApiParams,
} from './usePipelineFilters.js';

const empty = emptyPipelineFilters();
assert.equal(empty.search, '');
assert.equal(empty.stuck, 'all');
assert.equal(empty.past_sla_only, false);
assert.equal(empty.date_from, '');
assert.deepEqual(empty.status, []);
assert.equal(empty.stuck_only, undefined); // removed — the `stuck` tri-state is the single control

// Tri-state `stuck` filter: round-trips through params, omits the "all" default.
const stuckParsed = filtersFromSearchParams(new URLSearchParams('stuck=not_stuck'));
assert.equal(stuckParsed.stuck, 'not_stuck');
assert.deepEqual(filtersToApiParams(stuckParsed, ['stuck']), { stuck: 'not_stuck' });
assert.deepEqual(filtersToApiParams(emptyPipelineFilters(), ['stuck']), {});
const stuckWritten = applyFiltersToSearchParams(new URLSearchParams(), {
  ...emptyPipelineFilters(),
  stuck: 'stuck',
});
assert.equal(stuckWritten.get('stuck'), 'stuck');
assert.equal(
  applyFiltersToSearchParams(new URLSearchParams('stuck=stuck'), emptyPipelineFilters()).get('stuck'),
  null
);

// Date range is emitted only for boards that opt in via the `date_range` field.
const dateParsed = filtersFromSearchParams(new URLSearchParams('date_from=2026-01-01&date_to=2026-02-01'));
assert.equal(dateParsed.date_from, '2026-01-01');
assert.deepEqual(filtersToApiParams(dateParsed, ['date_range']), {
  date_from: '2026-01-01',
  date_to: '2026-02-01',
});
assert.deepEqual(filtersToApiParams(dateParsed, ['search']), {});

const params = new URLSearchParams(
  'search=Backend&status=open,in_progress&past_sla_only=true&sales_id=abc'
);
const parsed = filtersFromSearchParams(params);
assert.equal(parsed.search, 'Backend');
assert.deepEqual(parsed.status, ['open', 'in_progress']);
assert.equal(parsed.past_sla_only, true);
assert.equal(parsed.sales_id, 'abc');

const api = filtersToApiParams(parsed, ['search', 'status', 'past_sla_only', 'sales_id']);
assert.deepEqual(api, {
  search: 'Backend',
  status: 'open,in_progress',
  past_sla_only: 'true',
  sales_id: 'abc',
});

const written = applyFiltersToSearchParams(new URLSearchParams('view=matrix'), {
  ...emptyPipelineFilters(),
  search: 'Acme',
  status: ['open'],
  past_sla_only: true,
});
assert.equal(written.get('view'), 'matrix');
assert.equal(written.get('search'), 'Acme');
assert.equal(written.get('status'), 'open');
assert.equal(written.get('past_sla_only'), 'true');
assert.equal(written.get('stuck_only'), null);

// Persistence contract: a fully-populated filter set survives a
// write → URL → read round-trip unchanged (so Back / reload / new tab keep it).
const full = {
  ...emptyPipelineFilters(),
  search: 'Backend',
  account_id: 'acc-1',
  bda_id: 'bda-1',
  sales_id: 'sales-1',
  admin_id: 'admin-1',
  recruiter_id: 'rec-1',
  recruiter_ids: ['rec-2', 'rec-3'],
  submitted_by_ids: ['rec-4'],
  status: ['open', 'on_hold'],
  priority: ['high', 'urgent'],
  submission_stage: ['sourced', 'bgv'],
  stuck: 'stuck',
  past_sla_only: true,
  date_from: '2026-01-01',
  date_to: '2026-03-31',
};
const roundTripped = filtersFromSearchParams(applyFiltersToSearchParams(new URLSearchParams(), full));
assert.deepEqual(roundTripped, full);

console.log('usePipelineFilters.test.mjs: ok');
