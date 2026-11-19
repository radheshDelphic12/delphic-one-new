/**
 * Email address as a mailto link. Inherits the surrounding text size/colour, shows an underline on hover,
 * and does not trigger a click on a clickable table row / card it sits in.
 * Renders `fallback` (default nothing) when there is no usable address.
 */
export default function EmailLink({ email, className = '', fallback = null }) {
  const value = typeof email === 'string' ? email.trim() : '';
  if (!value || !value.includes('@')) return fallback;
  return (
    <a
      href={`mailto:${value}`}
      title={`Send an email to ${value}`}
      onClick={(e) => e.stopPropagation()}
      className={`break-all hover:text-primary-700 hover:underline focus-visible:underline ${className}`}
    >
      {value}
    </a>
  );
}
