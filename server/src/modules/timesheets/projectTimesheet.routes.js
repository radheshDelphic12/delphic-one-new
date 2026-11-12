const express = require('express');
const { z } = require('zod');
const JSZip = require('jszip');
const prisma = require('../../config/db');
const { hasPermission } = require('../../lib/permissions');
const { fail, ok } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { buildProjectWorkbook, loggedProjects, missingDays } = require('./projectTimesheet.export');

/**
 * Project-wise timesheet Excel (Time & Attendance > Log time). Mounted under /timesheets/project-timesheet.
 *
 * Who: every IT-department employee, for their own log; whoever may view timesheets (the Project Timesheets
 * tab: Diksha, Paras, admins) for any IT employee. A normal IT employee can only ever get their own data:
 * org_membership_id is ignored for them.
 */
const router = express.Router();

const querySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  org_membership_id: z.string().uuid().optional(),
  statuses: z.enum(['both', 'pending', 'approved']).default('both'),
  project_id: z.string().optional(),
});

const isItDepartment = (name) => String(name || '').trim().toLowerCase() === 'it';

// Same rule as the Project Timesheets tab: timesheets.view for a custom role, the admin role otherwise.
function canViewOthers(user) {
  const decided = hasPermission(user, 'timesheets.view');
  return decided === null ? user.role === 'admin' : decided;
}

// The membership whose timesheet may be downloaded, or { status, message }.
async function resolveTarget(req, requestedId) {
  const { org_id: orgId, org_membership_id: ownId } = req.user;
  const targetId = requestedId && requestedId !== ownId ? requestedId : ownId;
  if (targetId !== ownId && !canViewOthers(req.user)) return { status: 403, message: 'You can only download your own project timesheet' };
  const target = await prisma.orgMembership.findFirst({ where: { id: targetId, org_id: orgId }, select: { id: true, person: { select: { name: true, department: { select: { name: true } } } } } });
  if (!target) return { status: 404, message: 'Employee not found' };
  if (!isItDepartment(target.person?.department?.name)) {
    return targetId === ownId
      ? { status: 403, message: 'Project timesheet download is available to the IT department' }
      : { status: 422, message: 'Project timesheet download is only for IT department employees' };
  }
  return { membershipId: target.id };
}

router.get(
  '/options',
  asyncHandler(async (req, res) => {
    const q = querySchema.parse(req.query);
    const target = await resolveTarget(req, q.org_membership_id);
    if (target.status) return fail(res, target.status, target.message);
    const base = { orgId: req.user.org_id, membershipId: target.membershipId, month: q.month, year: q.year, statuses: q.statuses };
    const projects = await loggedProjects(base);
    const withMissing = await Promise.all(projects.map(async (p) => ({ ...p, missing_dates: await missingDays({ ...base, projectId: p.id }) })));
    return ok(res, { projects: withMissing });
  })
);

router.get(
  '/download',
  asyncHandler(async (req, res) => {
    const q = querySchema.parse(req.query);
    if (!q.project_id) return fail(res, 422, 'Select a project');
    const target = await resolveTarget(req, q.org_membership_id);
    if (target.status) return fail(res, target.status, target.message);
    const base = { orgId: req.user.org_id, membershipId: target.membershipId, month: q.month, year: q.year, statuses: q.statuses };
    const logged = await loggedProjects(base);
    const picked = q.project_id === 'all' ? logged : logged.filter((p) => p.id === q.project_id);
    if (!picked.length) return fail(res, 404, 'No hours logged on this project in this month');

    const files = [];
    for (const p of picked) {
      const built = await buildProjectWorkbook({ orgId: base.orgId, membershipId: base.membershipId, projectId: p.id, months: [{ month: q.month, year: q.year }], statuses: q.statuses });
      if (built.error) return fail(res, 404, built.error === 'project_not_found' ? 'Project not found' : 'Employee not found');
      if (built.logged_days > 0) files.push({ name: built.fileName, buffer: await built.workbook.xlsx.writeBuffer() });
    }
    if (!files.length) return fail(res, 404, 'No hours logged on this project in this month');

    if (files.length === 1) {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${files[0].name}"`);
      return res.end(Buffer.from(files[0].buffer));
    }
    const zip = new JSZip();
    files.forEach((f) => zip.file(f.name, f.buffer));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="Timesheets_${q.year}_${String(q.month).padStart(2, '0')}.zip"`);
    return res.end(await zip.generateAsync({ type: 'nodebuffer' }));
  })
);

module.exports = router;
