import { kvGet, kvSet } from '../../lib/kv';
import { mergeStoredWears, readStoredWears, storedWearsKey, storeWears, wearsInRange } from '../storedWears';
import type { WearWithItems } from '../wearsRepository';

const USER = 'user-1';
const wear = (id: string, wornOn: string): WearWithItems => ({
  id,
  wornOn,
  occasion: 'office',
  score: 80,
  garmentIds: ['g1', 'g2'],
});

test('round-trips a stored year', () => {
  const wears = [wear('w2', '2026-11-07'), wear('w1', '2026-10-01')];
  storeWears(USER, '2025-11-08', '2026-11-08', wears);

  expect(kvGet(storedWearsKey(USER))).not.toBeNull();
  expect(readStoredWears(USER)).toEqual({ from: '2025-11-08', to: '2026-11-08', wears });
});

test('a malformed value reads as null', () => {
  kvSet(storedWearsKey(USER), '{"from":"2025-11-08","to":"2026-11-08","wears":[{"id":1}]}');
  expect(readStoredWears(USER)).toBeNull();
  kvSet(storedWearsKey(USER), 'not json');
  expect(readStoredWears(USER)).toBeNull();
});

test('wearsInRange returns null for a range starting before the stored one and filters inside it', () => {
  const stored = {
    from: '2025-11-08',
    to: '2026-11-08',
    wears: [wear('w3', '2026-11-02'), wear('w2', '2026-10-31'), wear('w1', '2026-10-01')],
  };

  expect(wearsInRange(stored, '2025-10-01', '2025-10-31')).toBeNull();
  expect(wearsInRange(stored, '2025-11-01', '2025-11-30')).toBeNull();
  // The current month runs past the stored day; what's stored up to it is all there is.
  expect(wearsInRange(stored, '2026-11-01', '2026-11-30')?.map((w) => w.id)).toEqual(['w3']);
  expect(wearsInRange(stored, '2026-10-01', '2026-10-31')?.map((w) => w.id)).toEqual(['w2', 'w1']);
});

describe('mergeStoredWears', () => {
  beforeEach(() => {
    storeWears(USER, '2025-11-08', '2026-11-08', [wear('n1', '2026-11-03'), wear('o1', '2026-10-20'), wear('s1', '2026-09-10')]);
  });

  test('replaces the fetched month inside the stored range and keeps the rest in order', () => {
    mergeStoredWears(USER, '2026-10-01', '2026-10-31', [wear('o3', '2026-10-30'), wear('o2', '2026-10-02')]);

    const stored = readStoredWears(USER);
    expect(stored?.from).toBe('2025-11-08');
    expect(stored?.to).toBe('2026-11-08');
    expect(stored?.wears.map((w) => w.id)).toEqual(['n1', 'o3', 'o2', 's1']);
  });

  test('extends the range when the fetched month overlaps its start', () => {
    mergeStoredWears(USER, '2025-11-01', '2025-11-30', [wear('x1', '2025-11-02')]);

    expect(readStoredWears(USER)?.from).toBe('2025-11-01');
    expect(readStoredWears(USER)?.wears.map((w) => w.id)).toEqual(['n1', 'o1', 's1', 'x1']);
  });

  test('an older disjoint month leaves the record alone; with nothing stored it starts one', () => {
    mergeStoredWears(USER, '2025-01-01', '2025-01-31', [wear('x1', '2025-01-02')]);
    expect(readStoredWears(USER)?.from).toBe('2025-11-08');

    mergeStoredWears('user-2', '2026-10-01', '2026-10-31', [wear('o1', '2026-10-20')]);
    expect(readStoredWears('user-2')).toEqual({ from: '2026-10-01', to: '2026-10-31', wears: [wear('o1', '2026-10-20')] });
  });
});
