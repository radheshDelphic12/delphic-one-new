const express = require('express');
const { authenticate } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const controller = require('./submissions.controller');

const router = express.Router();

router.use(authenticate, requireMasterWorkspace);

// Open to any signed-in user: the service decides (manager of the round, its scheduler, or an interviewer assigned to it).
router.patch('/:id', controller.updateRound);

module.exports = router;
