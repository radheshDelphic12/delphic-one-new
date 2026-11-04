const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createOrg,
  createOrgMembership,
  createActiveClientAccount,
  authed,
} = require('./helpers');
const { toPlainText, shortTitle, moduleLabel } = require('../src/modules/timesheets/projectTimesheet.text');
const { buildDays } = require('../src/modules/timesheets/projectTimesheet.export');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const DASH = '–';

describe('project timesheet text helpers', () => {
  test('rich text becomes plain text: bold/italic/links removed, bullets kept readable', () => {
    const out = toPlainText('**Built** the *login* screen\n- fixed [bug 12](https://x.io/12)\n- wrote tests');
    expect(out).toBe('Built the login screen\n• fixed bug 12\n• wrote tests');
  });

  test('short title: first sentence, max 8 words, capitalised', () => {
    expect(shortTitle('attended the daily standup call and the project discussion meeting with the whole team today. More text')).toBe('Attended the daily standup call and the project');
    expect(shortTitle('Built PROD test build 3.0.6 (26). Smoke tested')).toBe('Built PROD test build 3.0.6 (26)');
    expect(shortTitle('**Fixed** login')).toBe('Fixed login');
  });

  test('edge cases: empty, link only, bullet first line', () => {
    expect(shortTitle('')).toBe('');
    expect(shortTitle(null)).toBe('');
    expect(shortTitle('https://example.com/very/long')).toBe('');
    expect(shortTitle('- fixed the crash on start\n- other')).toBe('Fixed the crash on start');
    expect(moduleLabel('SDC Mobile App', '')).toBe('SDC Mobile App');
    expect(moduleLabel('SDC Mobile App', 'Standup call')).toBe(`SDC Mobile App ${DASH} Standup call`);
  });

  test('a very long single word line stays short', () => {
    expect(shortTitle('x'.repeat(300)).length).toBeLessThanOrEqual(70);
  });
});

describe('project timesheet day status', () => {
  const day = (s) => new Date(`${s}T00:00:00.000Z`);
  const base = (over = {}) => ({
    year: 2026,
    month: 7,
    joinedAt: day('2026-06-01'),
    today: day('2026-12-31'),
    data: { byDay: new Map(), otherDays: new Set(), summaryByDay: new Map() },
    ...over,
  });

  test('holiday, week-off, leave, other project, missing and logged day, in that priority', () => {
    const summary = new Map([
      ['2026-07-01', { day_type: 'company_holiday', label: 'Founders day' }],
      ['2026-07-04', { day_type: 'weekend' }],
      ['2026-07-02', { day_type: 'working', leaves: [{ is_half_day: false }] }],
      ['2026-07-06', { day_type: 'working', leaves: [{ is_half_day: true }] }],
      ['2026-07-07', { day_type: 'weekend' }], // logged on a week-off: a working day
    ]);
    const byDay = new Map([['2026-07-07', [{ hours: 2, notes: '' }]], ['2026-07-06', [{ hours: 4, notes: '' }]]]);
    const days = buildDays(base({ data: { byDay, otherDays: new Set(['2026-07-03']), summaryByDay: summary } }));
    const kind = (k) => days.find((d) => d.key === k).kind;
    expect(kind('2026-07-01')).toBe('company_holiday');
    expect(kind('2026-07-02')).toBe('leave');
    expect(kind('2026-07-03')).toBe('other');
    expect(kind('2026-07-04')).toBe('weekend');
    expect(kind('2026-07-05')).toBe('missing');
    expect(kind('2026-07-06')).toBe('work');
    expect(days.find((d) => d.key === '2026-07-06').note).toMatch(/Half-day leave/);
    expect(kind('2026-07-07')).toBe('work');
    expect(days).toHaveLength(31);
  });

  test('days before joining and after today are left out; today is never "missing"', () => {
    const joined = buildDays(base({ joinedAt: day('2026-07-20') }));
    expect(joined[0].key).toBe('2026-07-20');
    const current = buildDays(base({ today: day('2026-07-10') }));
    expect(current[current.length - 1]).toMatchObject({ key: '2026-07-10', kind: 'today' });
    expect(current).toHaveLength(10);
    expect(buildDays(base({ year: 2099, today: day('2026-07-10') }))).toHaveLength(0);
  });
});

