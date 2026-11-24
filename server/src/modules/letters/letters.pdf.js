const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const htmlText = require('./letters.html');

// The PDF of an issued letter, drawn from the text stored on the letter (so it reads the same years later, whatever the template says now).
// It is on the company letterhead: the logo at the top of every page, the issuing office under it on the first page, and the company's
// legal name, registration line and every office at the foot of every page.
const INK = '#0f172a';
const GREY = '#64748b';
const LINE = '#cbd5e1';
const BLUE = '#105aa9';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (d) => {
  const x = new Date(d);
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
};

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = { top: 132, bottom: 128, left: 64, right: 64 };
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;
const BUNDLED_LOGO = path.join(__dirname, '..', '..', 'assets', 'delphic-letterhead-logo.png');

/**
 * The logo for a company's letterhead: the logo the company uploaded (a PNG / JPEG data URL), else, for the master workspace (Delphic Global),
 * the Delphic wordmark that ships with the app. Null = no logo (the company name is printed instead).
 */
function logoFor(org) {
  const url = org?.logo_url || '';
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/i.exec(url);
  if (m) return Buffer.from(m[2], 'base64');
  if (org?.is_master_workspace && fs.existsSync(BUNDLED_LOGO)) return fs.readFileSync(BUNDLED_LOGO);
  return null;
}

function drawHeader(doc, { logo, companyName }) {
  const top = 30;
  if (logo) {
    try {
      doc.image(logo, (PAGE.width - 150) / 2, top, { fit: [150, 62], align: 'center' });
      return;
    } catch { /* an unreadable image falls back to the name */ }
  }
  doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(18).text(companyName || '', MARGIN.left, top + 18, { width: CONTENT_WIDTH, align: 'center', lineBreak: false });
}

/** The foot of a page: the legal name, the registration line and every office (the issuing one in bold), then the page number. */
function drawFooter(doc, { head, companyName, pageNo, pages }) {
  const top = PAGE.height - 112;
  doc.save().lineWidth(0.6).strokeColor(LINE).moveTo(MARGIN.left, top).lineTo(PAGE.width - MARGIN.right, top).stroke().restore();
  let y = top + 6;
  const legal = head?.legal_name || companyName;
  if (legal) { doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.5).text(legal, MARGIN.left, y, { width: CONTENT_WIDTH, align: 'center', lineBreak: false }); y += 11; }
  if (head?.registration_info) { doc.fillColor(GREY).font('Helvetica').fontSize(7).text(head.registration_info, MARGIN.left, y, { width: CONTENT_WIDTH, align: 'center', lineBreak: false, ellipsis: true }); y += 10; }
  const offices = head?.offices || [];
  if (offices.length) {
    const cols = offices.length <= 4 ? 2 : 3;
    const colWidth = CONTENT_WIDTH / cols;
    const rowHeight = 19;
    y += 3;
    offices.forEach((o, i) => {
      const x = MARGIN.left + (i % cols) * colWidth;
      const yy = y + Math.floor(i / cols) * rowHeight;
      const place = o.address || [o.city, o.country].filter(Boolean).join(', ');
      const mine = head?.office?.id && o.id === head.office.id;
      doc.fillColor(mine ? INK : GREY).font(mine ? 'Helvetica-Bold' : 'Helvetica').fontSize(6.6).text(o.name, x, yy, { width: colWidth - 8, lineBreak: false, ellipsis: true });
      if (place) doc.fillColor(GREY).font('Helvetica').fontSize(6.4).text(place, x, yy + 7.5, { width: colWidth - 8, height: 9, ellipsis: true });
    });
  }
  doc.fillColor(GREY).font('Helvetica').fontSize(7.5).text(`Page ${pageNo} of ${pages}`, MARGIN.left, PAGE.height - 24, { width: CONTENT_WIDTH, align: 'right', lineBreak: false });
}

