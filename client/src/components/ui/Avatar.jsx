/**
 * Circular avatar showing initials from a name.
 */
export default function Avatar({ name = '?', size = 'md', className = '' }) {
  const sizeClass = size === 'sm' ? 'h-7 w-7 text-[10px]' : size === 'lg' ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-xs';
  const initial = String(name).trim().slice(0, 1).toUpperCase() || '?';

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-primary-600 font-semibold text-white ${sizeClass} ${className}`}
      title={name}
      aria-hidden={name === '?'}
    >
      {initial}
    </span>
  );
}