async function seed() {
  const org = await createOrg();
  const dept = await prisma.department.create({ data: { org_id: org.id, name: 'IT' } });
  const mk = async (name, role, department) => {
    const user = await createUser({ role });
    await prisma.user.update({ where: { id: user.id }, data: { name, ...(department ? { department_id: department.id } : {}) } });
    const membership = await createOrgMembership(user.id, org.id, { role, joined_at: new Date('2026-06-01T00:00:00.000Z') });
    const { access_token } = await loginAs(user);
    return { user, membership, token: access_token };
  };
  const dev = await mk('Dev One', 'recruiter', dept);
  const other = await mk('Dev Two', 'recruiter', dept);
  const sales = await mk('Sales Person', 'recruiter', null);
  const admin = await mk('Admin Boss', 'admin', null);
  const projA = await createActiveClientAccount(dev.user.id);
  await prisma.account.update({ where: { id: projA.id }, data: { org_id: org.id, project_name: 'Proj A', client_name: 'Client A' } });
  const projB = await createActiveClientAccount(dev.user.id);
  await prisma.account.update({ where: { id: projB.id }, data: { org_id: org.id, project_name: 'Proj B' } });
  const log = (who, account, date, hours, notes, status = 'approved') =>
    prisma.timesheetEntry.create({ data: { org_id: org.id, org_membership_id: who.membership.id, account_id: account.id, date: new Date(`${date}T00:00:00.000Z`), hours, notes, status } });
  return { org, dev, other, sales, admin, projA, projB, log };
}

