const path = require('path');
const { readTable, getIndex } = require('../server/dumpReader');
const { diffTable } = require('../server/diff');
const { classify, show, MASK } = require('../server/mask');
const { FIXTURES, A, B } = require('./helpers');

const dumpA = path.join(FIXTURES, A);
const dumpB = path.join(FIXTURES, B);

describe('masking rules', () => {
  test('secrets are always masked, personal identifiers only without reveal, the rest is shown', () => {
    expect(classify('password_hash')).toBe('always');
    expect(classify('access_token')).toBe('always');
    expect(classify('otp_code')).toBe('always');
    expect(classify('api_key')).toBe('always');
    expect(classify('aadhaar_number')).toBe('sensitive');
    expect(classify('bank_account_number')).toBe('sensitive');
    expect(classify('pan_number')).toBe('sensitive');
    expect(classify('ifsc_code')).toBe('sensitive');
    expect(classify('name')).toBeNull();
  });

  test('reveal opens sensitive columns but never the always-masked ones', () => {
    expect(show('aadhaar_number', '1111', false)).toBe(MASK);
    expect(show('aadhaar_number', '1111', true)).toBe('1111');
    expect(show('password_hash', 'secret', true)).toBe(MASK);
    expect(show('password_hash', 'secret', false)).toBe(MASK);
    expect(show('password_hash', null, true)).toBeNull(); // an empty value stays empty
    expect(show('name', 'Asha', false)).toBe('Asha');
  });
});

describe('table diff on the fixture dumps', () => {
  let people;
  beforeAll(async () => {
    const [a, b] = [await readTable(dumpA, 'people'), await readTable(dumpB, 'people')];
    people = diffTable(a, b, ['id']);
  });

  test('added, removed and changed rows are found by primary key', () => {
    expect(people.keyed).toBe(true);
    expect(people.counts).toEqual({ added: 1, removed: 1, changed: 2 });
    expect(people.added.map((r) => r.key)).toEqual([['p6']]);
    expect(people.removed.map((r) => r.key)).toEqual([['p4']]);
    expect(people.changed.map((r) => r.key[0]).sort()).toEqual(['p2', 'p3']);
  });

  test('a changed row lists each changed column with old and new', () => {
    const p3 = people.changed.find((r) => r.key[0] === 'p3');
    expect(p3.changes).toEqual([
      { col: 'aadhaar_number', old: null, new: '7777 8888 9999' },
      { col: 'amount', old: '30.00', new: '31.00' },
    ]);
  });

  test('a column only the newer snapshot has is a schema change, not a row change (p1 only gained a nickname)', () => {
    expect(people.columns_added).toEqual(['nickname']);
    expect(people.columns_removed).toEqual([]);
    expect(people.changed.find((r) => r.key[0] === 'p1')).toBeUndefined();
  });

  test('a secret column that changed is reported as changed, with no values anywhere in the result', () => {
    const p2 = people.changed.find((r) => r.key[0] === 'p2');
    expect(p2.changes.map((c) => c.col)).toEqual(['name', 'note', 'password_hash']);
    expect(p2.changes.find((c) => c.col === 'password_hash')).toEqual({ col: 'password_hash', masked: true });
    const json = JSON.stringify(people);
    expect(json).not.toMatch(/hash-[A-F]-\d/);
    expect(people.added[0].row.password_hash).toBe(MASK); // an added row carries the mask, not the hash
  });
});

describe('table diff without a primary key, and tables on one side only', () => {
  test('rows are compared as a multiset: duplicates count, nothing can be "changed"', async () => {
    const d = diffTable(await readTable(dumpA, 'events'), await readTable(dumpB, 'events'), []);
    expect(d.keyed).toBe(false);
    expect(d.counts).toEqual({ added: 2, removed: 2, changed: 0 });
    expect(d.added.map((r) => r.row.kind).sort()).toEqual(['logout', 'new-only']);
    expect(d.removed.map((r) => r.row.kind).sort()).toEqual(['login', 'old-only']);
  });

  test('a table only in the older snapshot is all removed, only in the newer is all added', async () => {
    const gone = diffTable(await readTable(dumpA, 'dropped_later'), null, ['id']);
    expect(gone.counts).toEqual({ added: 0, removed: 1, changed: 0 });
    expect(gone.columns_removed).toEqual(['id', 'label']);
    const fresh = diffTable(null, await readTable(dumpB, 'brand_new'), ['id']);
    expect(fresh.counts).toEqual({ added: 1, removed: 0, changed: 0 });
  });

  test('identical tables have identical content hashes (the shortcut that skips reading them)', async () => {
    const [ia, ib] = [await getIndex(dumpA, null), await getIndex(dumpB, null)];
    expect(ia.tables.same_in_both.hash).toBe(ib.tables.same_in_both.hash);
    expect(ia.tables.people.hash).not.toBe(ib.tables.people.hash);
  });
});
