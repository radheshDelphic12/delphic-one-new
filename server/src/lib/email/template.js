// Professional HTML layout for every email the app sends (candidates, vendors, clients, staff).
//
// Callers keep writing plain text (greeting, paragraphs, "Label: value" lines, one link, a sign-off); this turns it into a clean
// email: a brand bar, readable paragraphs, a details table for "Label: value" blocks, a button for the link (with the raw link
// underneath for mail apps that block buttons), and a quiet footer. Inline styles and tables only, so it holds up in Outlook,
// Gmail and phones. The plain-text part of the email is untouched.

const BRAND = 'Delphic';
const COLORS = { bg: '#f3f5f8', card: '#ffffff', text: '#1f2937', muted: '#6b7280', line: '#e5e7eb', accent: '#2563eb', accentText: '#ffffff' };
const FONT = "font-family:'Segoe UI',Arial,Helvetica,sans-serif;";

const BUTTON_LABEL = {
  ai_interview_invite: 'Start your interview',
  assessment_invite: 'Start the assessment',
  calendar_invite: 'Open the invitation',
};

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;
// A trailing full stop / comma / bracket belongs to the sentence, not to the link.
const trimUrl = (url) => url.replace(/[.,;:!?)\]]+$/, '');

function linkify(escaped) {
  return escaped.replace(URL_RE, (raw) => {
    const url = trimUrl(raw);
    const rest = raw.slice(url.length);
    return `<a href="${url}" style="color:${COLORS.accent};text-decoration:underline;word-break:break-all">${url}</a>${rest}`;
  });
}

const paragraph = (html, extra = '') => `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:${COLORS.text};${extra}">${html}</p>`;

const KEY_VALUE = /^\s*([A-Za-z][A-Za-z0-9 /&()'.-]{0,40}):\s+(\S.*)$/;
const SIGN_OFF = /^(thanks|thank you|regards|best regards|warm regards|kind regards|sincerely|best)[,!.]?$/i;

function detailsTable(lines) {
  const rows = lines.map((l) => {
    const [, key, value] = KEY_VALUE.exec(l);
    return `<tr><td style="padding:8px 12px;width:32%;font-size:13px;color:${COLORS.muted};vertical-align:top;border-bottom:1px solid ${COLORS.line}">${escapeHtml(key)}</td><td style="padding:8px 12px;font-size:14px;color:${COLORS.text};vertical-align:top;border-bottom:1px solid ${COLORS.line}">${linkify(escapeHtml(value))}</td></tr>`;
  });
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 18px 0;border:1px solid ${COLORS.line};border-radius:8px;border-collapse:separate;background:#fafbfc">${rows.join('')}</table>`;
}

function button(url, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 8px 0"><tr><td style="border-radius:8px;background:${COLORS.accent}"><a href="${url}" style="display:inline-block;padding:12px 26px;${FONT}font-size:15px;font-weight:600;color:${COLORS.accentText};text-decoration:none;border-radius:8px">${escapeHtml(label)}</a></td></tr></table>`
    + `<p style="margin:0 0 20px 0;font-size:12px;line-height:1.5;color:${COLORS.muted}">If the button does not work, copy this link into your browser:<br><a href="${url}" style="color:${COLORS.muted};word-break:break-all">${url}</a></p>`;
}

/** Turns the plain-text body into the email's inner HTML blocks. */
function blocksFromText(text, kind) {
  const blocks = String(text || '').replace(/\r\n/g, '\n').trim().split(/\n{2,}/);
  const out = [];
  let buttonUsed = false;
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.replace(/\s+$/, ''));
    const filled = lines.filter((l) => l.trim());
    if (!filled.length) continue;

    // "Label: value" lines (details of a requirement, a leave request, an invitation ...) as a small table.
    if (filled.length >= 2 && filled.every((l) => KEY_VALUE.test(l) && !/^\s*https?:/i.test(l))) {
      out.push(detailsTable(filled));
      continue;
    }

    // A numbered heading line followed by indented details ("1. Java Developer" + "   Skills: ...").
    const head = filled[0];
    const rest = filled.slice(1);
    if (rest.length >= 1 && !KEY_VALUE.test(head) && rest.every((l) => KEY_VALUE.test(l))) {
      out.push(paragraph(`<strong>${linkify(escapeHtml(head.trim()))}</strong>`, 'margin-bottom:6px;'));
      out.push(detailsTable(rest));
      continue;
    }

    // A sign-off ("Thank you," / "Regards,") with the name under it.
    if (SIGN_OFF.test(filled[0].trim())) {
      out.push(`<p style="margin:24px 0 0 0;font-size:15px;line-height:1.6;color:${COLORS.text}">${filled.map((l) => escapeHtml(l.trim())).join('<br>')}</p>`);
      continue;
    }

    // One link in the paragraph becomes a button below the sentence.
    const urls = block.match(URL_RE) || [];
    const unique = [...new Set(urls.map(trimUrl))];
    if (unique.length === 1 && !buttonUsed && filled.length <= 3 && BUTTON_LABEL[kind]) {
      const sentence = filled.join(' ').replace(URL_RE, '').replace(/\s*:\s*$/, '.').replace(/\s{2,}/g, ' ').trim();
      if (sentence) out.push(paragraph(escapeHtml(sentence)));
      out.push(button(unique[0], BUTTON_LABEL[kind]));
      buttonUsed = true;
      continue;
    }

    out.push(paragraph(filled.map((l) => linkify(escapeHtml(l))).join('<br>')));
  }
  return out.join('');
}

/**
 * The full HTML email. `subject` is shown as the heading, `text` is the plain-text body, `kind` picks the button label for a link.
 */
function renderEmailHtml({ subject, text, kind, brand = BRAND }) {
  const body = blocksFromText(text, kind);
  const title = subject ? `<h1 style="margin:0 0 20px 0;font-size:20px;line-height:1.35;font-weight:600;color:${COLORS.text}">${escapeHtml(subject)}</h1>` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject || brand)}</title></head>`
    + `<body style="margin:0;padding:0;background:${COLORS.bg};${FONT}">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg}"><tr><td align="center" style="padding:24px 12px">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${COLORS.card};border-radius:12px;border:1px solid ${COLORS.line};overflow:hidden">`
    + `<tr><td style="background:${COLORS.accent};padding:16px 28px;${FONT}font-size:17px;font-weight:700;letter-spacing:.3px;color:${COLORS.accentText}">${escapeHtml(brand)}</td></tr>`
    + `<tr><td style="padding:28px 28px 20px 28px;${FONT}">${title}${body}</td></tr>`
    + `<tr><td style="padding:16px 28px 22px 28px;border-top:1px solid ${COLORS.line};${FONT}font-size:12px;line-height:1.5;color:${COLORS.muted}">This email was sent by ${escapeHtml(brand)}. If it reached you by mistake, you can ignore it.</td></tr>`
    + `</table></td></tr></table></body></html>`;
}

module.exports = { renderEmailHtml, escapeHtml };
