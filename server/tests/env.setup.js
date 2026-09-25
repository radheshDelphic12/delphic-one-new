process.env.NODE_ENV = 'test';
// Small explicit pool — `--runInBand` means one Jest process, one PrismaClient,
// but this DB shares the same Postgres instance as the dev server(s).
// TEST_DATABASE_URL lets a machine where :5434 is already taken by something
// else (see AGENTS.md's port-conflict note) override without touching this
// file — unset, behavior is unchanged.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgres://postgres:postgres@localhost:5434/requirement_dashboard_test?connection_limit=10&pool_timeout=20';
process.env.JWT_ACCESS_SECRET = 'test_access_secret';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';
process.env.JWT_ACCESS_EXPIRES = '1h';
process.env.JWT_REFRESH_EXPIRES = '7d';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.UPLOAD_DIR = './uploads_test';
process.env.MAX_UPLOAD_MB = '10';
process.env.ENABLE_JOBS = 'false';

// Finance scope reduction is a production default; the existing suites cover those modules, so they run with them on. financeScope tests set it themselves.
process.env.FINANCE_DISABLED_MODULES = '';
