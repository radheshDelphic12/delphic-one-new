/** Quick-login buttons on /login (dev only). Matches server/prisma/team-roster.js */
export const QUICK_LOGIN_ACCOUNTS = [
  { role: 'admin', label: 'Admin', email: 'admin@delphic.in', name: 'Admin' },
  // Belongs to two orgs (Delphic + Acconcy) — `npm run erp:seed:multi-org` creates it.
  { role: 'multi_org', label: 'Multi-Org Admin', email: 'group.admin@delphic.in', name: 'Group Admin' },
  { role: 'bda', label: 'BDA', email: 'chahak.pandya@delphic.in', name: 'Chahak Pandya' },
  { role: 'sales', label: 'Sales', email: 'tanvi.saxena@delphic.in', name: 'Tanvi Saxena' },
  { role: 'recruiter', label: 'Recruiter', email: 'sarthak.solanki@delphic.in', name: 'Sarthak Solanki' },
  { role: 'recruiter', label: 'Recruiter', email: 'nikhil.yadav@delphic.in', name: 'Nikhil Yadav' },
];

/** Shared seed password for every roster user (server/prisma/team-roster.js). */
export const DEFAULT_DEV_PASSWORD = 'Password123!';

/** @deprecated use DEFAULT_DEV_PASSWORD */
export const TEST_PASSWORD = DEFAULT_DEV_PASSWORD;

export function isQuickLoginEnabled() {
  return import.meta.env.VITE_DISABLE_QUICK_LOGIN !== 'true';
}
