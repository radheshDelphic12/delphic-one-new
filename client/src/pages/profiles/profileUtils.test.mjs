import test from 'node:test';
import assert from 'node:assert/strict';
import { canCreateProfile, canEditProfile, canViewProfiles } from './profileUtils.js';

const permissionUser = (permissions, level = 'employee') => ({ role: 'employee', access: { mode: 'permissions', level, permissions, basic: [] } });

test('permission mode: Profiles > Add decides, not the derived role', () => {
  assert.equal(canCreateProfile(permissionUser({ 'profiles.create': true })), true);
  assert.equal(canCreateProfile(permissionUser({ 'profiles.view': 'all' })), false);
  assert.equal(canEditProfile(permissionUser({ 'profiles.update': 'all' })), true);
  assert.equal(canEditProfile(permissionUser({ 'profiles.create': true })), false);
  assert.equal(canViewProfiles(permissionUser({ 'profiles.view': 'all' })), true);
  assert.equal(canViewProfiles(permissionUser({})), false);
});

test('permission mode: the company admin and the super admin can always create', () => {
  assert.equal(canCreateProfile(permissionUser({}, 'admin')), true);
  assert.equal(canCreateProfile(permissionUser({}, 'super_admin')), true);
});

test('legacy company: the role decides, as before', () => {
  assert.equal(canCreateProfile({ role: 'recruiter' }), true);
  assert.equal(canCreateProfile({ role: 'admin' }), true);
  assert.equal(canCreateProfile({ role: 'sales' }), false);
  assert.equal(canCreateProfile({ role: 'employee', access: { mode: 'legacy' } }), false);
  assert.equal(canViewProfiles({ role: 'sales' }), true);
  assert.equal(canEditProfile({ role: 'bda' }), false);
});
