const path = require('path');
const { decodeField, decodeRow, parseSchema, getIndex, readTable } = require('../server/dumpReader');
const { FIXTURES, A } = require('./helpers');

const dumpA = path.join(FIXTURES, A);

describe('COPY text decoding', () => {
  test('\\N is NULL, an empty field is an empty string, plain text is untouched', () => {
    expect(decodeField('\\N')).toBeNull();
    expect(decodeField('')).toBe('');
    expect(decodeField('plain')).toBe('plain');
  });

  test('escapes: tab, newline, carriage return, backslash, octal and hex', () => {
    expect(decodeField('a\\tb')).toBe('a\tb');
    expect(decodeField('a\\nb\\rc')).toBe('a\nb\rc');
    expect(decodeField('back\\\\slash')).toBe('back\\slash');
    expect(decodeField('\\\\N')).toBe('\\N'); // the two characters "\N" are a value, not NULL
    expect(decodeField('\\101\\x42')).toBe('AB');
  });

  test('a row is split on real tabs only', () => {
    expect(decodeRow('a\\tb\tc\t\\N\t')).toEqual(['a\tb', 'c', null, '']);
  });
});

describe('schema parsing', () => {
  test('columns, types and primary keys from pg_restore --schema-only text', () => {
    const sql = [
      'CREATE TABLE public.people (',
      '    id text NOT NULL,',
      '    amount numeric(10,2),',
      '    stage public."AccountStage" DEFAULT \'lead\'::public."AccountStage" NOT NULL,',
      '    "order" integer',
      ');',
      '',
      'ALTER TABLE ONLY public.people',
      '    ADD CONSTRAINT people_pkey PRIMARY KEY (id);',
    ].join('\n');
    expect(parseSchema(sql)).toEqual({
      people: {
        columns: [
          { name: 'id', type: 'text' },
          { name: 'amount', type: 'numeric(10,2)' },
          { name: 'stage', type: 'public."AccountStage"' },
          { name: 'order', type: 'integer' },
        ],
        pk: ['id'],
      },
    });
  });
});

describe('reading a real dump file', () => {
  test('readTable decodes NULLs and embedded tabs, newlines, backslashes and quotes', async () => {
    const t = await readTable(dumpA, 'people');
    expect(t.columns).toEqual(['id', 'name', 'note', 'password_hash', 'aadhaar_number', 'amount']);
    const byId = Object.fromEntries(t.rows.map((r) => [r[0], r]));
    expect(byId.p1[2]).toBe('tab\there and newline\nand back\\slash and "quotes"');
    expect(byId.p2[2]).toBeNull();
    expect(byId.p5[2]).toBe('');
    expect(byId.p3[5]).toBe('30.00');
  });

  test('an unknown table is a 404', async () => {
    await expect(readTable(dumpA, 'nope')).rejects.toMatchObject({ status: 404 });
  });

  test('the index has row counts, primary keys, a content hash per table and the migration count', async () => {
    const idx = await getIndex(dumpA, null);
    expect(idx.tables.people.rows).toBe(5);
    expect(idx.tables.people.pk).toEqual(['id']);
    expect(idx.tables.events.pk).toEqual([]);
    expect(idx.tables.events.rows).toBe(4);
    expect(idx.tables.people.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(idx.migration_count).toBe(2);
  });
});
