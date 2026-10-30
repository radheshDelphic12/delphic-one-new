const PDFDocument = require('pdfkit');
const { amountInWords } = require('./amountWords');
const { D } = require('../modules/cashPosition/cash.calc');

// The one printed invoice layout used for every invoice the system produces (GST / USD invoices, client invoices, vendor invoices):
// a boxed tax-invoice page - seller and buyer on the left, the invoice particulars on the right, an items table with the tax lines
// inside it, the amount in words, the tax summary, bank details, declaration and signature. One copy per label in `copies`
// (default: Original for Recipient only). Drawn with pdfkit from a plain model, so a caller only maps
// its own data to the model below.
//
// model = {
//   title,                     // 'Tax Invoice' | 'Invoice' | 'Export Invoice'
//   currency,                  // 'INR' | 'USD'
//   copies,                    // optional array of labels
//   seller: { name, address, gstin, state_name, state_code, pan },
//   buyer:  { name, address, gstin, state_name, state_code },
//   place_of_supply,           // text, shown under the buyer
//   meta: { number, date, terms, delivery_note, buyer_order_no, ... },  // blank boxes stay blank
//   lines: [{ description, details: [text], hsn, gst_rate, qty, unit, rate, amount }],
//   showHsn, showTax,          // columns of the items table
//   taxes: [{ label, amount }], round_off,
//   subtotal, total,
//   tax_summary: [{ rate, taxable, parts: [{ label, amount }] }],     // GST invoices only
//   bank: { holder, lines: [text] }, remarks, declaration, notes, jurisdiction, cancelled
// }

const M = 28;
const MARGINS = { top: M, left: M, right: M, bottom: 0 }; // no bottom margin: the footer sits below the usual text area and must not trigger a new page
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const W = PAGE_W - 2 * M;
const COPIES = ['ORIGINAL FOR RECIPIENT'];
const INK = '#000';
const LINE = '#222';
const MUTED = '#444';
const DECLARATION = 'We declare that this invoice shows the actual price of the Services Described and that all particulars are true and correct.';

const fmt = (n, currency) => {
  const [whole, frac] = D(n).toFixed(2).split('.');
  const neg = whole.startsWith('-');
  const digits = neg ? whole.slice(1) : whole;
  const grouped = Number(digits).toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US');
  return `${neg ? '-' : ''}${grouped}.${frac}`;
};
const qtyText = (q) => String(Number(q));

function rule(doc, x1, y1, x2, y2) {
  doc.save().lineWidth(0.6).strokeColor(LINE).moveTo(x1, y1).lineTo(x2, y2).stroke().restore();
}

function box(doc, x, y, w, h) {
  doc.save().lineWidth(0.6).strokeColor(LINE).rect(x, y, w, h).stroke().restore();
}

function setFont(doc, font, size, color = INK) {
  doc.font(font).fontSize(size).fillColor(color);
}

/** Height a text takes at width w with the current font settings. */
const heightOf = (doc, text, w) => doc.heightOfString(String(text ?? ''), { width: w });

/** Party block: array of { text, font, size, color, gap } -> height, and draws when `draw` is set. */
function party(doc, x, y, w, items, draw) {
  let cy = y;
  for (const it of items) {
    if (!it.text) continue;
    setFont(doc, it.font || 'Helvetica', it.size || 8, it.color);
    const h = heightOf(doc, it.text, w);
    if (draw) doc.text(String(it.text), x, cy, { width: w });
    cy += h + (it.gap ?? 1);
  }
  return cy - y;
}

function partyItems(p, buyer, placeOfSupply) {
  const items = [{ text: p.name, font: 'Helvetica-Bold', size: 9 }];
  if (p.address) items.push({ text: p.address });
  if (p.gstin) items.push({ text: `GSTIN/UIN : ${p.gstin}` });
  if (p.pan) items.push({ text: `PAN : ${p.pan}` });
  if (p.state_name || p.state_code) items.push({ text: `State Name : ${p.state_name || ''}${p.state_code ? `${p.state_name ? ', ' : ''}Code : ${p.state_code}` : ''}` });
  if (buyer && placeOfSupply) items.push({ text: `Place of Supply : ${placeOfSupply}` });
  return items;
}

