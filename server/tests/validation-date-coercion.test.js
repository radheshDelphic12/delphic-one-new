const { createSchema: reqCreate, updateSchema: reqUpdate } = require('../src/modules/requirements/requirements.validation');
const { updateSchema: subUpdate } = require('../src/modules/submissions/submissions.validation');

// Regression: the browser's <input type="date"> emits "YYYY-MM-DD", which Prisma
// rejects for DateTime / @db.Date columns with "Expected ISO-8601 DateTime".
// Every optional date field that flows into a Prisma write must be coerced to a
// JS Date by its validation schema.

const ACCOUNT_ID = '56742a8d-3adc-40a7-6bbf-15bad96897c3';

describe('date-only strings are coerced to Date before hitting Prisma', () => {
  test('requirement create: start_date_target', () => {
    const out = reqCreate.parse({
      account_id: ACCOUNT_ID,
      title: 'Ruby Developer',
      req_type: 'recruitment',
      start_date_target: '2026-09-02',
    });
    expect(out.start_date_target).toBeInstanceOf(Date);
    expect(out.start_date_target.toISOString()).toBe('2026-09-02T00:00:00.000Z');
  });

  test('requirement update: start_date_target', () => {
    const out = reqUpdate.parse({ start_date_target: '2026-09-02' });
    expect(out.start_date_target).toBeInstanceOf(Date);
  });

  test('requirement create: empty / omitted start_date_target stays undefined', () => {
    expect(reqCreate.parse({ account_id: ACCOUNT_ID, title: 'x', req_type: 'recruitment', start_date_target: '' }).start_date_target).toBeUndefined();
    expect(reqCreate.parse({ account_id: ACCOUNT_ID, title: 'x', req_type: 'recruitment' }).start_date_target).toBeUndefined();
  });

  test('requirement create: rejects a non-date string', () => {
    expect(() => reqCreate.parse({ account_id: ACCOUNT_ID, title: 'x', req_type: 'recruitment', start_date_target: 'not-a-date' })).toThrow();
  });

  test('submission update: all offer / joining / bgv dates', () => {
    const out = subUpdate.parse({
      offer_date: '2026-09-02',
      expected_joining_date: '2026-10-01',
      actual_joining_date: '2026-10-05',
      bgv_initiated_date: '2026-09-10',
      bgv_completed_date: '2026-09-20',
    });
    for (const f of ['offer_date', 'expected_joining_date', 'actual_joining_date', 'bgv_initiated_date', 'bgv_completed_date']) {
      expect(out[f]).toBeInstanceOf(Date);
    }
  });

  test('submission update: full ISO string still accepted', () => {
    const out = subUpdate.parse({ actual_joining_date: '2026-10-05T00:00:00.000Z' });
    expect(out.actual_joining_date).toBeInstanceOf(Date);
  });
});
