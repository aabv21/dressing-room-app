import type { GridItem } from './ClosetGrid';

const DEFAULT_COUNT = 500;

// Zero-padded, 1-based fixture file name, e.g. index 1 -> `0001.webp`.
// NOTE: duplicated from `scripts/perf-fixtures.ts`'s `fixtureFileName` rather than imported: app
// code under `src/` must not depend on `scripts/`, which runs under Node's native type stripping
// with no bundler. Upgrade path: extract a tiny shared constant module if this padding scheme
// ever needs to change in more than one place.
function fixtureFileName(index: number): string {
  return `${String(index).padStart(4, '0')}.webp`;
}

/**
 * Builds `count` synthetic closet items whose thumbnails point at the local perf fixture server
 * (`scripts/perf-fixtures.ts`). Used only when `EXPO_PUBLIC_PERF_FIXTURES_URL` is set for the
 * on-device performance gate build; see Task 6's `NOTE:` in `src/app/(tabs)/closet.tsx`.
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
