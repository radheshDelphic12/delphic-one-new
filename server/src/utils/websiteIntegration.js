/**
 * Website integration - the seam between the recruitment pipeline (Pipeline > In-progress jobs, the applicant pool) and
 * the Delphic website. Implemented by modules/website, which talks to the website's Google Apps Script web apps
 * (see D:/Delphic/delphic/scripts/PLATFORM-INTEGRATION.md). Until the WEBSITE_* env vars are set every call throws
 * WebsiteNotConnectedError (501), so callers keep their "not connected" behaviour.
 *
 *  - publishRequirementToWebsite(requirement, user)  publishes the requirement's public fields (title, JD, experience,
 *                                                    work mode / location) to /career. Budget and billing are never sent.
 *                                                    Returns { posting, url }.
 *  - unpublishRequirementFromWebsite(requirement, user)
 *  - ingestWebsiteApplication(payload)               payload = { requirement_id, name, email, phone, experience_years };
 *                                                    lands the person in the requirement's applicant pool (source website).
 */
const env = require('../config/env');
const prisma = require('../config/db');
const client = require('../modules/website/appsScriptClient');
const postings = require('../modules/website/postings.service');
const applicants = require('../modules/applicants/applicants.service');

class WebsiteNotConnectedError extends Error {
  constructor(action) {
    super(`Website ${action} is not connected yet`);
    this.name = 'WebsiteNotConnectedError';
    this.statusCode = 501;
  }
}

class WebsiteActionError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = 'WebsiteActionError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const POSTING_ERRORS = {
  requirement_not_found: ['Requirement not found', 404],
  requirement_closed: ['A closed or dropped requirement cannot be published', 409],
  not_found: ['This requirement is not on the website', 404],
};

function raise(result) {
  const [message, status] = POSTING_ERRORS[result.error] || ['Website update failed', 500];
  throw new WebsiteActionError(result.error, message, status);
}

const isConnected = () => client.isConfigured();

// Recruitment requirements predating the org backfill have no org_id; they belong to the master workspace.
async function orgFor(requirement, user) {
  if (user?.org_id) return user.org_id;
  if (requirement.org_id) return requirement.org_id;
  const master = await prisma.org.findFirst({ where: { is_master_workspace: true, status: 'active' }, select: { id: true } });
  return master?.id;
}

async function publishRequirementToWebsite(requirement, user) {
  if (!isConnected()) throw new WebsiteNotConnectedError('publishing');
  const orgId = await orgFor(requirement, user);
  const state = await postings.forRequirement(orgId, requirement.id);
  if (state.error) raise(state);
  // Republishing keeps any wording an admin already edited; a first publish starts from the requirement's own fields.
  const current = state.posting;
  const fields = current
    ? { title: current.title, department: current.department, location: current.location, employment_type: current.employment_type, public_description: current.public_description }
    : state.defaults;
  const result = await postings.publish(orgId, user.id, requirement.id, fields);
  if (result.error) raise(result);
  return { posting: result.posting, url: env.website.careersUrl };
}

async function unpublishRequirementFromWebsite(requirement, user) {
  if (!isConnected()) throw new WebsiteNotConnectedError('unpublishing');
  const orgId = await orgFor(requirement, user);
  const state = await postings.forRequirement(orgId, requirement.id);
  if (state.error) raise(state);
  if (!state.posting) raise({ error: 'not_found' });
  const result = await postings.setStatus(orgId, user.id, state.posting.id, 'closed');
  if (result.error) raise(result);
  return { posting: result.posting };
}

/** Returns applicants.addApplicant's result ({ applicant } or { error }). */
async function ingestWebsiteApplication(payload) {
  if (!isConnected()) throw new WebsiteNotConnectedError('application intake');
  return applicants.addApplicant(null, payload, { source: 'website' });
}

module.exports = {
  WebsiteNotConnectedError,
  WebsiteActionError,
  isConnected,
  publishRequirementToWebsite,
  unpublishRequirementFromWebsite,
  ingestWebsiteApplication,
};
