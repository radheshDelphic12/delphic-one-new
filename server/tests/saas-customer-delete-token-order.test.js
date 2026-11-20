// The delete preview token carries a hash of the per-table row counts of the customer's companies. Those counts come from one UNION ALL query,
// whose row order the database does not promise (a parallel plan may return the branches in any order). The same data must always give the same
// counts object, or the token goes "out of date" between a preview and the delete although nothing changed (seen as an occasional 409 in CI).
const prisma = require('../src/config/db');
const { orgRowCounts } = require('../src/modules/platform/customerDeletion.service');

afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await prisma.$disconnect(); });

test('the row counts are the same object whatever order the database returns the rows in', async () => {
  const tables = [{ table_name: 'notifications' }, { table_name: 'accounts' }, { table_name: 'change_logs' }, { table_name: 'empty' }];
  const inOneOrder = [{ t: 'notifications', n: 3 }, { t: 'accounts', n: 1 }, { t: 'change_logs', n: 2 }, { t: 'empty', n: 0 }];
  const inAnotherOrder = [{ t: 'change_logs', n: 2 }, { t: 'empty', n: 0 }, { t: 'notifications', n: 3 }, { t: 'accounts', n: 1 }];
  jest.spyOn(prisma, '$queryRawUnsafe')
    .mockResolvedValueOnce(tables).mockResolvedValueOnce(inOneOrder)
    .mockResolvedValueOnce(tables).mockResolvedValueOnce(inAnotherOrder);
  const first = await orgRowCounts(['org-1']);
  const second = await orgRowCounts(['org-1']);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second)); // what goes into the token hash
  expect(Object.keys(first)).toEqual(['accounts', 'change_logs', 'notifications']); // sorted by table name; tables with no rows left out
  expect(first).toEqual({ accounts: 1, change_logs: 2, notifications: 3 });
});

test('no organisations means no counts', async () => {
  expect(await orgRowCounts([])).toEqual({});
});
