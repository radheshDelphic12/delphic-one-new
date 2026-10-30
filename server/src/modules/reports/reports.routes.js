const express = require('express');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { authenticate, authorize: authorizeRole } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./reports.service');
const explorerService = require('./explorer.service');
const drilldownService = require('./drilldown.service');
const monthlyReview = require('./monthlyReview.service');
const hiringFunnelService = require('./hiringFunnel.service');
const {
  drilldownSchema,
  dateRangeSchema,
  agingSchema,
  closureSchema,
  explorerSchema,
  coverageSchema,
  hrSchema,
  hiringFunnelSchema,
  joiningsSchema,
  timeToSubmitSchema,
} = require('./reports.validation');

// In a company on the permission model the central guard has already checked `reports.view` / `reports.export`, and a person
// holding only that permission has the derived role 'employee', which the role lists below would turn away. So they pass every
// report that is open to more than admins; the admin-only ones (HR, sales/BDA performance) stay admin-only.
function authorize(...roles) {
  const roleGate = authorizeRole(...roles);
  const adminOnly = roles.length === 1 && roles[0] === 'admin';
  return (req, res, next) => {
    if (!adminOnly && req.user?.access?.mode === 'permissions' && req.user.access.level === 'employee') return next();
    return roleGate(req, res, next);
  };
}

// The HR report is admin-only, unless the person is on the permission model and holds Reports > HR reports (the central guard
// has already checked that key for /reports/hr; the export checks it here).
// On the permission model the permission alone decides (a person holding Reports > View and Export is derived the admin role for
// other reports, which must not open HR); elsewhere it is the admin role.
const canOpenHr = (user) => (user?.access?.mode === 'permissions'
  ? user.access.level !== 'employee' || Boolean(user.access.permissions?.['reports.hr'])
  : user?.role === 'admin');
const authorizeHr = (req, res, next) => {
  if (req.user?.access?.mode === 'permissions') return canOpenHr(req.user) ? next() : fail(res, 403, "You don't have access to this");
  return authorizeRole('admin')(req, res, next);
};

const router = express.Router();
router.use(authenticate, requireMasterWorkspace);

const REPORTS = {
  'recruiter-performance': (q) => service.recruiterPerformance(q),
  'sales-performance': (q) => service.salesPerformance(q),
  'bda-performance': (q) => service.bdaPerformance(q),
  'vendor-performance': (q) => service.vendorPerformance(q),
  'client-performance': (q) => service.clientPerformance(q),
  aging: (q) => service.aging(q),
  closure: (q) => service.closure(q),
  'pipeline-explorer': (q, user) => explorerService.pipelineExplorer(user, q),
  'clients-without-requirements': (q) => service.clientsWithoutRequirements(q),
  'recruiter-vendor-gaps': (q) => service.recruiterVendorGaps(q),
  hr: (q) => service.hrReport(q),
  'hiring-funnel': (q) => hiringFunnelService.hiringFunnel(q),
  joinings: (q) => service.joinings(q),
  'time-to-submit': (q) => service.timeToSubmit(q),
  'bda-reports': (q) => service.bdaReports(q),
  'sales-reports': (q) => service.salesReports(q),
  'recruiter-reports': (q) => service.recruiterReports(q),
};

router.get(
  '/recruiter-performance',
  authorize('admin', 'sales', 'recruiter'),
  asyncHandler(async (req, res) => {
    const query = dateRangeSchema.parse(req.query);
    if (req.user.role === 'recruiter') query.recruiter_id = req.user.id;
    const data = await service.recruiterPerformance(query);
    return ok(res, data);
  })
);

router.get(
  '/sales-performance',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const query = dateRangeSchema.parse(req.query);
    const data = await service.salesPerformance(query);
    return ok(res, data);
  })
);

router.get(
  '/bda-performance',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const query = dateRangeSchema.parse(req.query);
    const data = await service.bdaPerformance(query);
    return ok(res, data);
  })
);

router.get(
  '/vendor-performance',
  authorize('admin', 'sales'),
  asyncHandler(async (req, res) => {
    const query = dateRangeSchema.parse(req.query);
    const data = await service.vendorPerformance(query);
    return ok(res, data);
  })
);

