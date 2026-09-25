import assert from 'node:assert/strict';
import { buildAccountBody, canMutateAccount, formFromAccount } from './accountUtils.js';

const bda = { id: 'bda-1', role: 'bda' };
const otherBda = { id: 'bda-2', role: 'bda' };
const admin = { id: 'admin-1', role: 'admin' };
const owned = { id: 'acc-1', owner: { id: 'bda-1' } };
const foreign = { id: 'acc-2', owner: { id: 'bda-2' } };

assert.equal(canMutateAccount(owned, bda), true);
assert.equal(canMutateAccount(foreign, bda), true);
assert.equal(canMutateAccount(foreign, admin), true);
assert.equal(canMutateAccount(owned, otherBda), true);
// Regression: calling with only the user object must not throw or grant access.
assert.equal(canMutateAccount(bda), false);
assert.equal(canMutateAccount(null, bda), false);

// Regression: an account API row with null optional columns must not crash the edit
// form. Before the fix, `...account` clobbered the '' defaults with null and
// buildAccountBody() threw `null.trim()`, surfacing only "Failed to update account".
const nullyClient = {
  id: 'acc-9',
  type: 'client',
  name: 'Nully Co',
  stage: 'active',
  industry: null,
  website: null,
  location_city: null,
  location_country: null,
  gst_or_tax_id: null,
  location: null,
  linkedin_url: null,
  poc_name: null,
  poc_email: null,
  poc_phone: null,
  poc_designation: null,
  source: null,
  client_payment_terms: null,
  client_agreement_url: null,
  client_billing_currency: null,
  additional_contacts: [{ name: 'Ann', email: null, phone: null, designation: null, role_label: null }],
  vendor_rate_range: null,
  owner: { id: 'bda-1' },
};

const form = formFromAccount(nullyClient);
assert.equal(form.industry, '');
assert.equal(form.poc_phone, '');
assert.equal(form.client_billing_currency, 'INR');
assert.equal(form.additional_contacts[0].email, '');

const body = buildAccountBody(form, true, true, false);
assert.equal(body.industry, '');
assert.equal(body.poc_phone, '');
assert.equal(body.name, 'Nully Co');
assert.equal(body.client_payment_terms, '');
assert.deepEqual(body.additional_contacts, [
  { name: 'Ann', email: '', phone: '', designation: '', role_label: '' },
]);
// type unchanged from the loaded value → still sent; service drops it when equal.
assert.equal(body.type, 'client');
assert.equal(body.owner_id, 'bda-1');

// A brand-new form (all '' defaults) still builds without a type/owner_id.
const fresh = buildAccountBody(formFromAccount({ additional_contacts: [] }), false, false, false);
assert.equal(fresh.type, undefined);
assert.equal(fresh.owner_id, undefined);
assert.deepEqual(fresh.additional_contacts, []);

console.log('accountUtils.test.mjs: ok');
