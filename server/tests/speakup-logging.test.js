// Speak Up (confidential reporting): the request log and the error log must never say who made a request to it.
const { EventEmitter } = require('events');

jest.mock('../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/config/env', () => ({ nodeEnv: 'production' }));

const logger = require('../src/config/logger');
const requestLogger = require('../src/middleware/requestLogger');
const errorHandler = require('../src/middleware/errorHandler');

const run = (path) => {
  const res = new EventEmitter();
  res.statusCode = 200;
  const req = { method: 'POST', path, originalUrl: path, url: path, user: { id: 'user-1', role: 'recruiter' } };
  requestLogger(req, res, () => {});
  res.emit('finish');
  return logger.info.mock.calls.at(-1)[1];
};

describe('speak up: the logs never say who', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a request to Speak Up is logged without the user, and any other request still is', () => {
    expect(run('/api/v1/whistleblower/cases')).not.toHaveProperty('user_id');
    expect(run('/api/v1/whistleblower/mine?x=1')).not.toHaveProperty('user_id');
    expect(run('/api/v1/public/whistleblower/track')).not.toHaveProperty('user_id');
    expect(run('/api/v1/whistleblower/cases')).not.toHaveProperty('role');
    expect(run('/api/v1/expenses/claims/me')).toMatchObject({ user_id: 'user-1', role: 'recruiter' });
    expect(run('/api/v1/whistleblowers-guide')).toMatchObject({ user_id: 'user-1' }); // only the module's own path
  });

  test('an error on a Speak Up request is logged without the user too', () => {
    const res = { status: () => ({ json: () => {} }), setHeader: () => {}, headersSent: false };
    const err = Object.assign(new Error('boom'), { status: 500 });
    errorHandler(err, { method: 'POST', originalUrl: '/api/v1/whistleblower/cases', url: '/x', user: { id: 'user-1' } }, { ...res, status: () => ({ json: () => {} }) }, () => {});
    expect(logger.error.mock.calls.at(-1)[1]).not.toHaveProperty('user_id');
    errorHandler(err, { method: 'GET', originalUrl: '/api/v1/expenses/claims', url: '/x', user: { id: 'user-1' } }, { ...res, status: () => ({ json: () => {} }) }, () => {});
    expect(logger.error.mock.calls.at(-1)[1]).toMatchObject({ user_id: 'user-1' });
  });
});
