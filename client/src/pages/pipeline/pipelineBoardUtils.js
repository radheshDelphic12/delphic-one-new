/**
 * Strict-pure helpers for role-specific pipeline boards.
 */

export const LEAD_COLUMNS = ['lead', 'meeting_scheduled', 'rescheduled', 'active', 'dropped'];
export const JOB_COLUMNS = ['open', 'in_progress', 'on_hold', 'closed', 'dropped'];

/**
 * Group rows into stage columns.
 *
 * Args:
 *   rows: Items that each have a stageField value.
 *   columns: Ordered stage keys for the board.
 *   stageField: Property name that holds the stage/status (default "stage").
 *
 * Returns:
 *   Object keyed by column with arrays of matching rows (empty arrays for missing columns).
 */
export function groupByStage(rows, columns, stageField = 'stage') {
  const list = Array.isArray(rows) ? rows : [];
  const cols = Array.isArray(columns) ? columns : [];
  const cells = Object.fromEntries(cols.map((column) => [column, []]));
  for (const row of list) {
    const stage = row?.[stageField];
    if (stage && cells[stage]) cells[stage].push(row);
  }
  return cells;
}

/**
 * Pick the default pipeline view for a role.
 *
 * Args:
 *   role: User role string.
 *
 * Returns:
 *   "matrix" | "lead" | "jobs" | "candidates"
 */
export function defaultPipelineView(role) {
  if (role === 'bda' || role === 'sales' || role === 'recruiter' || role === 'admin') return 'matrix';
  return 'matrix';
}

/**
 * Format a stage/status key for display.
 *
 * Args:
 *   value: Stage string (may contain underscores).
 *
 * Returns:
 *   Human-readable label, or em dash when empty.
 */
export function formatStageLabel(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value).replace(/_/g, ' ');
}

/**
 * Short key for an entity id.
 *
 * Args:
 *   prefix: Key prefix (e.g. ACC, REQ, SUB).
 *   id: UUID string.
 *
 * Returns:
 *   Prefixed truncated key.
 */
export function shortKey(prefix, id) {
  return `${prefix}-${String(id || '').slice(0, 8).toUpperCase()}`;
}
