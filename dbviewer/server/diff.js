// Row-level comparison of one table between two snapshots. Rows are keyed by primary key; a table without one is compared as a
// multiset of whole rows (so it can only report added / removed, never "changed"). Always-masked columns are dropped here, so
// their values never reach the result files: a change in one only shows as { col, masked: true }.
const { MASK, classify } = require('./mask');

const MAX_PER_KIND = Number(process.env.DIFF_MAX_ROWS) || 50000;

function toObject(columns, row, cols) {
  const out = {};
  for (const c of cols) {
    const i = columns.indexOf(c);
    const v = i === -1 ? null : row[i];
    out[c] = classify(c) === 'always' && v !== null ? MASK : v;
  }
  return out;
}

function diffTable(a, b, pk) {
  const colsA = a ? a.columns : [];
  const colsB = b ? b.columns : [];
  const common = colsB.filter((c) => colsA.includes(c));
  const columnsAdded = colsB.filter((c) => !colsA.includes(c));
  const columnsRemoved = colsA.filter((c) => !colsB.includes(c));
  const rowsA = a ? a.rows : [];
  const rowsB = b ? b.rows : [];
  const allCols = [...new Set([...colsB, ...colsA])];
  const result = {
    columns: colsB.length ? colsB : colsA,
    pk: [],
    keyed: false,
    columns_added: columnsAdded,
    columns_removed: columnsRemoved,
    added: [],
    removed: [],
    changed: [],
    counts: { added: 0, removed: 0, changed: 0 },
    truncated: false,
  };
  const push = (kind, item) => {
    result.counts[kind] += 1;
    if (result[kind].length < MAX_PER_KIND) result[kind].push(item);
    else result.truncated = true;
  };

  const usablePk = pk && pk.length > 0 && pk.every((c) => colsA.includes(c) && colsB.includes(c)) ? pk : null;
  if (usablePk) {
    result.pk = usablePk;
    result.keyed = true;
    const idxA = usablePk.map((c) => colsA.indexOf(c));
    const idxB = usablePk.map((c) => colsB.indexOf(c));
    const keyOf = (row, idx) => JSON.stringify(idx.map((i) => row[i]));
    const mapA = new Map();
    for (const r of rowsA) mapA.set(keyOf(r, idxA), r);
    const posA = common.map((c) => colsA.indexOf(c));
    const posB = common.map((c) => colsB.indexOf(c));
    const seen = new Set();
    for (const r of rowsB) {
      const key = keyOf(r, idxB);
      const old = mapA.get(key);
      if (!old) {
        push('added', { key: JSON.parse(key), row: toObject(colsB, r, colsB) });
        continue;
      }
      seen.add(key);
      const changes = [];
      for (let i = 0; i < common.length; i += 1) {
        const ov = old[posA[i]];
        const nv = r[posB[i]];
        if (ov !== nv) {
          if (classify(common[i]) === 'always') changes.push({ col: common[i], masked: true });
          else changes.push({ col: common[i], old: ov, new: nv });
        }
      }
      if (changes.length) push('changed', { key: JSON.parse(key), changes });
    }
    for (const [key, r] of mapA) {
      if (!seen.has(key)) push('removed', { key: JSON.parse(key), row: toObject(colsA, r, colsA) });
    }
    return result;
  }

  // No usable primary key: multiset of rows over the columns both sides have.
  const posA = common.map((c) => colsA.indexOf(c));
  const posB = common.map((c) => colsB.indexOf(c));
  const hashOf = (row, pos) => JSON.stringify(pos.map((i) => row[i]));
  const bag = new Map();
  for (const r of rowsA) {
    const h = hashOf(r, posA);
    const list = bag.get(h);
    if (list) list.push(r);
    else bag.set(h, [r]);
  }
  for (const r of rowsB) {
    const h = hashOf(r, posB);
    const list = bag.get(h);
    if (list && list.length) list.pop();
    else push('added', { key: null, row: toObject(colsB, r, allCols.filter((c) => colsB.includes(c))) });
  }
  for (const list of bag.values()) for (const r of list) push('removed', { key: null, row: toObject(colsA, r, colsA) });
  return result;
}

module.exports = { diffTable, MAX_PER_KIND };
