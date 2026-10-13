const express = require('express');
const { z } = require('zod');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const client = require('./appsScriptClient');
const postings = require('./postings.service');
const submissions = require('./submissions.service');

// Marketing website control: publish requirements to /career and work the
// website's form submissions. Delphic Global admins only.
const router = express.Router();
router.use(authenticate, requireOrgMembership, requireMasterWorkspace, authorize('admin'));

const ERRORS = {
  not_found: [404, 'Not found'],
  requirement_not_found: [404, 'Requirement not found'],
  requirement_closed: [409, 'A closed or dropped requirement cannot be published'],
  wrong_form: [422, 'That conversion does not apply to this form'],
  already_handled: [409, 'This submission has already been handled'],
  requirement_not_in_progress: [409, 'Only in-progress requirements take applicants'],
  duplicate_applicant: [409, 'This person has already applied to that requirement'],
};

function failFor(res, result) {
  if (result.error === 'invalid') {
    return fail(res, 422, 'Validation failed', result.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  const mapped = ERRORS[result.error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}

const send = (key, status = 200) => (res, result) => {
  if (result.error) return failFor(res, result);
  return status === 201 ? created(res, result[key] ?? result) : ok(res, result[key] ?? result);
};

// Readable without config so the page can say what is missing.
router.get('/status', (req, res) => ok(res, client.configStatus()));

router.use((req, res, next) => {
  if (!client.isConfigured()) return fail(res, 503, 'Website control is not configured on this server');
  return next();
});

const orgId = (req) => req.user.org_id;

// --- Job postings ---
router.get(
  '/postings',
  asyncHandler(async (req, res) => {
    const { status } = z.object({ status: z.enum(['published', 'closed']).optional() }).parse(req.query);
    return ok(res, await postings.list(orgId(req), { status }));
  })
);
router.get(
  '/postings/requirement/:requirementId',
  asyncHandler(async (req, res) => send()(res, await postings.forRequirement(orgId(req), req.params.requirementId)))
);
router.post(
  '/postings',
  asyncHandler(async (req, res) => {
    const body = postings.publicFieldsSchema.extend({ requirement_id: z.string().uuid() }).parse(req.body);
    const { requirement_id, ...fields } = body;
    return send('posting', 201)(res, await postings.publish(orgId(req), req.user.id, requirement_id, fields));
  })
);
router.patch(
  '/postings/:id',
  asyncHandler(async (req, res) => send('posting')(res, await postings.update(orgId(req), req.user.id, req.params.id, postings.updateSchema.parse(req.body))))
);
router.post('/postings/:id/close', asyncHandler(async (req, res) => send('posting')(res, await postings.setStatus(orgId(req), req.user.id, req.params.id, 'closed'))));
router.post('/postings/:id/reopen', asyncHandler(async (req, res) => send('posting')(res, await postings.setStatus(orgId(req), req.user.id, req.params.id, 'published'))));
router.post('/postings/:id/retry', asyncHandler(async (req, res) => send('posting')(res, await postings.retry(orgId(req), req.params.id))));

// --- Form submissions ---
router.get(
  '/submissions',
  asyncHandler(async (req, res) => {
    const result = await submissions.list(orgId(req), submissions.listQuerySchema.parse(req.query));
    return ok(res, result.data, { pagination: result.pagination, counts: result.counts });
  })
);
router.post('/submissions/sync', asyncHandler(async (req, res) => ok(res, await submissions.sync(orgId(req)))));
router.post('/submissions/:id/convert-lead', asyncHandler(async (req, res) => send(undefined, 201)(res, await submissions.convertToLead(orgId(req), req.user.id, req.params.id))));
router.post(
  '/submissions/:id/convert-profile',
  asyncHandler(async (req, res) =>
    send(undefined, 201)(res, await submissions.convertToProfile(orgId(req), req.user.id, req.params.id, submissions.convertProfileSchema.parse(req.body)))
  )
);
router.post(
  '/submissions/:id/to-applicant',
  asyncHandler(async (req, res) =>
    send(undefined, 201)(res, await submissions.toApplicant(orgId(req), req.user.id, req.params.id, submissions.toApplicantSchema.parse(req.body)))
  )
);
router.post('/submissions/:id/dismiss', asyncHandler(async (req, res) => send('submission')(res, await submissions.dismiss(orgId(req), req.user.id, req.params.id))));

module.exports = router;
