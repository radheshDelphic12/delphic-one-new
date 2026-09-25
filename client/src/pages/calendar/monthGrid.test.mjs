import assert from 'node:assert/strict';
import { layoutDayEvents } from './monthGrid.js';

const at = (h, m = 0) => `2026-09-08T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
const ev = (id, h, m, dur) => ({ id, scheduled_at: at(h, m), duration_minutes: dur });

// Three events all overlapping 12:00–13:00 -> 3 columns, every one knows colCount = 3.
const cluster = layoutDayEvents([
  ev('a', 12, 0, 60),
  ev('b', 12, 0, 60),
  ev('c', 12, 30, 60),
]);
assert.deepEqual(
  cluster.map((r) => [r.event.id, r.col, r.colCount]).sort(),
  [
    ['a', 0, 3],
    ['b', 1, 3],
    ['c', 2, 3],
  ]
);
// no two blocks share a column within the cluster
assert.equal(new Set(cluster.map((r) => r.col)).size, cluster.length);

// A later, non-overlapping event is its own cluster and spans full width.
const [, , solo] = layoutDayEvents([ev('a', 12, 0, 60), ev('b', 12, 0, 60), ev('c', 14, 0, 30)]);
assert.deepEqual([solo.event.id, solo.col, solo.colCount], ['c', 0, 1]);

// A freed column is reused: b (12:00-12:30) and d (12:30-13:00) don't overlap,
// so they share a column; the long a (12:00-13:30) sits in its own column.
const chain = layoutDayEvents([
  ev('a', 12, 0, 90),
  ev('b', 12, 0, 30),
  ev('d', 12, 30, 30),
]);
const byId = Object.fromEntries(chain.map((r) => [r.event.id, r]));
assert.equal(byId.b.col, byId.d.col); // same column, reused
assert.notEqual(byId.a.col, byId.b.col);
assert.equal(byId.a.colCount, 2);
assert.equal(byId.d.colCount, 2);

console.log('monthGrid.test.mjs: ok');
