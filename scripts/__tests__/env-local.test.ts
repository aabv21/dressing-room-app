/** @jest-environment node */
// scripts/__tests__/env-local.test.ts
import { toEnvFile } from '../env-local.ts';

test('maps supabase status env to the app and test variables in a fixed order', () => {
  expect(
    toEnvFile({ API_URL: 'http://127.0.0.1:54321', ANON_KEY: 'anon', SERVICE_ROLE_KEY: 'srv', DB_URL: 'postgresql://x' }),
  ).toBe(
    'EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nEXPO_PUBLIC_SUPABASE_ANON_KEY=anon\nSUPABASE_SERVICE_ROLE_KEY=srv\nSUPABASE_DB_URL=postgresql://x\n',
  );
});

test('refuses to write a half-configured env', () => {
  expect(() => toEnvFile({ API_URL: 'http://127.0.0.1:54321' })).toThrow(/ANON_KEY/);
});

describe('merging with an existing .env.local', () => {
  const statusEnv = { API_URL: 'http://127.0.0.1:54321', ANON_KEY: 'anon', SERVICE_ROLE_KEY: 'srv', DB_URL: 'postgresql://x' };

  test('keeps a non-Supabase key from the existing file (e.g. a Google client id)', () => {
    const existing =
      'EXPO_PUBLIC_SUPABASE_URL=http://old\n' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY=old-anon\n' +
      'SUPABASE_SERVICE_ROLE_KEY=old-srv\n' +
      'SUPABASE_DB_URL=postgresql://old\n' +
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=my-web-id\n' +
      'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=my-ios-id\n';

    const result = toEnvFile(statusEnv, existing);

    expect(result).toBe(
      'EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n' +
        'EXPO_PUBLIC_SUPABASE_ANON_KEY=anon\n' +
        'SUPABASE_SERVICE_ROLE_KEY=srv\n' +
        'SUPABASE_DB_URL=postgresql://x\n' +
        'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=my-web-id\n' +
        'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=my-ios-id\n',
    );
  });

  test('replaces the four Supabase keys wherever they appear, never duplicating them', () => {
    const existing =
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=my-web-id\n' +
      'EXPO_PUBLIC_SUPABASE_URL=http://old\n' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY=old-anon\n' +
      'SUPABASE_SERVICE_ROLE_KEY=old-srv\n' +
      'SUPABASE_DB_URL=postgresql://old\n';

    const result = toEnvFile(statusEnv, existing);

    const supabaseUrlOccurrences = result.split('\n').filter((line) => line.startsWith('EXPO_PUBLIC_SUPABASE_URL=')).length;
    expect(supabaseUrlOccurrences).toBe(1);
    expect(result).toContain('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=my-web-id');
    expect(result).toContain('EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321');
  });

  test('with no existing file, writes only the four Supabase keys', () => {
    const result = toEnvFile(statusEnv);

    expect(result).toBe(
      'EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n' +
        'EXPO_PUBLIC_SUPABASE_ANON_KEY=anon\n' +
        'SUPABASE_SERVICE_ROLE_KEY=srv\n' +
        'SUPABASE_DB_URL=postgresql://x\n',
    );
  });

  test('an existing file with only Supabase keys round-trips to just the four keys', () => {
    const existing =
      'EXPO_PUBLIC_SUPABASE_URL=http://old\n' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY=old-anon\n' +
      'SUPABASE_SERVICE_ROLE_KEY=old-srv\n' +
      'SUPABASE_DB_URL=postgresql://old\n';

    const result = toEnvFile(statusEnv, existing);

    expect(result).toBe(
      'EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n' +
        'EXPO_PUBLIC_SUPABASE_ANON_KEY=anon\n' +
        'SUPABASE_SERVICE_ROLE_KEY=srv\n' +
        'SUPABASE_DB_URL=postgresql://x\n',
    );
  });
});
