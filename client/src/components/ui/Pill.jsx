import { titleCase } from '../../lib/format.js';

const TONES = {
  gray: 'bg-tertiary-100 text-tertiary-700',
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-green-50 text-green-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  purple: 'bg-purple-50 text-purple-700',
  cyan: 'bg-cyan-50 text-cyan-700',
};

// Status word -> tone, shared across the vertical modules.
const AUTO_TONE = {
  active: 'green', trading: 'green', completed: 'green', won: 'green', valid: 'green', paid: 'green', sent: 'green',
  onboarding: 'amber', paused: 'amber', proposal: 'amber', expiring_soon: 'amber', planning: 'blue', draft: 'gray',
  lead: 'blue', new: 'blue', contacted: 'blue', qualified: 'purple', on_hold: 'amber', open: 'blue',
  inactive: 'gray', not_trading: 'gray', no_expiry: 'gray', lost: 'red', terminated: 'red', cancelled: 'red',
  expired: 'red', failed: 'red', skipped: 'gray', queued: 'blue',
};

export default function Pill({ children, value, tone }) {
  const text = children ?? titleCase(value);
  const resolved = tone || AUTO_TONE[value] || 'gray';
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[resolved]}`}>{text}</span>;
}
