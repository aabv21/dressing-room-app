/** @jest-environment node */
// scripts/__tests__/perf-fixtures.test.ts
import { fixtureFileName, fixtureSpec, fixtureSvg, resolveInside } from '../perf-fixtures.ts';

test('specs are deterministic and visually varied across 500 items', () => {
  expect(fixtureSpec(42)).toEqual(fixtureSpec(42));
  const keys = new Set(Array.from({ length: 500 }, (_, i) => JSON.stringify(fixtureSpec(i + 1))));
  expect(keys.size).toBeGreaterThanOrEqual(400);
});

test('file names are zero-padded and 1-based', () => {
  expect(fixtureFileName(1)).toBe('0001.webp');
  expect(fixtureFileName(500)).toBe('0500.webp');
});

test('svg has a transparent background and the requested size', () => {
  const svg = fixtureSvg(fixtureSpec(7), 256);
  expect(svg).toContain('width="256"');
  expect(svg).not.toMatch(/<rect[^>]*width="256"[^>]*height="256"[^>]*fill=/);
});

test('serve rejects paths that escape the fixtures root', () => {
  expect(resolveInside('/root/.perf-fixtures', '/perf/0001.webp')).toBe('/root/.perf-fixtures/perf/0001.webp');
  expect(resolveInside('/root/.perf-fixtures', '/../package.json')).toBeNull();
  expect(resolveInside('/root/.perf-fixtures', '/perf/%2e%2e/%2e%2e/x')).toBeNull();
});
