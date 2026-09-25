import { Link } from 'react-router-dom';
import Tooltip from './Tooltip.jsx';

/** Saturated Figma KPI accents — not washed pastels */
const KPI_THEMES = {
  blue: {
    border: 'border-t-[#3B82F6]',
    iconBg: 'bg-[#EFF6FF] text-[#2563EB]',
  },
  green: {
    border: 'border-t-[#10B981]',
    iconBg: 'bg-[#ECFDF5] text-[#059669]',
  },
  purple: {
    border: 'border-t-[#8B5CF6]',
    iconBg: 'bg-[#F5F3FF] text-[#7C3AED]',
  },
  orange: {
    border: 'border-t-[#F59E0B]',
    iconBg: 'bg-[#FFFBEB] text-[#D97706]',
  },
  red: {
    border: 'border-t-[#EF4444]',
    iconBg: 'bg-[#FEF2F2] text-[#DC2626]',
  },
  cyan: {
    border: 'border-t-[#06B6D4]',
    iconBg: 'bg-[#ECFEFF] text-[#0891B2]',
  },
};

/**
 * KPI card with themed icon and top accent border.
 * Fixed height so every card in the row matches.
 */
export default function KpiCard({ label, value, hint, description, icon: Icon, theme = 'blue', to }) {
  const palette = KPI_THEMES[theme] || KPI_THEMES.blue;

  const baseClass = `hover-zoom relative flex h-28 w-full flex-col overflow-hidden rounded-2xl border border-tertiary-100 border-t-[3px] bg-white p-4 shadow-card ${palette.border}`;

  const CardTag = to ? Link : 'div';
  const cardProps = to
    ? { to, className: `${baseClass} transition-shadow hover:shadow-cardHover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400` }
    : { className: baseClass };

  const card = (
    <CardTag {...cardProps}>
      <div className="flex min-h-[3.25rem] items-start gap-2">
        {Icon && (
          <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${palette.iconBg}`}>
            <Icon className="h-4 w-4" strokeWidth={2.25} />
          </span>
        )}
        <div className="min-w-0 flex-1 text-right">
          <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-tertiary-500">{label}</div>
          <div className="mt-0.5 text-2xl font-bold leading-none tabular-nums tracking-tight text-tertiary-900">
            {value ?? '—'}
          </div>
        </div>
      </div>
      <div className="mt-auto truncate text-xs text-tertiary-500">{hint || '\u00A0'}</div>
    </CardTag>
  );

  if (!description) return card;
  return (
    <Tooltip label={description} side="bottom" block>
      {card}
    </Tooltip>
  );
}

export { KPI_THEMES };
