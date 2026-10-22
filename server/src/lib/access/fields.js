const { adminPower } = require('./guard');

/**
 * Fields a person without the People permission never receives. The default basic access shows the directory fields only: name,
 * designation, department, office, work email and manager. Pay-related and personal fields are removed from the response itself,
 * not hidden by the screen.
 */
const DIRECTORY_KEYS = ['id', 'org_id', 'employee_code', 'employment_status', 'worker_type', 'work_mode', 'department', 'designation', 'team', 'location', 'manager'];

function directoryRow(row) {
  const out = {};
  for (const k of DIRECTORY_KEYS) if (row[k] !== undefined) out[k] = row[k];
  if (row.person) out.person = { id: row.person.id, name: row.person.name, email: row.person.email, active: row.person.active };
  return out;
}

/** Does this caller get only the directory fields of `row`? Own record and anyone holding People (or the Admin) get everything. */
function limitsTo(user, row) {
  if (!user?.access || user.access.mode !== 'permissions') return false;
  if (row.id === user.org_membership_id) return false;
  return !adminPower(user, 'people.view');
}

function restrictMembership(user, row) {
  return limitsTo(user, row) ? directoryRow(row) : row;
}

module.exports = { directoryRow, restrictMembership };
