/**
 * A resource's client billing status on a full leave day: with no hours it is the leave status (billed by the project's leave rule, 0 by
 * default); with approved hours logged the day is a worked day and bills like one.
 */
const resourceBilling = require('../src/modules/calculations/engines/resourceBilling');

const DATE = new Date('2026-10-27T00:00:00.000Z');
const leaveRow = (extra = {}) => ({ org_membership_id: 'm1', from_date: DATE, to_date: DATE, is_half_day: false, leave_type: { name: 'Sick Leave', paid: true }, ...extra });
const data = (leaves, attendance = new Map()) => ({ leaves, attendance });
const status = (leaves, approvedHours, attendance) => resourceBilling.statusFor({ membershipId: 'm1', date: DATE, data: data(leaves, attendance), approvedHours, overtimeHours: 0, dayHours: 8 });

describe('resource billing on a leave day', () => {
  test('a paid full leave day with no hours is the leave status, and bills only what the project rule says', () => {
    expect(status([leaveRow()], 0)).toBe('pl');
    expect(resourceBilling.fractionOf({ pl: 0, full_day: 1, present: 1 }, 'pl', 0)).toBe(0);
    expect(resourceBilling.fractionOf({ pl: 0.5 }, 'pl', 0)).toBe(0.5);
  });

  test('the same day with approved hours logged is a worked day and bills like one', () => {
    expect(status([leaveRow()], 8)).toBe('full_day');
    expect(status([leaveRow()], 5)).toBe('present');
    expect(resourceBilling.fractionOf({ pl: 0, full_day: 1, present: 0.5 }, 'full_day', 8)).toBe(1);
    // an unpaid leave and a comp off behave the same way
    expect(status([leaveRow({ leave_type: { name: 'Leave Without Pay', paid: false } })], 0)).toBe('npl');
    expect(status([leaveRow({ leave_type: { name: 'Leave Without Pay', paid: false } })], 8)).toBe('full_day');
    expect(status([leaveRow({ leave_type: { name: 'Comp Off', paid: true } })], 0)).toBe('comp_off');
  });
});
