const express = require('express');
const { authenticate } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const controller = require('./interviews.controller');

const router = express.Router();
router.use(authenticate, requireMasterWorkspace);

router.get('/', controller.list);
router.post('/:id/feedback', controller.submitFeedback);
router.post('/:id/cancel', controller.cancel);

module.exports = router;
