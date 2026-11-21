import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    // NOTE: database.types.ts is generated (`pnpm db:types`) and trips a lint rule on its own
    // CompositeTypes helper; ceiling: lives until Supabase's generator output changes shape,
    // upgrade path: re-check this exclusion after any `pnpm db:types` regeneration.
    ignores: [
      '.expo/**',
      'ios/**',
      'android/**',
      'dist/**',
      '.perf-fixtures/**',
      'src/lib/database.types.ts',
    ],
  },
  tseslint.configs.strictTypeChecked,
  security.configs.recommended,
  reactHooks.configs.flat['recommended-latest'],
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  {
    // Node tooling reads and writes repo, temp and backup paths it builds itself, never a path from
    // outside input; the one request-driven read (`perf-fixtures.ts`) maps a number to its file.
    files: ['scripts/**/*.ts', 'integration/**/*.ts'],
    rules: { 'security/detect-non-literal-fs-filename': 'off' },
  },
);
