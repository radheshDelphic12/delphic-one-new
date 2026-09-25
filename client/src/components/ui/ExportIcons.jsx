/** Branded-style export icons for report download buttons. */

export function ExcelIcon({ className = 'h-4 w-4 shrink-0' }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <rect width="20" height="20" rx="3" fill="#107C41" />
      <path
        d="M5.8 5.2h2.3l1.7 3 1.7-3h2.3l-2.8 4.5 2.9 4.8h-2.4l-1.8-3.1-1.8 3.1H5.8l2.9-4.8L5.8 5.2z"
        fill="#fff"
      />
    </svg>
  );
}

export function PdfIcon({ className = 'h-4 w-4 shrink-0' }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <rect width="20" height="20" rx="3" fill="#E53935" />
      <path
        d="M6.2 5.5h2.5c2 0 3.2 1.1 3.2 2.8 0 1.15-.6 2-1.55 2.35l1.85 2.85H10.1L8.5 11.2H7.4v2.55H6.2V5.5zm2.3 3.8c.9 0 1.4-.45 1.4-1.15 0-.7-.5-1.15-1.4-1.15H7.4v2.3h1.1z"
        fill="#fff"
      />
    </svg>
  );
}
