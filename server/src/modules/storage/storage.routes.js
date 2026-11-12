const express = require('express');
const { authenticate, authorizeGroupSuperadmin } = require('../../middleware/auth');
const { ok } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./storage.service');

// Group Dashboard > Settings > Storage (group superadmin only): disk, uploaded files and database size.
const router = express.Router();
router.use(authenticate, authorizeGroupSuperadmin);
router.get('/', asyncHandler(async (req, res) => ok(res, await service.report({ fresh: req.query.fresh === '1' }))));
module.exports = router;
