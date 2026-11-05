// Which client accounts count as projects. A row made by Add Project
// (is_project) always does; a plain catalogue client only once it is actually
// worked on as a project (older projects predate is_project). Without this,
// every newly created/activated client showed up as a project.
// The sales stage is deliberately not part of this: a project is on or off by its
// own contract_status and agreement dates, so a sales "drop" of the client never
// removes a project from billing, P&L, timesheets or attendance.
function projectListWhere(orgId) {
  return {
    org_id: orgId,
    type: 'client',
    OR: [
      { is_project: true },
      { billing_rates: { some: { requirement_id: null } } },
      { project_cost_rates: { some: {} } },
      { timesheet_entries: { some: {} } },
      { project_calendar: { isNot: null } },
      { daily_project_revenues: { some: {} } },
    ],
  };
}

module.exports = { projectListWhere };
