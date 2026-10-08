const express = require('express');
const { authenticate } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const { requireMeetingsDepartment } = require('../../middleware/requireDepartment');
const controller = require('./interviews.controller');

const router = express.Router();
router.use(authenticate, requireMasterWorkspace);

// The calendar feed (interviews + client meetings) is for Sales, HR and
// Management; feedback / cancel stay open to the interviewers themselves.
router.get('/', requireMeetingsDepartment, controller.list);
router.post('/:id/feedback', controller.submitFeedback);
router.post('/:id/cancel', controller.cancel);

module.exports = router;
