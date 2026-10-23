// Rules for the public fields of a job posting that must look the same everywhere: the title and the employment type.

const ACRONYMS = ['AI', 'ML', 'QA', 'HR', 'IT', 'UI', 'UX', 'SQL', 'API', 'SAP', 'ERP', 'CRM', 'BI', 'SEO', 'SDET', 'AWS', 'ETL', 'RPA', 'CTO', 'CFO', 'CEO', 'VP', 'iOS', 'PHP', 'DBA', 'SRE', 'GCP', 'SaaS', 'DevOps', 'QC', 'PMO', 'BPO', 'KYC', 'AML'];

/** Single spaces, no trailing punctuation ("Product Owner - Data & Digital." -> "... Digital"), no ALL-CAPS title. */
function cleanTitle(value) {
  let s = String(value ?? '').replace(/\s+/g, ' ').trim().replace(/[\s.,;:!\-–—]+$/, '').trim();
  if (s === s.toUpperCase() && /[A-Z]{3,}/.test(s)) {
    s = s.toLowerCase().replace(/(^|[^a-z0-9'])([a-z])/g, (_m, pre, c) => pre + c.toUpperCase());
    for (const a of ACRONYMS) {
      const cap = a.charAt(0).toUpperCase() + a.slice(1).toLowerCase();
      s = s.replace(new RegExp(`\\b${cap}\\b`, 'g'), a);
    }
  }
  return s;
}

const KINDS = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
};

/** "Full Time", "full-time", "FULLTIME", "Permanent" ... -> { kind, label }; null when it is none of the known types. */
function normalizeEmployment(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return null;
  let kind = null;
  if (/part/.test(s)) kind = 'part_time';
  else if (/(contract|temp|freelanc|consult)/.test(s)) kind = 'contract';
  else if (/intern/.test(s)) kind = 'internship';
  else if (/(full|perm)/.test(s)) kind = 'full_time';
  return kind ? { kind, label: KINDS[kind] } : null;
}

const JOB_CODE = /^[A-Za-z]{2,5}-?\d{1,8}$/;
/** "dlp 0001", "DLP-0001", "dlp0001" -> "dlp0001" (compare Job IDs on this). */
const codeKey = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

module.exports = { ACRONYMS, KINDS, cleanTitle, normalizeEmployment, JOB_CODE, codeKey };
