const { z } = require('zod');

// The screening answers a candidate gives when applying. One definition used by the public apply form (where most are
// required), the internal referral form and the recruiter's "Add applicant" (where they are optional).

const blank = (v) => (v === '' || v === null || v === undefined ? undefined : v);
const optText = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());
const optNum = (min, max) => z.preprocess(blank, z.coerce.number().min(min).max(max).optional());
const optDate = z.preprocess(blank, z.coerce.date().optional());
const optBool = z.preprocess((v) => (v === 'yes' || v === 'true' || v === true ? true : v === 'no' || v === 'false' || v === false ? false : undefined), z.boolean().optional());

const JOINER = ['yes', 'no', 'serving_notice'];
const WORK_MODES = ['remote', 'onsite', 'hybrid'];

const fields = {
  linkedin_url: optText(300),
  cv_url: optText(500),
  currently_working: optBool,
  joiner_status: z.preprocess(blank, z.enum(JOINER).optional()),
  notice_period_days: z.preprocess(blank, z.coerce.number().int().min(0).max(365).optional()),
  last_working_day: optDate,
  current_ctc_lpa: optNum(0, 10000),
  expected_ctc_lpa: optNum(0, 10000),
  work_mode: z.preprocess(blank, z.enum(WORK_MODES).optional()),
  // typed as a comma / new-line separated list or an array
  extra_skills: z.preprocess((v) => (typeof v === 'string' ? v.split(/[,\n]/) : v), z.array(z.string().trim().max(60)).max(40).optional()),
};

const isUrl = (v) => { try { const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`); return Boolean(u.hostname.includes('.')); } catch { return false; } };

/** Optional version (recruiter adds someone by hand, an employee refers someone). */
const optionalShape = fields;

/** What the public apply form insists on; the rest of the screening answers stay optional. */
function requireScreening(d, ctx) {
  const need = (key, message) => { if (d[key] === undefined || d[key] === null || d[key] === '') ctx.addIssue({ code: 'custom', path: [key], message }); };
  need('linkedin_url', 'LinkedIn profile link is required');
  need('currently_working', 'Please say whether you are working somewhere');
  need('joiner_status', 'Please choose a joiner status');
  need('notice_period_days', 'Please choose your notice period');
  need('current_ctc_lpa', 'Current CTC is required');
  need('expected_ctc_lpa', 'Expected CTC is required');
  need('work_mode', 'Please choose how you can join');
}

/** Cross-field rules that hold everywhere. */
function checkScreening(d, ctx) {
  if (d.linkedin_url && !isUrl(d.linkedin_url)) ctx.addIssue({ code: 'custom', path: ['linkedin_url'], message: 'Enter a valid LinkedIn link' });
  if (d.cv_url && !isUrl(d.cv_url)) ctx.addIssue({ code: 'custom', path: ['cv_url'], message: 'Enter a valid link to your CV' });
  if (d.joiner_status === 'serving_notice' && !d.last_working_day) ctx.addIssue({ code: 'custom', path: ['last_working_day'], message: 'Last working day is required while serving notice' });
}

/** The columns to store for a validated body. Skills are kept lower-case so the skill filter matches whatever case was typed. */
function toColumns(d) {
  const skills = [...new Set((d.extra_skills || []).map((s) => s.trim().toLowerCase()).filter(Boolean))];
  const withHttp = (u) => (u ? (/^https?:\/\//i.test(u) ? u : `https://${u}`) : null);
  return {
    linkedin_url: withHttp(d.linkedin_url),
    cv_url: withHttp(d.cv_url),
    currently_working: d.currently_working ?? null,
    joiner_status: d.joiner_status ?? null,
    // an immediate joiner has no notice to serve
    notice_period_days: d.notice_period_days ?? (d.joiner_status === 'yes' ? 0 : null),
    last_working_day: d.joiner_status === 'serving_notice' || d.last_working_day ? d.last_working_day ?? null : null,
    current_ctc_lpa: d.current_ctc_lpa ?? null,
    expected_ctc_lpa: d.expected_ctc_lpa ?? null,
    work_mode: d.work_mode ?? null,
    extra_skills: skills,
  };
}

module.exports = { fields, optionalShape, requireScreening, checkScreening, toColumns, JOINER, WORK_MODES };
