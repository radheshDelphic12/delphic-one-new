const express = require('express');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { authenticate, authorize } = require('../../middleware/auth');
const requireMasterWorkspace = require('../../middleware/requireMasterWorkspace');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./reports.service');
const explorerService = require('./explorer.service');
const {
  dateRangeSchema,
  agingSchema,
  closureSchema,
  explorerSchema,
  coverageSchema,
  hrSchema,
  joiningsSchema,
  timeToSubmitSchema,
} = require('./reports.validation');

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
  joinings: (q) => service.joinings(q),
  'time-to-submit': (q) => service.timeToSubmit(q),
  'bda-reports': (q) => service.bdaReports(q),
  'sales-reports': (q) => service.salesReports(q),
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

router.get(
  '/hr',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const query = hrSchema.parse(req.query);
    const data = await service.hrReport(query);
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

router.get(
  '/export',
  authorize('admin', 'sales'),
  asyncHandler(async (req, res) => {
    const { type, report } = req.query;
    const fn = REPORTS[report];
    if (!fn) return fail(res, 422, 'Unknown report');
    if (!['xlsx', 'pdf'].includes(type)) return fail(res, 422, 'type must be xlsx or pdf');
    // HR is admin-only for the GET; keep its export admin-only too.
    if (report === 'hr' && req.user.role !== 'admin') return fail(res, 403, 'Admin only');

    let query = { ...req.query };
    if (report === 'aging') query = agingSchema.parse(req.query);
    else if (report === 'closure') query = closureSchema.parse(req.query);
    else if (report === 'pipeline-explorer') query = explorerSchema.parse(req.query);
    else if (report === 'hr') query = hrSchema.parse(req.query);
    else if (report === 'joinings') query = joiningsSchema.parse(req.query);
    else if (report === 'time-to-submit') query = timeToSubmitSchema.parse(req.query);
    else if (report === 'clients-without-requirements' || report === 'recruiter-vendor-gaps') {
      query = coverageSchema.parse(req.query);
    } else query = dateRangeSchema.parse(req.query);

    if (report === 'bda-reports' && req.user.role === 'bda') query.bda_id = req.user.id;
    if (report === 'sales-reports' && req.user.role === 'sales') query.sales_id = req.user.id;

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
    ['hr', 'joinings', 'bda-reports', 'sales-reports'].includes(report) &&
    data &&
    typeof data === 'object' &&
    Array.isArray(data.tables)
  ) {
    return data.tables.map((t) => ({ name: t.title, rows: (t.rows || []).map((r) => flatten(r)) }));
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
