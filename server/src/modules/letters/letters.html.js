// Letters written in the rich-text editor are stored as sanitised HTML (see lib/richText.js: only simple formatting tags survive).
// This turns that HTML into blocks of formatted text and draws them on a pdfkit page. Older letters are plain text and take the old path.

const HAS_TAGS = /<[a-z][\s\S]*>/i;
const isHtml = (text) => HAS_TAGS.test(String(text || ''));
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return ENTITIES[e.toLowerCase()] ?? m;
});

const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'li', 'tr']);
const SIZES = { h1: 16, h2: 13.5, h3: 12, h4: 11, p: 10.5, div: 10.5, li: 10.5, blockquote: 10.5, tr: 10.5 };

/** HTML -> [{ kind: 'text'|'hr', tag, runs: [{ text, bold, italic, underline, strike, link }], list: { ordered, n, depth } | null, quote }] */
function toBlocks(html) {
  const tokens = String(html || '').split(/(<[^>]+>)/).filter((t) => t !== '');
  const blocks = [];
  const style = { bold: 0, italic: 0, underline: 0, strike: 0, link: [] };
  const lists = [];
  let quote = 0;
  let cur = null;
  const open = (tag, extra = {}) => { cur = { kind: 'text', tag, runs: [], list: null, quote: quote > 0, ...extra }; };
  const close = () => { if (cur && cur.runs.some((r) => r.text.trim() !== '' || r.text.includes('\n'))) blocks.push(cur); else if (cur && cur.tag !== 'li') blocks.push({ ...cur, runs: [], empty: true }); cur = null; };
  const push = (text) => {
    if (!text) return;
    if (!cur) open('p');
    cur.runs.push({ text, bold: style.bold > 0 || /^h[1-4]$/.test(cur.tag), italic: style.italic > 0, underline: style.underline > 0 || style.link.length > 0, strike: style.strike > 0, link: style.link[style.link.length - 1] || null });
  };
  for (const t of tokens) {
    if (t[0] !== '<') { const txt = decode(t.replace(/\s+/g, ' ')); if (txt.trim() !== '' || cur) push(txt); continue; }
    const m = /^<\s*(\/)?\s*([a-z0-9]+)([^>]*)>/i.exec(t);
    if (!m) continue;
    const closing = Boolean(m[1]); const tag = m[2].toLowerCase(); const attrs = m[3] || '';
    if (tag === 'br') { push('\n'); continue; }
    if (tag === 'hr') { close(); blocks.push({ kind: 'hr' }); continue; }
    if (tag === 'ul' || tag === 'ol') { close(); if (closing) { lists.pop(); if (!lists.length) blocks.push({ kind: 'gap' }); } else lists.push({ ordered: tag === 'ol', n: 0 }); continue; }
    if (tag === 'blockquote') { close(); quote += closing ? -1 : 1; if (quote < 0) quote = 0; if (!closing) open('blockquote'); continue; }
    if (BLOCK.has(tag) || tag === 'table' || tag === 'tbody' || tag === 'thead') {
      if (!BLOCK.has(tag)) continue;
      close();
      if (!closing) {
        const list = tag === 'li' && lists.length ? lists[lists.length - 1] : null;
        if (list) list.n += 1;
        open(tag, { list: list ? { ordered: list.ordered, n: list.n, depth: lists.length } : null });
      } else if (tag === 'blockquote') open('p');
      continue;
    }
    if (tag === 'th' || tag === 'td') { if (!closing && cur && cur.runs.length) push('   '); continue; }
    const delta = closing ? -1 : 1;
    if (tag === 'strong' || tag === 'b') style.bold = Math.max(0, style.bold + delta);
    else if (tag === 'em' || tag === 'i') style.italic = Math.max(0, style.italic + delta);
    else if (tag === 'u') style.underline = Math.max(0, style.underline + delta);
    else if (tag === 's' || tag === 'strike') style.strike = Math.max(0, style.strike + delta);
    else if (tag === 'a') { if (closing) style.link.pop(); else { const h = /href\s*=\s*"([^"]*)"/i.exec(attrs) || /href\s*=\s*'([^']*)'/i.exec(attrs); style.link.push(h ? decode(h[1]) : 'about:blank'); } }
  }
  close();
  // trim the line breaks hanging at the end of a block and collapse runs of empty blocks
  const out = [];
  for (const b of blocks) {
    if (b.kind === 'text' && b.runs.length) {
      while (b.runs.length && /^[\s]*$/.test(b.runs[b.runs.length - 1].text) && b.runs.length > 0) b.runs.pop();
      if (b.runs.length) b.runs[0] = { ...b.runs[0], text: b.runs[0].text.replace(/^ +/, '') };
    }
    if (b.empty && out.length && out[out.length - 1].empty) continue;
    out.push(b);
  }
  return out;
}

const fontFor = (r) => (r.bold && r.italic ? 'Helvetica-BoldOblique' : r.bold ? 'Helvetica-Bold' : r.italic ? 'Helvetica-Oblique' : 'Helvetica');

/** Draws the blocks from the current position. `ink` / `blue` are colours; the page bottom is taken from the document margins. */
function drawBlocks(doc, html, { ink, blue, line, left, width }) {
  const blocks = toBlocks(html);
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  for (const b of blocks) {
    if (b.kind === 'gap') { doc.moveDown(0.4); continue; }
    if (b.kind === 'hr') {
      if (doc.y > bottom() - 20) doc.addPage();
      doc.moveDown(0.3);
      doc.strokeColor(line).lineWidth(0.7).moveTo(left, doc.y).lineTo(left + width, doc.y).stroke();
      doc.moveDown(0.8);
      continue;
    }
    if (b.empty) { doc.moveDown(0.8); continue; }
    const size = SIZES[b.tag] || 10.5;
    const depth = b.list ? b.list.depth : 0;
    const indent = (b.list ? 14 + depth * 14 : 0) + (b.quote ? 16 : 0);
    const x = left + indent;
    const w = width - indent;
    if (doc.y > bottom() - size * 3) doc.addPage();
    const top = doc.y;
    if (b.list) {
      const label = b.list.ordered ? `${b.list.n}.` : '•';
      doc.fillColor(ink).font('Helvetica').fontSize(size).text(label, x - 14, top, { width: 14, lineBreak: false, align: 'left' });
    }
    if (b.quote) doc.strokeColor(line).lineWidth(2).moveTo(left + 4, top).lineTo(left + 4, top + size * 1.4).stroke();
    const runs = b.runs.length ? b.runs : [{ text: ' ' }];
    runs.forEach((r, i) => {
      doc.fillColor(r.link ? blue : ink).font(fontFor(r)).fontSize(size);
      const opts = { continued: i < runs.length - 1, underline: Boolean(r.underline), strike: Boolean(r.strike), lineGap: 3, align: 'left', width: w };
      if (r.link && /^(https?:|mailto:|tel:)/i.test(r.link)) opts.link = r.link;
      if (i === 0) doc.text(r.text, x, top, opts); else doc.text(r.text, opts);
    });
    doc.x = left;
    doc.moveDown(b.list ? 0.3 : b.tag.startsWith('h') ? 0.6 : 0.8);
  }
}

module.exports = { isHtml, escapeHtml, toBlocks, drawBlocks };
