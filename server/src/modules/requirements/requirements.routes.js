const express = require('express');
const { can } = require('../../lib/permissions');
const { authenticate, authorizeSuperadmin } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const lockCheck = require('../../middleware/lockCheck');
const controller = require('./requirements.controller');

const router = express.Router();

router.use(authenticate, requireMasterWorkspace);

router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.get('/:id/history', controller.history);
router.get('/:id/activity', controller.activity);
router.get('/:id/assignments', controller.assignments);
router.get('/:id/seats', controller.getSeats);

router.post('/', can('requirements.create', 'sales', 'admin'), controller.create);
router.patch('/:id', can('requirements.update', 'sales', 'admin'), lockCheck('requirements'), controller.update);
router.delete('/:id', can('requirements.delete', 'sales', 'admin'), controller.remove);
router.post('/:id/status', can('requirements.update', 'sales', 'admin'), controller.changeStatus);
router.post('/:id/tat/extend', can('requirements.update', 'sales', 'admin'), controller.extendTat);
router.post('/:id/status/override', authorizeSuperadmin, controller.changeStatusOverride);
router.post('/:id/assign', can('requirements.update', 'sales', 'admin'), controller.assign);
router.post('/:id/unassign', can('requirements.update', 'sales', 'admin'), controller.unassign);
router.post('/:id/seats', can('requirements.update', 'sales', 'admin'), controller.addSeat);

module.exports = router;
