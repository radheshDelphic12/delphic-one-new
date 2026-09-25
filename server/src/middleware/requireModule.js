const prisma = require('../config/db');
const { fail } = require('../utils/response');

// Vertical modules (trading, leads, contracts, projects) are switched on per
// company via Org.enabled_modules. Core ERP is always available.
function requireModule(name) {
  return async (req, res, next) => {
    try {
      const org = await prisma.org.findUnique({ where: { id: req.user.org_id }, select: { enabled_modules: true } });
      if (!org || !org.enabled_modules.includes(name)) {
        return fail(res, 403, `The "${name}" module is not enabled for this organization`);
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = requireModule;
