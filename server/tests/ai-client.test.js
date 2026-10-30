/**
 * The Anthropic call behind the AI interview, with fetch replaced: request shape (key, model, CV document), usage, JSON parsing,
 * and that every failure becomes one AiUnavailableError (so the interview can fall back instead of crashing).
 */
const env = require('../src/config/env');
const { askJson, setProvider, AiUnavailableError } = require('../src/modules/aiInterviews/aiClient');

const realFetch = global.fetch;
const reply = (text, usage = { input_tokens: 11, output_tokens: 7 }) => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }], usage }) });

beforeEach(() => {
  setProvider(null); // the real Anthropic provider
  env.aiInterview.apiKey = 'test-key';
});
afterEach(() => { global.fetch = realFetch; });

test('sends the key, model, system prompt and question, and returns parsed JSON with token usage', async () => {
  let seen;
  global.fetch = jest.fn(async (url, opts) => { seen = { url, opts, body: JSON.parse(opts.body) }; return reply('{"ok":true}'); });
  const r = await askJson({ system: 'SYS', user: 'ASK', maxTokens: 321 });
  expect(r).toEqual({ data: { ok: true }, usage: { input: 11, output: 7 } });
  expect(seen.url).toBe('https://api.anthropic.com/v1/messages');
  expect(seen.opts.headers['x-api-key']).toBe('test-key');
  expect(seen.opts.headers['anthropic-version']).toBe('2023-06-01');
  expect(seen.body).toMatchObject({ model: env.aiInterview.model, max_tokens: 321, system: 'SYS', messages: [{ role: 'user', content: 'ASK' }] });
});

test('a workspace id, when configured, is sent as the anthropic-workspace-id header (user-level keys need it)', async () => {
  let headers;
  global.fetch = jest.fn(async (url, opts) => { headers = opts.headers; return reply('{}'); });
  env.aiInterview.workspaceId = null;
  await askJson({ system: 'S', user: 'U' });
  expect(headers['anthropic-workspace-id']).toBeUndefined();
  env.aiInterview.workspaceId = 'wrkspc_test';
  await askJson({ system: 'S', user: 'U' });
  expect(headers['anthropic-workspace-id']).toBe('wrkspc_test');
  env.aiInterview.workspaceId = null;
});

test('a reply that is not JSON is asked for once more, and the second try is used', async () => {
  const replies = ['sorry, here is some prose', '{"ok":1}'];
  global.fetch = jest.fn(async () => reply(replies.shift()));
  expect((await askJson({ system: 'S', user: 'U' })).data).toEqual({ ok: 1 });
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('a CV PDF goes in front of the question as a document block', async () => {
  let body;
  global.fetch = jest.fn(async (url, opts) => { body = JSON.parse(opts.body); return reply('{}'); });
  await askJson({ system: 'S', user: 'ASK', documents: [{ base64: 'QUJD' }] });
  expect(body.messages[0].content).toEqual([
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'QUJD' } },
    { type: 'text', text: 'ASK' },
  ]);
});

test('JSON inside a code fence, or with chatter around it, is still read', async () => {
  global.fetch = jest.fn(async () => reply('Here you go:\n```json\n{"a":1}\n```'));
  expect((await askJson({ system: 'S', user: 'U' })).data).toEqual({ a: 1 });
});

test.each([
  ['no key', () => { env.aiInterview.apiKey = null; }, null, /not set/],
  ['an error status', () => {}, async () => ({ ok: false, status: 529 }), /529/],
  ['a network failure', () => {}, async () => { throw new Error('socket hang up'); }, /unreachable/],
  ['a timeout', () => {}, async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }, /timed out/],
  ['a reply that is not JSON', () => {}, async () => reply('sorry, I cannot do that'), /not JSON/],
  ['broken JSON', () => {}, async () => reply('{"a": '), /JSON/],
])('%s becomes one AiUnavailableError', async (name, setup, fetchImpl, message) => {
  setup();
  if (fetchImpl) global.fetch = jest.fn(fetchImpl);
  await expect(askJson({ system: 'S', user: 'U' })).rejects.toThrow(AiUnavailableError);
  await expect(askJson({ system: 'S', user: 'U' })).rejects.toThrow(message);
});
