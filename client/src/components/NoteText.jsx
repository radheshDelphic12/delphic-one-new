import { useState } from 'react';

const COLLAPSED_LINES = 4;

/**
 * A timesheet description (or any free-text note) as it was typed: line
 * breaks kept, long words wrapped, and anything over four lines collapsed
 * behind "Show more". Renders `empty` when there's no text.
 */
export default function NoteText({ text, empty = '—', className = '' }) {
  const [expanded, setExpanded] = useState(false);
  const value = (text || '').trim();
  if (!value) return <span className="text-tertiary-400">{empty}</span>;
  const lines = value.split(/\r?\n/);
  const long = lines.length > COLLAPSED_LINES || value.length > 320;
  return (
    <span className={`block max-w-xl whitespace-pre-line break-words text-left ${className}`}>
      <span className={!expanded && long ? 'line-clamp-4' : ''}>{value}</span>
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
