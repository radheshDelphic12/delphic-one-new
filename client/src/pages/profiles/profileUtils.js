export function profileKey(id) {
  return `PRF-${String(id || '').slice(0, 8).toUpperCase()}`;
}

export function formatProfileValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value).replace(/_/g, ' ');
}

export function canCreateProfile(user) {
  return user?.role === 'recruiter' || user?.role === 'admin';
}

export function canViewProfiles(user) {
  return user?.role === 'recruiter' || user?.role === 'sales' || user?.role === 'admin';
}

export function canEditProfile(user) {
  return user?.role === 'recruiter' || user?.role === 'admin';
}

/**
 * Who may add/remove recruiters on a requirement.
 * Admin: always. Sales: only when they own the requirement (sales_owner).
 * Pass requirement when checking a specific row; omit for role-level checks.
 */
export function canAssignRecruiters(user, requirement) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'sales') return false;
  if (!requirement) return true;
  const ownerId = requirement.sales_owner?.id || requirement.sales_owner_id;
  return Boolean(ownerId && ownerId === user.id);
}

export { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';

export function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function joinCsv(values) {
  return Array.isArray(values) ? values.join(', ') : '';
}
