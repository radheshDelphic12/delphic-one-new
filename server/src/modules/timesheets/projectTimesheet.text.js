// Text helpers for the project-wise timesheet Excel: the Log time description is rich text
// (**bold**, *italic*, - bullets, [links](url)); the sheet wants plain text and a short module title.
// Deterministic on purpose: no AI call at download time.

const DASH = '–';
const MAX_TITLE_WORDS = 8;
const MAX_TITLE_CHARS = 70;

// Rich text -> readable plain text. Bullets stay on their own line with a bullet sign, links keep their text.
function toPlainText(input) {
  const lines = String(input || '').replace(/\r\n?/g, '\n').split('\n');
  const out = lines.map((raw) => {
    let line = raw.replace(/[ \t]+$/g, '');
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) line = `• ${bullet[1]}`;
    line = line
      .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, (_, text, url) => text || url)
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?=[^\w*]|$)/g, '$1$2')
      .replace(/(^|[^\w])_(?!\s)(.+?)_(?=[^\w]|$)/g, '$1$2')
      .replace(/`([^`]*)`/g, '$1');
    return line;
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const isLinkOnly = (text) => /^(?:https?:\/\/\S+|www\.\S+)$/i.test(text.trim());

// Short title (<= 8 words) from the first line / first sentence of the description; '' when there is nothing usable.
function shortTitle(description) {
  const plain = toPlainText(description);
  const firstLine = plain.split('\n').map((l) => l.replace(/^•\s*/, '').trim()).find(Boolean) || '';
  if (!firstLine || isLinkOnly(firstLine)) return '';
  // first sentence: up to . ! ? or a colon followed by a space (not the dot in "3.0.6" or "e.g.")
  const sentence = (/^(.+?[.!?:])(?=\s)/.exec(firstLine) || [null, firstLine])[1].replace(/[.:;,\s-]+$/, '');
  const words = sentence.split(/\s+/).filter(Boolean);
  let title = words.slice(0, MAX_TITLE_WORDS).join(' ');
  if (title.length > MAX_TITLE_CHARS) title = `${title.slice(0, MAX_TITLE_CHARS - 1).replace(/\s+\S*$/, '')}`;
  title = title.replace(/[.:;,\s-]+$/, '');
  if (!title) return '';
  return title.charAt(0).toUpperCase() + title.slice(1);
}

// "<Project> - <short title>"; just the project name when the description gives no title.
function moduleLabel(projectName, description) {
  const title = shortTitle(description);
  return title ? `${projectName} ${DASH} ${title}` : projectName;
}

module.exports = { toPlainText, shortTitle, moduleLabel };
