const express = require('express');
const { authenticate, authorize, authorizeSuperadmin, loadSuperadminFlag } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const lockCheck = require('../../middleware/lockCheck');
const controller = require('./submissions.controller');

const router = express.Router();

router.use(authenticate, requireMasterWorkspace);

router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.get('/:id/history', controller.history);

router.post('/', authorize('recruiter', 'sales', 'admin'), controller.create);
router.patch('/:id', authorize('recruiter', 'admin'), lockCheck('submissions'), controller.update);
router.post('/:id/stage', authorize('recruiter', 'sales', 'admin'), loadSuperadminFlag, lockCheck('submissions'), controller.changeStage);
router.post('/:id/stage/override', authorizeSuperadmin, controller.changeStageOverride);
router.post('/:id/interview-rounds', authorize('recruiter', 'sales', 'admin'), controller.addRound);

module.exports = router;
