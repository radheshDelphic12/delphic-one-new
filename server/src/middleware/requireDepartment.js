const prisma = require('../config/db');
const { fail } = require('../utils/response');

// Gates a route to members of the named departments (case-insensitive), read
// fresh on every request so a department change applies immediately — same
// posture and same legacy User.department_id as requireItDepartment. Admins
// bypass.
function requireDepartment(names, message) {
  const allowed = new Set(names.map((n) => n.toLowerCase()));
  return async function departmentGate(req, res, next) {
    if (!req.user?.id) return fail(res, 401, 'Not authenticated');
    if (req.user.role === 'admin') return next();
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { department: { select: { name: true } } } });
      if (!allowed.has(user?.department?.name?.toLowerCase())) return fail(res, 403, message);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

// The meetings / interviews calendar: Sales, HR and Management only.
const MEETINGS_DEPARTMENTS = ['Sales', 'HR', 'Management'];
const requireMeetingsDepartment = requireDepartment(
  MEETINGS_DEPARTMENTS,
  'Access denied: the meetings calendar is limited to the Sales, HR and Management departments.'
);

module.exports = { requireDepartment, requireMeetingsDepartment, MEETINGS_DEPARTMENTS };
