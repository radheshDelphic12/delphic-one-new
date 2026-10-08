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
      <span className={!expanded && long ? 'line-clamp-4' : 'block'}>{value}</span>
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
