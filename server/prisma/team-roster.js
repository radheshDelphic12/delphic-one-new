/**
 * Delphic team roster for base seed + Jira CSV import.
 * Jira display names are mapped to these records via JIRA_NAME_TO_EMAIL.
 */

const DEPARTMENT_NAMES = ['Sales', 'HR', 'Vendor'];

const TEAM_ROSTER = [
  { name: 'Admin', email: 'admin@delphic.in', role: 'admin', department: null, is_superadmin: true },
  { name: 'Diksha Yadav', email: 'diksha.yadav@delphic.in', role: 'admin', department: 'HR' },
  { name: 'Paras Gulati', email: 'paras.gulati@delphic.in', role: 'admin', department: 'HR' },
  { name: 'Biswajit Dey', email: 'biswajit.dey@delphic.in', role: 'admin', department: null },
  { name: 'Chahak Pandya', email: 'chahak.pandya@delphic.in', role: 'bda', department: 'Sales' },
  { name: 'Dheeraj Kumar', email: 'dheeraj.kumar@delphic.in', role: 'bda', department: 'Sales' },
  { name: 'Tanvi Saxena', email: 'tanvi.saxena@delphic.in', role: 'sales', department: 'Sales' },
  { name: 'Garv Gulati', email: 'Garv@delphic.in', role: 'recruiter', department: 'Vendor' },
  { name: 'Krupali Vala', email: 'krupali.vala@delphic.in', role: 'recruiter', department: 'Vendor' },
  { name: 'Prashant Singh Hada', email: 'prashant.hada@delphic.in', role: 'recruiter', department: 'HR' },
  { name: 'Sarthak Solanki', email: 'sarthak.solanki@delphic.in', role: 'recruiter', department: 'HR' },
  { name: 'Shivani Sinha', email: 'shivani.sinha@delphic.in', role: 'recruiter', department: 'HR' },
  { name: 'Nikhil Yadav', email: 'nikhil.yadav@delphic.in', role: 'recruiter', department: 'HR' },
];

/** Jira CSV display name → roster email (includes aliases). */
const JIRA_NAME_TO_EMAIL = {
  Admin: 'admin@delphic.in',
  'Biswajit Dey': 'biswajit.dey@delphic.in',
  'Chahak Pandya': 'chahak.pandya@delphic.in',
  'Dheeraj Kumar': 'dheeraj.kumar@delphic.in',
  'Diksha Yadav': 'diksha.yadav@delphic.in',
  'Garv Gulati': 'Garv@delphic.in',
  'Krupali Vala': 'krupali.vala@delphic.in',
  'Nikhil Yadav': 'nikhil.yadav@delphic.in',
  'Paras Gulati': 'paras.gulati@delphic.in',
  'Prashant Hada': 'prashant.hada@delphic.in',
  'Prashant Singh Hada': 'prashant.hada@delphic.in',
  'Sarthak Solanki': 'sarthak.solanki@delphic.in',
  'Shivani Sinha': 'shivani.sinha@delphic.in',
  'Tanvi Saxena': 'tanvi.saxena@delphic.in',
};

/** Jira comment author id → roster email. */
const JIRA_AUTHOR_ID_TO_EMAIL = {
  '712020:ec9d4891-6015-4d98-9edb-e2d531338090': 'Garv@delphic.in',
  '712020:05dfacdd-8b81-44e0-8c65-67aa8bd8e871': 'biswajit.dey@delphic.in',
  '712020:3b446a8d-8374-4088-846f-225155343891': 'prashant.hada@delphic.in',
  '712020:bf29b759-0312-4089-99ad-f56191f124a0': 'sarthak.solanki@delphic.in',
  '712020:9388b521-3985-43aa-80a7-8fe219fc219d': 'shivani.sinha@delphic.in',
  '712020:180b6eb2-dca6-4aec-b67b-23a22e971f04': 'tanvi.saxena@delphic.in',
  '712020:07b19da2-e557-418b-a72b-435fd3d74c4f': 'chahak.pandya@delphic.in',
  '63804f3f213a315af3473e76': 'diksha.yadav@delphic.in',
  '6400dafa4307e46ad144cb7f': 'paras.gulati@delphic.in',
};

/** Assign when name appears in requirement comments (recruiter role on req). */
const COMMENT_MENTION_ASSIGNMENTS = [
  { pattern: /\bdheeraj\b/i, email: 'dheeraj.kumar@delphic.in' },
  { pattern: /\bkrupali\b/i, email: 'krupali.vala@delphic.in' },
  { pattern: /\bnikhil\b/i, email: 'nikhil.yadav@delphic.in' },
];

const DEFAULT_SEED_PASSWORD = 'Password123!';

function emailsMentionedInComments(comments) {
  const emails = new Set();
  const text = comments.map((c) => c.body || '').join('\n');
  for (const hint of COMMENT_MENTION_ASSIGNMENTS) {
    if (hint.pattern.test(text)) emails.add(hint.email.toLowerCase());
  }
  return emails;
}

module.exports = {
  COMMENT_MENTION_ASSIGNMENTS,
  DEFAULT_SEED_PASSWORD,
  DEPARTMENT_NAMES,
  JIRA_AUTHOR_ID_TO_EMAIL,
  JIRA_NAME_TO_EMAIL,
  TEAM_ROSTER,
  emailsMentionedInComments,
};
