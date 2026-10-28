const holdPeriods = require('../src/lib/holdPeriods');
const { contractState } = require('../src/lib/contractState');

const d = (s) => new Date(`${s}T00:00:00.000Z`);

describe('contract hold periods', () => {
  const periods = holdPeriods.parse([
    { from: '2026-08-15', resume: '2026-10-01' },
    { from: '2027-01-10', resume: null },
  ]);

  test('a day is held from `from` up to the day before `resume`', () => {
    expect(holdPeriods.isHeld(periods, d('2026-08-14'))).toBe(false);
    expect(holdPeriods.isHeld(periods, d('2026-08-15'))).toBe(true);
    expect(holdPeriods.isHeld(periods, d('2026-09-30'))).toBe(true);
    expect(holdPeriods.isHeld(periods, d('2026-10-01'))).toBe(false);
    expect(holdPeriods.isHeld(periods, d('2027-02-01'))).toBe(true);
  });

  test('held days per month: Aug 15-31 = 17, Sep = 30, Oct = 0', () => {
    expect(holdPeriods.heldDays(periods, d('2026-08-01'), d('2026-08-31'))).toBe(17);
    expect(holdPeriods.heldDays(periods, d('2026-09-01'), d('2026-09-30'))).toBe(30);
    expect(holdPeriods.heldDays(periods, d('2026-10-01'), d('2026-10-31'))).toBe(0);
  });

  test('validation rejects overlaps, a resume before the start and an open hold followed by another', () => {
    expect(holdPeriods.validate([{ from: '2026-08-15', resume: '2026-10-01' }, { from: '2026-11-01', resume: null }])).toBeNull();
    expect(holdPeriods.validate([{ from: '2026-08-15', resume: '2026-10-01' }, { from: '2026-09-01', resume: '2026-09-10' }])).toBe('hold_periods_overlap');
    expect(holdPeriods.validate([{ from: '2026-08-15', resume: null }, { from: '2026-11-01', resume: null }])).toBe('hold_periods_overlap');
    expect(holdPeriods.validate([{ from: '2026-08-15', resume: '2026-08-15' }])).toBe('hold_resume_before_from');
  });

  test('inside a hold period the contract reads as on hold, then runs again', () => {
    const account = { agreement_start_date: d('2026-07-01'), agreement_end_date: null, contract_hold_periods: [{ from: '2026-08-15', resume: '2026-10-01' }] };
    expect(contractState(account, d('2026-09-01')).state).toBe('on_hold');
    expect(contractState(account, d('2026-10-01')).state).toBe('running');
  });
});
