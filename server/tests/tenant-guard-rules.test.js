// The tenant read guard must build filters Prisma accepts. A table with a required org_id cannot be asked for `org_id: null`
// (that broke Time & Attendance on prod: "Argument org_id is missing"); only tables where org_id may be empty get that branch.
const orgContext = require('../src/lib/orgContext');
const guard = require('../src/config/tenantGuard');

const CUSTOMER = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';

function setup() {
  let middleware;
  const prisma = {
    $use: (fn) => { middleware = fn; },
    $queryRawUnsafe: async () => [{ org_id: CUSTOMER }],
  };
  guard.clearCache();
  guard.install(prisma);
  return (params) => {
    const seen = {};
    return orgContext.run({ org_id: OWNER }, () => middleware(params, async (p) => { Object.assign(seen, p); return []; })).then(() => seen);
  };
}

describe('tenant guard filters', () => {
  test('a table with a required org_id is never asked for org_id null', async () => {
    expect(guard._rules.scoped.has('TimesheetEntry')).toBe(true);
    expect(guard._rules.nullableOrg.has('TimesheetEntry')).toBe(false);
    const run = setup();
    const seen = await run({ model: 'TimesheetEntry', action: 'findMany', args: { where: { org_membership_id: 'x' } } });
    expect(JSON.stringify(seen.args.where)).not.toMatch(/"org_id":null/);
    expect(seen.args.where).toEqual({ AND: [{ org_membership_id: 'x' }, { org_id: { notIn: [CUSTOMER] } }] });
  });

  test('a table whose org_id can be empty keeps the null branch', async () => {
    const nullable = [...guard._rules.nullableOrg][0];
    if (!nullable) return; // no such table in this schema
    const run = setup();
    const seen = await run({ model: nullable, action: 'findMany', args: {} });
    expect(seen.args.where).toEqual({ OR: [{ org_id: null }, { org_id: { notIn: [CUSTOMER] } }] });
  });
});
