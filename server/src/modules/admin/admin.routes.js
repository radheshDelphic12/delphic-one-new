const express = require('express');
const { authenticate, authorize, authorizeSuperadmin } = require('../../middleware/auth');
const controller = require('./admin.controller');
const prisma = require('../../config/db');
const { hasPermission } = require('../../lib/permissions');

// A custom role that may delete a kind of record (Settings > Roles & permissions). Plain roles stay superadmin-only.
const DELETE_PERM = { account: 'accounts.delete', requirement: 'requirements.delete', profile: 'profiles.delete', invoice: 'financials.delete', expense_claim: 'financials.delete' };
const OWNER = {
  account: async (id) => (await prisma.account.findUnique({ where: { id }, select: { owner_id: true } }))?.owner_id,
  requirement: async (id) => (await prisma.requirement.findUnique({ where: { id }, select: { sales_owner_id: true } }))?.sales_owner_id,
  profile: async (id) => (await prisma.profile.findUnique({ where: { id }, select: { added_by: true } }))?.added_by,
};
async function authorizeDelete(req, res, next) {
  try {
    const perm = DELETE_PERM[req.params.entity_type];
    if (perm && req.user && hasPermission(req.user, perm) !== null) {
      const owner = OWNER[req.params.entity_type] ? await OWNER[req.params.entity_type](req.params.entity_id) : undefined;
      if (hasPermission(req.user, perm, owner === undefined ? null : owner)) return next();
    }
    return authorizeSuperadmin(req, res, next);
  } catch (err) {
    return next(err);
  }
}

const router = express.Router();
router.use(authenticate);

// Superadmin-only record deletion / restore. `authorizeSuperadmin` is applied
// per-route (not router-wide) so the admin/bda `unlock` route below is untouched.
router.get('/deleted', authorizeSuperadmin, controller.listDeleted);
router.get('/audit', authorizeSuperadmin, controller.listAudit);
router.post('/:entity_type/:entity_id/delete', authorizeDelete, controller.softDelete);
router.post('/:entity_type/:entity_id/restore', authorizeSuperadmin, controller.restore);

router.post('/:entity_type/:entity_id/unlock', authorize('admin', 'bda'), controller.unlock);

module.exports = router;
