import type { GridItem } from './ClosetGrid';

const DEFAULT_COUNT = 500;

// Zero-padded, 1-based fixture file name, e.g. index 1 -> `0001.webp`.
// NOTE: duplicates `scripts/perf-fixtures.ts`'s `fixtureFileName` (src/ can't import scripts/); upgrade: a shared module.
function fixtureFileName(index: number): string {
  return `${String(index).padStart(4, '0')}.webp`;
}

/**
 * Synthetic items served by `scripts/perf-fixtures.ts`, only when `EXPO_PUBLIC_PERF_FIXTURES_URL` is set
 * (docs/performance-gate.md); see the `NOTE:` in `src/app/(tabs)/closet.tsx`.
 */
export function perfFixtureItems(baseUrl: string, count: number = DEFAULT_COUNT): GridItem[] {
  return Array.from({ length: count }, (_, zeroBasedIndex) => {
    const i = zeroBasedIndex + 1;
    return {
      id: `perf-${String(i).padStart(4, '0')}`,
      thumbUri: `${baseUrl}/perf/${fixtureFileName(i)}`,
      wearCount: (i * 7) % 31,
      label: `Item ${String(i)}`,
    };
  });
}
