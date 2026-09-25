const SIZE = {
  sm: { box: 28, stroke: 3, font: 8 },
  md: { box: 48, stroke: 4, font: 12 },
};

function ringColor(percent) {
  if (percent >= 75) return '#16a34a'; // success
  if (percent >= 40) return '#d97706'; // warning
  return '#dc2626'; // danger
}

/** Circular closure-probability indicator. `percent` null/undefined renders a muted dash. */
export default function ProgressRing({ percent, size = 'sm' }) {
  const { box, stroke, font } = SIZE[size] || SIZE.sm;

  if (percent == null) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full border border-tertiary-200 text-tertiary-400"
        style={{ width: box, height: box, fontSize: font }}
        title="No active submission"
      >
        —
      </span>
    );
  }

  const radius = (box - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, percent)) / 100);
  const color = ringColor(percent);
  const center = box / 2;

  return (
    <span className="relative inline-flex" style={{ width: box, height: box }} title={`${percent}% probability of closure`}>
      <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`}>
        <circle cx={center} cy={center} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center font-medium text-tertiary-700"
        style={{ fontSize: font }}
      >
        {percent}%
      </span>
    </span>
  );
}
