const assert = require('assert');
const { normalizeClientName } = require('./client-aliases');

assert.strictEqual(normalizeClientName('Girnarsoft_Pragya'), 'Girnarsoft');
assert.strictEqual(normalizeClientName('GirnarSoft'), 'Girnarsoft');
assert.strictEqual(normalizeClientName('Girnarsoft'), 'Girnarsoft');
assert.strictEqual(normalizeClientName('Devlabs'), 'Devlabsalliance');
assert.strictEqual(normalizeClientName('Devlabsalliance'), 'Devlabsalliance');
assert.strictEqual(normalizeClientName('Protonshub'), 'Protonshub Technologies');
assert.strictEqual(normalizeClientName('ApaarInfosystem'), 'Apaar Information Systems');
assert.strictEqual(normalizeClientName('tridhya-tech'), 'TridhiyaTech');
assert.strictEqual(normalizeClientName('Sinontech'), 'Sinon Tech [Naeya Tech]');
assert.strictEqual(normalizeClientName('Orangebits'), 'Orangebites');
assert.strictEqual(normalizeClientName('DinaApps'), 'DianApps');
assert.strictEqual(normalizeClientName('bench'), 'Delphic Bench');
assert.strictEqual(normalizeClientName(''), 'Unknown Client');

console.log('client-aliases ok');
