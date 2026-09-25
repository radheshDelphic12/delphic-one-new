import assert from 'node:assert/strict';
import {
  LEAD_COLUMNS,
  JOB_COLUMNS,
  defaultPipelineView,
  formatStageLabel,
  groupByStage,
  shortKey,
} from './pipelineBoardUtils.js';

const accounts = [
  { id: 'a1', stage: 'lead', name: 'Acme' },
  { id: 'a2', stage: 'active', name: 'Beta' },
  { id: 'a3', stage: 'lead', name: 'Gamma' },
  { id: 'a4', stage: 'unknown', name: 'Skip' },
];

const leadCells = groupByStage(accounts, LEAD_COLUMNS, 'stage');
assert.equal(leadCells.lead.length, 2);
assert.equal(leadCells.active.length, 1);
assert.equal(leadCells.dropped.length, 0);
assert.equal(leadCells.meeting_scheduled.length, 0);

const requirements = [
  { id: 'r1', status: 'open' },
  { id: 'r2', status: 'in_progress' },
  { id: 'r3', status: 'closed' },
];
const jobCells = groupByStage(requirements, JOB_COLUMNS, 'status');
assert.equal(jobCells.open.length, 1);
assert.equal(jobCells.in_progress.length, 1);
assert.equal(jobCells.on_hold.length, 0);
assert.equal(jobCells.closed.length, 1);

assert.equal(defaultPipelineView('bda'), 'matrix');
assert.equal(defaultPipelineView('sales'), 'matrix');
assert.equal(defaultPipelineView('recruiter'), 'matrix');
assert.equal(defaultPipelineView('admin'), 'matrix');
assert.equal(defaultPipelineView('unknown'), 'matrix');

assert.equal(formatStageLabel('meeting_scheduled'), 'meeting scheduled');
assert.equal(formatStageLabel(''), '—');
assert.equal(shortKey('ACC', 'abcdef12-9999'), 'ACC-ABCDEF12');

assert.deepEqual(groupByStage(null, LEAD_COLUMNS).lead, []);

console.log('pipelineBoardUtils.test.mjs: ok');