function columns(model) {
  const cols = [{ key: 'sl', title: 'SI\nNo.', w: 24, align: 'center' }, { key: 'desc', title: 'Description of Goods', w: 0, align: 'left' }];
  if (model.showHsn) cols.push({ key: 'hsn', title: 'HSN/SAC', w: 52, align: 'left' });
  if (model.showTax) cols.push({ key: 'gst', title: 'GST\nRate', w: 36, align: 'center' });
  cols.push({ key: 'qty', title: 'Quantity', w: 60, align: 'right' }, { key: 'rate', title: 'Rate', w: 62, align: 'right' }, { key: 'per', title: 'per', w: 30, align: 'center' }, { key: 'amount', title: 'Amount', w: 80, align: 'right' });
  const fixed = cols.reduce((a, c) => a + c.w, 0);
  cols.find((c) => c.key === 'desc').w = W - fixed;
  let x = M;
  for (const c of cols) { c.x = x; x += c.w; }
  return cols;
}

/** Height of one item row (description block drives it). */
function rowHeight(doc, line, descW) {
  setFont(doc, 'Helvetica-Bold', 9);
  let h = heightOf(doc, line.description, descW - 8) + 2;
  setFont(doc, 'Helvetica-Oblique', 7);
  for (const d of line.details || []) h += heightOf(doc, d, descW - 8) + 1;
  return h + 6;
}

function drawRow(doc, cols, model, line, i, y) {
  const cell = (key) => cols.find((c) => c.key === key);
  const text = (key, value, font = 'Helvetica', size = 8.5) => {
    const c = cell(key);
    if (!c || value === '' || value === null || value === undefined) return;
    setFont(doc, font, size);
    doc.text(String(value), c.x + 3, y + 3, { width: c.w - 6, align: c.align });
  };
  text('sl', i + 1);
  const d = cell('desc');
  setFont(doc, 'Helvetica-Bold', 9);
  doc.text(line.description, d.x + 4, y + 3, { width: d.w - 8 });
  let cy = doc.y + 1;
  setFont(doc, 'Helvetica-Oblique', 7);
  for (const detail of line.details || []) { doc.text(detail, d.x + 4, cy, { width: d.w - 8 }); cy = doc.y + 1; }
  text('hsn', line.hsn);
  text('gst', line.gst_rate !== undefined && line.gst_rate !== null && line.gst_rate !== '' ? `${line.gst_rate} %` : '');
  text('qty', `${qtyText(line.qty)}${line.unit ? ` ${line.unit}` : ''}`, 'Helvetica-Bold', 8.5);
  text('rate', fmt(line.rate, model.currency));
  text('per', line.unit || '');
  text('amount', fmt(line.amount, model.currency), 'Helvetica-Bold', 8.5);
}

