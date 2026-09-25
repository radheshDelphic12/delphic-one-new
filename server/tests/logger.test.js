const { createLogger } = require('../src/config/logger');

describe('logger', () => {
  const originalLog = console.log;
  const originalError = console.error;
  let lines;

  beforeEach(() => {
    lines = [];
    console.log = (msg) => lines.push(String(msg));
    console.error = (msg) => lines.push(String(msg));
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  test('writes error lines with message and serialized err', () => {
    process.env.LOG_LEVEL = 'error';
    const log = createLogger({ service: 'test' });
    log.error('boom', { err: new Error('nope') });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('boom');
    expect(lines[0]).toContain('nope');
  });

  test('child logger keeps parent bindings', () => {
    process.env.LOG_LEVEL = 'info';
    const log = createLogger({ service: 'test' }).child({ module: 'auth' });
    log.info('hello');

    expect(lines[0]).toContain('hello');
    expect(lines[0]).toContain('auth');
  });
});
