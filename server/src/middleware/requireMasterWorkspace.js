const prisma = require('../config/db');
const { fail } = require('../utils/response');

// Gates the strategic/recruitment layer (accounts/requirements/profiles/
// submissions/pipeline, reports, analytics, financials) to the group's
// master workspace (Delphic Global) only — see Org.is_master_workspace.
// Re-read from the DB on every request, same posture as requireModule() /
// authorizeSuperadmin / authorizeGroupSuperadmin, so a flag flip takes
// effect on the very next request rather than waiting for a fresh token.
//
// A missing org context is a hard 403. login/refresh issue `org_id: null`
// to anyone without an active OrgMembership — which includes an offboarded
// employee whose memberships were all ended but whose User row is still
// active. Passing that through let ex-members keep reading candidates, CVs
// and client data after they left. authenticate's resolveOrgContext only
// sets org_membership_id for an *active* membership, so requiring both
// fields means "currently employed in the master workspace".
function requireMasterWorkspace(req, res, next) {
  if (!req.user?.org_id || !req.user?.org_membership_id) {
    return fail(res, 403, 'Active organization membership required');
  }
  return isMasterWorkspace(req.user.org_id)
    .then((isMaster) => {
      if (!isMaster) return fail(res, 403, 'This is only available for the master workspace');
      return next();
    })
    .catch(next);
}

async function isMasterWorkspace(orgId) {
  if (!orgId) return false;
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { is_master_workspace: true, status: true } });
  return Boolean(org && org.is_master_workspace && org.status === 'active');
}

module.exports = requireMasterWorkspace;
module.exports.isMasterWorkspace = isMasterWorkspace;
