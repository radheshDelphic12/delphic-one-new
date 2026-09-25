import assert from 'node:assert/strict';
import { can } from './permissions.js';

assert.equal(can('bda', 'viewLeadPipeline'), true);
assert.equal(can('bda', 'viewJobPipeline'), false);
assert.equal(can('bda', 'viewCandidatePipeline'), false);
assert.equal(can('bda', 'viewPipeline'), true);
assert.equal(can('bda', 'viewRequirementMatrix'), true);
assert.equal(can('bda', 'viewReports'), true);

assert.equal(can('sales', 'viewJobPipeline'), true);
assert.equal(can('sales', 'viewLeadPipeline'), false);
assert.equal(can('sales', 'viewCandidatePipeline'), false);
assert.equal(can('sales', 'viewRequirementMatrix'), true);

assert.equal(can('recruiter', 'viewCandidatePipeline'), true);
assert.equal(can('recruiter', 'viewLeadPipeline'), false);
assert.equal(can('recruiter', 'viewJobPipeline'), false);
assert.equal(can('recruiter', 'viewRequirementMatrix'), true);

assert.equal(can('admin', 'viewLeadPipeline'), true);
assert.equal(can('admin', 'viewJobPipeline'), true);
assert.equal(can('admin', 'viewCandidatePipeline'), true);
assert.equal(can('admin', 'viewRequirementMatrix'), true);

console.log('permissions.pipeline.test.mjs: ok');
