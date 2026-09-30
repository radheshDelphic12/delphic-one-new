const ExcelJS = require('exceljs');
const prisma = require('../../config/db');
const { monthlyGrouped } = require('./timesheets.service');

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TITLE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6D4AA6' } };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
const META_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
const WH_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8CBAD' } };
const OT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const THIN = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const COLS = 6; // Date, Developer, Total Hours, Project, Hours, Description

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Builds the "Timesheet for the Month of <Month-Year>" workbook, matching
 * the company's real template (title band, employee/project metadata block,
 * CH/LT/WH legend, one merged Date/Developer/Total-Hours block per day with
 * one row per itemized task). Reuses timesheets.service.monthlyGrouped so
 * the on-screen grid and this export can never disagree on the underlying
 * data.
 *
 * Weekly Holiday (WH) rows are inserted for a Saturday/Sunday with zero
 * logged entries — the only status this function can determine with
 * certainty from existing data. Company Holiday (CH) and Leave Taken (LT)
 * are NOT auto-detected (that would mean guessing at calendar/leave state
 * this module doesn't own) — such days simply don't appear in the table,
 * same as any other day with nothing logged.
 */
async function buildMonthlyWorkbook(orgId, orgMembershipId, month, year) {
  const membership = await prisma.orgMembership.findFirst({
    where: { id: orgMembershipId, org_id: orgId },
    select: {
      person: { select: { name: true } },
      joined_at: true,
      location: { select: { name: true, city: true } },
      designation: { select: { name: true } },
    },
  });
  if (!membership) return { error: 'not_found' };

  const days = await monthlyGrouped(orgId, orgMembershipId, year, month);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const projectNames = Array.from(new Set(days.flatMap((d) => d.entries.map((e) => e.account?.name).filter(Boolean))));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`${MONTH_NAMES[month - 1]} ${year}`.slice(0, 31));
  sheet.columns = [{ width: 12 }, { width: 20 }, { width: 12 }, { width: 26 }, { width: 10 }, { width: 60 }];

  function mergedRow(text, fill, opts = {}) {
    const row = sheet.addRow([text]);
    sheet.mergeCells(row.number, 1, row.number, COLS);
    row.getCell(1).font = { bold: true, color: { argb: opts.dark ? 'FF000000' : 'FFFFFFFF' }, size: opts.size || 12 };
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    if (fill) row.getCell(1).fill = fill;
    row.height = opts.height || 20;
    return row;
  }

  mergedRow(`Timesheet for the Month of ${MONTH_NAMES[month - 1]}- ${year}`, TITLE_FILL, { height: 26 });

  function metaRow(labelA, valueA, labelB, valueB) {
    const row = sheet.addRow([labelA, valueA, labelB, valueB, '', '']);
    sheet.mergeCells(row.number, 2, row.number, 3);
    sheet.mergeCells(row.number, 4, row.number, 6);
    [1, 4].forEach((c) => {
      row.getCell(c).font = { bold: true };
      row.getCell(c).fill = META_FILL;
    });
    for (let c = 1; c <= COLS; c += 1) row.getCell(c).border = BORDER;
    return row;
  }

  metaRow('Employee Name', membership.person.name, 'Client Name', '');
  metaRow('Date of Joining', membership.joined_at ? membership.joined_at.toISOString().slice(0, 10) : '', 'Project ID', '');
  metaRow(
    'Location',
    membership.location?.name || membership.location?.city || '',
    'Project Name',
    [...projectNames, 'Monthly', membership.designation?.name].filter(Boolean).join(' - ')
  );

  mergedRow(
    '( CH - Company Holiday,  LT - Leave Taken,  WH - Weekly Holiday,  OT - Overtime/Holiday Work — highlighted rows )',
    META_FILL,
    { dark: true, size: 10, height: 16 }
  );

  const header = sheet.addRow(['Date', 'Developer', 'Total Hours', 'Project', 'Hours', 'Description']);
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = BORDER;
  });

  const total = daysInMonth(year, month);
  for (let d = 1; d <= total; d += 1) {
    const date = new Date(Date.UTC(year, month - 1, d));
    const key = date.toISOString().slice(0, 10);
    const label = `${String(d).padStart(2, '0')}-${MONTH_NAMES[month - 1].slice(0, 3)}-${String(year).slice(2)}`;
    const dow = date.getUTCDay();
    const day = byDate.get(key);

    if (day) {
      const startRow = sheet.rowCount + 1;
      for (const entry of day.entries) {
        const particulars = entry.is_holiday_overtime
          ? `${entry.notes ? `${entry.notes} — ` : ''}OT: ${entry.holiday_label || 'Project holiday'}`
          : entry.notes || '';
        const row = sheet.addRow(['', membership.person.name, '', entry.account?.name || '', entry.hours, particulars]);
        row.eachCell((cell) => {
          cell.border = BORDER;
          if (entry.is_holiday_overtime) cell.fill = OT_FILL;
        });
        row.getCell(5).alignment = { horizontal: 'center' };
        // Descriptions keep their line breaks and wrap inside the cell.
        row.getCell(6).alignment = { wrapText: true, vertical: 'top' };
      }
      const endRow = sheet.rowCount;
      sheet.getCell(startRow, 1).value = label;
      sheet.getCell(startRow, 3).value = day.total_hours;
      sheet.getCell(startRow, 3).alignment = { horizontal: 'center', vertical: 'middle' };
      if (endRow > startRow) {
        sheet.mergeCells(startRow, 1, endRow, 1);
        sheet.mergeCells(startRow, 2, endRow, 2);
        sheet.mergeCells(startRow, 3, endRow, 3);
      }
      sheet.getCell(startRow, 1).alignment = { horizontal: 'center', vertical: 'middle' };
      sheet.getCell(startRow, 2).alignment = { horizontal: 'center', vertical: 'middle' };
    } else if (dow === 0 || dow === 6) {
      const row = sheet.addRow([label, membership.person.name, 'Weekly Holiday', '', '', '']);
      sheet.mergeCells(row.number, 3, row.number, 6);
      row.eachCell((cell) => {
        cell.border = BORDER;
        cell.fill = WH_FILL;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
    }
    // A weekday with nothing logged and no detectable holiday is omitted —
    // see the function doc comment on why CH/LT aren't guessed at here.
  }

  return { workbook };
}

module.exports = { buildMonthlyWorkbook };
