const { createApp } = require('./app');
const { createAuth } = require('./auth');
const { createAudit } = require('./audit');
const { createNowDump } = require('./nowDump');

const env = process.env;
const config = {
  port: Number(env.PORT) || 8090,
  dumpDir: env.DUMP_DIR || '/backups', // the host's ./backups, mounted read-only
  viewerDir: env.VIEWER_DIR || '/viewer-dumps', // the only place the viewer writes
};

const auth = createAuth({ apiUrl: env.APP_API_URL || 'http://server:4000' });
const audit = createAudit(config.viewerDir);

// "Compare with now" needs the read-only dump_reader role; without its password the button reports that it is not set up.
const nowDump = env.DUMP_READER_PASSWORD
  ? createNowDump({
    viewerDir: config.viewerDir,
    minFreeGb: Number(env.BACKUP_MIN_FREE_GB) || 3,
    db: { host: env.DB_HOST || 'db', port: Number(env.DB_PORT) || 5432, name: env.DB_NAME || 'requirement_dashboard', user: env.DUMP_READER_USER || 'dump_reader', password: env.DUMP_READER_PASSWORD },
  })
  : null;

createApp({ config, auth, audit, nowDump }).listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`dbviewer listening on ${config.port}\n`);
});
