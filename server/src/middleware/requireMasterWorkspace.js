const prisma = require('../config/db');
const { fail } = require('../utils/response');

// Gates the strategic/recruitment layer (accounts/requirements/profiles/
// submissions/pipeline, reports, analytics, financials) to the group's
// master workspace (Delphic Global) only — see Org.is_master_workspace.
// Re-read from the DB on every request, same posture as requireModule() /
// authorizeSuperadmin / authorizeGroupSuperadmin, so a flag flip takes
// effect on the very next request rather than waiting for a fresh token.
//
// A missing org_id is passed through, not blocked: several of the routers
// this guards (accounts, requirements, profiles, submissions, pipeline,
// interviews) still only apply bare `authenticate`, not
// `requireOrgMembership`, and middleware/auth.js's own resolveOrgContext
// already documents "no org context -> today's global-role behavior" as
// the deliberate fallback for any actor without a resolved org (a token
// issued before Phase 1, or a user with no OrgMembership). This gate only
// ever narrows access for someone WITH a resolved, non-master org — it
// must not newly block everyone that older, org-oblivious code already let
// through.
function requireMasterWorkspace(req, res, next) {
  if (!req.user?.org_id) return next();
  return prisma.org
    .findUnique({ where: { id: req.user.org_id }, select: { is_master_workspace: true } })
    .then((org) => {
      if (org && !org.is_master_workspace) return fail(res, 403, 'This is only available for the master workspace');
      return next();
    })
    .catch(next);
}

module.exports = requireMasterWorkspace;
