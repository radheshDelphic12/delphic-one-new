import assert from 'node:assert/strict';
import { hasNeed } from './access.js';

const employee = {
  access: {
    mode: 'permissions',
    level: 'employee',
    basic: ['basic.timesheet'],
    permissions: { 'timesheets.view': true },
  },
};

assert.equal(hasNeed(employee, 'basic.timesheet'), true);
assert.equal(hasNeed(employee, 'timesheets.view'), true);
assert.equal(hasNeed(employee, undefined), false);
assert.equal(hasNeed(employee, [undefined]), false);
assert.equal(hasNeed(employee, 'timesheets.approve'), false);

console.log('access.test.mjs: ok');
