const prisma = require('../../config/db');

async function list(orgId) {
  return prisma.calendar.findMany({
    where: { org_id: orgId },
    orderBy: { name: 'asc' },
    include: {
      location: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      _count: { select: { holidays: true, employees: true } },
    },
  });
}

const CALENDAR_INCLUDE = { location: { select: { id: true, name: true } }, department: { select: { id: true, name: true } } };

async function checkCalendarRefs(orgId, { location_id, department_id }) {
  if (location_id) {
    const location = await prisma.location.findFirst({ where: { id: location_id, org_id: orgId } });
    if (!location) return 'location_not_found';
  }
  if (department_id) {
    const department = await prisma.department.findFirst({ where: { id: department_id, org_id: orgId } });
    if (!department) return 'department_not_found';
  }
  return null;
}

async function create(orgId, { name, kind, is_default, location_id, department_id }) {
  const refError = await checkCalendarRefs(orgId, { location_id, department_id });
  if (refError) return { error: refError };
  const calendar = await prisma.calendar.create({
    data: { org_id: orgId, name, kind, is_default, location_id: location_id || null, department_id: department_id || null },
    include: CALENDAR_INCLUDE,
  });
  return { calendar };
}

async function update(orgId, calendarId, patch) {
  const calendar = await prisma.calendar.findFirst({ where: { id: calendarId, org_id: orgId } });
  if (!calendar) return { error: 'not_found' };
  const refError = await checkCalendarRefs(orgId, patch);
  if (refError) return { error: refError };
  const updated = await prisma.calendar.update({
    where: { id: calendarId },
    data: patch,
    include: CALENDAR_INCLUDE,
  });
  return { calendar: updated };
}

// Blocked while any employee still follows this calendar (EmployeeCalendar) —
// reassign them first rather than silently leaving a dangling mapping.
// Holidays themselves cascade-delete (schema.prisma's onDelete: Cascade).
async function remove(orgId, calendarId) {
  const calendar = await prisma.calendar.findFirst({ where: { id: calendarId, org_id: orgId } });
  if (!calendar) return { error: 'not_found' };
  const [employeeMappings, projectMappings] = await Promise.all([
    prisma.employeeCalendar.count({ where: { calendar_id: calendarId } }),
    prisma.projectCalendar.count({ where: { calendar_id: calendarId } }),
  ]);
  const inUse = employeeMappings + projectMappings;
  if (inUse > 0) return { error: 'in_use', count: inUse };
  await prisma.calendar.delete({ where: { id: calendarId } });
  return { deleted: true };
}

async function updateHoliday(orgId, calendarId, holidayId, patch) {
  const calendar = await prisma.calendar.findFirst({ where: { id: calendarId, org_id: orgId } });
  if (!calendar) return { error: 'not_found' };
  const holiday = await prisma.calendarHoliday.findFirst({ where: { id: holidayId, calendar_id: calendarId } });
  if (!holiday) return { error: 'holiday_not_found' };
  if (patch.date) {
    const clash = await prisma.calendarHoliday.findUnique({ where: { calendar_id_date: { calendar_id: calendarId, date: patch.date } } });
    if (clash && clash.id !== holidayId) return { error: 'already_exists' };
  }
  const updated = await prisma.calendarHoliday.update({ where: { id: holidayId }, data: patch });
  return { holiday: updated };
}

async function removeHoliday(orgId, calendarId, holidayId) {
  const calendar = await prisma.calendar.findFirst({ where: { id: calendarId, org_id: orgId } });
  if (!calendar) return { error: 'not_found' };
  const holiday = await prisma.calendarHoliday.findFirst({ where: { id: holidayId, calendar_id: calendarId } });
  if (!holiday) return { error: 'holiday_not_found' };
  await prisma.calendarHoliday.delete({ where: { id: holidayId } });
  return { deleted: true };
}

// One calendar's holidays as a workbook (Date / Day / Holiday). Built here so the
// route only streams it.
async function buildHolidaysWorkbook(orgId, calendarId) {
  const calendar = await prisma.calendar.findFirst({
    where: { id: calendarId, org_id: orgId },
    include: { location: { select: { name: true } }, holidays: { orderBy: { date: 'asc' } } },
  });
  if (!calendar) return { error: 'not_found' };

  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Holidays');
  sheet.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Day', key: 'day', width: 14 },
    { header: 'Holiday', key: 'label', width: 40 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const h of calendar.holidays) {
    sheet.addRow({
      date: h.date.toISOString().slice(0, 10),
      day: h.date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
      label: h.label,
    });
  }
  return { workbook, calendar };
}

