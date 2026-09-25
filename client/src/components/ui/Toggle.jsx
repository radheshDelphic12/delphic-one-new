/**
 * Generic on/off switch. Controlled: pass `checked` + `onChange(next)`.
 *
 * Args:
 *   checked: Boolean state.
 *   onChange: (next: boolean) => void.
 *   disabled: Greys the control and blocks interaction.
 *   label: Accessible label (visually hidden unless `showLabel`).
 *   showLabel: Render the label text beside the switch.
 *   size: 'sm' | 'md'.
 */
const SIZES = {
  sm: {
    track: 'h-5 w-9',
    knob: 'h-4 w-4 peer-checked:translate-x-4',
  },
  md: {
    track: 'h-6 w-11',
    knob: 'h-5 w-5 peer-checked:translate-x-5',
  },
};

export default function Toggle({
  checked = false,
  onChange,
  disabled = false,
  label,
  showLabel = false,
  size = 'md',
  id,
}) {
  const dims = SIZES[size] || SIZES.md;

  return (
    <label
      className={`inline-flex items-center gap-2 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
      htmlFor={id}
    >
      <span className="relative inline-flex shrink-0 items-center">
        <input
          id={id}
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange?.(e.target.checked)}
          aria-label={label}
        />
        <span
          className={`${dims.track} rounded-full bg-tertiary-200 transition-colors peer-checked:bg-primary-600 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-300`}
        />
        <span
          className={`pointer-events-none absolute left-0.5 ${dims.knob} rounded-full bg-white shadow transition-transform`}
        />
      </span>
      {showLabel && label && <span className="text-sm text-tertiary-700">{label}</span>}
    </label>
  );
}
