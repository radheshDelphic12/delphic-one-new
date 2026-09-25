const { assertProductionConfig, isWeakSecret } = require('../src/config/env');

describe('production env guard', () => {
  const strong = 'a'.repeat(32);
  const strongB = 'b'.repeat(32);

  test('isWeakSecret rejects missing, short, and placeholder values', () => {
    expect(isWeakSecret(undefined)).toBe(true);
    expect(isWeakSecret('short')).toBe(true);
    expect(isWeakSecret('change_me_access')).toBe(true);
    expect(isWeakSecret('local_dev_access_secret_do_not_use_in_prod_01')).toBe(true);
    expect(isWeakSecret(strong)).toBe(false);
  });

  test('assertProductionConfig throws when secrets are weak', () => {
    expect(() =>
      assertProductionConfig(
        {
          nodeEnv: 'production',
          databaseUrl: 'postgres://x',
          jwt: { accessSecret: 'change_me_access', refreshSecret: strongB },
          corsOrigin: 'https://app.example.com',
        },
        { CORS_ORIGIN: 'https://app.example.com' }
      )
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  test('assertProductionConfig throws when CORS_ORIGIN is not set in the environment', () => {
    expect(() =>
      assertProductionConfig(
        {
          nodeEnv: 'production',
          databaseUrl: 'postgres://x',
          jwt: { accessSecret: strong, refreshSecret: strongB },
          corsOrigin: 'https://app.example.com',
        },
        {}
      )
    ).toThrow(/CORS_ORIGIN/);
  });

  test('assertProductionConfig accepts a valid production config', () => {
    expect(() =>
      assertProductionConfig(
        {
          nodeEnv: 'production',
          databaseUrl: 'postgres://x',
          jwt: { accessSecret: strong, refreshSecret: strongB },
          corsOrigin: 'https://app.example.com',
        },
        { CORS_ORIGIN: 'https://app.example.com' }
      )
    ).not.toThrow();
  });

  test('assertProductionConfig is a no-op outside production', () => {
    expect(() =>
      assertProductionConfig({
        nodeEnv: 'development',
        databaseUrl: undefined,
        jwt: { accessSecret: undefined, refreshSecret: undefined },
        corsOrigin: 'http://localhost:5173',
      })
    ).not.toThrow();
  });
});
