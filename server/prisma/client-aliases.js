/**
 * Canonical client account names for LeadMinds + Jira CSV imports.
 * Jira often uses short / variant spellings; LeadMinds is the display name of record.
 */

/** Lowercased Jira / informal label → LeadMinds (or house) display name. */
const CLIENT_NAME_ALIASES = {
  girnarsoft: 'Girnarsoft',
  'girnar soft': 'Girnarsoft',
  girnarsoft_pragya: 'Girnarsoft',
  'girnarsoft pragya': 'Girnarsoft',
  girnarsoftpragya: 'Girnarsoft',

  devlabs: 'Devlabsalliance',
  'devlabs alliance': 'Devlabsalliance',
  devlabsalliance: 'Devlabsalliance',

  protonshub: 'Protonshub Technologies',
  'protonshub technologies': 'Protonshub Technologies',
  'protonshub technologies pvt': 'Protonshub Technologies',

  apaarinfosystem: 'Apaar Information Systems',
  apaarinfosystems: 'Apaar Information Systems',
  'apaar information systems': 'Apaar Information Systems',
  'apaar info systems': 'Apaar Information Systems',

  'tridhya-tech': 'TridhiyaTech',
  tridhyatech: 'TridhiyaTech',
  'tridhya tech': 'TridhiyaTech',
  tridhiyatech: 'TridhiyaTech',

  sinontech: 'Sinon Tech [Naeya Tech]',
  'sinon tech': 'Sinon Tech [Naeya Tech]',
  'sinon tech [naeya tech]': 'Sinon Tech [Naeya Tech]',
  'naeya tech': 'Sinon Tech [Naeya Tech]',

  orangebits: 'Orangebites',
  orangebites: 'Orangebites',
  orangebite: 'Orangebites',

  dinaapps: 'DianApps',
  dianapps: 'DianApps',
  'dina apps': 'DianApps',
  'dian apps': 'DianApps',

  'hub-ai': 'Hub-AI',
  hubai: 'Hub-AI',
  'hub ai': 'Hub-AI',

  bench: 'Delphic Bench',
  'delphic bench': 'Delphic Bench',
};

function aliasKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Return the canonical account display name for imports.
 *
 * Girnarsoft_Pragya and GirnarSoft both resolve to Girnarsoft.
 * Devlabs resolves to Devlabsalliance (LeadMinds name).
 */
function normalizeClientName(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return 'Unknown Client';

  const key = aliasKey(trimmed);
  if (CLIENT_NAME_ALIASES[key]) return CLIENT_NAME_ALIASES[key];

  // Compact key without spaces (Girnarsoft_Pragya → girnarsoftpragya after _→space→join)
  const compact = key.replace(/\s+/g, '');
  if (CLIENT_NAME_ALIASES[compact]) return CLIENT_NAME_ALIASES[compact];

  // Underscore variants kept as original keys
  const underscored = String(raw || '').trim().toLowerCase();
  if (CLIENT_NAME_ALIASES[underscored]) return CLIENT_NAME_ALIASES[underscored];

  return trimmed;
}

module.exports = {
  CLIENT_NAME_ALIASES,
  aliasKey,
  normalizeClientName,
};
