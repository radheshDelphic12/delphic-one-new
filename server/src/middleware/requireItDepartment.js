const prisma = require('../config/db');
const { fail } = require('../utils/response');

// Gates the itemized "IT timesheet" view (my-log + Excel export) to members
// of the IT department, matching org scope — checked on every request, same
// posture as requireModule()/requireMasterWorkspace/authorizeSuperadmin so a
// department change takes effect on the very next request, not next login.
// Admins bypass: the spec's "Admin/Lead" summary/export needs to see every
// IT member's log, not just their own.
//
// Uses the legacy User.department_id (already returned by GET /users/me and
// already relied on client-side) rather than the newer per-org
// OrgMembership.department_id, so no change is needed to expose it to the
// client — see client/src/lib/authContext.jsx, which already passes
// `department` straight through from that response.
async function requireItDepartment(req, res, next) {
  if (!req.user?.id) return fail(res, 401, 'Not authenticated');
  if (req.user.role === 'admin') return next();
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { department: { select: { name: true } } },
    });
    if (user?.department?.name?.toLowerCase() !== 'it') {
      return fail(res, 403, 'Access denied: the timesheet module is restricted to IT department personnel only.');
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = requireItDepartment;