const q = (extra = '') => `?month=7&year=2026${extra}`;
const binary = (r, cb) => {
  const chunks = [];
  r.on('data', (c) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('project timesheet download', () => {
  test('one project, one month: layout, live formulas, week-off and missing rows, other-project hours kept out', async () => {
    const s = await seed();
    await s.log(s.dev, s.projA, '2026-07-01', 3, '**Built** login');
    await s.log(s.dev, s.projA, '2026-07-01', 2, '- fixed crash\n- wrote tests');
    await s.log(s.dev, s.projB, '2026-07-01', 5, 'Other project work');
    await s.log(s.dev, s.projB, '2026-07-02', 8, 'Only B today');
    await s.log(s.dev, s.projA, '2026-07-03', 4, 'https://example.com', 'submitted');

    const opts = await authed(request(app).get(`/api/v1/timesheets/project-timesheet/options${q()}`), s.dev.token);
    expect(opts.status).toBe(200);
    expect(opts.body.data.projects.map((p) => p.name)).toEqual(['Proj A', 'Proj B']);
    const a = opts.body.data.projects.find((p) => p.name === 'Proj A');
    expect(a.missing_dates).toContain('2026-07-06'); // a Monday with nothing logged anywhere
    expect(a.missing_dates).not.toContain('2026-07-02'); // logged on the other project
    expect(a.missing_dates).not.toContain('2026-07-04'); // Saturday

    const res = await authed(request(app).get(`/api/v1/timesheets/project-timesheet/download${q(`&project_id=${s.projA.id}`)}`), s.dev.token).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('Timesheet_Proj_A_Jul_2026_Dev_One.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const ws = wb.getWorksheet('jul 2026');
    expect(ws.getCell('A1').value).toBe('Timesheet for the Month of July - 2026');
    expect(ws.getCell('A1').fill.fgColor.argb).toBe('FF1F4E78');
    expect(ws.getCell('B3').value).toBe('Dev One');
    expect(ws.getCell('D3').value).toBe('Client A');
    expect(ws.getCell('D5').value).toBe('Proj A');
    expect(ws.getCell('A8').value).toBe('Date');
    expect(ws.getCell('A9').value.toISOString().slice(0, 10)).toBe('2026-07-01');
    // block of two tasks on 1 Jul: only this project's hours (3 + 2), live formula
    expect(ws.getCell('C9').value.formula).toBe('ROUND(SUM(E9:E10),2)');
    expect(ws.getCell('E9').value).toBe(3);
    expect(ws.getCell('D9').value).toBe(`Proj A ${DASH} Built login`);
    expect(ws.getCell('F9').value).toBe('Built login');
    expect(ws.getCell('F10').value).toBe('• fixed crash\n• wrote tests');
    // 2 Jul: logged only on B -> blank row, not "Not Logged"; 3 Jul: pending entry, link-only
    expect(ws.getCell('C11').value).toBeNull();
    expect(ws.getCell('D12').value).toBe('Proj A');
    // 4 Jul Saturday -> Weekly Holiday
    expect(ws.getCell('C13').value).toBe('Weekly Holiday');
    expect(ws.getCell('C13').fill.fgColor.argb).toBe('FFFFC000');
    // 6 Jul Monday -> Not Logged, light red
    expect(ws.getCell('C15').value).toBe('Not Logged');
    expect(ws.getCell('C15').fill.fgColor.argb).toBe('FFF4CCCC');
    const last = ws.lastRow.number;
    expect(ws.getCell(`D${last}`).value).toBe('Total Hours for the Month');
    expect(ws.getCell(`C${last}`).value.formula).toBe('C9+C12');
    expect(ws.getCell(`C${last}`).value.result).toBe(9);
    expect(ws.getCell(`C${last}`).fill.fgColor.argb).toBe('FFA9D08E');
    expect(ws.getColumn('F').width).toBeCloseTo(179.63, 1);
  });

  test('status option: approved only leaves pending hours out; nothing logged -> 404', async () => {
    const s = await seed();
    await s.log(s.dev, s.projA, '2026-07-03', 4, 'pending work', 'submitted');
    const none = await authed(request(app).get(`/api/v1/timesheets/project-timesheet/download${q(`&project_id=${s.projA.id}&statuses=approved`)}`), s.dev.token);
    expect(none.status).toBe(404);
    const otherProject = await authed(request(app).get(`/api/v1/timesheets/project-timesheet/download${q(`&project_id=${s.projB.id}`)}`), s.dev.token);
    expect(otherProject.status).toBe(404);
  });

  test('all projects comes back as a zip with one file per project', async () => {
    const s = await seed();
    await s.log(s.dev, s.projA, '2026-07-01', 3, 'a');
    await s.log(s.dev, s.projB, '2026-07-01', 2, 'b');
    const res = await authed(request(app).get(`/api/v1/timesheets/project-timesheet/download${q('&project_id=all')}`), s.dev.token).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('zip');
    const zip = await JSZip.loadAsync(res.body);
    expect(Object.keys(zip.files).sort()).toEqual(['Timesheet_Proj_A_Jul_2026_Dev_One.xlsx', 'Timesheet_Proj_B_Jul_2026_Dev_One.xlsx']);
  });

  test('access: IT sees own only, other departments are refused, an admin may pick an IT employee', async () => {
    const s = await seed();
    await s.log(s.dev, s.projA, '2026-07-01', 3, 'a');
    await s.log(s.other, s.projA, '2026-07-01', 6, 'b');
    const url = `/api/v1/timesheets/project-timesheet/options${q()}`;

    expect((await authed(request(app).get(url), s.sales.token)).status).toBe(403);
    // an IT employee passing someone else's membership id is refused, not silently served
    expect((await authed(request(app).get(`${url}&org_membership_id=${s.other.membership.id}`), s.dev.token)).status).toBe(403);
    // admin picks an IT employee
    const adminRes = await authed(request(app).get(`${url}&org_membership_id=${s.other.membership.id}`), s.admin.token);
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.data.projects).toHaveLength(1);
    // admin cannot pull a non-IT employee
    expect((await authed(request(app).get(`${url}&org_membership_id=${s.sales.membership.id}`), s.admin.token)).status).toBe(422);
    // admin with no employee picked has no own IT timesheet
    expect((await authed(request(app).get(url), s.admin.token)).status).toBe(403);
    expect((await request(app).get(url)).status).toBe(401);
  });
});
