const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const env = require('../../config/env');
const parties = require('./parties.service');
const documents = require('./documents.service');
const leads = require('./leads.service');
const projects = require('./projects.service');
const people = require('./people.service');
const salaries = require('./salaries.service');
const ledger = require('./ledger.service');
const overviewSvc = require('./overview.service');
const financials = require('./financials.service');
const { authenticate, requireOrgMembership } = require('../../middleware/auth');
const requireModule = require('../../middleware/requireModule');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { zxAccess, zxAuthorize } = require('./access');
const core = require('./core.service');

const router = express.Router();
router.use(authenticate, requireOrgMembership, requireModule('zephyr'), zxAccess);

const ERRORS = {
  not_found: [404, 'Record not found'],
  duplicate: [409, 'That name already exists'],
  manual_value_required: [422, 'A manual valuation needs a value'],
  user_not_in_org: [422, 'That user is not a member of this company'],
  user_linked: [409, 'That user is already linked to another person'],
};

function failFor(res, result) {
  const mapped = ERRORS[result.error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}

const orgId = (req) => req.user.org_id;

router.get('/me', asyncHandler(async (req, res) => ok(res, await core.me(req))));

router.get('/settings', zxAuthorize('settings'), asyncHandler(async (req, res) => ok(res, await core.getSettings(orgId(req)))));
router.patch(
  '/settings',
  zxAuthorize('settings'),
  asyncHandler(async (req, res) => {
    const result = await core.updateSettings(orgId(req), req.user.id, core.settingsSchema.parse(req.body));
    return result.error ? failFor(res, result) : ok(res, result.settings);
  })
);

// Categories are read by anyone who can enter money; only admins edit them.
router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    if (!req.zx.caps.includes('ledger')) return fail(res, 403, 'Insufficient Zephyr role');
    const kind = ['revenue', 'expense'].includes(req.query.kind) ? req.query.kind : undefined;
    return ok(res, await core.listCategories(orgId(req), kind));
  })
);
router.post(
  '/categories',
  zxAuthorize('settings'),
  asyncHandler(async (req, res) => {
    const result = await core.createCategory(orgId(req), req.user.id, core.categoryCreateSchema.parse(req.body));
    return result.error ? failFor(res, result) : created(res, result.category);
  })
);
router.patch(
  '/categories/:id',
  zxAuthorize('settings'),
  asyncHandler(async (req, res) => {
    const result = await core.updateCategory(orgId(req), req.user.id, req.params.id, core.categoryUpdateSchema.parse(req.body));
    return result.error ? failFor(res, result) : ok(res, result.category);
  })
);
router.delete(
  '/categories/:id',
  zxAuthorize('settings'),
  asyncHandler(async (req, res) => {
    const result = await core.deleteCategory(orgId(req), req.user.id, req.params.id);
    return result.error ? failFor(res, result) : ok(res, { id: req.params.id });
  })
);

