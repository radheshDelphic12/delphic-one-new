const express = require('express');
const { z } = require('zod');
const { authenticate, requireOrgMembership } = require('../../middleware/auth');
const { can, canAny } = require('../../lib/permissions');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./seating.service');

// People > Seating. Seeing it needs People; adding desks and seating people needs HR settings (lib/access/routeRules.js).
const router = express.Router();
router.use(authenticate, requireOrgMembership);
const mayView = canAny(['people.view', 'hr_settings.view', 'hr_settings.update'], 'admin');
const mayEdit = can('hr_settings.update', 'admin');
const ERRORS = {
  not_found: [404, 'Desk not found'], location_not_found: [404, 'Office not found'], label_taken: [409, 'That desk number is already used in this office'],
  seat_taken: [409, 'Someone sits at this desk; move them first'], seat_inactive: [409, 'This desk is switched off'], person_not_found: [404, 'Person not found'],
};
const problem = (res, r) => { const [s, m] = ERRORS[r.error] || [400, 'Bad request']; return fail(res, s, m); };
const uuid = z.string().uuid();

router.get('/', mayView, asyncHandler(async (req, res) => ok(res, await service.overview(req.user.org_id, req.query.location_id ? uuid.parse(req.query.location_id) : undefined))));
router.post('/seats', mayEdit, asyncHandler(async (req, res) => {
  const r = await service.addSeats(req.user.org_id, service.addSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : created(res, r);
}));
router.patch('/seats/:id', mayEdit, asyncHandler(async (req, res) => {
  const r = await service.updateSeat(req.user.org_id, uuid.parse(req.params.id), service.updateSchema.parse(req.body || {}));
  return r.error ? problem(res, r) : ok(res, r.seat);
}));
router.delete('/seats/:id', mayEdit, asyncHandler(async (req, res) => {
  const r = await service.removeSeat(req.user.org_id, uuid.parse(req.params.id));
  return r.error ? problem(res, r) : ok(res, r);
}));
router.put('/seats/:id/person', mayEdit, asyncHandler(async (req, res) => {
  const r = await service.assign(req.user.org_id, uuid.parse(req.params.id), service.assignSchema.parse(req.body || {}).org_membership_id);
  return r.error ? problem(res, r) : ok(res, r);
}));

module.exports = router;
