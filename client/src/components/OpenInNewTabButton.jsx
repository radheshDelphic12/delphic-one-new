import { useLocation } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';

/**
 * Opens the current view (path + search, so filters travel with it) in a new
 * browser tab. Rendered as a real anchor — the browser-native new-tab affordance,
 * which (unlike `window.open(url, '_blank', 'features')`) is never popup-blocked.
 * Available to every role on every board.
 */
export default function OpenInNewTabButton({ label = 'Open in new tab', className = 'btn-secondary' }) {
  const { pathname, search } = useLocation();
  return (
    <a
      href={`${pathname}${search}`}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title="Opens this view in a new tab, keeping the current filters"
    >
      <ExternalLink className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </a>
  );
}
