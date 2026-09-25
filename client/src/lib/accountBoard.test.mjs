/**
 * T0 assert demo for accountBoard groupBoard / stageColumnStats.
 * Run: node src/lib/accountBoard.test.mjs
 */
import { BOARD_COLUMNS, groupBoard, stageColumnStats } from './accountBoard.js';

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

const requirements = [
  { id: 'req-a', title: 'Backend Engineer', status: 'open' },
  { id: 'req-b', title: 'Frontend Engineer', status: 'in_progress' },
];

const submissions = [
  { id: 's1', stage: 'sourced', requirement: { id: 'req-a', title: 'Backend Engineer' }, seat: { requirement_id: 'req-a' } },
  { id: 's2', stage: 'offer', requirement: { id: 'req-a', title: 'Backend Engineer' }, seat: { requirement_id: 'req-a' } },
  { id: 's3', stage: 'internal_screening', requirement: { id: 'req-b', title: 'Frontend Engineer' }, seat: { requirement_id: 'req-b' } },
];

const { rows } = groupBoard(requirements, submissions);
assert(rows.length === 2, 'expected two requirement rows');
assert(rows[0].cells.sourced.map((s) => s.id).includes('s1'), 's1 in sourced for req-a');
assert(rows[0].cells.offer.map((s) => s.id).includes('s2'), 's2 in offer for req-a');
assert(rows[0].cells.internal_screening.length === 0, 'req-a has no internal_screening');
assert(rows[1].cells.internal_screening.map((s) => s.id).includes('s3'), 's3 in internal_screening for req-b');

const stats = stageColumnStats(rows);
assert(stats.sourced === 1, 'sourced count 1');
assert(stats.offer === 1, 'offer count 1');
assert(stats.internal_screening === 1, 'internal_screening count 1');
assert(stats.closed === 0, 'closed count 0');
assert(BOARD_COLUMNS.includes('backout') && BOARD_COLUMNS.includes('rejected'), 'terminal columns present');

const empty = groupBoard([], []);
assert(empty.rows.length === 0, 'empty board has no rows');

console.log('accountBoard.test.mjs: all asserts passed');