/** Tax summary table (GST invoices): taxable value, one rate + amount pair per tax, and the total tax amount. */
function taxSummary(doc, model, x, y, w, draw) {
  const rows = model.tax_summary || [];
  if (!rows.length) return 0;
  const parts = rows[0].parts;
  const valueW = 96;
  const totalW = 92;
  const pairW = (w - valueW - totalW) / parts.length;
  const rateW = 38;
  const rowH = 12;
  const total = rows.reduce((a, r) => ({ taxable: a.taxable.plus(D(r.taxable)), tax: a.tax.plus(r.parts.reduce((s, p) => s.plus(D(p.amount)), D(0))), parts: a.parts.map((p, i) => p.plus(D(r.parts[i].amount))) }), { taxable: D(0), tax: D(0), parts: parts.map(() => D(0)) });
  const h = rowH * (3 + rows.length);
  if (!draw) return h;
  box(doc, x, y, w, h);
  const cellText = (t, cx, cy, cw, align = 'right', font = 'Helvetica') => { setFont(doc, font, 7.5); doc.text(String(t), cx + 2, cy + 2.5, { width: cw - 4, align }); };
  rule(doc, x + valueW, y, x + valueW, y + h);
  rule(doc, x + w - totalW, y, x + w - totalW, y + h);
  cellText('Taxable', x, y, valueW, 'center'); cellText('Value', x, y + rowH, valueW, 'center');
  cellText('Total', x + w - totalW, y, totalW, 'center'); cellText('Tax Amount', x + w - totalW, y + rowH, totalW, 'center');
  parts.forEach((p, i) => {
    const px = x + valueW + i * pairW;
    if (i) rule(doc, px, y, px, y + h);
    cellText(p.label, px, y, pairW, 'center');
    rule(doc, px, y + rowH, px + pairW, y + rowH);
    rule(doc, px + rateW, y + rowH, px + rateW, y + h);
    cellText('Rate', px, y + rowH, rateW, 'center'); cellText('Amount', px + rateW, y + rowH, pairW - rateW, 'center');
  });
  rule(doc, x + valueW, y + 2 * rowH, x + w, y + 2 * rowH);
  rule(doc, x, y + 2 * rowH, x + valueW, y + 2 * rowH);
  rows.forEach((r, ri) => {
    const ry = y + (2 + ri) * rowH;
    cellText(fmt(r.taxable, model.currency), x, ry, valueW);
    r.parts.forEach((p, i) => {
      const px = x + valueW + i * pairW;
      cellText(`${r.rate}%`, px, ry, rateW);
      cellText(fmt(p.amount, model.currency), px + rateW, ry, pairW - rateW);
    });
    cellText(fmt(r.parts.reduce((s, p) => s.plus(D(p.amount)), D(0)), model.currency), x + w - totalW, ry, totalW);
  });
  const ty = y + (2 + rows.length) * rowH;
  rule(doc, x, ty, x + w, ty);
  cellText(fmt(total.taxable, model.currency), x, ty, valueW, 'right', 'Helvetica-Bold');
  total.parts.forEach((p, i) => cellText(fmt(p, model.currency), x + valueW + i * pairW + rateW, ty, pairW - rateW, 'right', 'Helvetica-Bold'));
  cellText(fmt(total.tax, model.currency), x + w - totalW, ty, totalW, 'right', 'Helvetica-Bold');
  return h;
}

