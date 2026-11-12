const PDFDocument = require('pdfkit');

// The PDF of an issued letter, drawn from the text stored on the letter (so it reads the same years later, whatever the template says now).
const INK = '#0f172a';
const GREY = '#64748b';
const BLUE = '#105aa9';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (d) => {
  const x = new Date(d);
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
};

function letterPdf(letter, { companyName = '' } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 64, left: 64, right: 64 }, info: { Title: `${letter.kind} letter ${letter.serial_number}` } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(16).text(companyName, { align: 'left' });
    doc.moveTo(64, doc.y + 4).lineTo(531, doc.y + 4).lineWidth(1.5).strokeColor(BLUE).stroke().lineWidth(1);
    doc.moveDown(1.2);

    const top = doc.y;
    doc.fillColor(GREY).font('Helvetica').fontSize(10).text('Ref:', 64, top, { continued: true }).fillColor(INK).font('Helvetica-Bold').text(` ${letter.serial_number}`);
    doc.fillColor(GREY).font('Helvetica').fontSize(10).text(`Date: ${longDate(letter.issued_on)}`, 64, top, { width: 467, align: 'right' });
    doc.y = top + 22;
    doc.x = 64;

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(letter.recipient_name);
    if (letter.recipient_address) doc.font('Helvetica').fontSize(10).fillColor(GREY).text(letter.recipient_address);
    doc.moveDown(1);

    if (letter.subject) doc.fillColor(INK).font('Helvetica-Bold').fontSize(11.5).text(letter.subject).moveDown(0.8);

    doc.fillColor(INK).font('Helvetica').fontSize(10.5);
    for (const paragraph of String(letter.body).split(/\n{2,}/)) {
      doc.text(paragraph, { align: 'left', lineGap: 3 });
      doc.moveDown(0.8);
    }

    if (letter.signatory_name || letter.signatory_title) {
      doc.moveDown(1.5);
      doc.font('Helvetica').fillColor(INK).text('Yours sincerely,').moveDown(2.2);
      if (letter.signatory_name) doc.font('Helvetica-Bold').text(letter.signatory_name);
      if (letter.signatory_title) doc.font('Helvetica').fillColor(GREY).text(letter.signatory_title);
      doc.font('Helvetica').fillColor(GREY).text(companyName);
    }

    if (letter.status === 'cancelled') {
      doc.save().rotate(-30, { origin: [300, 420] }).fillColor('#dc2626').opacity(0.18).font('Helvetica-Bold').fontSize(90).text('CANCELLED', 90, 380).restore();
    }
    doc.end();
  });
}

module.exports = { letterPdf };
