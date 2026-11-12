/** Small tag for a premium customer (the flag lives on the client account). */
export function PremiumBadge({ className = '' }) {
  return (
    <span className={`inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ${className}`} data-testid="premium-badge" title="Premium customer">
      Premium
    </span>
  );
}

/** A closed candidate whose actual joining date is still to come. */
export function JoiningPendingBadge({ className = '' }) {
  return (
    <span className={`inline-flex items-center rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 ${className}`} data-testid="joining-pending-badge" title="Closed, actual joining date not entered yet">
      Joining date pending
    </span>
  );
}

export default PremiumBadge;
