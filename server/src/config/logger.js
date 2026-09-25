const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function resolveLevel() {
  const fromEnv = (process.env.LOG_LEVEL || '').toLowerCase();
  if (fromEnv && LEVELS[fromEnv] !== undefined) return fromEnv;
  if (process.env.NODE_ENV === 'test') return 'error';
  if (process.env.NODE_ENV === 'production') return 'info';
  return 'debug';
}

function serializeError(err) {
  if (!err || typeof err !== 'object') return err;
  return {
    name: err.name,
    message: err.message,
    stack: err.stack,
    code: err.code,
    status: err.status,
  };
}

function normalizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const out = { ...meta };
  if (out.err) out.err = serializeError(out.err);
  if (out.error) out.error = serializeError(out.error);
  return out;
}

function formatPretty(entry) {
  const { ts, level, msg, ...rest } = entry;
  const extras = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
  return `${ts} ${level.toUpperCase().padEnd(5)} ${msg}${extras}`;
}

function createLogger(bindings = {}) {
  const minLevel = LEVELS[resolveLevel()];

  function write(level, msg, meta) {
    if (LEVELS[level] > minLevel) return;

    const entry = {
      ts: new Date().toISOString(),
      level,
      msg: String(msg),
      ...bindings,
      ...normalizeMeta(meta),
    };

    const line = process.env.NODE_ENV === 'production' ? JSON.stringify(entry) : formatPretty(entry);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  return {
    error(msg, meta) {
      write('error', msg, meta);
    },
    warn(msg, meta) {
      write('warn', msg, meta);
    },
    info(msg, meta) {
      write('info', msg, meta);
    },
    debug(msg, meta) {
      write('debug', msg, meta);
    },
    child(extra) {
      return createLogger({ ...bindings, ...extra });
    },
  };
}

const logger = createLogger({ service: 'delphic-api' });

module.exports = logger;
module.exports.createLogger = createLogger;
