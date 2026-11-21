import { act, renderHook } from '@testing-library/react-native';

import { forgetAccountOnDevice } from '../../account/forgetAccount';
import { allowUserKeys, kvGet, kvKeys, kvRemove } from '../../lib/kv';
import { MAX_CHECKED_TRIPS, toggleChecked, tripChecksKey, tripKey, useTripChecks } from '../tripChecks';

const USER = 'user-1';
const TRIP = { city: ' Lisboa ', start: '2026-12-01', end: '2026-12-03', occasion: null };

beforeEach(() => {
  for (const key of kvKeys()) kvRemove(key);
  allowUserKeys(USER);
});

test('a trip is keyed by its city (case and spaces aside), dates and occasion', () => {
  expect(tripKey(TRIP)).toBe(tripKey({ ...TRIP, city: 'lisboa' }));
  expect(tripKey(TRIP)).not.toBe(tripKey({ ...TRIP, end: '2026-12-04' }));
  expect(tripKey(TRIP)).not.toBe(tripKey({ ...TRIP, occasion: 'office' }));
  expect(tripChecksKey(USER)).toBe('trip.checks.user-1');
});

test('check-offs are kept per trip in kv and follow every toggle', async () => {
  const key = tripKey(TRIP);
  const { result } = await renderHook(() => useTripChecks(USER, key));
  expect(result.current).toEqual(new Set());

  await act(() => {
    toggleChecked(USER, key, 'g-1');
    toggleChecked(USER, key, 'g-2');
    toggleChecked(USER, key, 'g-1');
  });

  expect(result.current).toEqual(new Set(['g-2']));
  expect(kvGet(tripChecksKey(USER))).toContain('g-2');
});

test(`only the latest ${String(MAX_CHECKED_TRIPS)} trips keep their check-offs`, () => {
  for (let n = 0; n <= MAX_CHECKED_TRIPS; n += 1) toggleChecked(USER, `trip-${String(n)}`, 'g-1');
  const stored = JSON.parse(kvGet(tripChecksKey(USER)) ?? '{}') as Record<string, string[]>;
  expect(Object.keys(stored)).toHaveLength(MAX_CHECKED_TRIPS);
  expect(stored['trip-0']).toBeUndefined();
});

test('account deletion clears the check-offs', () => {
  toggleChecked(USER, tripKey(TRIP), 'g-1');
  forgetAccountOnDevice(USER);
  expect(kvGet(tripChecksKey(USER))).toBeNull();
});
