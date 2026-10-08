// Pure leave-hours rules shared by the leave, timesheet and payroll modules
// (no imports on purpose, so none of them can form a require cycle).
//
//   Full day = the day's standard hours (the employee's shift, 9h default).
//   Half day = half of that (4.5h). A day's leave is capped at the standard day.
//   Paid leave hours count as paid hours; unpaid leave hours never do.
//   Only APPROVED leave is ever passed in here — pending / rejected / cancelled
//   leave has no effect on hours, balance or pay.

const round2 = (n) => Math.round(n * 100) / 100;

// leaves: [{ is_half_day, paid }] approved on one working day.
function leaveHoursForDay(leaves, standardHours) {
  let paid = 0;
  let unpaid = 0;
  for (const leave of leaves || []) {
    const room = standardHours - paid - unpaid;
    if (room <= 0) break;
    const hours = Math.min(leave.is_half_day ? standardHours / 2 : standardHours, room);
    if (leave.paid) paid += hours;
    else unpaid += hours;
  }
  return { paid: round2(paid), unpaid: round2(unpaid), total: round2(paid + unpaid) };
}

module.exports = { leaveHoursForDay };
