const express = require('express');
const { authenticate } = require('../../middleware/auth');
const controller = require('./comments.controller');

const router = express.Router();
router.use(authenticate);

router.get('/', controller.list);
router.post('/', controller.create);

module.exports = router;
