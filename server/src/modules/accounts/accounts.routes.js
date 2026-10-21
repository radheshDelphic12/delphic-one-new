const express = require('express');
const { can, canAny } = require('../../lib/permissions');
const { authenticate, authorizeSuperadmin, loadSuperadminFlag } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const lockCheck = require('../../middleware/lockCheck');
const controller = require('./accounts.controller');

const router = express.Router();

router.use(authenticate, requireMasterWorkspace);

router.get('/', controller.list);
router.get('/specializations', controller.listSpecializations);
router.get('/:id', controller.getOne);
router.get('/:id/history', controller.history);
router.get('/:id/activity', controller.activity);
router.post('/', can('accounts.create', 'bda', 'admin'), controller.create);
router.patch('/:id', can('accounts.update', 'bda', 'admin'), loadSuperadminFlag, lockCheck('accounts'), controller.update);
router.post('/:id/stage', canAny(['meetings.schedule', 'accounts.update'], 'bda', 'admin'), controller.changeStage);
router.post('/:id/stage/override', authorizeSuperadmin, controller.changeStageOverride);
router.post('/:id/meeting', canAny(['meetings.schedule', 'accounts.update'], 'bda', 'admin'), controller.updateMeeting);
router.get('/:id/meetings', controller.listClientMeetings);
router.post('/:id/meetings', canAny(['meetings.schedule', 'accounts.update'], 'bda', 'admin'), controller.createClientMeeting);
router.patch('/:id/meetings/:meetingId', canAny(['meetings.schedule', 'accounts.update'], 'bda', 'admin'), controller.updateClientMeeting);
router.delete('/:id/meetings/:meetingId', canAny(['meetings.schedule', 'accounts.update'], 'bda', 'admin'), controller.deleteClientMeeting);
router.post('/:id/classify', canAny(['accounts.update', 'accounts.create', 'vendors.onboard'], 'bda', 'admin'), controller.classify);

module.exports = router;
