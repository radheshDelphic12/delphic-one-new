import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

/**
 * Page breadcrumb trail. Every item except the last is a link; the last
 * (current page) renders as plain text.
 *
 * Args:
 *   items: [{ label, to? }] — omit `to` (or leave it on the last entry) to
 *     render that crumb as the non-clickable current page.
 */
export default function Breadcrumbs({ items = [] }) {
  if (!items.length) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-tertiary-500">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={`${item.label}-${index}`} className="flex items-center gap-1">
            {index > 0 && <ChevronRight className="h-3 w-3 text-tertiary-300" aria-hidden="true" />}
            {item.to && !isLast ? (
              <Link to={item.to} className="text-primary-700 hover:underline">
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? 'font-medium text-tertiary-700' : ''} aria-current={isLast ? 'page' : undefined}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
