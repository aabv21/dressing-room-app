import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['.expo/**', 'ios/**', 'android/**', 'dist/**', '.perf-fixtures/**'],
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
);