// Which calendar governs an employee, in priority order — the client brief's
// "project calendar, not just the general employee profile":
//   1. the calendar mapped to this project (ProjectCalendar — Project <-> Calendar)
//   1b. a legacy per-employee, per-project mapping (EmployeeCalendar with
//       account_id = project) — still honoured so existing data keeps working,
//       no longer offered in the UI
//   2. the employee's default mapping (EmployeeCalendar, account_id = null)
//   3. the standard calendar of the employee's Department (e.g. non-IT staff)
//   4. the calendar tied to the employee's office Location (Ahmedabad, Indore, …)
//   5. the org's default calendar
// Pure function over pre-loaded rows so timesheets (one lookup) and payroll
// (whole-org batch) apply the exact same rule.
function pickCalendarId({ assignments, membershipLocationId, membershipDepartmentId = null, calendars, projectCalendars = [] }, accountId = null) {
  if (accountId) {
    const forProject = projectCalendars.find((p) => p.account_id === accountId);
    if (forProject) return forProject.calendar_id;
    const legacy = assignments.find((a) => a.account_id === accountId);
    if (legacy) return legacy.calendar_id;
  }
  const forDefault = assignments.find((a) => a.account_id === null);
  if (forDefault) return forDefault.calendar_id;
  if (membershipDepartmentId) {
    const forDepartment = calendars.find((c) => c.department_id === membershipDepartmentId);
    if (forDepartment) return forDepartment.id;
  }
  if (membershipLocationId) {
    const forLocation = calendars.find((c) => c.location_id === membershipLocationId);
    if (forLocation) return forLocation.id;
  }
  return calendars.find((c) => c.is_default)?.id || null;
}

async function resolveCalendar(orgId, orgMembershipId, accountId = null) {
  const [membership, assignments, calendars, projectCalendars] = await Promise.all([
    prisma.orgMembership.findFirst({ where: { id: orgMembershipId, org_id: orgId }, select: { location_id: true, department_id: true } }),
    prisma.employeeCalendar.findMany({ where: { org_membership_id: orgMembershipId }, select: { account_id: true, calendar_id: true } }),
    prisma.calendar.findMany({ where: { org_id: orgId }, select: { id: true, name: true, kind: true, location_id: true, department_id: true, is_default: true } }),
    accountId ? prisma.projectCalendar.findMany({ where: { org_id: orgId, account_id: accountId }, select: { account_id: true, calendar_id: true } }) : [],
  ]);
  const id = pickCalendarId({ assignments, membershipLocationId: membership?.location_id || null, membershipDepartmentId: membership?.department_id || null, calendars, projectCalendars }, accountId);
  return id ? calendars.find((c) => c.id === id) : null;
}

// Employee view: which calendar governs the caller by default, and which one
// each of their assigned projects follows, with that year's holidays.
async function myCalendars(orgId, orgMembershipId, year) {
  const assignments = await prisma.projectMemberAssignment.findMany({
    where: { org_id: orgId, org_membership_id: orgMembershipId },
    orderBy: { created_at: 'asc' },
    select: {
      account: { select: { id: true, name: true, project_name: true, client_name: true, service_category: true, agreement_start_date: true } },
    },
  });
  const standard = await resolveCalendar(orgId, orgMembershipId, null);
  const projects = [];
  for (const { account } of assignments) {
    const calendar = await resolveCalendar(orgId, orgMembershipId, account.id);
    projects.push({
      id: account.id,
      name: projectName(account),
      client_name: account.client_name || null,
      service_category: account.service_category || null,
      agreement_start_date: account.agreement_start_date,
      calendar_id: calendar?.id || null,
    });
  }

  const calendarIds = [...new Set([standard?.id, ...projects.map((p) => p.calendar_id)].filter(Boolean))];
  const [calendars, holidays] = await Promise.all([
    prisma.calendar.findMany({ where: { id: { in: calendarIds } }, select: { id: true, name: true, kind: true } }),
    prisma.calendarHoliday.findMany({
      where: { calendar_id: { in: calendarIds }, date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } },
      orderBy: { date: 'asc' },
      select: { calendar_id: true, date: true, label: true },
    }),
  ]);
  const withHolidays = (id) => {
    const calendar = calendars.find((c) => c.id === id);
    if (!calendar) return null;
    return { ...calendar, holidays: holidays.filter((h) => h.calendar_id === id).map(({ date, label }) => ({ date, label })) };
  };

  return {
    year,
    standard_calendar: standard ? withHolidays(standard.id) : null,
    projects: projects.map(({ calendar_id, ...project }) => ({ ...project, calendar: calendar_id ? withHolidays(calendar_id) : null })),
  };
}

