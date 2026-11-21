import { createRequire } from 'node:module';

import type { Config } from 'jest';

const require = createRequire(import.meta.url);

// Four projects (docs/testing.md): `app` under jest-expo's React Native environment, and
// `scripts`, `functions` and `integration` under plain Node. The Node ones stay out of jest-expo
// because its preset's lazy globals (`fetch`, `structuredClone`, ...) break a file's own
// `@jest-environment node` docblock at teardown.
const config: Config = {
  projects: [
    {
      displayName: 'app',
      preset: 'jest-expo',
      setupFiles: ['<rootDir>/jest.setup.ts'],
      testMatch: ['<rootDir>/src/**/*.test.[jt]s?(x)'],
      transformIgnorePatterns: [
        'node_modules/(?!(.pnpm|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg))',
      ],
      moduleNameMapper: {
        // NOTE: lucide-react-native's `exports` map resolves the `react-native`/`browser`
        // condition to an ESM-only .mjs build that jest-expo's babel transform (`\.[jt]sx?$`)
        // does not match. Node's plain CJS resolution (no custom conditions) resolves the same
        // bare specifier to the package's CJS build instead, so reuse that path here. Upgrade
        // path: drop this once the package ships a transform-compatible entry or Jest's
        // resolver supports `.mjs` via babel.
        '^lucide-react-native$': require.resolve('lucide-react-native'),
      },
    },
    {
      // `scripts/` has no babel/TS transform of its own (no `.js`/`.mjs` sources, run with
      // Node's native type stripping). Rather than add a babel transform here that would need
      // devDependencies this repo doesn't otherwise have, let Jest 30's native ESM loader
      // (Node 24.9+'s synchronous `require(esm)`) load these files directly: `extensionsToTreatAsEsm`
      // marks `.ts` as ESM, Node strips the types, and no CJS/transform path is involved.
      displayName: 'scripts',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/scripts/**/*.test.ts'],
      extensionsToTreatAsEsm: ['.ts'],
      transform: {},
    },
    {
      // Supabase Edge Function logic under `supabase/functions/`. Same setup as `scripts` (plain
      // Node, native TS stripping): the function code is runtime-neutral TypeScript with explicit
      // `.ts` imports, and only each function's `index.ts` (never imported by a test) touches Deno.
      displayName: 'functions',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/supabase/functions/**/*.test.ts'],
      extensionsToTreatAsEsm: ['.ts'],
      transform: {},
    },
    {
      // Exercises authService and RLS against a running local Supabase stack. Same reasoning as
      // the `scripts` project above (plain Node, native TS stripping, no jest-expo preset); kept
      // out of the default `pnpm test` project selection (see the `test:int` script) since it
      // needs Docker and `.env.local`, not just `node_modules`.
      displayName: 'integration',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/integration/**/*.int.test.ts'],
      extensionsToTreatAsEsm: ['.ts'],
      transform: {},
      moduleNameMapper: {
        // `emailAuth.ts`/`socialAuth.ts` default their `client` parameter to the real
        // `src/lib/supabase.ts` singleton, which imports `react-native` and
        // `expo-sqlite/localStorage/install` — native modules that cannot load under plain Node.
        // Every integration test passes an explicit client (see `helpers.ts`), so this default
        // path is never meant to run here; map it to a stub that throws if it ever is. Matches the
        // relative specifier as written in `src/auth/{emailAuth,socialAuth}.ts` (`../lib/supabase`).
        '^(\\.\\./)+lib/supabase$': '<rootDir>/integration/lib-supabase.stub.ts',
        // `garmentRepository.ts` imports expo-file-system's `File` (native-only) for its file-reading
        // upload; integration tests use the bytes variant, so map it to a stub that throws if used.
        '^expo-file-system$': '<rootDir>/integration/expo-file-system.stub.ts',
      },
    },
  ],
};

export default config;
