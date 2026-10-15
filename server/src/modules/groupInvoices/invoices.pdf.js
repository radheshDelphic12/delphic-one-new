const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const env = require('../../config/env');
const { D } = require('../cashPosition/cash.calc');

// The PDF of an invoice, drawn with pdfkit from the invoice's own snapshot (seller details as they were the day it was issued).

const TITLE = { gst: 'TAX INVOICE', non_gst: 'INVOICE', usd_export: 'EXPORT INVOICE' };

const group = (n, currency) => {
  const [whole, frac] = D(n).toFixed(2).split('.');
  const g = Number(whole).toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US');
  return `${g}.${frac}`;
};

/** The entity's logo when it is a PNG / JPEG stored in the upload folder; anything else (SVG, a web path) is skipped. */
function logoPath(url) {
  if (!url || !/^\/uploads\/[A-Za-z0-9._-]+\.(png|jpe?g)$/i.test(url)) return null;
  const file = path.join(path.resolve(env.uploadDir), path.basename(url));
  return fs.existsSync(file) ? file : null;
}

function invoicePdf(inv) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = [];
  const done = new Promise((resolve, reject) => { doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const cur = inv.currency;
  const s = inv.seller || {};

  const logo = logoPath(s.logo_url);
  if (logo) { try { doc.image(logo, L, 40, { fit: [90, 50] }); } catch { /* an unreadable logo is not worth failing the invoice */ } }
  doc.font('Helvetica-Bold').fontSize(16).text(s.name || '', logo ? L + 100 : L, 42, { width: W - 150 });
  doc.font('Helvetica').fontSize(9).fillColor('#444');
  if (s.address) doc.text(s.address, logo ? L + 100 : L, doc.y, { width: W - 150 });
  doc.text([s.gstin && `GSTIN: ${s.gstin}`, s.pan && `PAN: ${s.pan}`].filter(Boolean).join('   '), logo ? L + 100 : L, doc.y);
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(14).text(TITLE[inv.type] || 'INVOICE', L, 42, { width: W, align: 'right' });
  doc.font('Helvetica').fontSize(9).text(`No: ${inv.number}`, L, 62, { width: W, align: 'right' });
  doc.text(`Date: ${inv.invoice_date}`, { width: W, align: 'right' });
  if (inv.due_date) doc.text(`Due: ${inv.due_date}`, { width: W, align: 'right' });
  doc.y = Math.max(doc.y, 110) + 10;

  doc.moveTo(L, doc.y).lineTo(L + W, doc.y).strokeColor('#bbb').stroke();
  doc.moveDown(0.6).font('Helvetica-Bold').fontSize(9).fillColor('#666').text('BILL TO');
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(inv.buyer_name);
  doc.font('Helvetica').fontSize(9);
  if (inv.buyer_address) doc.text(inv.buyer_address, { width: W / 2 });
  if (inv.buyer_gstin) doc.text(`GSTIN: ${inv.buyer_gstin}`);
  if (inv.type === 'gst' && inv.place_of_supply) doc.text(`Place of supply: state code ${inv.place_of_supply}`);
  doc.moveDown(0.8);

  const cols = [['#', 22], ['Description', inv.type === 'gst' ? 190 : 230], ...(inv.type === 'gst' ? [['HSN/SAC', 55], ['GST %', 40]] : []), ['Qty', 45], ['Rate', 70], ['Amount', 80]];
  const row = (values, bold) => {
    if (doc.y > doc.page.height - 120) doc.addPage();
    let x = L;
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    let tallest = 12;
    values.forEach((v, i) => {
      const align = i >= cols.length - 3 || ['Qty', 'GST %'].includes(cols[i][0]) ? 'right' : 'left';
      doc.text(String(v ?? ''), x, y, { width: cols[i][1] - 6, align });
      tallest = Math.max(tallest, doc.y - y);
      x += cols[i][1];
    });
    doc.y = y + tallest + 4;
  };
  doc.rect(L, doc.y - 2, W, 16).fillColor('#f1f3f5').fill().fillColor('#000');
  row(cols.map((c) => c[0]), true);
  inv.lines.forEach((l, i) => row([i + 1, l.description, ...(inv.type === 'gst' ? [l.hsn_sac || '', l.gst_rate] : []), l.qty, group(l.rate, cur), group(l.amount, cur)]));
  doc.moveTo(L, doc.y).lineTo(L + W, doc.y).strokeColor('#bbb').stroke();
  doc.moveDown(0.5);

  const total = (label, value, bold) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).text(label, L + W - 250, y, { width: 160, align: 'right' }).text(`${cur} ${group(value, cur)}`, L + W - 90, y, { width: 90, align: 'right' });
    doc.y = y + (bold ? 17 : 13);
  };
  total('Subtotal', inv.subtotal);
  if (D(inv.cgst).gt(0)) total('CGST', inv.cgst);
  if (D(inv.sgst).gt(0)) total('SGST', inv.sgst);
  if (D(inv.igst).gt(0)) total('IGST', inv.igst);
  total('Total', inv.total, true);
  if (inv.status === 'cancelled') doc.fillColor('#c0392b').font('Helvetica-Bold').fontSize(12).text('CANCELLED', L, doc.y + 6).fillColor('#000');

  doc.moveDown(1.5).fontSize(9);
  if (inv.payment_instructions) doc.font('Helvetica-Bold').text('Payment details').font('Helvetica').text(inv.payment_instructions, { width: W / 2 }).moveDown(0.6);
  if (inv.type === 'usd_export' && inv.lut_note) doc.font('Helvetica-Oblique').text(inv.lut_note, { width: W }).moveDown(0.6);
  if (inv.notes) doc.font('Helvetica-Bold').text('Notes').font('Helvetica').text(inv.notes, { width: W });
  doc.end();
  return done;
}

module.exports = { invoicePdf };
