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