router.get(
  '/client-performance',
  authorize('admin', 'sales'),
  asyncHandler(async (req, res) => {
    const query = dateRangeSchema.parse(req.query);
    const data = await service.clientPerformance(query);
    return ok(res, data);
  })
);

router.get(
  '/aging',
  authorize('admin', 'sales'),
  asyncHandler(async (req, res) => {
    const query = agingSchema.parse(req.query);
    const data = await service.aging(query);
    return ok(res, data);
  })
);

router.get(
  '/closure',
  authorize('admin', 'sales'),
  asyncHandler(async (req, res) => {
    const query = closureSchema.parse(req.query);
    const data = await service.closure(query);
    return ok(res, data);
  })
);

// Monthly performance review: per employee and month, attendance plus the measures of the person's function. Admin only (it is about people).
router.get(
  '/monthly-review',
  authorize('admin'),
  asyncHandler(async (req, res) => ok(res, await monthlyReview.review(req.user.org_id, req.user, req.query)))
);

router.get(
  '/monthly-review/export',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const type = req.query.type;
    if (!['xlsx', 'pdf'].includes(type)) return fail(res, 422, 'type must be xlsx or pdf');
    const { rows, dayRows, truncated } = await monthlyReview.exportBundle(req.user.org_id, req.user, req.query);
    const day = { rows: dayRows, truncated };
    const filename = `monthly-performance-review-${new Date().toISOString().slice(0, 7)}`;
    if (type === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Monthly review');
      if (rows.length) {
        sheet.columns = Object.keys(rows[0]).map((key) => ({ header: key, key, width: 18 }));
        rows.forEach((r) => sheet.addRow(r));
        sheet.getRow(1).font = { bold: true };
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
      } else sheet.addRow(['(no rows)']);
      const daySheet = workbook.addWorksheet('Day-wise');
      if (day.rows.length) {
        daySheet.columns = Object.keys(day.rows[0]).map((key) => ({ header: key, key, width: key === 'Activity' ? 70 : 18 }));
        day.rows.forEach((r) => daySheet.addRow(r));
        daySheet.getRow(1).font = { bold: true };
        daySheet.views = [{ state: 'frozen', ySplit: 1 }];
        if (day.truncated) daySheet.addRow(['(the sheet stops at the first 20000 rows; narrow the filters for the rest)']);
      } else daySheet.addRow(['(no rows)']);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      await workbook.xlsx.write(res);
      return res.end();
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    doc.pipe(res);
    doc.fontSize(15).text('Monthly performance review', { underline: true });
    doc.fontSize(9).text(`Generated ${new Date().toISOString().slice(0, 10)}`);
    doc.moveDown();
    if (!rows.length) doc.fontSize(10).text('(no rows)');
    else {
      const headers = Object.keys(rows[0]);
      doc.fontSize(7).font('Helvetica-Bold').text(headers.join(' | '));
      doc.font('Helvetica');
      rows.slice(0, 400).forEach((row) => doc.text(headers.map((h) => String(row[h] ?? '')).join(' | ')));
      if (rows.length > 400) doc.text(`... and ${rows.length - 400} more rows (use the Excel export for everything)`);
    }
    doc.addPage();
    doc.fontSize(15).font('Helvetica').text('Day-wise', { underline: true });
    doc.moveDown(0.5);
    if (!day.rows.length) doc.fontSize(10).text('(no rows)');
    else {
      doc.fontSize(7).font('Helvetica-Bold').text('Employee | Date | Attendance | Projects | Activity');
      doc.font('Helvetica');
      day.rows.slice(0, 600).forEach((r) => doc.text([r.Employee, r.Date, r.Attendance, r['Projects that day'], r.Activity].filter((x) => x !== '').join(' | ')));
      if (day.rows.length > 600) doc.text(`... and ${day.rows.length - 600} more days (use the Excel export for everything)`);
    }
    doc.end();
    return undefined;
  })
);

