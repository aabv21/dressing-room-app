// Components take their font sizes and colors from `theme.ts`, so one change there restyles the app
// (and a dark palette can come later). Garment swatches are data, not chrome: `statsModel.ts` keeps its own.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { fontSizes } from '../theme';

const SRC = join(__dirname, '..', '..');
const DATA_COLOR_FILES: ReadonlySet<string> = new Set(['stats/statsModel.ts']);

function appSources(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter(
    (file) =>
      /\.tsx?$/.test(file) &&
      !file.includes('__tests__') &&
      !file.startsWith('test/') &&
      file !== 'ui/theme.ts' &&
      file !== 'lib/database.types.ts',
  );
}

function offenders(pattern: RegExp, skip: ReadonlySet<string> = new Set()): string[] {
  return appSources()
    .filter((file) => !skip.has(file))
    .filter((file) => pattern.test(readFileSync(join(SRC, file), 'utf8')))
    .map((file) => relative('.', file));
}

test('no component hard-codes a font size', () => {
  expect(offenders(/fontSize: \d/)).toEqual([]);
});

test('no component hard-codes a color', () => {
  expect(offenders(/['"`][^'"`\n]*(#[0-9a-fA-F]{3,8}\b|rgba?\()[^'"`\n]*['"`]/, DATA_COLOR_FILES)).toEqual([]);
});

test('the type scale never goes below 11 pt', () => {
  expect(Math.min(...Object.values(fontSizes))).toBeGreaterThanOrEqual(11);
});
