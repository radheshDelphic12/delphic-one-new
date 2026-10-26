const express = require('express');
const ExcelJS = require('exceljs');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./hiring.service');

// Hiring of the companies other than Delphic Global: jobs published on /<org-slug>/career/ and the applications that come in.
// Admin only (a company admin, or the group superadmin working inside the company).
const router = express.Router();
router.use(authenticate, requireOrgMembership, authorize('admin'));

const ERRORS = {
  not_found: [404, 'Not found'],
  master_workspace: [409, 'Delphic Global publishes jobs from Pipeline and Website; Hiring is for the other companies'],
};
const send = (res, r, key, status = 200) => {
  if (r.error) { const m = ERRORS[r.error] || [400, 'Bad request']; return fail(res, m[0], m[1]); }
  return status === 201 ? created(res, key ? r[key] : r) : ok(res, key ? r[key] : r);
};
const orgId = (req) => req.user.org_id;

router.get('/jobs', asyncHandler(async (req, res) => {
  const r = await service.listJobs(orgId(req), { status: service.STATUSES.includes(req.query.status) ? req.query.status : undefined });
  return r.error ? send(res, r) : ok(res, r.jobs, { career_path: r.career_path, org: r.org });
}));
router.post('/jobs', asyncHandler(async (req, res) => send(res, await service.createJob(orgId(req), req.user.id, service.createJobSchema.parse(req.body)), 'job', 201)));
router.patch('/jobs/:id', asyncHandler(async (req, res) => send(res, await service.updateJob(orgId(req), req.params.id, service.updateJobSchema.parse(req.body)), 'job')));
router.delete('/jobs/:id', asyncHandler(async (req, res) => send(res, await service.removeJob(orgId(req), req.params.id))));

router.get('/applications', asyncHandler(async (req, res) => {
  const r = await service.listApplications(orgId(req), service.listApplicationsSchema.parse(req.query));
  return ok(res, r.applications, { pagination: r.pagination, by_status: r.by_status });
}));
router.get('/applications/export', asyncHandler(async (req, res) => {
  const rows = await service.exportRows(orgId(req), service.listApplicationsSchema.parse({ ...req.query, page: 1, limit: 100 }));
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Applications');
  if (rows.length) {
    sheet.columns = Object.keys(rows[0]).map((key) => ({ header: key, key, width: 20 }));
    rows.forEach((r) => sheet.addRow(r));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  } else sheet.addRow(['(no applications)']);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="job-applications.xlsx"');
  await workbook.xlsx.write(res);
  return res.end();
}));
router.patch('/applications/:id', asyncHandler(async (req, res) => send(res, await service.updateApplication(orgId(req), req.params.id, service.updateApplicationSchema.parse(req.body)), 'application')));

module.exports = router;
