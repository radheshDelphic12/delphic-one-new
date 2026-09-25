const express = require('express');
const { authenticate, authorize } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const { ok } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./pipeline.service');
const { boardQuerySchema } = require('./pipeline.validation');

const router = express.Router();
router.use(authenticate, requireMasterWorkspace);

router.get(
  '/board',
  authorize('admin', 'sales', 'recruiter', 'bda'),
  asyncHandler(async (req, res) => {
    const query = boardQuerySchema.parse(req.query);
    const data = await service.getBoard(req.user, query);
    return ok(res, data);
  })
);

module.exports = router;
