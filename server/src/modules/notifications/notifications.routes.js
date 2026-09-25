const express = require('express');
const { authenticate } = require('../../middleware/auth');
const controller = require('./notifications.controller');

const router = express.Router();
router.use(authenticate);

router.get('/', controller.list);
router.get('/unread-count', controller.unreadCount);
router.post('/read', controller.markRead);
router.post('/read-all', controller.markAllRead);
router.get('/preferences', controller.getPreferences);
router.put('/preferences', controller.setPreferences);
router.delete('/preferences', controller.resetPreferences);

module.exports = router;