// --- People, assignments, salaries (Z4) ---
const PEOPLE_ERRORS = {
  not_found: [404, 'Person not found'],
  assignment_not_found: [404, 'Assignment not found'],
  project_not_found: [404, 'Project not found'],
  project_closed: [409, 'A completed or cancelled project cannot take new assignments'],
  admin_only_field: [403, 'Only an admin can change login access or pay'],
  pay_incomplete: [422, 'Set both a pay basis and a rate, or neither'],
  bad_dates: [422, 'The end date must be on or after the start date'],
  user_not_in_org: [422, 'That user is not a member of this company'],
  user_linked: [409, 'That user is already linked to another person'],
  vendor_invalid: [422, 'The contractor firm must be a vendor in the directory'],
  employee_vendor: [422, 'Only a contractor can belong to a vendor firm'],
  already_assigned: [409, 'This person is already assigned to that project'],
  over_allocated: [422, 'That would allocate more than 100% of the person\'s time'],
  not_draft: [409, 'Only a draft salary record can be changed'],
  not_approved: [409, 'The salary record is not approved'],
  already_paid: [409, 'A paid salary record cannot be reopened'],
  days_not_applicable: [422, 'Days apply only to daily-rate pay'],
  days_required: [422, 'Enter the days worked before approving a daily-rate slip'],
  deductions_exceed: [422, 'Deductions cannot be more than the gross pay'],
  split_total: [422, 'The project split must add up to 100%'],
  split_duplicate: [422, 'A project appears twice in the split'],
  future_date: [422, 'The paid date cannot be in the future'],
};
function failPeople(res, result) {
  const mapped = PEOPLE_ERRORS[result.error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}
const peopleCap = zxAuthorize('people');
const salariesCap = zxAuthorize('salaries');
const pctx = (req) => ({ isAdmin: req.zx.role === 'admin' });
const sendPerson = (res, result, status = 200) => (result.error ? failPeople(res, result) : ok(res, result.person, {}, status));

router.get('/people', peopleCap, asyncHandler(async (req, res) => ok(res, await people.list(orgId(req), pctx(req), people.listQuerySchema.parse(req.query)))));
router.post('/people', peopleCap, asyncHandler(async (req, res) => sendPerson(res, await people.create(orgId(req), req.user.id, pctx(req), people.createPersonSchema.parse(req.body)), 201)));
router.get('/people/:id', peopleCap, asyncHandler(async (req, res) => sendPerson(res, await people.get(orgId(req), pctx(req), req.params.id))));
router.patch('/people/:id', peopleCap, asyncHandler(async (req, res) => sendPerson(res, await people.update(orgId(req), req.user.id, pctx(req), req.params.id, people.updatePersonSchema.parse(req.body)))));
router.delete(
  '/people/:id',
  zxAuthorize('delete'),
  asyncHandler(async (req, res) => {
    const result = await people.remove(orgId(req), req.user.id, req.params.id);
    return result.error ? failPeople(res, result) : ok(res, { id: req.params.id });
  })
);
const sendOk = (res, result) => (result.error ? failPeople(res, result) : ok(res, { ok: true }));
router.post('/people/:id/assignments', peopleCap, asyncHandler(async (req, res) => sendOk(res, await people.addAssignment(orgId(req), req.user.id, req.params.id, people.assignmentCreateSchema.parse(req.body)))));
router.patch('/people/:id/assignments/:aid', peopleCap, asyncHandler(async (req, res) => sendOk(res, await people.updateAssignment(orgId(req), req.user.id, req.params.id, req.params.aid, people.assignmentUpdateSchema.parse(req.body)))));
router.delete('/people/:id/assignments/:aid', peopleCap, asyncHandler(async (req, res) => sendOk(res, await people.removeAssignment(orgId(req), req.user.id, req.params.id, req.params.aid))));

const sendRecord = (res, result, status = 200) => (result.error ? failPeople(res, result) : ok(res, result.record, {}, status));
router.get('/salaries', salariesCap, asyncHandler(async (req, res) => ok(res, await salaries.list(orgId(req), salaries.listQuerySchema.parse(req.query).month))));
router.post('/salaries/generate', salariesCap, asyncHandler(async (req, res) => ok(res, await salaries.generate(orgId(req), req.user.id, salaries.generateSchema.parse(req.body).month))));
router.patch('/salaries/:id', salariesCap, asyncHandler(async (req, res) => sendRecord(res, await salaries.update(orgId(req), req.user.id, req.params.id, salaries.updateSchema.parse(req.body)))));
router.post('/salaries/:id/approve', salariesCap, asyncHandler(async (req, res) => sendRecord(res, await salaries.approve(orgId(req), req.user.id, req.params.id))));
router.post('/salaries/:id/unapprove', salariesCap, asyncHandler(async (req, res) => sendRecord(res, await salaries.unapprove(orgId(req), req.user.id, req.params.id, salaries.unapproveSchema.parse(req.body).reason))));
router.post('/salaries/:id/pay', salariesCap, asyncHandler(async (req, res) => sendRecord(res, await salaries.pay(orgId(req), req.user.id, req.params.id, salaries.paySchema.parse(req.body || {}).paid_on))));
router.delete(
  '/salaries/:id',
  salariesCap,
  asyncHandler(async (req, res) => {
    const result = await salaries.remove(orgId(req), req.user.id, req.params.id);
    return result.error ? failPeople(res, result) : ok(res, { id: req.params.id });
  })
);

// The signed-in person's own assigned projects and slips (staff, and managers who are on the roster).
router.get('/my-work', zxAuthorize('myWork'), asyncHandler(async (req, res) => ok(res, await salaries.myWork(orgId(req), req.zx.person_id))));

// --- Client / Vendor directory (Z1) ---
const PARTY_ERRORS = { not_found: [404, 'Client / vendor not found'], duplicate_name: [409, 'A client or vendor with that name already exists'] };
function failParty(res, result) {
  const mapped = PARTY_ERRORS[result.error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}

router.get(
  '/parties',
  zxAuthorize('parties'),
  asyncHandler(async (req, res) => {
    const result = await parties.list(orgId(req), parties.listQuerySchema.parse(req.query));
    return ok(res, result.data, { pagination: result.pagination, summary: result.summary });
  })
);
router.post(
  '/parties/import',
  zxAuthorize('parties'),
  asyncHandler(async (req, res) => ok(res, await parties.importRows(orgId(req), req.user.id, parties.importSchema.parse(req.body).rows)))
);
router.post(
  '/parties',
  zxAuthorize('parties'),
  asyncHandler(async (req, res) => {
    const result = await parties.create(orgId(req), req.user.id, parties.createPartySchema.parse(req.body));
    return result.error ? failParty(res, result) : created(res, result.party);
  })
);
router.get(
  '/parties/:id',
  zxAuthorize('parties'),
  asyncHandler(async (req, res) => {
    const result = await parties.get(orgId(req), req.params.id);
    return result.error ? failParty(res, result) : ok(res, result.party);
  })
);
router.patch(
  '/parties/:id',
  zxAuthorize('parties'),
  asyncHandler(async (req, res) => {
    const result = await parties.update(orgId(req), req.user.id, req.params.id, parties.updatePartySchema.parse(req.body));
    return result.error ? failParty(res, result) : ok(res, result.party);
  })
);
router.delete(
  '/parties/:id',
  zxAuthorize('delete'),
  asyncHandler(async (req, res) => {
    const result = await parties.remove(orgId(req), req.user.id, req.params.id);
    return result.error ? failParty(res, result) : ok(res, { id: req.params.id });
  })
);

// --- Leads (Z2) ---
const LEAD_ERRORS = {
  not_found: [404, 'Lead not found'],
  lead_closed: [409, 'A won or lost lead can no longer be changed'],
  same_stage: [422, 'The lead is already in that stage'],
  lost_reason_required: [422, 'Say why the lead was lost'],
  party_not_found: [422, 'That client / vendor does not exist'],
  owner_invalid: [422, 'The owner must be an admin or a manager'],
  not_closed: [409, 'Only a won or lost lead can be reopened'],
  has_project: [409, 'This lead already became a project and cannot be reopened'],
};
function failLead(res, result) {
  if (result.error === 'invalid') return fail(res, 422, result.message || 'Validation failed');
  const mapped = LEAD_ERRORS[result.error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}
const leadsCap = zxAuthorize('leads');

router.get('/leads/owners', leadsCap, asyncHandler(async (req, res) => ok(res, await leads.listOwners(orgId(req)))));
router.get('/leads/summary', leadsCap, asyncHandler(async (req, res) => ok(res, await leads.summary(orgId(req)))));
router.get('/leads/follow-ups', leadsCap, asyncHandler(async (req, res) => ok(res, await leads.followUps(orgId(req)))));
router.get('/leads', leadsCap, asyncHandler(async (req, res) => ok(res, await leads.list(orgId(req), leads.listQuerySchema.parse(req.query)))));
router.post(
  '/leads',
  leadsCap,
  asyncHandler(async (req, res) => {
    const result = await leads.create(orgId(req), req.user.id, leads.createLeadSchema.parse(req.body));
    return result.error ? failLead(res, result) : created(res, result.lead);
  })
);
router.get(
  '/leads/:id',
  leadsCap,
  asyncHandler(async (req, res) => {
    const result = await leads.get(orgId(req), req.params.id);
    return result.error ? failLead(res, result) : ok(res, result.lead);
  })
);
router.patch(
  '/leads/:id',
  leadsCap,
  asyncHandler(async (req, res) => {
    const result = await leads.update(orgId(req), req.user.id, req.params.id, leads.updateLeadSchema.parse(req.body));
    return result.error ? failLead(res, result) : ok(res, result.lead);
  })
);
router.delete(
  '/leads/:id',
  zxAuthorize('delete'),
  asyncHandler(async (req, res) => {
    const result = await leads.remove(orgId(req), req.user.id, req.params.id);
    return result.error ? failLead(res, result) : ok(res, { id: req.params.id });
  })
);
router.post(
  '/leads/:id/stage',
  leadsCap,
  asyncHandler(async (req, res) => {
    const result = await leads.changeStage(orgId(req), req.user.id, req.params.id, leads.stageSchema.parse(req.body));
    return result.error ? failLead(res, result) : ok(res, result.lead);
  })
);
router.post(
  '/leads/:id/reopen',
  zxAuthorize('settings'),
  asyncHandler(async (req, res) => {
    const result = await leads.reopen(orgId(req), req.user.id, req.params.id, leads.reopenSchema.parse(req.body));
    return result.error ? failLead(res, result) : ok(res, result.lead);
  })
);
router.get(
  '/leads/:id/activities',
  leadsCap,
  asyncHandler(async (req, res) => {
    const result = await leads.listActivities(orgId(req), req.params.id);
    return result.error ? failLead(res, result) : ok(res, result.activities);
  })
);
router.post(
  '/leads/:id/activities',
  leadsCap,
  asyncHandler(async (req, res) => {
    const result = await leads.addActivity(orgId(req), req.user.id, req.params.id, leads.activitySchema.parse(req.body));
    return result.error ? failLead(res, result) : created(res, result.activity);
  })
);
router.patch(
  '/leads/:id/activities/:activityId',
  leadsCap,
  asyncHandler(async (req, res) => {
    const result = await leads.setFollowUpDone(orgId(req), req.params.id, req.params.activityId, req.body?.follow_up_done);
    return result.error ? failLead(res, result) : ok(res, result.activity);
  })
);

// --- Projects (Z3) ---
const PROJECT_ERRORS = {
  not_found: [404, 'Project not found'],
  milestone_not_found: [404, 'Milestone not found'],
  work_order_not_found: [404, 'Work order not found'],
  lead_not_found: [404, 'Lead not found'],
  lead_not_won: [409, 'Only a won lead can become a project'],
  lead_converted: [409, 'This lead already became a project'],
  project_closed: [409, 'A completed or cancelled project can no longer be changed'],
  party_not_found: [422, 'That client does not exist'],
  party_not_client: [422, 'A client project needs a client, not a vendor-only party'],
  manager_invalid: [422, 'The project manager must be an admin or a manager'],
  bad_dates: [422, 'The end date must be on or after the start date'],
  milestones_incomplete: [422, 'Finish every milestone before completing the project'],
  not_done: [422, 'Only a 100% done milestone can be marked billed'],
  milestone_billed: [409, 'A billed milestone cannot be deleted'],
  vendor_invalid: [422, 'Pick an active vendor or subcontractor'],
  billed_exceeds: [422, 'Billed to date cannot be more than the work order value'],
  cancel_billed: [409, 'A work order with billing against it cannot be cancelled or deleted'],
};
function failProject(res, result) {
  const mapped = PROJECT_ERRORS[result.error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}
const projectsView = zxAuthorize('projects');
const projectsEdit = zxAuthorize('projectsEdit');
const sendProject = (res, result, status = 200) => (result.error ? failProject(res, result) : ok(res, result.project, {}, status));

router.get('/projects/summary', projectsView, asyncHandler(async (req, res) => ok(res, await projects.summary(orgId(req)))));
router.get('/projects', projectsView, asyncHandler(async (req, res) => ok(res, await projects.list(orgId(req), projects.listQuerySchema.parse(req.query)))));
router.post(
  '/projects/from-lead/:leadId',
  projectsEdit,
  leadsCap,
  asyncHandler(async (req, res) =>
    sendProject(res, await projects.createFromLead(orgId(req), req.user.id, req.params.leadId, projects.fromLeadSchema.parse(req.body || {})), 201)
  )
);
router.post('/projects', projectsEdit, asyncHandler(async (req, res) => sendProject(res, await projects.create(orgId(req), req.user.id, projects.createProjectSchema.parse(req.body)), 201)));
router.get('/projects/:id', projectsView, asyncHandler(async (req, res) => sendProject(res, await projects.get(orgId(req), req.params.id))));
router.patch('/projects/:id', projectsEdit, asyncHandler(async (req, res) => sendProject(res, await projects.update(orgId(req), req.user.id, req.params.id, projects.updateProjectSchema.parse(req.body)))));
router.delete(
  '/projects/:id',
  zxAuthorize('delete'),
  asyncHandler(async (req, res) => {
    const result = await projects.remove(orgId(req), req.user.id, req.params.id);
    return result.error ? failProject(res, result) : ok(res, { id: req.params.id });
  })
);
router.post('/projects/:id/milestones', projectsEdit, asyncHandler(async (req, res) => sendProject(res, await projects.addMilestone(orgId(req), req.user.id, req.params.id, projects.milestoneCreateSchema.parse(req.body)), 201)));
router.patch('/projects/:id/milestones/:mid', projectsEdit, asyncHandler(async (req, res) => sendProject(res, await projects.updateMilestone(orgId(req), req.user.id, req.params.id, req.params.mid, projects.milestoneUpdateSchema.parse(req.body)))));
router.delete('/projects/:id/milestones/:mid', projectsEdit, asyncHandler(async (req, res) => sendProject(res, await projects.removeMilestone(orgId(req), req.user.id, req.params.id, req.params.mid))));
router.post('/projects/:id/work-orders', projectsEdit, asyncHandler(async (req, res) => sendProject(res, await projects.addWorkOrder(orgId(req), req.user.id, req.params.id, projects.workOrderCreateSchema.parse(req.body)), 201)));
router.patch('/projects/:id/work-orders/:wid', projectsEdit, asyncHandler(async (req, res) => sendProject(res, await projects.updateWorkOrder(orgId(req), req.user.id, req.params.id, req.params.wid, projects.workOrderUpdateSchema.parse(req.body)))));
router.delete('/projects/:id/work-orders/:wid', projectsEdit, asyncHandler(async (req, res) => sendProject(res, await projects.removeWorkOrder(orgId(req), req.user.id, req.params.id, req.params.wid))));

// --- Money: ledger (Z5), overview (Z6), financials (Z7) ---
const MONEY_ERRORS = {
  not_found: [404, 'Record not found'],
  future_actual: [422, 'An actual entry cannot be dated in the future. Mark it planned instead'],
  category_invalid: [422, 'Pick an active category of the same kind (revenue or expense)'],
  wo_expense_only: [422, 'Only an expense can be linked to a work order'],
  milestone_revenue_only: [422, 'Only revenue can be linked to a milestone'],
  link_not_found: [422, 'A linked project, party, work order or milestone does not exist'],
  link_mismatch: [422, 'The linked work order or milestone belongs to a different project or vendor'],
  party_kind: [422, 'Revenue needs a client and an expense needs a vendor'],
  manager_scope: [403, 'Managers can record project expenses only'],
  project_not_found: [404, 'Project not found'],
  month_not_over: [422, 'Only a finished month can be closed'],
  already_closed: [409, 'That month is already closed'],
  draft_slips: [409, 'Approve or delete the draft salary slips of that month before closing it'],
  not_closed: [409, 'That month is not closed'],
};
function failMoney(res, result) {
  const mapped = MONEY_ERRORS[result.error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}
const ledgerCap = zxAuthorize('ledger');
const overviewCap = zxAuthorize('overview');
const financialsCap = zxAuthorize('financials');
const mctx = (req) => ({ isAdmin: req.zx.role === 'admin' });
const sendEntry = (res, result, status = 200) => (result.error ? failMoney(res, result) : ok(res, result.entry, {}, status));

router.get('/ledger', ledgerCap, asyncHandler(async (req, res) => {
  const result = await ledger.list(orgId(req), mctx(req), ledger.listQuerySchema.parse(req.query));
  return ok(res, result.data, { pagination: result.pagination, totals: result.totals });
}));
router.post('/ledger/import', zxAuthorize('settings'), asyncHandler(async (req, res) => ok(res, await ledger.importRows(orgId(req), req.user.id, ledger.importSchema.parse(req.body).rows))));
router.post('/ledger', ledgerCap, asyncHandler(async (req, res) => sendEntry(res, await ledger.create(orgId(req), req.user.id, mctx(req), ledger.createEntrySchema.parse(req.body)), 201)));
router.get('/ledger/:id', ledgerCap, asyncHandler(async (req, res) => sendEntry(res, await ledger.get(orgId(req), mctx(req), req.params.id))));
router.patch('/ledger/:id', ledgerCap, asyncHandler(async (req, res) => sendEntry(res, await ledger.update(orgId(req), req.user.id, mctx(req), req.params.id, ledger.updateEntrySchema.parse(req.body)))));
router.delete('/ledger/:id', zxAuthorize('delete'), asyncHandler(async (req, res) => {
  const result = await ledger.remove(orgId(req), req.user.id, req.params.id);
  return result.error ? failMoney(res, result) : ok(res, { id: req.params.id });
}));
router.get('/projects/:id/money', ledgerCap, projectsView, asyncHandler(async (req, res) => {
  const result = await ledger.projectMoney(orgId(req), mctx(req), req.params.id);
  return result.error ? failMoney(res, result) : ok(res, result.money);
}));
router.get('/parties/:id/statement', ledgerCap, zxAuthorize('parties'), asyncHandler(async (req, res) => {
  const result = await ledger.partyStatement(orgId(req), req.params.id);
  return result.error ? failMoney(res, result) : ok(res, result.statement);
}));

router.get('/overview', overviewCap, asyncHandler(async (req, res) => ok(res, await overviewSvc.overview(orgId(req), mctx(req), overviewSvc.querySchema.parse(req.query)))));
router.get('/overview/salaries', salariesCap, asyncHandler(async (req, res) => ok(res, await overviewSvc.salaryRows(orgId(req), overviewSvc.drillSchema.parse(req.query)))));

router.get('/financials/plans', financialsCap, asyncHandler(async (req, res) => ok(res, await financials.listPlans(orgId(req), financials.rangeSchema.parse(req.query)))));
router.put('/financials/plans', financialsCap, asyncHandler(async (req, res) => {
  const result = await financials.savePlan(orgId(req), req.user.id, financials.planSchema.parse(req.body));
  return result.error ? failMoney(res, result) : ok(res, result.plan);
}));
router.delete('/financials/plans/:id', financialsCap, asyncHandler(async (req, res) => {
  const result = await financials.deletePlan(orgId(req), req.user.id, req.params.id);
  return result.error ? failMoney(res, result) : ok(res, { id: req.params.id });
}));
router.get('/financials/plan-vs-actual', financialsCap, asyncHandler(async (req, res) => ok(res, await financials.planVsActual(orgId(req), financials.rangeSchema.parse(req.query)))));
router.get('/financials/projection', financialsCap, asyncHandler(async (req, res) => ok(res, await financials.projection(orgId(req)))));
router.get('/financials/closes', financialsCap, asyncHandler(async (req, res) => ok(res, await financials.listCloses(orgId(req), financials.rangeSchema.parse(req.query)))));
router.post('/financials/close', financialsCap, asyncHandler(async (req, res) => {
  const result = await financials.closeMonth(orgId(req), req.user.id, financials.closeSchema.parse(req.body).month);
  return result.error ? failMoney(res, result) : ok(res, result.close);
}));
router.post('/financials/reopen', financialsCap, asyncHandler(async (req, res) => {
  const body = financials.reopenSchema.parse(req.body);
  const result = await financials.reopenMonth(orgId(req), req.user.id, body.month, body.reason);
  return result.error ? failMoney(res, result) : ok(res, result.close);
}));
router.get('/financials/statement', financialsCap, asyncHandler(async (req, res) => {
  const query = financials.statementSchema.parse(req.query);
  const stmt = await financials.statement(orgId(req), query);
  if (query.format === 'json') return ok(res, stmt);
  const name = `zephyr-pnl-${query.group}-${stmt.from}-${stmt.to}`;
  if (query.format === 'xlsx') {
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${name}.xlsx"`);
    return res.send(await financials.exportXlsx(stmt));
  }
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${name}.pdf"`);
  return res.send(await financials.exportPdf(stmt));
}));
// --- Documents (Z1: owned by a party; later phases add project / person / lead) ---
fs.mkdirSync(env.uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, env.uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, documents.ALLOWED_EXT.includes(path.extname(file.originalname).toLowerCase())),
});

router.get(
  '/documents',
  asyncHandler(async (req, res) => {
    const query = documents.listSchema.parse(req.query);
    if (!req.zx.caps.includes(documents.capFor(query.owner_type))) return fail(res, 403, 'Insufficient Zephyr role');
    if (!(await documents.ownerExists(orgId(req), query.owner_type, query.owner_id))) return fail(res, 404, 'Record not found');
    return ok(res, await documents.list(orgId(req), query));
  })
);
router.post(
  '/documents',
  (req, res, next) =>
    upload.single('file')(req, res, (err) => {
      if (err) return fail(res, 422, err.code === 'LIMIT_FILE_SIZE' ? `File is larger than ${env.maxUploadMb} MB` : 'Could not read the upload');
      return next();
    }),
  asyncHandler(async (req, res) => {
    const file = req.file;
    const bail = (status, message, errors) => {
      if (file) documents.removeFile(`/uploads/${file.filename}`);
      return fail(res, status, message, errors);
    };
    if (!file) return bail(422, 'Attach a PDF, Word, Excel, CSV or image file');
    const parsed = documents.uploadSchema.safeParse(req.body);
    if (!parsed.success) return bail(422, 'Validation failed', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    if (!req.zx.caps.includes(documents.capFor(parsed.data.owner_type))) return bail(403, 'Insufficient Zephyr role');
    if (!(await documents.ownerExists(orgId(req), parsed.data.owner_type, parsed.data.owner_id))) return bail(404, 'Record not found');
    const result = await documents.create(orgId(req), req.user.id, parsed.data, file);
    return created(res, result.document);
  })
);
router.patch(
  '/documents/:id',
  asyncHandler(async (req, res) => {
    const doc = await documents.find(orgId(req), req.params.id);
    if (!doc) return fail(res, 404, 'Document not found');
    if (!req.zx.caps.includes(documents.capFor(doc.owner_type))) return fail(res, 403, 'Insufficient Zephyr role');
    const result = await documents.update(orgId(req), req.user.id, req.params.id, documents.updateSchema.parse(req.body));
    if (result.error === 'bad_dates') return fail(res, 422, 'Expiry must be on or after the issue date');
    return result.error ? fail(res, 404, 'Document not found') : ok(res, result.document);
  })
);
router.delete(
  '/documents/:id',
  asyncHandler(async (req, res) => {
    const doc = await documents.find(orgId(req), req.params.id);
    if (!doc) return fail(res, 404, 'Document not found');
    if (!req.zx.caps.includes(documents.capFor(doc.owner_type))) return fail(res, 403, 'Insufficient Zephyr role');
    await documents.remove(orgId(req), req.user.id, req.params.id);
    return ok(res, { id: req.params.id });
  })
);

router.get(
  '/audit',
  zxAuthorize('audit'),
  asyncHandler(async (req, res) => ok(res, await core.listAudit(orgId(req), { entity: req.query.entity, limit: req.query.limit })))
);

module.exports = router;
