const logger = require('../config/logger');
const env = require('../config/env');

const SKIP_PATHS = new Set(['/api/v1/health']);
// Speak Up (confidential reporting): who made the request is never logged, so the logs cannot tie a person to a complaint.
const CONFIDENTIAL_PATH = /^\/api\/v1\/(public\/)?whistleblower(\/|\?|$)/;

function requestLogger(req, res, next) {
  if (env.nodeEnv === 'test') return next();
  if (SKIP_PATHS.has(req.path)) return next();

  const started = Date.now();

  res.on('finish', () => {
    const meta = {
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      duration_ms: Date.now() - started,
    };
    if (!CONFIDENTIAL_PATH.test(meta.path)) {
      if (req.user?.id) meta.user_id = req.user.id;
      if (req.user?.role) meta.role = req.user.role;
    }

    if (res.statusCode >= 500) logger.error('http_request', meta);
    else if (res.statusCode >= 400) logger.warn('http_request', meta);
    else logger.info('http_request', meta);
  });

  next();
}

module.exports = requestLogger;
