require('dotenv').config();

const PLACEHOLDER_SECRETS = new Set([
  'dev_access_secret_change_me',
  'dev_refresh_secret_change_me',
  'change_me_access',
  'change_me_refresh',
  'local_dev_access_secret_do_not_use_in_prod_01',
  'local_dev_refresh_secret_do_not_use_in_prod_01',
]);

function isWeakSecret(value) {
  if (!value || typeof value !== 'string') return true;
  if (value.length < 32) return true;
  if (value.startsWith('local_dev_')) return true;
  return PLACEHOLDER_SECRETS.has(value);
}

function assertProductionConfig(config, rawEnv = process.env) {
  if (config.nodeEnv !== 'production') return;

  const problems = [];
  if (!config.databaseUrl) problems.push('DATABASE_URL is required');
  if (isWeakSecret(config.jwt.accessSecret)) {
    problems.push('JWT_ACCESS_SECRET must be set to a non-placeholder value of at least 32 characters');
  }
  if (isWeakSecret(config.jwt.refreshSecret)) {
    problems.push('JWT_REFRESH_SECRET must be set to a non-placeholder value of at least 32 characters');
  }
  if (!rawEnv.CORS_ORIGIN) {
    problems.push('CORS_ORIGIN must be set explicitly in production');
  }
  if (problems.length > 0) {
    throw new Error(`Production config invalid:\n- ${problems.join('\n- ')}`);
  }
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,
  logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  databaseUrl: process.env.DATABASE_URL,
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '1h',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '7d',
  },
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  // Business timezone for human-readable dates in notifications / emails. The
  // server clock is UTC; without this, notification times render in UTC.
  timezone: process.env.APP_TIMEZONE || 'Asia/Kolkata',
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 10,
  // In-process background jobs (interview reminder cron). Off in tests; opt out in
  // any single environment with ENABLE_JOBS=false. See docs/guides/DEPLOY-RUNBOOK.md.
  jobs: {
    enabled: process.env.NODE_ENV !== 'test' && process.env.ENABLE_JOBS !== 'false',
  },
  // Email: NOTIFICATIONS_SMTP_URL (e.g. smtps://user:pass@smtp.example.com:465) turns on
  // real delivery from the email_outbox queue (lib/email/outbox.js); unset, queued mail is
  // marked `skipped`. msGraph (Teams meeting creation) is still reserved: nothing reads it yet.
  notifications: {
    email: {
      from: process.env.NOTIFICATIONS_EMAIL_FROM || null,
      smtpUrl: process.env.NOTIFICATIONS_SMTP_URL || null,
    },
    msGraph: {
      tenantId: process.env.MS_GRAPH_TENANT_ID || null,
      clientId: process.env.MS_GRAPH_CLIENT_ID || null,
      clientSecret: process.env.MS_GRAPH_CLIENT_SECRET || null,
    },
  },
};

assertProductionConfig(env);

module.exports = env;
module.exports.assertProductionConfig = assertProductionConfig;
module.exports.isWeakSecret = isWeakSecret;
