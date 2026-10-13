/**
 * Website integration - STUB. Intentionally not implemented here: the website side (publishing an in-progress requirement
 * as a job post, and receiving applications from the careers page / LinkedIn links) is built end to end by another
 * developer with application scripts. These are the seams they plug into; until then each call reports "not connected".
 *
 * Contract the website developer is expected to follow:
 *  - publishRequirementToWebsite(requirement)   publishes {title, job_description, experience_min/max, budget_min/max (only when
 *                                               set), work_mode, work_location} and returns { url }.
 *  - unpublishRequirementFromWebsite(requirement)
 *  - ingestWebsiteApplication(payload)          payload = { requirement_id, name, email, phone, experience_years }; the
 *                                               implementation should end by calling applicants.service.addApplicant(...,
 *                                               { source: 'website' }) so the person lands in the applicant pool.
 */
class WebsiteNotConnectedError extends Error {
  constructor(action) {
    super(`Website ${action} is not connected yet`);
    this.name = 'WebsiteNotConnectedError';
    this.statusCode = 501;
  }
}

async function publishRequirementToWebsite() {
  throw new WebsiteNotConnectedError('publishing');
}

async function unpublishRequirementFromWebsite() {
  throw new WebsiteNotConnectedError('unpublishing');
}

async function ingestWebsiteApplication() {
  throw new WebsiteNotConnectedError('application intake');
}

module.exports = { WebsiteNotConnectedError, publishRequirementToWebsite, unpublishRequirementFromWebsite, ingestWebsiteApplication };
