const express = require('express');
const { can, canOn } = require('../../lib/permissions');
const prisma = require('../../config/db');
const { authenticate, authorize } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const controller = require('./profiles.controller');

const router = express.Router();

router.use(authenticate, requireMasterWorkspace);

// Reads are open to every role (a BDA needs to see a candidate's attached CV,
// pipeline context, etc). Create / edit stay recruiter + admin.
router.get('/', authorize('recruiter', 'sales', 'admin', 'bda'), controller.list);
router.get('/:id', authorize('recruiter', 'sales', 'admin', 'bda'), controller.getOne);
router.get('/:id/submissions', authorize('recruiter', 'sales', 'admin', 'bda'), controller.submissions);
router.post('/', can('profiles.create', 'recruiter', 'admin'), controller.create);
router.patch('/:id', canOn('profiles.update', async (req) => (await prisma.profile.findUnique({ where: { id: req.params.id }, select: { added_by: true } }))?.added_by, 'recruiter', 'admin'), controller.update);

module.exports = router;
