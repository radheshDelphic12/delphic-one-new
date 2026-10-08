// Department-gated areas, mirroring the server's requireDepartment middleware
// (legacy User.department, which GET /users/me returns). Admins always pass.
const MEETINGS_DEPARTMENTS = new Set(['sales', 'hr', 'management']);

function departmentName(user) {
  return user?.department?.name?.toLowerCase() || '';
}

/** The meetings / interviews calendar: Sales, HR and Management only. */
export function canSeeMeetingsCalendar(user) {
  return user?.role === 'admin' || MEETINGS_DEPARTMENTS.has(departmentName(user));
}
