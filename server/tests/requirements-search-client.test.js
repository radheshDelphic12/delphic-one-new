/** The requirements search box finds a requirement by its client name, and combines with the tech-stack filter instead of being replaced by it. */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createRequirement, createActiveClientAccount, authed } = require('./helpers');

let token;
let reqA;
let reqB;
let clientA;

beforeAll(async () => {
  await cleanDatabase();
  const u = await createUser({ role: 'sales' });
  ({ access_token: token } = await loginAs(u));
  clientA = await createActiveClientAccount(u.id);
  const clientB = await createActiveClientAccount(u.id);
  await prisma.account.update({ where: { id: clientA.id }, data: { name: 'Zorbex Industries' } });
  await prisma.account.update({ where: { id: clientB.id }, data: { name: 'Quillon Labs' } });
  reqA = await createRequirement(token, clientA.id);
  reqB = await createRequirement(token, clientB.id);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const ids = (res) => res.body.data.map((r) => r.id).sort();
const list = (qs) => authed(request(app).get(`/api/v1/requirements?${qs}`), token);

test('searching by (part of) the client name finds that client requirements, whatever the letter case', async () => {
  expect(ids(await list('search=zorbex'))).toEqual([reqA.id]);
  expect(ids(await list('search=QUILLON'))).toEqual([reqB.id]);
  expect(ids(await list('search=%20labs%20'))).toEqual([reqB.id]);
  expect(ids(await list('search=nomatchatall'))).toEqual([]);
});

test('the search still applies when a tech-stack filter is set too', async () => {
  await prisma.requirement.update({ where: { id: reqA.id }, data: { primary_tech_stack: ['Go'] } });
  await prisma.requirement.update({ where: { id: reqB.id }, data: { primary_tech_stack: ['Go'] } });
  expect(ids(await list('search=zorbex&tech_stack=Go'))).toEqual([reqA.id]);
  expect(ids(await list('search=zorbex&tech_stack=Rust'))).toEqual([]);
});