router.get(
  '/monthly-review/details',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const data = await monthlyReview.details(req.user.org_id, req.user, req.query);
    if (data.error) return fail(res, data.error === 'not_found' ? 404 : 400, data.error === 'not_found' ? 'Employee not found' : 'Unknown measure');
    return ok(res, data);
  })
);

router.get(
  '/hr',
  authorizeHr,
  asyncHandler(async (req, res) => {
    const query = hrSchema.parse(req.query);
    const data = await service.hrReport(query);
    return ok(res, data);
  })
);

router.get(
  '/hiring-funnel',
  authorizeHr,
  asyncHandler(async (req, res) => {
    const query = hiringFunnelSchema.parse(req.query);
    const data = await hiringFunnelService.hiringFunnel(query);
    return ok(res, data);
  })
);

router.get(
  '/joinings',
  authorize('admin', 'sales'),
  asyncHandler(async (req, res) => {
    const query = joiningsSchema.parse(req.query);
    return ok(res, await service.joinings(query));
  })
);

router.get(
  '/time-to-submit',
  authorize('admin', 'sales'),
  asyncHandler(async (req, res) => {
    const query = timeToSubmitSchema.parse(req.query);
    return ok(res, await service.timeToSubmit(query));
  })
);

router.get(
  '/bda-reports',
  authorize('admin', 'bda'),
  asyncHandler(async (req, res) => {
    const query = dateRangeSchema.parse(req.query);
    if (req.user.role === 'bda') query.bda_id = req.user.id;
    return ok(res, await service.bdaReports(query));
  })
);

router.get(
  '/sales-reports',
  authorize('admin', 'sales'),
  asyncHandler(async (req, res) => {
    const query = dateRangeSchema.parse(req.query);
    if (req.user.role === 'sales') query.sales_id = req.user.id;
    return ok(res, await service.salesReports(query));
  })
);

router.get(
  '/recruiter-reports',
  authorize('admin', 'recruiter'),
  asyncHandler(async (req, res) => {
    const query = dateRangeSchema.parse(req.query);
    if (req.user.role === 'recruiter') query.recruiter_id = req.user.id;
    return ok(res, await service.recruiterReports(query));
  })
);

router.get(
  '/pipeline-explorer',
  authorize('admin', 'sales', 'recruiter', 'bda'),
  asyncHandler(async (req, res) => {
    const query = explorerSchema.parse(req.query);
    const data = await explorerService.pipelineExplorer(req.user, query);
    return ok(res, data);
  })
);

router.get(
  '/clients-without-requirements',
  authorize('admin', 'sales', 'bda'),
  asyncHandler(async (req, res) => {
    const query = coverageSchema.parse(req.query);
    if (req.user.role === 'bda') query.bda_id = req.user.id;
    const data = await service.clientsWithoutRequirements(query);
    return ok(res, data);
  })
);

router.get(
  '/recruiter-vendor-gaps',
  authorize('admin', 'recruiter'),
  asyncHandler(async (req, res) => {
    const query = coverageSchema.parse(req.query);
    if (req.user.role === 'recruiter') query.recruiter_id = req.user.id;
    const data = await service.recruiterVendorGaps(query);
    return ok(res, data);
  })
);

// Records behind a count in a report table (click a count -> side panel).
router.get(
  '/drilldown',
  authorize('admin', 'sales', 'recruiter', 'bda'),
  asyncHandler(async (req, res) => {
    const query = drilldownSchema.parse(req.query);
    const result = await drilldownService.drilldown(req.user, query);
    if (result.error === 'forbidden') return fail(res, 403, 'Not permitted');
    if (result.error) return fail(res, 422, 'Unknown report table');
    return ok(res, result.data);
  })
);

