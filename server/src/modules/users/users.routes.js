const express = require('express');
const { authenticate, authorize, loadSuperadminFlag, requireOrgMembership } = require('../../middleware/auth');
const controller = require('./users.controller');

const router = express.Router();

router.use(authenticate);

router.get('/me', requireOrgMembership, controller.me);
router.get('/me/activity', requireOrgMembership, controller.myActivity);
// Any authenticated user — powers filter bars and owner / brought-by / POC pickers.
router.get('/directory', requireOrgMembership, controller.directory);
router.get('/', requireOrgMembership, authorize('admin', 'sales', 'bda'), controller.list);
router.get('/:id', requireOrgMembership, authorize('admin'), controller.getOne);
router.post('/', requireOrgMembership, authorize('admin'), controller.create);
router.patch('/:id', requireOrgMembership, authorize('admin'), loadSuperadminFlag, controller.update);

module.exports = router;