/** Header, footer and the CANCELLED stamp on every page, once the pages are known (so the footer can say "Page 2 of 3"). */
function decoratePages(doc, ctx) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const saved = { ...doc.page.margins };
    doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 }; // drawing in the margins must not start a new page
    drawHeader(doc, ctx);
    drawFooter(doc, { ...ctx, pageNo: i + 1, pages: range.count });
    if (ctx.cancelled) doc.save().rotate(-30, { origin: [300, 420] }).fillColor('#dc2626').opacity(0.18).font('Helvetica-Bold').fontSize(90).text('CANCELLED', 90, 380, { lineBreak: false }).restore();
    doc.page.margins = saved;
  }
}

function letterPdf(letter, { companyName = '', logo = null } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: MARGIN, info: { Title: `${letter.kind} letter ${letter.serial_number}` } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const head = letter.letterhead || null;
    const officeName = head?.office?.name || null;

    // Ref, date and the issuing office
    const top = doc.y;
    doc.fillColor(GREY).font('Helvetica').fontSize(10).text('Ref:', MARGIN.left, top, { continued: true }).fillColor(INK).font('Helvetica-Bold').text(` ${letter.serial_number}`);
    // the date sits at the right edge: label and value are placed by their measured widths (a continued right-aligned text overlaps itself)
    const dateText = longDate(letter.issued_on);
    doc.font('Helvetica-Bold').fontSize(10);
    const dateWidth = doc.widthOfString(dateText);
    doc.font('Helvetica').fontSize(10);
    const labelWidth = doc.widthOfString('Date: ');
    const dateX = PAGE.width - MARGIN.right - dateWidth - labelWidth;
    doc.fillColor(GREY).font('Helvetica').fontSize(10).text('Date: ', dateX, top, { lineBreak: false });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(dateText, dateX + labelWidth, top, { lineBreak: false });
    doc.x = MARGIN.left;
    doc.y = top + 15;
    if (officeName) {
      doc.fillColor(GREY).font('Helvetica').fontSize(10).text('Office:', MARGIN.left, doc.y, { continued: true }).fillColor(INK).font('Helvetica-Bold').text(` ${officeName}${head?.legal_name ? ` · ${head.legal_name}` : ''}`);
    }
    doc.x = MARGIN.left;
    doc.moveDown(1.4);

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(letter.recipient_name);
    if (letter.recipient_address) doc.font('Helvetica').fontSize(10).fillColor(GREY).text(letter.recipient_address);
    doc.moveDown(1);

    if (letter.subject) doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(`Sub: ${letter.subject}`).moveDown(0.9);

    doc.fillColor(INK).font('Helvetica').fontSize(10.5);
    if (htmlText.isHtml(letter.body)) {
      // written in the rich-text editor: bold, italic, underline, headings, lists, links, dividers
      htmlText.drawBlocks(doc, letter.body, { ink: INK, blue: BLUE, line: LINE, left: MARGIN.left, width: CONTENT_WIDTH });
      doc.fillColor(INK).font('Helvetica').fontSize(10.5);
    } else {
      for (const paragraph of String(letter.body).split(/\n{2,}/)) {
        doc.text(paragraph, { align: 'left', lineGap: 3 });
        doc.moveDown(0.8);
      }
    }

    if (letter.signatory_name || letter.signatory_title) {
      doc.moveDown(1.5);
      doc.font('Helvetica').fillColor(INK).text('Yours sincerely,').moveDown(2.2);
      if (letter.signatory_name) doc.font('Helvetica-Bold').text(letter.signatory_name);
      if (letter.signatory_title) doc.font('Helvetica').fillColor(GREY).text(letter.signatory_title);
      doc.font('Helvetica').fillColor(GREY).text(head?.legal_name || companyName);
    }

    decoratePages(doc, { logo, companyName, head, cancelled: letter.status === 'cancelled' });
    doc.end();
  });
}

module.exports = { letterPdf, logoFor };