router.get(
  '/export',
  authorize('admin', 'sales'),
  asyncHandler(async (req, res) => {
    const { type, report } = req.query;
    const fn = REPORTS[report];
    if (!fn) return fail(res, 422, 'Unknown report');
    if (!['xlsx', 'pdf'].includes(type)) return fail(res, 422, 'type must be xlsx or pdf');
    // HR is admin-only for the GET (or Reports > HR reports); keep its export the same.
    if ((report === 'hr' || report === 'hiring-funnel') && !canOpenHr(req.user)) return fail(res, 403, 'Admin only');

    let query = { ...req.query };
    if (report === 'aging') query = agingSchema.parse(req.query);
    else if (report === 'closure') query = closureSchema.parse(req.query);
    else if (report === 'pipeline-explorer') query = explorerSchema.parse(req.query);
    else if (report === 'hr') query = hrSchema.parse(req.query);
    else if (report === 'hiring-funnel') query = hiringFunnelSchema.parse(req.query);
    else if (report === 'joinings') query = joiningsSchema.parse(req.query);
    else if (report === 'time-to-submit') query = timeToSubmitSchema.parse(req.query);
    else if (report === 'clients-without-requirements' || report === 'recruiter-vendor-gaps') {
      query = coverageSchema.parse(req.query);
    } else query = dateRangeSchema.parse(req.query);

    if (report === 'bda-reports' && req.user.role === 'bda') query.bda_id = req.user.id;
    if (report === 'sales-reports' && req.user.role === 'sales') query.sales_id = req.user.id;
    if (report === 'recruiter-reports' && req.user.role === 'recruiter') query.recruiter_id = req.user.id;

    const data = await fn(query, req.user);
    const sheets = buildExportSheets(report, data);
    const filename = `${report}-${new Date().toISOString().slice(0, 7)}`;

    if (type === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      for (const sheetDef of sheets) {
        const sheet = workbook.addWorksheet(sheetDef.name.slice(0, 31));
        if (sheetDef.rows.length) {
          sheet.columns = Object.keys(sheetDef.rows[0]).map((key) => ({ header: key, key, width: 22 }));
          sheetDef.rows.forEach((r) => sheet.addRow(r));
          sheet.getRow(1).font = { bold: true };
        } else {
          sheet.addRow(['(no rows)']);
        }
      }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      await workbook.xlsx.write(res);
      return res.end();
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);
    doc.fontSize(16).text(report, { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Generated ${new Date().toISOString()}`);
    doc.moveDown();

    for (const sheetDef of sheets) {
      doc.fontSize(12).text(sheetDef.name, { underline: true });
      doc.moveDown(0.3);
      if (!sheetDef.rows.length) {
        doc.fontSize(10).text('(no rows)');
        doc.moveDown();
        continue;
      }
      const headers = Object.keys(sheetDef.rows[0]);
      doc.fontSize(8).text(headers.join(' | '));
      sheetDef.rows.slice(0, 80).forEach((row) => {
        const line = headers.map((h) => String(row[h] ?? '')).join(' | ');
        doc.text(line.length > 140 ? `${line.slice(0, 137)}...` : line);
      });
      if (sheetDef.rows.length > 80) doc.text(`… and ${sheetDef.rows.length - 80} more rows`);
      doc.moveDown();
    }
    doc.end();
  })
);

function buildExportSheets(report, data) {
  if (report === 'aging' && data && typeof data === 'object' && !Array.isArray(data)) {
    return [
      { name: 'stuck_leads', rows: (data.stuck_leads || []).map((r) => flatten(r)) },
      { name: 'stuck_requirements', rows: (data.stuck_requirements || []).map((r) => flatten(r)) },
      { name: 'stuck_submissions', rows: (data.stuck_submissions || []).map((r) => flatten(r)) },
      { name: 'past_sla', rows: (data.past_sla_requirements || []).map((r) => flatten(r)) },
    ];
  }

  if (report === 'pipeline-explorer' && data && typeof data === 'object' && Array.isArray(data.rows)) {
    return [{ name: 'pipeline-explorer', rows: data.rows.map((r) => flatten(r)) }];
  }

  if (
    ['hr', 'joinings', 'bda-reports', 'sales-reports', 'recruiter-reports'].includes(report) &&
    data &&
    typeof data === 'object' &&
    Array.isArray(data.tables)
  ) {
    return data.tables.map((t) => ({ name: t.title, rows: (t.rows || []).map((r) => flatten(r)) }));
  }

  if (report === 'hiring-funnel' && data && typeof data === 'object' && Array.isArray(data.funnels)) {
    const num = (v) => (v == null ? '' : v);
    const sheets = [{
      name: 'Summary',
      rows: [
        { Metric: 'Profiles sourced', Value: data.summary.sourced },
        { Metric: 'Submitted to a requirement', Value: data.summary.submitted },
        { Metric: 'First round cleared', Value: data.summary.first_round_cleared },
        { Metric: 'Reached a client round', Value: data.summary.reached_client_round },
        { Metric: 'Selected / joined', Value: data.summary.selected },
        { Metric: 'Dropped', Value: data.summary.dropped },
        { Metric: 'In progress', Value: data.summary.in_progress },
        { Metric: 'Avg days sourced to joined', Value: num(data.summary.avg_days_to_join) },
        { Metric: 'Median days sourced to joined', Value: num(data.summary.median_days_to_join) },
      ],
    }];
    for (const fn of data.funnels) {
      sheets.push({
        name: fn.label,
        rows: fn.stages.map((st) => ({
          Stage: st.label,
          'Came (reached)': st.reached,
          Passed: st.passed,
          'Not held (assumed pass)': st.assumed,
          Dropped: st.dropped,
          'In progress': st.pending,
          'Data unavailable': st.unavailable,
          'Avg days from sourcing': num(st.avg_days_from_start),
        })),
      });
    }
    sheets.push({
      name: 'By recruiter',
      rows: data.recruiters.map((r) => ({
        Recruiter: r.sourcer,
        Sourced: r.sourced,
        Submitted: r.submitted,
        'First round cleared': r.first_round_cleared,
        'Reached client round': r.reached_client_round,
        Selected: r.selected,
        Dropped: r.dropped,
        'In progress': r.in_progress,
        'First round %': num(r.first_round_pct),
        'Client round %': num(r.client_round_pct),
        'Selected %': num(r.selected_pct),
        'Avg days to join': num(r.avg_days_to_join),
      })),
    });
    if (data.trend.length) {
      sheets.push({
        name: 'Trend',
        rows: data.trend.map((r) => ({ Period: r.bucket, Sourced: r.sourced, 'First round cleared': r.first_round_cleared, 'Reached client round': r.reached_client_round, Selected: r.selected, Dropped: r.dropped })),
      });
    }
    sheets.push({ name: 'Assumptions', rows: data.assumptions.map((a) => ({ Assumption: a })) });
    return sheets;
  }

  if (report === 'time-to-submit' && data && typeof data === 'object' && Array.isArray(data.rows)) {
    return [
      {
        name: report,
        rows: data.rows.map((r) =>
          flatten({
            requirement_created_at: r.requirement_created_at,
            requirement: r.requirement,
            client: r.client,
            candidate: r.candidate,
            sourcer: r.sourcer,
            type: r.type,
            vendor_name: r.vendor_name,
            requirement_to_submission: r.req_to_submission?.label || '',
            requirement_to_r1: r.req_to_r1?.label || '',
            requirement_to_submitted_to_client: r.req_to_submitted?.label || '',
          })
        ),
      },
    ];
  }

  if (report === 'recruiter-vendor-gaps' && Array.isArray(data)) {
    // Hide "Recruiters (our end)" from export — keep Our POC / Brought by only.
    const rows = data.map((r) => {
      const { recruiters: _recruiters, ...rest } = r;
      return flatten(rest);
    });
    return [{ name: report, rows }];
  }

  const rows = Array.isArray(data) ? data.map((r) => flatten(r)) : [flatten(data)];
  return [{ name: report, rows }];
}

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      if (v.name || v.id) {
        out[key] = v.name || v.id;
      } else {
        Object.assign(out, flatten(v, key));
      }
    } else if (Array.isArray(v)) {
      if (v.every((item) => item && typeof item === 'object' && item.name)) {
        out[key] = v.map((item) => item.name).join(', ');
      } else {
        out[key] = v.length;
      }
    } else if (v instanceof Date) {
      out[key] = v.toISOString();
    } else {
      out[key] = v;
    }
  }
  return out;
}

module.exports = router;
