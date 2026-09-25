/**
 * Shared Recharts theme — colors and tooltip styling only.
 * Stage palette matches Figma dashboard exactly.
 */

export const CHART_COLORS = {
  primary: '#105AA9',
  primarySoft: '#60A5FA',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',
  muted: '#9CA3AF',
  grid: '#E5E7EB',
  purple: '#8B5CF6',
};

/** Funnel / stage-mix order: Sourced → Screening → Submitted → Interview → Offer → BGV → Closed */
export const CHART_PALETTE = [
  '#3B82F6', // Sourced — bright blue
  '#60A5FA', // Screening — sky blue
  '#8B5CF6', // Submitted — vivid purple
  '#F59E0B', // Interview — amber
  '#10B981', // Offer — emerald
  '#9CA3AF', // BGV — medium gray
  '#EF4444', // Closed — red
];

export const chartTooltipStyle = {
  borderRadius: 12,
  border: '1px solid #E5E7EB',
  boxShadow: '0 4px 12px -2px rgb(15 23 42 / 0.08)',
  fontSize: 12,
};
