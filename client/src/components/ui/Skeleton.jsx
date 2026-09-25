/**
 * Lightweight loading skeleton block.
 */
export default function Skeleton({ className = '', rounded = 'xl' }) {
  const roundedClass = rounded === 'full' ? 'rounded-full' : rounded === '2xl' ? 'rounded-2xl' : 'rounded-xl';
  return <div className={`animate-pulse bg-tertiary-100 ${roundedClass} ${className}`} aria-hidden="true" />;
}
