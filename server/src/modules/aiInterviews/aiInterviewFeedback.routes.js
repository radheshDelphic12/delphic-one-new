// Feedback on a finished AI interview: the people on the hiring side read the AI's result and transcript and add their own view.
// One note per person, amended in place (PUT) or taken back (DELETE). Mounted next to the AI interview routes.
const express = require('express');
const { z } = require('zod');
const prisma = require('../../config/db');
const { authenticate, authorize } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');

const router = express.Router();
router.use(authenticate, requireMasterWorkspace);

const idParam = z.string().uuid();
const body = z.object({ feedback: z.string().trim().min(3, 'Write the feedback').max(3000) });
const FINISHED = ['completed', 'pending_review'];

async function finishedInterview(id) {
  const a = await prisma.aiInterview.findFirst({ where: { id, deleted_at: null }, select: { id: true, status: true, submission_id: true, outcome: true, score_percent: true } });
  if (!a) return { error: [404, 'AI interview not found'] };
  if (!FINISHED.includes(a.status)) return { error: [409, 'Feedback can be added once the candidate has finished the AI interview'] };
  return { a };
}

const serialize = (r, userId) => ({ id: r.id, feedback: r.feedback, by: { id: r.user.id, name: r.user.name }, mine: r.user_id === userId, created_at: r.created_at, updated_at: r.updated_at });

router.get('/:id/feedback', asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const rows = await prisma.aiInterviewFeedback.findMany({ where: { ai_interview_id: id }, orderBy: { created_at: 'asc' }, include: { user: { select: { id: true, name: true } } } });
  return ok(res, rows.map((r) => serialize(r, req.user.id)));
}));

router.put('/:id/feedback', authorize('admin', 'recruiter', 'sales'), asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const { feedback } = body.parse(req.body);
  const found = await finishedInterview(id);
  if (found.error) return fail(res, ...found.error);
  const row = await prisma.$transaction(async (tx) => {
    const saved = await tx.aiInterviewFeedback.upsert({
      where: { ai_interview_id_user_id: { ai_interview_id: id, user_id: req.user.id } },
      create: { ai_interview_id: id, user_id: req.user.id, feedback },
      update: { feedback },
      include: { user: { select: { id: true, name: true } } },
    });
    await tx.auditLog.create({
      data: { actor_id: req.user.id, action: 'ai_interview_feedback', entity_type: 'ai_interview', entity_id: id, reason: 'Feedback on the AI interview', org_id: req.user.org_id || null, snapshot: { submission_id: found.a.submission_id, outcome: found.a.outcome, score_percent: found.a.score_percent != null ? Number(found.a.score_percent) : null } },
    });
    return saved;
  });
  return ok(res, serialize(row, req.user.id));
}));

router.delete('/:id/feedback', authorize('admin', 'recruiter', 'sales'), asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  await prisma.aiInterviewFeedback.deleteMany({ where: { ai_interview_id: id, user_id: req.user.id } });
  return ok(res, { deleted: true });
}));

module.exports = router;
