const prisma = require('../config/db');
const { fail } = require('../utils/response');

const MODELS = {
  accounts: 'account',
  requirements: 'requirement',
  requirement_seats: 'requirementSeat',
  submissions: 'submission',
};

function lockCheck(table) {
  const model = MODELS[table] || table;
  return async (req, res, next) => {
    try {
      const row = await prisma[model].findUnique({ where: { id: req.params.id }, select: { is_locked: true } });
      if (!row) return fail(res, 404, 'Not found');
      // A superadmin (flag resolved by loadSuperadminFlag upstream) may edit locked rows.
      if (row.is_locked && !req.user?.is_superadmin) return fail(res, 403, 'Record is locked');
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = lockCheck;