// The holiday (if any) that blocks work on `date` under the calendar that
// governs this employee for this project.
async function holidayFor(orgId, orgMembershipId, accountId, date) {
  const calendar = await resolveCalendar(orgId, orgMembershipId, accountId);
  if (!calendar) return null;
  const holiday = await prisma.calendarHoliday.findUnique({
    where: { calendar_id_date: { calendar_id: calendar.id, date } },
  });
  return holiday ? { label: holiday.label, calendar_name: calendar.name } : null;
}

async function listHolidays(orgId, calendarId) {
  const calendar = await prisma.calendar.findFirst({ where: { id: calendarId, org_id: orgId } });
  if (!calendar) return { error: 'not_found' };
  const holidays = await prisma.calendarHoliday.findMany({
    where: { calendar_id: calendarId },
    orderBy: { date: 'asc' },
  });
  return { holidays };
}

async function addHoliday(orgId, calendarId, { date, label }) {
  const calendar = await prisma.calendar.findFirst({ where: { id: calendarId, org_id: orgId } });
  if (!calendar) return { error: 'not_found' };
  const existing = await prisma.calendarHoliday.findUnique({
    where: { calendar_id_date: { calendar_id: calendarId, date } },
  });
  if (existing) return { error: 'already_exists' };
  const holiday = await prisma.calendarHoliday.create({ data: { calendar_id: calendarId, date, label } });
  return { holiday };
}

// Assign (or reassign) which calendar an org membership follows for a given
// project (`account_id`), or its default calendar when `account_id` is
// omitted. Changed 2026-09-15 (client brief): an employee on more than one
// concurrent client engagement can carry more than one active mapping at
// once — this is no longer "one calendar per membership", it's one per
// (membership, project).
async function assign(orgId, calendarId, orgMembershipId, accountId = null) {
  const calendar = await prisma.calendar.findFirst({ where: { id: calendarId, org_id: orgId } });
  if (!calendar) return { error: 'calendar_not_found' };
  const membership = await prisma.orgMembership.findFirst({ where: { id: orgMembershipId, org_id: orgId } });
  if (!membership) return { error: 'membership_not_found' };
  if (accountId) {
    const account = await prisma.account.findFirst({ where: { id: accountId, org_id: orgId } });
    if (!account) return { error: 'account_not_found' };
  }

  // Reassigning the SAME project (or the default, account_id: null) to a
  // different calendar should replace the old mapping, not add a second row
  // for the same project — find-then-upsert since account_id being
  // nullable in the compound unique means Postgres won't enforce that for us
  // (NULL <> NULL), see the schema comment on EmployeeCalendar.
  const existing = await prisma.employeeCalendar.findFirst({
    where: { org_membership_id: orgMembershipId, account_id: accountId },
  });
  const assignment = existing
    ? await prisma.employeeCalendar.update({ where: { id: existing.id }, data: { calendar_id: calendarId } })
    : await prisma.employeeCalendar.create({
        data: { org_membership_id: orgMembershipId, calendar_id: calendarId, account_id: accountId },
      });
  return { assignment };
}

async function listAssignments(orgId, orgMembershipId) {
  return prisma.employeeCalendar.findMany({
    where: { org_membership_id: orgMembershipId, org_membership: { org_id: orgId } },
    include: { calendar: true, account: { select: { id: true, name: true } } },
    orderBy: { created_at: 'asc' },
  });
}

// ---------------------------------------------------------------------------
// Project <-> Calendar (mapping 1). Kept apart from Employee <-> Project
// (ProjectMemberAssignment, mapping 2) on purpose — see ProjectCalendar in
// schema.prisma. A "project" is an active client Account.
// ---------------------------------------------------------------------------

