const express = require('express');
const { can, canOn } = require('../../lib/permissions');
const prisma = require('../../config/db');
const { authenticate, authorizeSuperadmin, loadSuperadminFlag } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const lockCheck = require('../../middleware/lockCheck');
const controller = require('./submissions.controller');

const router = express.Router();

router.use(authenticate, requireMasterWorkspace);

router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.get('/:id/history', controller.history);
router.get('/:id/interview-plan', controller.interviewPlan);

router.post('/', can('submissions.create', 'recruiter', 'sales', 'admin'), controller.create);
router.patch('/:id', canOn('submissions.update', async (req) => (await prisma.submission.findUnique({ where: { id: req.params.id }, select: { submitted_by: true } }))?.submitted_by, 'recruiter', 'admin'), lockCheck('submissions', { allowFields: ['actual_joining_date'] }), controller.update);
router.post('/:id/stage', canOn('submissions.update', async (req) => (await prisma.submission.findUnique({ where: { id: req.params.id }, select: { submitted_by: true } }))?.submitted_by, 'recruiter', 'sales', 'admin'), loadSuperadminFlag, lockCheck('submissions'), controller.changeStage);
router.post('/:id/stage/override', authorizeSuperadmin, controller.changeStageOverride);
router.post('/:id/candidate-feedback-message', can('meetings.schedule', 'recruiter', 'sales', 'admin'), controller.candidateFeedbackMessage);
router.post('/:id/interview-rounds', can('meetings.schedule', 'recruiter', 'sales', 'admin'), controller.addRound);

module.exports = router;
