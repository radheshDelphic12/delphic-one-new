const express = require('express');
const { authenticate, authorize, authorizeSuperadmin } = require('../../middleware/auth');
const controller = require('./admin.controller');

const router = express.Router();
router.use(authenticate);

// Superadmin-only record deletion / restore. `authorizeSuperadmin` is applied
// per-route (not router-wide) so the admin/bda `unlock` route below is untouched.
router.get('/deleted', authorizeSuperadmin, controller.listDeleted);
router.get('/audit', authorizeSuperadmin, controller.listAudit);
router.post('/:entity_type/:entity_id/delete', authorizeSuperadmin, controller.softDelete);
router.post('/:entity_type/:entity_id/restore', authorizeSuperadmin, controller.restore);

router.post('/:entity_type/:entity_id/unlock', authorize('admin', 'bda'), controller.unlock);

module.exports = router;
