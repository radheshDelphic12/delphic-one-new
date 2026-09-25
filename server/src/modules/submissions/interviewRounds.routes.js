const express = require('express');
const { authenticate, authorize } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const controller = require('./submissions.controller');

const router = express.Router();

router.use(authenticate, requireMasterWorkspace);

router.patch('/:id', authorize('recruiter', 'sales', 'admin'), controller.updateRound);

module.exports = router;
