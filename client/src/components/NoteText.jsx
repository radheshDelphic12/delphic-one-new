import { useState } from 'react';

const COLLAPSED_LINES = 4;

// A note as typed, cleaned only at the edges: Windows line endings
// normalised, tabs as spaces, trailing spaces and leading/trailing blank
// lines dropped. Indentation, bullets and spacing inside are kept.
function normalise(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

// Light markup, rendered as React elements (never raw HTML): **bold**, *italic*,
// `code`, [label](https://link), bare https:// links and "- " / "* " bullets.
const INLINE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<]+)/g;

function linkProps(href) {
  return { href, target: '_blank', rel: 'noopener noreferrer', className: 'text-primary-700 underline', onClick: (e) => e.stopPropagation() };
}

function renderInline(line, keyPrefix) {
  return line.split(INLINE).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (!part) return null;
    if (/^\*\*[^*\n]+\*\*$/.test(part)) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*\n]+\*$/.test(part)) return <em key={key}>{part.slice(1, -1)}</em>;
    if (/^`[^`\n]+`$/.test(part)) return <code key={key} className="rounded bg-tertiary-100 px-1 text-[0.9em]">{part.slice(1, -1)}</code>;
    const md = part.match(/^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (md) return <a key={key} {...linkProps(md[2])}>{md[1]}</a>;
    if (/^https?:\/\//.test(part)) return <a key={key} {...linkProps(part)}>{part}</a>;
    return part;
  });
}

function renderMarkup(value) {
  return value.split('\n').map((line, i) => {
    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
    return (
      <span key={i} className="block">
        {bullet ? <>{bullet[1]}• {renderInline(bullet[2], i)}</> : renderInline(line, i)}
        {line === '' && '​'}
      </span>
    );
  });
}

/**
 * A timesheet description (or any free-text note) exactly as it was typed:
 * line breaks, indentation, bullets and spacing kept (pre-wrap; pre-line used
 * to collapse them), long words wrapped, and anything over four lines
 * collapsed behind "Show more". Renders `empty` when there's no text.
 */
export default function NoteText({ text, empty = '—', className = '' }) {
  const [expanded, setExpanded] = useState(false);
  const value = normalise(text);
  if (!value.trim()) return <span className="text-tertiary-400">{empty}</span>;
  const lines = value.split('\n');
  const long = lines.length > COLLAPSED_LINES || value.length > 320;
  return (
    <span className={`block max-w-xl whitespace-pre-wrap break-words text-left leading-snug ${className}`}>
      <span className={!expanded && long ? 'line-clamp-4' : 'block'}>{renderMarkup(value)}</span>
      {long && (
        <button
          type="button"
          className="mt-0.5 block text-xs font-medium text-primary-700 hover:underline"
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </span>
  );
}
