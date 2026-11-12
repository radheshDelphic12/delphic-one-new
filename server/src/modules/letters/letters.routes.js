const express = require('express');
const { z } = require('zod');
const { authenticate, requireOrgMembership } = require('../../middleware/auth');
const { can, canAny } = require('../../lib/permissions');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const prisma = require('../../config/db');
const service = require('./letters.service');
const { letterPdf } = require('./letters.pdf');

// HR letters. Which permission each route needs is in lib/access/routeRules.js (letters.view / letters.create / letters.manage).
const router = express.Router();
router.use(authenticate, requireOrgMembership);

// In a company on the permission model the central route table decides; in a company still on the old roles these guards do (admin only).
const mayRead = canAny(['letters.view', 'letters.create'], 'admin');
const mayIssue = can('letters.create', 'admin');
const mayManage = can('letters.manage', 'admin');

const ERRORS = {
  not_found: [404, 'Not found'],
  template_not_found: [404, 'That template was not found'],
  template_inactive: [409, 'That template is switched off'],
  recipient_required: [422, 'Choose who the letter is for'],
  recipient_not_found: [404, 'That person or vendor is not part of this company'],
  already_cancelled: [409, 'This letter is already cancelled'],
};
const problem = (res, r) => {
  if (r.error === 'missing_fields') return fail(res, 422, `Fill these first: ${r.missing.join(', ')}`, { missing: r.missing });
  if (r.error === 'bad_serial_format') return fail(res, 422, r.message);
  const [status, message] = ERRORS[r.error] || [400, 'Bad request'];
  return fail(res, status, message);
};
const uuid = z.string().uuid();
const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const listQuery = z.object({
  kind: z.string().max(40).optional(),
  status: z.enum(['issued', 'cancelled']).optional(),
  org_membership_id: uuid.optional(),
  account_id: uuid.optional(),
  q: z.string().max(100).optional(),
  from: dayStr.optional(),
  to: dayStr.optional(),
});

// ---- templates (letters.manage to change) ------------------------------------------------------------------------------
router.get('/fields', mayRead, asyncHandler(async (req, res) => ok(res, service.fieldCatalog())));
router.get('/templates', mayRead, asyncHandler(async (req, res) => ok(res, await service.listTemplates(req.user.org_id, { includeInactive: req.query.all === '1' }))));
router.post('/templates', mayManage, asyncHandler(async (req, res) => {
  const r = await service.createTemplate(req.user.org_id, req.user, service.templateSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : created(res, r.template);
}));
router.patch('/templates/:id', mayManage, asyncHandler(async (req, res) => {
  const r = await service.updateTemplate(req.user.org_id, uuid.parse(req.params.id), service.templateUpdateSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : ok(res, r.template);
}));
router.delete('/templates/:id', mayManage, asyncHandler(async (req, res) => {
  const r = await service.removeTemplate(req.user.org_id, uuid.parse(req.params.id));
  return r.error ? problem(res, r) : ok(res, r);
}));

// ---- issuing (letters.create) and reading (letters.view) ---------------------------------------------------------------
router.get('/recipients', mayIssue, asyncHandler(async (req, res) => ok(res, await service.searchRecipients(req.user.org_id, { type: req.query.type === 'vendor' ? 'vendor' : 'employee', q: req.query.q }))));
router.post('/preview', mayIssue, asyncHandler(async (req, res) => {
  const r = await service.preview(req.user.org_id, service.letterInputSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : ok(res, r.preview);
}));
router.post('/', mayIssue, asyncHandler(async (req, res) => {
  const r = await service.issue(req.user.org_id, req.user, service.letterInputSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : created(res, r.letter);
}));
router.get('/', mayRead, asyncHandler(async (req, res) => ok(res, await service.list(req.user.org_id, listQuery.parse(req.query)))));
router.get('/:id', mayRead, asyncHandler(async (req, res) => {
  const r = await service.get(req.user.org_id, uuid.parse(req.params.id));
  return r ? ok(res, r.letter) : problem(res, { error: 'not_found' });
}));
router.get('/:id/pdf', mayRead, asyncHandler(async (req, res) => {
  const r = await service.get(req.user.org_id, uuid.parse(req.params.id));
  if (!r) return problem(res, { error: 'not_found' });
  const org = await prisma.org.findUnique({ where: { id: req.user.org_id }, select: { name: true } });
  const pdf = await letterPdf(r.raw, { companyName: org?.name || '' });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${r.raw.serial_number.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf"`, 'Cache-Control': 'private, no-store' });
  return res.send(pdf);
}));
router.post('/:id/cancel', mayIssue, asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Write why it is cancelled').max(300) }).parse(req.body || {});
  const r = await service.cancel(req.user.org_id, req.user, uuid.parse(req.params.id), reason);
  return r.error ? problem(res, r) : ok(res, r.letter);
}));

module.exports = router;
