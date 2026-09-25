const STATUS_STYLES = {
  done: 'text-success-700',
  current: 'font-medium text-primary-700',
  pending: 'text-tertiary-400',
};

const STATUS_ICON = { done: '✓', current: '●', pending: '○' };

/** Step-by-step "why this percentage" list backing a ProgressRing, from computeClosureDetail's `steps`. */
export default function ClosureStepsBreakdown({ steps }) {
  if (!steps?.length) return null;
  return (
    <ul className="space-y-1">
      {steps.map((step) => (
        <li key={step.key} className={`flex items-center gap-2 text-xs ${STATUS_STYLES[step.status] || 'text-tertiary-500'}`}>
          <span aria-hidden="true">{STATUS_ICON[step.status] || '○'}</span>
          <span>{step.label}</span>
        </li>
      ))}
    </ul>
  );
}
