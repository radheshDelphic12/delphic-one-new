// CSV and XLSX output. Everything goes through mask.show, so always-masked columns never appear and sensitive ones only on reveal.
const ExcelJS = require('exceljs');
const { show } = require('./mask');
const { readTable } = require('./dumpReader');

const CELL_MAX = 32000; // Excel's limit is 32767 characters per cell

// A value that a spreadsheet would run as a formula is neutralised in CSV (XLSX stores strings as strings).
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+@]/.test(s) || /^-[^0-9.]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvLine(values) {
  return `${values.map(csvCell).join(',')}\r\n`;
}

const clip = (v) => (typeof v === 'string' && v.length > CELL_MAX ? `${v.slice(0, CELL_MAX)}...` : v);

async function writeTableCsv(res, dump, table, reveal) {
  const t = await readTable(dump, table);
  res.write(csvLine(t.columns));
  for (const row of t.rows) res.write(csvLine(row.map((v, i) => show(t.columns[i], v, reveal))));
  res.end();
}

function sheetNamer() {
  const used = new Set();
  return (raw) => {
    let base = String(raw).replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'sheet';
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base.slice(0, 31 - String(n).length - 1)}_${n}`;
    used.add(name.toLowerCase());
    return name;
  };
}

function newWorkbook(res, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false });
}

function headerRow(sheet, values) {
  const row = sheet.addRow(values);
  row.font = { bold: true };
  row.commit();
}

// Whole snapshot: one sheet per table that has rows. Tables are read one at a time, so memory stays at one table.
async function writeSnapshotXlsx(res, dump, index, filename, reveal) {
  const wb = newWorkbook(res, filename);
  const name = sheetNamer();
  for (const table of Object.keys(index.tables).sort()) {
    if (!index.tables[table].rows) continue;
    const t = await readTable(dump, table);
    const sheet = wb.addWorksheet(name(table), { views: [{ state: 'frozen', ySplit: 1 }] });
    headerRow(sheet, t.columns);
    for (const row of t.rows) sheet.addRow(row.map((v, i) => clip(show(t.columns[i], v, reveal)))).commit();
    sheet.commit();
  }
  await wb.commit();
}

// A comparison: Summary, then one sheet per changed table: Change, Key, then the table's columns. Added / removed rows carry their
// values; a changed row carries "old -> new" in each column that changed (and is shaded), blank elsewhere.
async function writeCompareXlsx(res, summary, readResult, filename, reveal) {
  const wb = newWorkbook(res, filename);
  const name = sheetNamer();
  const s = wb.addWorksheet(name('Summary'), { views: [{ state: 'frozen', ySplit: 4 }] });
  s.addRow([`A: ${summary.a.id} (${summary.a.time_ist} IST)`]).commit();
  s.addRow([`B: ${summary.b.id} (${summary.b.time_ist} IST)`]).commit();
  s.addRow([`Migrations added: ${summary.schema.migrations_added.join(', ') || 'none'}`]).commit();
  headerRow(s, ['Table', 'Added', 'Removed', 'Changed', 'Rows in A', 'Rows in B', 'Columns added', 'Columns removed']);
  for (const t of summary.tables) s.addRow([t.name, t.added, t.removed, t.changed, t.rows_a, t.rows_b, t.columns_added.join(', '), t.columns_removed.join(', ')]).commit();
  s.commit();
  const shade = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
  for (const t of summary.tables) {
    const d = readResult(t.name);
    if (!d) continue;
    const sheet = wb.addWorksheet(name(t.name), { views: [{ state: 'frozen', ySplit: 1 }] });
    headerRow(sheet, ['Change', 'Key', ...d.columns]);
    const key = (k) => (k ? k.join(' | ') : '');
    const cellsOf = (row) => d.columns.map((c) => clip(show(c, row[c], reveal)));
    for (const r of d.added) sheet.addRow(['added', key(r.key), ...cellsOf(r.row)]).commit();
    for (const r of d.removed) sheet.addRow(['removed', key(r.key), ...cellsOf(r.row)]).commit();
    for (const r of d.changed) {
      const byCol = Object.fromEntries(r.changes.map((c) => [c.col, c]));
      const row = sheet.addRow(['changed', key(r.key), ...d.columns.map((c) => {
        const ch = byCol[c];
        if (!ch) return null;
        if (ch.masked) return '(changed)';
        const [o, n] = [show(c, ch.old, reveal), show(c, ch.new, reveal)];
        return clip(`${o === null ? '(empty)' : o} -> ${n === null ? '(empty)' : n}`);
      })]);
      d.columns.forEach((c, i) => { if (byCol[c]) row.getCell(i + 3).fill = shade; });
      row.commit();
    }
    sheet.commit();
  }
  await wb.commit();
}

module.exports = { csvLine, csvCell, writeTableCsv, writeSnapshotXlsx, writeCompareXlsx };
