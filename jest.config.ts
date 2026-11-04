import { createRequire } from 'node:module';

import type { Config } from 'jest';

const require = createRequire(import.meta.url);

// Two projects: the app runs under jest-expo's React Native environment; `scripts/` is plain
// Node tooling (no React Native, no Expo globals) and runs under Jest's standard node
// environment. Keeping `scripts/` out of the jest-expo project matters because jest-expo's
// preset setupFile installs Expo's lazy globals (`fetch`, `structuredClone`, ...) through
// getters that `require()` on first access; those getters are incompatible with a test file's
// own `@jest-environment node` docblock (`You are trying to require a file outside of the scope
// of the test code` during teardown), so `scripts/__tests__` needs a project that never loads
// that preset in the first place.
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
      },
    },
  ],
};

export default config;