function drawCopy(doc, model, copyLabel, cols) {
  const desc = cols.find((c) => c.key === 'desc');
  const leftW = Math.round(W * 0.56);
  const rightW = W - leftW;

  // ---- measure the bottom block (amount in words, tax summary, bank, signature) ----
  const words = amountInWords(model.total, model.currency);
  const taxWords = model.showTax && model.tax_summary?.length ? amountInWords(model.tax_summary.reduce((a, r) => a.plus(r.parts.reduce((s, p) => s.plus(D(p.amount)), D(0))), D(0)), model.currency) : null;
  const bankLines = [model.bank?.holder ? `A/c Holder's Name : ${model.bank.holder}` : null, ...(model.bank?.lines || [])].filter(Boolean);
  setFont(doc, 'Helvetica', 8);
  const bankH = bankLines.length ? heightOf(doc, bankLines.join('\n'), rightW - 12) + 18 : 18;
  const remarksText = [model.remarks, model.notes].filter(Boolean).join('\n');
  const leftBottomH = (remarksText ? heightOf(doc, remarksText, leftW - 12) + 12 : 12) + heightOf(doc, model.declaration || DECLARATION, leftW - 12) + 24;
  const sumH = taxWords ? taxSummary(doc, model, 0, 0, 380, false) : 0;
  const signH = 52;
  const midH = Math.max(bankH, leftBottomH);
  const bottomH = 34 + (taxWords ? sumH + 24 : 0) + midH + signH;
  const footerY = PAGE_H - M - 22;

  // ---- header block (seller + buyer / particulars) ----
  const titleY = M;
  setFont(doc, 'Helvetica-Bold', 11);
  doc.text(model.title, M, titleY, { width: W, align: 'center' });
  setFont(doc, 'Helvetica-Oblique', 7.5);
  doc.text(`(${copyLabel})`, M, titleY + 2, { width: W, align: 'right' });
  const top = titleY + 17;
  const sellerItems = partyItems(model.seller);
  const buyerItems = [{ text: 'Buyer (Bill to)', size: 7.5, color: MUTED }, ...partyItems(model.buyer, true, model.place_of_supply)];
  const sellerH = party(doc, 0, 0, leftW - 12, sellerItems, false) + 8;
  const buyerH = party(doc, 0, 0, leftW - 12, buyerItems, false) + 8;
  const headerH = Math.max(sellerH + buyerH, 190);
  box(doc, M, top, W, headerH);
  rule(doc, M + leftW, top, M + leftW, top + headerH);
  party(doc, M + 6, top + 4, leftW - 12, sellerItems, true);
  rule(doc, M, top + sellerH, M + leftW, top + sellerH);
  party(doc, M + 6, top + sellerH + 3, leftW - 12, buyerItems, true);

  const m = model.meta || {};
  const gridRows = [[['Invoice No.', m.number, true], ['Dated', m.date, true]], [['Delivery Note', m.delivery_note], ['Mode/Terms of Payment', m.terms]], [["Buyer's Order No.", m.buyer_order_no], ['Dated', m.buyer_order_date]], [['Dispatch Doc No.', m.dispatch_doc_no], ['Delivery Note Date', m.delivery_note_date]], [['Dispatched through', m.dispatched_through], ['Destination', m.destination]]];
  const cellH = 31;
  const half = rightW / 2;
  gridRows.forEach((row, ri) => {
    row.forEach(([label, value, bold], ci) => {
      const cx = M + leftW + ci * half;
      const cy = top + ri * cellH;
      setFont(doc, 'Helvetica', 7.5, MUTED);
      doc.text(label, cx + 4, cy + 3, { width: half - 8 });
      if (value) { setFont(doc, bold ? 'Helvetica-Bold' : 'Helvetica', 8.5); doc.text(String(value), cx + 4, cy + 14, { width: half - 8 }); }
    });
    rule(doc, M + leftW, top + (ri + 1) * cellH, M + W, top + (ri + 1) * cellH);
    rule(doc, M + leftW + half, top + ri * cellH, M + leftW + half, top + (ri + 1) * cellH);
  });
  setFont(doc, 'Helvetica', 7.5, MUTED);
  doc.text('Terms of Delivery', M + leftW + 4, top + gridRows.length * cellH + 3, { width: rightW - 8 });
  if (m.terms_of_delivery) { setFont(doc, 'Helvetica', 8); doc.text(m.terms_of_delivery, M + leftW + 4, top + gridRows.length * cellH + 14, { width: rightW - 8 }); }

  // ---- items table ----
  const tableTop = top + headerH;
  const headH = 22;
  box(doc, M, tableTop, W, headH);
  for (const c of cols) {
    if (c.x > M) rule(doc, c.x, tableTop, c.x, tableTop + headH);
    setFont(doc, 'Helvetica', 7.5);
    const lines = c.title.split('\n').length;
    doc.text(c.title, c.x + 2, tableTop + (lines > 1 ? 3 : 7), { width: c.w - 4, align: 'center' });
  }
  const bodyTop = tableTop + headH;
  const bodyBottom = footerY - bottomH - 20;
  const taxRows = [...(model.taxes || []).filter((t) => !D(t.amount).isZero()), ...(D(model.round_off || 0).isZero() ? [] : [{ label: 'Round Off', amount: model.round_off, less: true }])];
  const taxH = taxRows.length * 14 + (model.cancelled ? 20 : 0);
  const capLast = bodyBottom - bodyTop - 4 - taxH; // first page and last page carry the header / the totals block
  const capFull = footerY - 8 - (M + 17 + headH) - 4;
  const heights = model.lines.map((l) => rowHeight(doc, l, desc.w));
  const pages = [];
  let cur = [];
  let used = 0;
  heights.forEach((h, i) => {
    const cap = pages.length === 0 ? capLast : capFull;
    if (cur.length && used + h > cap) { pages.push(cur); cur = []; used = 0; }
    cur.push(i);
    used += h;
  });
  pages.push(cur);
  // the last page also holds the tax lines and the totals block: push rows that no longer fit onto one more page
  const lastRows = pages[pages.length - 1];
  const lastUsed = lastRows.reduce((a, i) => a + heights[i], 0);
  const lastLimit = pages.length === 1 ? capLast : bodyBottom - (M + 17 + headH) - 4 - taxH;
  if (lastUsed > lastLimit && lastRows.length > 1) {
    let moved = [];
    let u = lastUsed;
    while (u > lastLimit && lastRows.length > 1) { const i = lastRows.pop(); u -= heights[i]; moved.unshift(i); }
    pages.push(moved);
  } else if (lastUsed > lastLimit) pages.push([]);

  pages.forEach((idx, pi) => {
    if (pi > 0) {
      doc.addPage({ size: 'A4', margins: MARGINS });
      setFont(doc, 'Helvetica-Bold', 11);
      doc.text(model.title, M, M, { width: W, align: 'center' });
      setFont(doc, 'Helvetica-Oblique', 7.5);
      doc.text(`(${copyLabel}) - continued, invoice ${m.number || ''}`, M, M + 2, { width: W, align: 'right' });
    }
    const last = pi === pages.length - 1;
    const y0 = pi === 0 ? bodyTop : M + 17 + headH;
    if (pi > 0) {
      box(doc, M, M + 17, W, headH);
      for (const c of cols) {
        if (c.x > M) rule(doc, c.x, M + 17, c.x, M + 17 + headH);
        setFont(doc, 'Helvetica', 7.5);
        doc.text(c.title, c.x + 2, M + 17 + (c.title.includes('\n') ? 3 : 7), { width: c.w - 4, align: 'center' });
      }
    }
    const yEnd = last ? bodyBottom : footerY - 8;
    // body frame and column lines
    box(doc, M, y0, W, yEnd - y0);
    for (const c of cols) if (c.x > M) rule(doc, c.x, y0, c.x, yEnd);
    let y = y0 + 2;
    idx.forEach((i) => { drawRow(doc, cols, model, model.lines[i], i, y); y += heights[i]; });
    if (last) {
      y += 6;
      const amountCol = cols.find((c) => c.key === 'amount');
      taxRows.forEach((t) => {
        if (t.less) { setFont(doc, 'Helvetica-Oblique', 8); doc.text('Less :', desc.x + 6, y, { width: 60 }); }
        setFont(doc, 'Helvetica-BoldOblique', 8.5);
        doc.text(t.label, desc.x + 4, y, { width: desc.w - 10, align: 'right' });
        setFont(doc, 'Helvetica-Bold', 8.5);
        doc.text(t.less ? `(${D(t.amount).isNegative() ? '-' : '+'})${fmt(D(t.amount).abs(), model.currency)}` : fmt(t.amount, model.currency), amountCol.x + 3, y, { width: amountCol.w - 6, align: 'right' });
        y += 14;
      });
      if (model.cancelled) { setFont(doc, 'Helvetica-Bold', 14, '#c0392b'); doc.text('CANCELLED', desc.x + 6, y + 4, { width: desc.w - 12 }); }
    } else {
      setFont(doc, 'Helvetica-Oblique', 8, MUTED);
      doc.text('continued ...', desc.x + 4, yEnd - 14, { width: desc.w - 10, align: 'right' });
    }

    if (!last) return;
    // ---- total row ----
    const ty = bodyBottom;
    box(doc, M, ty, W, 18);
    for (const c of cols) if (c.x > M) rule(doc, c.x, ty, c.x, ty + 18);
    setFont(doc, 'Helvetica', 8.5);
    doc.text('Total', desc.x + 4, ty + 5, { width: desc.w - 10, align: 'right' });
    const units = new Set(model.lines.map((l) => l.unit || ''));
    const qtyCol = cols.find((c) => c.key === 'qty');
    if (units.size === 1) {
      const sum = model.lines.reduce((a, l) => a.plus(D(l.qty)), D(0));
      setFont(doc, 'Helvetica-Bold', 8.5);
      doc.text(`${qtyText(sum)}${[...units][0] ? ` ${[...units][0]}` : ''}`, qtyCol.x + 3, ty + 5, { width: qtyCol.w - 6, align: 'right' });
    }
    const amountCol = cols.find((c) => c.key === 'amount');
    setFont(doc, 'Helvetica-Bold', 9.5);
    doc.text(`${model.currency} ${fmt(model.total, model.currency)}`, amountCol.x - 30, ty + 4.5, { width: amountCol.w + 24, align: 'right' });

    // ---- words, tax summary ----
    let by = ty + 18;
    box(doc, M, by, W, 30);
    setFont(doc, 'Helvetica', 7.5, MUTED);
    doc.text('Amount Chargeable (in words)', M + 4, by + 3, { width: W / 2 });
    setFont(doc, 'Helvetica-Oblique', 7.5);
    doc.text('E. & O.E', M + 4, by + 3, { width: W - 8, align: 'right' });
    setFont(doc, 'Helvetica-Bold', 9);
    doc.text(words, M + 4, by + 15, { width: W - 8 });
    by += 30;
    if (taxWords) {
      taxSummary(doc, model, M + W - 380, by, 380, true);
      by += sumH;
      box(doc, M, by, W, 20);
      setFont(doc, 'Helvetica', 8);
      doc.text('Tax Amount (in words) :', M + 4, by + 6, { continued: true });
      setFont(doc, 'Helvetica-Bold', 8.5);
      doc.text(` ${taxWords}`);
      by += 20;
    }

    // ---- remarks / declaration | bank, signature ----
    box(doc, M, by, W, midH);
    rule(doc, M + leftW, by, M + leftW, by + midH);
    let ly = by + 4;
    if (remarksText) {
      setFont(doc, 'Helvetica-Oblique', 7.5, MUTED); doc.text('Remarks:', M + 6, ly, { width: leftW - 12 });
      setFont(doc, 'Helvetica', 8); doc.text(remarksText, M + 6, doc.y, { width: leftW - 12 });
      ly = doc.y + 6;
    }
    setFont(doc, 'Helvetica-Oblique', 7.5, MUTED); doc.text('Declaration', M + 6, ly, { width: leftW - 12, underline: true });
    setFont(doc, 'Helvetica', 8); doc.text(model.declaration || DECLARATION, M + 6, doc.y + 1, { width: leftW - 12 });
    setFont(doc, 'Helvetica', 8);
    doc.text("Company's Bank Details", M + leftW + 6, by + 4, { width: rightW - 12 });
    if (bankLines.length) { setFont(doc, 'Helvetica', 8); doc.text(bankLines.join('\n'), M + leftW + 6, doc.y + 2, { width: rightW - 12 }); }
    by += midH;
    box(doc, M, by, W, signH);
    rule(doc, M + leftW, by, M + leftW, by + signH);
    setFont(doc, 'Helvetica', 8);
    doc.text("Customer's Seal and Signature", M + 6, by + 4, { width: leftW - 12 });
    setFont(doc, 'Helvetica-Bold', 8.5);
    doc.text(`for ${model.seller.name}`, M + leftW + 6, by + 4, { width: rightW - 12, align: 'right' });
    setFont(doc, 'Helvetica', 8);
    doc.text('Authorised Signatory', M + leftW + 6, by + signH - 13, { width: rightW - 12, align: 'right' });
  });

  setFont(doc, 'Helvetica', 8);
  doc.text(model.jurisdiction || 'SUBJECT TO JURISDICTION', M, footerY + 2, { width: W, align: 'center' });
  doc.text('This is a Computer Generated Invoice', M, footerY + 14, { width: W, align: 'center' });
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-08-13 -> 13-Aug-26 */
const dateText = (ymd) => {
  if (!ymd) return '';
  const [y, m, d] = String(ymd).slice(0, 10).split('-');
  return `${d}-${SHORT_MONTHS[Number(m) - 1]}-${y.slice(2)}`;
};

/** Renders one invoice model (or an array of them, one after the other) to a PDF buffer: one copy per label. */
function taxInvoicePdf(input) {
  const models = Array.isArray(input) ? input : [input];
  const doc = new PDFDocument({ size: 'A4', margins: MARGINS, autoFirstPage: false, info: { Title: `${models[0].title} ${models[0].meta?.number || ''}`.trim() } });
  const chunks = [];
  const done = new Promise((resolve, reject) => { doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  for (const model of models) {
    const cols = columns(model);
    (model.copies || COPIES).forEach((label) => {
      doc.addPage({ size: 'A4', margins: MARGINS });
      drawCopy(doc, model, label, cols);
    });
  }
  doc.end();
  return done;
}

module.exports = { taxInvoicePdf, dateText, COPIES };
