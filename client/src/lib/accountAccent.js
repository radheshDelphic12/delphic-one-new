/**
 * Deterministic per-account accent color so different accounts are visually
 * distinguishable across the list, peek, and detail views — same account
 * always gets the same color, derived from its id.
 */
const PALETTE = [
  { name: 'blue', dot: 'bg-blue-500', border: 'border-l-blue-500', text: 'text-blue-700', ring: 'ring-blue-200' },
  { name: 'violet', dot: 'bg-violet-500', border: 'border-l-violet-500', text: 'text-violet-700', ring: 'ring-violet-200' },
  { name: 'teal', dot: 'bg-teal-500', border: 'border-l-teal-500', text: 'text-teal-700', ring: 'ring-teal-200' },
  { name: 'amber', dot: 'bg-amber-500', border: 'border-l-amber-500', text: 'text-amber-700', ring: 'ring-amber-200' },
  { name: 'rose', dot: 'bg-rose-500', border: 'border-l-rose-500', text: 'text-rose-700', ring: 'ring-rose-200' },
  { name: 'emerald', dot: 'bg-emerald-500', border: 'border-l-emerald-500', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  { name: 'fuchsia', dot: 'bg-fuchsia-500', border: 'border-l-fuchsia-500', text: 'text-fuchsia-700', ring: 'ring-fuchsia-200' },
  { name: 'cyan', dot: 'bg-cyan-500', border: 'border-l-cyan-500', text: 'text-cyan-700', ring: 'ring-cyan-200' },
];

function hashString(value) {
  let hash = 0;
  const str = String(value || '');
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Stable accent (dot/border/text/ring class names) for a given account id. */
export function accountAccent(accountId) {
  return PALETTE[hashString(accountId) % PALETTE.length];
}
