const express = require('express');
const { authenticate, authorizeSuperadmin } = require('../../middleware/auth');
const { ok } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const prisma = require('../../config/db');

// Super-admin-only helpers that sit outside any company workspace.
const router = express.Router();

// "Who is this token?" for the database snapshot viewer (dbviewer/), which runs as a separate container, holds no JWT secret
// and has no database access: it forwards the caller's Authorization header here and lets in only a 200. authorizeSuperadmin
// re-reads the flag from the DB on every call, so a demoted super admin loses the viewer on the next (uncached) check.
router.get(
  '/whoami',
  authenticate,
  authorizeSuperadmin,
  asyncHandler(async (req, res) => {
    const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, name: true, email: true } });
    return ok(res, { id: u.id, name: u.name, email: u.email });
  })
);

module.exports = router;
