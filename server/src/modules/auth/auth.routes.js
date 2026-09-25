const express = require('express');
const { authenticate } = require('../../middleware/auth');
const controller = require('./auth.controller');

const router = express.Router();

router.post('/login', controller.login);
router.get('/workspace/:slug', controller.workspace);
router.post('/refresh', controller.refresh);
router.post('/change-password', authenticate, controller.changePassword);
router.post('/switch-org', authenticate, controller.switchOrg);

module.exports = router;
