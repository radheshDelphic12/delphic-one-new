const { ZodError } = require('zod');
const { fail } = require('../utils/response');
const logger = require('../config/logger');

module.exports = function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ZodError) {
    logger.warn('validation_failed', {
      method: req.method,
      path: req.originalUrl || req.url,
      issues: err.errors?.length,
    });
    return fail(res, 422, 'Validation failed', err.errors);
  }

  const status = err.status || 500;
  const meta = {
    method: req.method,
    path: req.originalUrl || req.url,
    status,
    err,
  };
  if (req.user?.id) meta.user_id = req.user.id;

  if (status >= 500) logger.error('unhandled_error', meta);
  else logger.warn('request_error', meta);

  return fail(res, status, err.message || 'Internal server error');
};
