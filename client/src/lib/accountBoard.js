import { SUBMISSION_PIPELINE } from './submissionStages.js';

/** Stage columns for the account pipeline board (happy path + terminal exits). */
export const BOARD_COLUMNS = [...SUBMISSION_PIPELINE, 'backout', 'rejected'];

/**
 * Group requirements into board rows with submissions in stage cells.
 *
 * Args:
 *   requirements: Account requirements (each needs id).
 *   submissions: Submissions whose seat.requirement belongs to the account.
 *
 * Returns:
 *   { rows: [{ requirement, cells: { [stage]: submissions[] } }] }
 */
export function groupBoard(requirements, submissions) {
  const reqList = Array.isArray(requirements) ? requirements : [];
  const subList = Array.isArray(submissions) ? submissions : [];

  const byRequirement = new Map();
  for (const req of reqList) {
    byRequirement.set(req.id, {
      requirement: req,
      cells: Object.fromEntries(BOARD_COLUMNS.map((stage) => [stage, []])),
    });
  }

  for (const sub of subList) {
    const reqId = sub.requirement?.id || sub.seat?.requirement_id;
    if (!reqId) continue;
    let row = byRequirement.get(reqId);
    if (!row) {
      row = {
        requirement: {
          id: reqId,
          title: sub.requirement?.title || 'Requirement',
          status: 'open',
        },
        cells: Object.fromEntries(BOARD_COLUMNS.map((stage) => [stage, []])),
      };
      byRequirement.set(reqId, row);
    }
    const stage = BOARD_COLUMNS.includes(sub.stage) ? sub.stage : 'sourced';
    row.cells[stage].push(sub);
  }

  const rows = [];
  for (const req of reqList) {
    rows.push(byRequirement.get(req.id));
    byRequirement.delete(req.id);
  }
  for (const orphan of byRequirement.values()) {
    rows.push(orphan);
  }
  return { rows };
}

/**
 * Count submissions per stage across all rows.
 *
 * Args:
 *   rows: Board rows from groupBoard.
 *
 * Returns:
 *   Object mapping stage → count.
 */
export function stageColumnStats(rows) {
  const stats = Object.fromEntries(BOARD_COLUMNS.map((stage) => [stage, 0]));
  for (const row of rows || []) {
    for (const stage of BOARD_COLUMNS) {
      stats[stage] += (row.cells[stage] || []).length;
    }
  }
  return stats;
}
