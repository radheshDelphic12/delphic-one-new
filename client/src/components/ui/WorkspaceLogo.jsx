import { useState } from 'react';

const SIZES = {
  sm: 'h-7 w-7 rounded-lg text-xs',
  md: 'h-9 w-9 rounded-xl text-sm',
  lg: 'h-12 w-12 rounded-2xl text-lg',
};

// Deterministic tint from the name so each company keeps a recognisable
// colour when it has no logo. Full class strings so Tailwind can see them.
const TINTS = [
  'bg-primary-600',
  'bg-violet-600',
  'bg-emerald-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-cyan-600',
];

function tintFor(name) {
  let hash = 0;
  for (const ch of String(name || '?')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length];
}

/** Company/tenant logo tile: the org's logo when it has one (and it loads), else a tinted initial. */
export default function WorkspaceLogo({ name, logoUrl, size = 'md', className = '' }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const box = SIZES[size] || SIZES.md;
  const showImage = logoUrl && failedUrl !== logoUrl;

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold text-white ${box} ${
        showImage ? 'bg-white p-1 ring-1 ring-black/5' : tintFor(name)
      } ${className}`}
      aria-hidden="true"
    >
      {showImage ? (
        <img src={logoUrl} alt="" className="h-full w-full object-contain" onError={() => setFailedUrl(logoUrl)} />
      ) : (
        String(name || '?').trim().slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
