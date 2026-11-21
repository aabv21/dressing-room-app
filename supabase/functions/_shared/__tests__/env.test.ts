/** @jest-environment node */
// supabase/functions/_shared/__tests__/env.test.ts
import { appleEnvFrom, readEnv } from '../env.ts';

const getter =
  (values: Record<string, string>) =>
  (name: string): string | undefined =>
    new Map(Object.entries(values)).get(name);

const SUPABASE = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
};

describe('readEnv', () => {
  test('reads the variables of each capability asked for', () => {
    expect(readEnv(getter({ ...SUPABASE, TYPESAFE_API_KEY: 'jev-key' }), ['supabase', 'jev'])).toEqual({
      supabaseUrl: 'https://x.supabase.co',
      anonKey: 'anon',
      serviceRoleKey: 'service',
      typesafeApiKey: 'jev-key',
      typesafeBaseUrl: 'https://api.typesafe.ai',
    });
  });

  test.each([
    ['unset', {}],
    ['empty', { SUPABASE_URL: '' }],
  ])('throws on a missing SUPABASE_URL (%s), never passing it on blank', (_label, url) => {
    const values = { SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', ...url };
    expect(() => readEnv(getter(values), ['supabase'])).toThrow('missing env: SUPABASE_URL');
  });

  test('throws on a missing secret of a capability it needs, and ignores the others', () => {
    expect(() => readEnv(getter(SUPABASE), ['supabase', 'claude'])).toThrow('missing env: ANTHROPIC_API_KEY');
    expect(readEnv(getter(SUPABASE), ['supabase'])).not.toHaveProperty('anthropicApiKey');
  });

  test('applies the real API hosts when the base URLs are unset or empty', () => {
    const env = readEnv(
      getter({ ...SUPABASE, TYPESAFE_API_KEY: 'k', ANTHROPIC_API_KEY: 'k', TYPESAFE_BASE_URL: '' }),
      ['supabase', 'jev', 'claude', 'weather'],
    );
    expect(env.typesafeBaseUrl).toBe('https://api.typesafe.ai');
    expect(env.anthropicBaseUrl).toBe('https://api.anthropic.com');
    expect(env.openMeteoUrl).toBe('https://api.open-meteo.com');
    expect(env.geocodingUrl).toBe('https://geocoding-api.open-meteo.com');
  });

  test('trims trailing slashes off every URL once', () => {
    const env = readEnv(
      getter({ ...SUPABASE, SUPABASE_URL: 'https://x.supabase.co/', OPEN_METEO_URL: 'http://mock.test:54498//' }),
      ['supabase', 'weather'],
    );
    expect(env.supabaseUrl).toBe('https://x.supabase.co');
    expect(env.openMeteoUrl).toBe('http://mock.test:54498');
  });

  test('the service capability needs no anon key', () => {
    expect(
      readEnv(getter({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's', EXTRACT_WEBHOOK_SECRET: 'w' }), [
        'service',
        'webhook',
      ]),
    ).toEqual({ supabaseUrl: 'https://x.supabase.co', serviceRoleKey: 's', webhookSecret: 'w' });
  });
});

describe('appleEnvFrom', () => {
  test('trims a trailing slash off the Apple base URL', () => {
    const env = appleEnvFrom(
      getter({
        APPLE_TEAM_ID: 'TEAM',
        APPLE_KEY_ID: 'KEY',
        APPLE_PRIVATE_KEY: 'pem',
        APPLE_CLIENT_ID: 'com.example',
        APPLE_BASE_URL: 'http://apple.test/',
      }),
    );
    expect(env?.baseUrl).toBe('http://apple.test');
  });
});