const DEFAULT_PROJECT_CALENDAR_NAME = 'Ahmedabad Calendar';
// Recruitment is deliberately not offered yet (client brief).
const CATEGORY_SCOPE = ['managed_services', 'project'];

// The calendar a project follows when none is chosen: "Ahmedabad Calendar" by
// name, else the Ahmedabad office calendar (what it is called in a seeded org),
// else the org default, else the first calendar there is.
function pickDefaultProjectCalendar(calendars) {
  const lower = (v) => String(v || '').toLowerCase();
  return (
    calendars.find((c) => lower(c.name) === lower(DEFAULT_PROJECT_CALENDAR_NAME)) ||
    calendars.find((c) => lower(c.location?.name) === 'ahmedabad') ||
    calendars.find((c) => lower(c.name).includes('ahmedabad')) ||
    calendars.find((c) => c.is_default) ||
    calendars[0] ||
    null
  );
}

async function defaultCalendar(orgId, db = prisma) {
  const calendars = await db.calendar.findMany({
    where: { org_id: orgId },
    select: { id: true, name: true, kind: true, is_default: true, location: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  return pickDefaultProjectCalendar(calendars);
}

// A project's client can be any of this org's client accounts, whatever their
// pipeline stage — typed client or not yet classified. Vendors are sourcing
// partners, not clients, and projects made via Add Project (always given a
// service_category) are never offered as a client.
function clientOptionWhere(orgId) {
  return { org_id: orgId, service_category: null, OR: [{ type: 'client' }, { type: null }] };
}

async function listLeadClientOptions(orgId) {
  return prisma.account.findMany({
    where: clientOptionWhere(orgId),
    select: { id: true, name: true, type: true, stage: true },
    orderBy: { name: 'asc' },
  });
}

// Resolves the client to link. `keepId` is the project's current link: re-saving
// an unchanged client is always allowed, so editing other fields never fails on
// it. `projectId` is the project being edited — it can't be its own client.
async function resolveLeadClient(orgId, clientAccountId, keepId = null, projectId = null) {
  if (clientAccountId && clientAccountId === keepId) {
    return { account: await prisma.account.findUnique({ where: { id: clientAccountId }, select: { id: true, name: true } }) };
  }
  if (projectId && clientAccountId === projectId) return { error: 'client_not_lead' };
  const account = await prisma.account.findFirst({
    where: { id: clientAccountId, ...clientOptionWhere(orgId) },
    select: { id: true, name: true },
  });
  return account ? { account } : { error: 'client_not_lead' };
}

const CLIENT_ACCOUNT_SELECT = { select: { id: true, name: true, stage: true } };

// Linked lead's live name when there is one, else the legacy free-text value.
function clientFields(row) {
  return {
    client_account_id: row.client_account_id,
    client_account: row.client_account || null,
    client_name: row.client_account?.name || row.client_name,
  };
}

// A project's display name. Finance renames write project_name only, so the
// account's own name (which may be a client other projects link to) is kept.
function projectName(row) {
  return row.project_name || row.name;
}

// Another client account in the org already showing this project name.
function projectNameTaken(orgId, name, exceptId = null) {
  const equals = { equals: name, mode: 'insensitive' };
  return prisma.account.findFirst({
    where: {
      org_id: orgId,
      type: 'client',
      OR: [{ project_name: equals }, { project_name: null, name: equals }],
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  });
}

const PROJECT_SELECT = {
  id: true,
  name: true,
  project_name: true,
  client_name: true,
  client_account_id: true,
  client_account: CLIENT_ACCOUNT_SELECT,
  service_category: true,
  project_calendar: { select: { calendar: { select: { id: true, name: true, kind: true } } } },
};

function serializeProject(row, fallback) {
  const mapped = row.project_calendar?.calendar || null;
  const effective = mapped || (fallback ? { id: fallback.id, name: fallback.name, kind: fallback.kind } : null);
  return {
    id: row.id,
    name: projectName(row),
    ...clientFields(row),
    service_category: row.service_category,
    calendar: effective,
    // true when the project has no explicit mapping and is showing the default.
    calendar_is_default: !mapped,
  };
}

async function listProjects(orgId) {
  const [rows, fallback] = await Promise.all([
    prisma.account.findMany({
      where: { org_id: orgId, type: 'client', stage: 'active' },
      select: PROJECT_SELECT,
      orderBy: { name: 'asc' },
    }),
    defaultCalendar(orgId),
  ]);
  return rows.map((row) => serializeProject(row, fallback));
}

async function createProject(orgId, ownerId, { name, client_account_id, service_category, calendar_id }) {
  if (!CATEGORY_SCOPE.includes(service_category)) return { error: 'category_not_available' };
  if (await projectNameTaken(orgId, name)) return { error: 'name_taken' };

  let client = null;
  if (client_account_id) {
    const resolved = await resolveLeadClient(orgId, client_account_id);
    if (resolved.error) return resolved;
    client = resolved.account;
  }

  let calendar;
  if (calendar_id) {
    calendar = await prisma.calendar.findFirst({ where: { id: calendar_id, org_id: orgId }, select: { id: true } });
    if (!calendar) return { error: 'calendar_not_found' };
  } else {
    calendar = await defaultCalendar(orgId);
    if (!calendar) return { error: 'no_calendar_available' };
  }

  const account = await prisma.$transaction(async (tx) => {
    const created = await tx.account.create({
      data: {
        org_id: orgId,
        type: 'client',
        stage: 'active',
        name,
        client_account_id: client?.id || null,
        client_name: client?.name || null,
        service_category,
        owner_id: ownerId,
        origin_owner_id: ownerId,
      },
      select: { id: true },
    });
    await tx.projectCalendar.create({ data: { org_id: orgId, account_id: created.id, calendar_id: calendar.id } });
    return created;
  });
  const project = (await listProjects(orgId)).find((p) => p.id === account.id);
  return { project };
}

// Edit a project's calendar at any time (upsert — a legacy project with no
// mapping row gets one).
async function setProjectCalendar(orgId, accountId, calendarId) {
  const account = await prisma.account.findFirst({ where: { id: accountId, org_id: orgId, type: 'client' }, select: { id: true } });
  if (!account) return { error: 'project_not_found' };
  const calendar = await prisma.calendar.findFirst({ where: { id: calendarId, org_id: orgId }, select: { id: true } });
  if (!calendar) return { error: 'calendar_not_found' };
  await prisma.projectCalendar.upsert({
    where: { account_id: accountId },
    create: { org_id: orgId, account_id: accountId, calendar_id: calendarId },
    update: { calendar_id: calendarId },
  });
  const project = (await listProjects(orgId)).find((p) => p.id === accountId);
  return { project: project || null };
}

// Mon–Fri days of a month that are not holidays on the given calendar.
// Pure: `holidayDates` is a Set of 'YYYY-MM-DD' strings.
function countWorkingDays(year, month, holidayDates = new Set()) {
  const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= total; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    if (holidayDates.has(date.toISOString().slice(0, 10))) continue;
    count += 1;
  }
  return count;
}

// Working days in a calendar month under the calendar this PROJECT follows —
// what monthly billing prorates against.
async function projectWorkingDays(orgId, accountId, year, month) {
  const mapped = await prisma.projectCalendar.findFirst({ where: { org_id: orgId, account_id: accountId }, select: { calendar_id: true } });
  const calendarId = mapped?.calendar_id || (await defaultCalendar(orgId))?.id || null;
  let holidayDates = new Set();
  if (calendarId) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    const holidays = await prisma.calendarHoliday.findMany({ where: { calendar_id: calendarId, date: { gte: start, lte: end } }, select: { date: true } });
    holidayDates = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
  }
  return { working_days: countWorkingDays(year, month, holidayDates), holiday_dates: holidayDates };
}

module.exports = {
  list,
  create,
  update,
  remove,
  listHolidays,
  addHoliday,
  updateHoliday,
  removeHoliday,
  assign,
  listAssignments,
  pickCalendarId,
  resolveCalendar,
  myCalendars,
  holidayFor,
  buildHolidaysWorkbook,
  DEFAULT_PROJECT_CALENDAR_NAME,
  pickDefaultProjectCalendar,
  defaultCalendar,
  listProjects,
  createProject,
  setProjectCalendar,
  listLeadClientOptions,
  resolveLeadClient,
  projectName,
  projectNameTaken,
  clientFields,
  CLIENT_ACCOUNT_SELECT,
  countWorkingDays,
  projectWorkingDays,
};
