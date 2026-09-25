const express = require('express');
const { authenticate, authorize, authorizeSuperadmin, loadSuperadminFlag } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const lockCheck = require('../../middleware/lockCheck');
const controller = require('./accounts.controller');

const router = express.Router();

router.use(authenticate, requireMasterWorkspace);

router.get('/', controller.list);
router.get('/specializations', controller.listSpecializations);
router.get('/:id', controller.getOne);
router.get('/:id/history', controller.history);
router.post('/', authorize('bda', 'admin'), controller.create);
router.patch('/:id', authorize('bda', 'admin'), loadSuperadminFlag, lockCheck('accounts'), controller.update);
router.post('/:id/stage', authorize('bda', 'admin'), controller.changeStage);
router.post('/:id/stage/override', authorizeSuperadmin, controller.changeStageOverride);
router.post('/:id/meeting', authorize('bda', 'admin'), controller.updateMeeting);
router.post('/:id/classify', authorize('bda', 'admin'), controller.classify);

module.exports = router;
