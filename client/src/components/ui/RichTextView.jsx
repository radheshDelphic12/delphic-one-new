/**
 * Shows text written in the rich-text editor. The server strips anything unsafe before it is stored, so the HTML can be shown as it is.
 * Older plain-text values (no tags) are shown as typed, with their line breaks.
 */
const HAS_TAGS = /<[a-z][\s\S]*>/i;
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function richTextToHtml(text) {
  const value = String(text ?? '');
  return HAS_TAGS.test(value) ? value : escapeHtml(value).replace(/\n/g, '<br>');
}

export default function RichTextView({ value, className = '' }) {
  if (!value) return null;
  return <div className={`policy-content ${className}`} dangerouslySetInnerHTML={{ __html: richTextToHtml(value) }} />;
}
