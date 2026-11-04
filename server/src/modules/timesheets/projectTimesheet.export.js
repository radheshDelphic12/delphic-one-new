const ExcelJS = require('exceljs');
const prisma = require('../../config/db');
const workHours = require('./workHours.service');
const { todayIst } = require('../../lib/istDate');
const { toPlainText, moduleLabel } = require('./projectTimesheet.text');

/**
 * Project-wise monthly timesheet (.xlsx), the client format: one sheet per month ("oct 2026"), header block,
 * one block per working day (Total Hours is a live =ROUND(SUM()) formula) and one row for each non-working day.
 *
 * Day status, in this order: logged on this project -> working day; company holiday (CH); weekly off (WH);
 * approved leave (LT); logged on another project only -> blank row; nothing at all -> "Not Logged" (light red).
 * Holiday / week-off / leave come from workHours.daySummaries, the same source as the attendance views.
 */

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const COLS = 6;
const FONT = { name: 'Arial', size: 10 };
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const FILLS = {
  title: fill('FF1F4E78'),
  label: fill('FFBDD7EE'),
  value: fill('FFDDEBF7'),
  legend: fill('FFFCE4D6'),
  head: fill('FF2E75B6'),
  work: fill('FFE2EFDA'),
  off: fill('FFFFC000'),
  total: fill('FFA9D08E'),
  missing: fill('FFF4CCCC'),
};
const THIN = { style: 'thin', color: { argb: 'FF999999' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const DATE_FORMAT = 'd\\-mmm\\-yy';
const OFF_LABELS = { company_holiday: 'Company Holiday', weekend: 'Weekly Holiday', leave: 'Leave Taken', half_leave: 'Leave Taken (Half Day)' };
const STATUS_SETS = { both: ['submitted', 'approved'], pending: ['submitted'], approved: ['approved'] };

const ymd = (d) => d.toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;

function minutesLabel(total) {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

function fileName(projectName, employeeName, month, year) {
  const clean = (s) => String(s).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `Timesheet_${clean(projectName)}_${MONTH_NAMES[month - 1].slice(0, 3)}_${year}_${clean(employeeName)}.xlsx`;
}

// Everything the sheet needs for one person + project + month, as plain data (also drives the UI warning).
async function loadMonth({ orgId, membershipId, projectId, month, year, statuses = 'both' }) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  const [entries, otherEntries, summary] = await Promise.all([
    prisma.timesheetEntry.findMany({
      where: { org_id: orgId, org_membership_id: membershipId, account_id: projectId, date: { gte: from, lte: to }, status: { in: STATUS_SETS[statuses] || STATUS_SETS.both } },
      orderBy: [{ date: 'asc' }, { created_at: 'asc' }],
      select: { date: true, hours: true, overtime_hours: true, notes: true },
    }),
    prisma.timesheetEntry.findMany({
      where: { org_id: orgId, org_membership_id: membershipId, account_id: { not: projectId }, date: { gte: from, lte: to }, status: { not: 'rejected' } },
      select: { date: true },
    }),
    workHours.daySummaries(orgId, membershipId, from, to),
  ]);
  const byDay = new Map();
  for (const e of entries) {
    const key = ymd(e.date);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push({
      hours: round2(Number(e.hours) + Number(e.overtime_hours || 0)),
      notes: e.notes || '',
    });
  }
  const otherDays = new Set(otherEntries.map((e) => ymd(e.date)));
  const summaryByDay = new Map(summary.days.map((d) => [d.date, d]));
  return { from, to, byDay, otherDays, summaryByDay };
}

// One item per calendar day to show: joining date and today bound the month.
function buildDays({ year, month, joinedAt, data, today }) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const todayKey = ymd(today);
  const joinKey = joinedAt ? ymd(joinedAt) : null;
  const days = [];
  for (let d = 1; d <= lastDay; d += 1) {
    const date = new Date(Date.UTC(year, month - 1, d));
    const key = ymd(date);
    if (key > todayKey) break;
    if (joinKey && key < joinKey) continue;
    const logged = data.byDay.get(key);
    const info = data.summaryByDay.get(key);
    if (logged) {
      const halfLeave = (info?.leaves || []).some((l) => l.is_half_day);
      days.push({ date, key, kind: 'work', entries: logged, note: halfLeave ? 'Half-day leave approved on this day' : '' });
    } else if (info?.day_type === 'company_holiday') days.push({ date, key, kind: 'company_holiday', label: info.label });
    else if (info?.day_type === 'weekend') days.push({ date, key, kind: 'weekend' });
    else if ((info?.leaves || []).length) days.push({ date, key, kind: (info.leaves.every((l) => l.is_half_day) ? 'half_leave' : 'leave') });
    else if (data.otherDays.has(key)) days.push({ date, key, kind: 'other' });
    else if (key === todayKey) days.push({ date, key, kind: 'today' });
    else days.push({ date, key, kind: 'missing' });
  }
  return days;
}

function styleRow(row, fillStyle, opts = {}) {
  for (let c = 1; c <= COLS; c += 1) {
    const cell = row.getCell(c);
    cell.font = { ...FONT, bold: Boolean(opts.bold) };
    if (fillStyle) cell.fill = fillStyle;
    cell.border = BORDER;
    cell.alignment = { vertical: 'top' };
  }
}

function writeMonthSheet(workbook, { membership, project, month, year, days, timeSlots }) {
  const sheet = workbook.addWorksheet(`${MONTH_NAMES[month - 1].slice(0, 3).toLowerCase()} ${year}`);
  sheet.columns = [{ width: 17.27 }, { width: 31.36 }, { width: 12.63 }, { width: 61.63 }, { width: 12.63 }, { width: 179.63 }];

  sheet.mergeCells('A1:F1');
  const title = sheet.getCell('A1');
  title.value = `Timesheet for the Month of ${MONTH_NAMES[month - 1]} - ${year}`;
  title.font = { ...FONT, size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = FILLS.title;
  title.alignment = { horizontal: 'center' };
  sheet.getRow(1).height = 15.75;
  sheet.getRow(2).height = 15.75;

  const meta = [
    ['Employee Name', membership.person.name, 'Client Name', project.client_name || ''],
    ['Date of Joining', membership.joined_at || null, 'Time Slots (8hr)', timeSlots],
    ['Location', membership.location?.name || membership.location?.city || '', 'Project Name', project.name],
  ];
  meta.forEach(([la, va, lb, vb], i) => {
    const r = 3 + i;
    sheet.mergeCells(`D${r}:F${r}`);
    sheet.getCell(`A${r}`).value = la;
    sheet.getCell(`B${r}`).value = va;
    sheet.getCell(`C${r}`).value = lb;
    sheet.getCell(`D${r}`).value = vb;
    for (let c = 1; c <= COLS; c += 1) {
      const cell = sheet.getCell(r, c);
      const isLabel = c === 1 || c === 3;
      cell.font = { ...FONT, bold: isLabel };
      cell.fill = isLabel ? FILLS.label : FILLS.value;
      cell.border = BORDER;
    }
    sheet.getRow(r).height = 12.75;
  });
  sheet.getCell('B4').numFmt = DATE_FORMAT;

  sheet.mergeCells('A6:F6');
  const legend = sheet.getCell('A6');
  legend.value = '( CH - Company Holiday, LT - Leave Taken, WH - Weekly Holiday )';
  legend.font = { ...FONT, size: 9 };
  legend.fill = FILLS.legend;
  sheet.getRow(7).height = 15.75;

  const head = sheet.getRow(8);
  ['Date', 'Developer', 'Total Hours', 'Modules', 'Hours', 'Particulars'].forEach((text, i) => { head.getCell(i + 1).value = text; });
  for (let c = 1; c <= COLS; c += 1) {
    const cell = head.getCell(c);
    cell.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = FILLS.head;
    cell.border = BORDER;
    cell.alignment = { horizontal: 'center' };
  }

  const totalCells = [];
  for (const day of days) {
    if (day.kind === 'work') {
      const start = sheet.rowCount + 1;
      day.entries.forEach((e, idx) => {
        const row = sheet.addRow([]);
        styleRow(row, FILLS.work);
        if (idx === 0) {
          row.getCell(1).value = day.date;
          row.getCell(1).numFmt = DATE_FORMAT;
          row.getCell(2).value = membership.person.name;
        }
        row.getCell(3).font = { ...FONT, bold: true };
        row.getCell(3).alignment = { horizontal: 'center', vertical: 'top' };
        row.getCell(4).value = moduleLabel(project.name, e.notes);
        row.getCell(5).value = e.hours;
        row.getCell(5).alignment = { horizontal: 'center', vertical: 'top' };
        const particulars = toPlainText(e.notes);
        row.getCell(6).value = idx === day.entries.length - 1 && day.note ? `${particulars}${particulars ? ' ' : ''}(${day.note})` : particulars;
        row.getCell(6).alignment = { vertical: 'top', wrapText: true };
      });
      const end = sheet.rowCount;
      sheet.getCell(start, 3).value = { formula: `ROUND(SUM(E${start}:E${end}),2)`, result: round2(day.entries.reduce((s, e) => s + e.hours, 0)) };
      totalCells.push(`C${start}`);
    } else {
      const row = sheet.addRow([day.date, membership.person.name]);
      row.getCell(1).numFmt = DATE_FORMAT;
      if (day.kind === 'missing') {
        row.getCell(3).value = 'Not Logged';
        styleRow(row, FILLS.missing, { bold: true });
      } else if (day.kind === 'other' || day.kind === 'today') {
        styleRow(row, null);
      } else {
        row.getCell(3).value = OFF_LABELS[day.kind];
        styleRow(row, FILLS.off, { bold: true });
      }
    }
  }

  const totalRow = sheet.addRow([]);
  const sum = totalCells.map((c) => c);
  const monthTotal = round2(days.filter((d) => d.kind === 'work').reduce((s, d) => s + d.entries.reduce((a, e) => a + e.hours, 0), 0));
  totalRow.getCell(3).value = sum.length ? { formula: sum.join('+'), result: monthTotal } : 0;
  totalRow.getCell(4).value = 'Total Hours for the Month';
  for (const c of [3, 4]) {
    const cell = totalRow.getCell(c);
    cell.font = { ...FONT, bold: true };
    cell.fill = FILLS.total;
    cell.border = BORDER;
  }
  return sheet;
}

/**
 * Workbook for one project over one or more months. `months` is [{ month, year }].
 * Returns { workbook, fileName, project, missing: [{ month, year, dates: [] }], logged_days } or { error }.
 */
async function buildProjectWorkbook({ orgId, membershipId, projectId, months, statuses = 'both' }) {
  const [membership, project] = await Promise.all([
    prisma.orgMembership.findFirst({
      where: { id: membershipId, org_id: orgId },
      select: {
        person: { select: { name: true } },
        joined_at: true,
        location: { select: { name: true, city: true } },
        shift: { select: { start_minutes: true, end_minutes: true } },
      },
    }),
    prisma.account.findFirst({ where: { id: projectId, org_id: orgId }, select: { id: true, name: true, project_name: true, client_name: true } }),
  ]);
  if (!membership) return { error: 'member_not_found' };
  if (!project) return { error: 'project_not_found' };
  const projectInfo = { id: project.id, name: project.project_name || project.name, client_name: project.client_name };
  const timeSlots = membership.shift ? `${minutesLabel(membership.shift.start_minutes)} - ${minutesLabel(membership.shift.end_minutes)} (IST)` : '';

  const workbook = new ExcelJS.Workbook();
  const missing = [];
  let loggedDays = 0;
  for (const { month, year } of months) {
    const data = await loadMonth({ orgId, membershipId, projectId, month, year, statuses });
    const days = buildDays({ year, month, joinedAt: membership.joined_at, data, today: todayIst() });
    loggedDays += days.filter((d) => d.kind === 'work').length;
    missing.push({ month, year, dates: days.filter((d) => d.kind === 'missing').map((d) => d.key) });
    writeMonthSheet(workbook, { membership, project: projectInfo, month, year, days, timeSlots });
  }
  const first = months[0];
  return { workbook, project: projectInfo, employee: membership.person.name, fileName: fileName(projectInfo.name, membership.person.name, first.month, first.year), missing, logged_days: loggedDays };
}

// Projects the person logged hours on in a month (non-rejected), for the dropdown.
async function loggedProjects({ orgId, membershipId, month, year }) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  const rows = await prisma.timesheetEntry.findMany({
    where: { org_id: orgId, org_membership_id: membershipId, account_id: { not: null }, status: { not: 'rejected' }, date: { gte: from, lte: to } },
    select: { account: { select: { id: true, name: true, project_name: true } } },
    distinct: ['account_id'],
  });
  return rows.map((r) => ({ id: r.account.id, name: r.account.project_name || r.account.name })).sort((a, b) => a.name.localeCompare(b.name));
}

// Days with nothing logged, no holiday, no week-off and no leave, for the warning shown before a download.
async function missingDays({ orgId, membershipId, projectId, month, year, statuses = 'both' }) {
  const membership = await prisma.orgMembership.findFirst({ where: { id: membershipId, org_id: orgId }, select: { joined_at: true } });
  if (!membership) return [];
  const data = await loadMonth({ orgId, membershipId, projectId, month, year, statuses });
  return buildDays({ year, month, joinedAt: membership.joined_at, data, today: todayIst() }).filter((d) => d.kind === 'missing').map((d) => d.key);
}

module.exports = { buildProjectWorkbook, loggedProjects, missingDays, buildDays, fileName, STATUS_SETS };
