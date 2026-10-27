const prisma = require('../config/db');
const { fail } = require('../utils/response');

const MODELS = {
  accounts: 'account',
  requirements: 'requirement',
  requirement_seats: 'requirementSeat',
  submissions: 'submission',
};

// `allowFields`: fields anyone allowed to edit the record may still change while it is locked, as long as the request carries nothing else
// (a closed candidate's actual joining date is entered after the ticket is closed).
function lockCheck(table, { allowFields = [] } = {}) {
  const model = MODELS[table] || table;
  return async (req, res, next) => {
    try {
      const row = await prisma[model].findUnique({ where: { id: req.params.id }, select: { is_locked: true } });
      if (!row) return fail(res, 404, 'Not found');
      // A superadmin (flag resolved by loadSuperadminFlag upstream) may edit locked rows.
      if (row.is_locked && !req.user?.is_superadmin) {
        const keys = Object.keys(req.body || {});
        if (!(allowFields.length && keys.length && keys.every((k) => allowFields.includes(k)))) return fail(res, 403, 'Record is locked');
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = lockCheck;
