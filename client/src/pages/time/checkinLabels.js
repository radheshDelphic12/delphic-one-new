// Wording and formatting for Workplace Check-in data, shared by the Check-in tab and the Attendance Dashboard register.

export const CHECKIN_RESULT_LABEL = {
  in_office: 'In office',
  outside_office: 'Outside office',
  work_from_home: 'Work from home',
  location_unavailable: 'Location unavailable',
};

export const CHECKIN_COMPARISON_LABEL = {
  as_planned: 'As planned',
  office_day_outside: 'Office day, checked in away from office',
  home_day_at_office: 'Home day, checked in at office',
  no_location: 'Office day, no location',
  wfh_no_location: 'Home day, no location',
  no_checkin: 'Working day, no check-in',
  on_leave: 'On leave',
};

export const CHECKIN_PLACE_LABEL = { office: 'Work from office', home: 'Work from home' };

// 211 -> "3h 31m", 45 -> "45m", 120 -> "2h"
export const hoursMinutes = (m) => {
  const total = Math.round(Number(m) || 0);
  const h = Math.floor(total / 60);
  const r = total % 60;
  if (h === 0) return `${r}m`;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
};

// India time, 24-hour
export const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '—');
