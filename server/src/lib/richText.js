const sanitizeHtml = require('sanitize-html');

// Text written in the app's rich-text editor (a reason, a note). The editor produces simple formatted text; anything else (scripts, styles,
// event handlers, iframes) is stripped before it is stored, so showing it is safe. Same rules as the policies editor.
const SANITIZE = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'ul', 'ol', 'li', 'blockquote', 'a', 'span', 'div',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  transformTags: { a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }, true) },
};

const cleanHtml = (html) => sanitizeHtml(html || '', SANITIZE).trim();

/** The text of an HTML string, tags and entities removed: used to tell an empty editor ("<p><br></p>") from a real answer. */
const plainText = (html) => sanitizeHtml(html || '', { allowedTags: [], allowedAttributes: {} }).replace(/&nbsp;|&#160;/g, ' ').trim();

module.exports = { cleanHtml, plainText };
