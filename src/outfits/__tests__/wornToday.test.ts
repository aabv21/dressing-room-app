jest.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ userId: 'user-1' }) }));

import { kvGet, kvRemove, kvSet } from '../../lib/kv';
import { isWornToday, markWornToday, outfitIdentity, wornTodayKey } from '../wornToday';

const DAY = '2026-11-08';

beforeEach(() => {
  kvRemove(wornTodayKey('user-1'));
  kvRemove(wornTodayKey('user-2'));
});

test('an outfit is the same whatever order its ids come in', () => {
  expect(outfitIdentity(['c', 'a', 'b'])).toBe('a,b,c');

  markWornToday('user-1', DAY, ['c', 'a', 'b']);

  expect(isWornToday('user-1', DAY, ['b', 'c', 'a'])).toBe(true);
  expect(isWornToday('user-1', DAY, ['a', 'b'])).toBe(false);
});

test('is kept per user, under outfit.worn.<userId>', () => {
  markWornToday('user-1', DAY, ['a', 'b']);

  expect(isWornToday('user-2', DAY, ['a', 'b'])).toBe(false);
  expect(kvGet('outfit.worn.user-1')).toBe(JSON.stringify({ day: DAY, outfits: ['a,b'] }));
  expect(kvGet('outfit.worn.user-2')).toBeNull();
});

test("is only for its day, and a new day's mark drops the earlier day", () => {
  markWornToday('user-1', DAY, ['a', 'b']);
  markWornToday('user-1', DAY, ['c', 'd']);
  expect(isWornToday('user-1', '2026-11-09', ['a', 'b'])).toBe(false);

  markWornToday('user-1', '2026-11-09', ['e', 'f']);

  expect(kvGet('outfit.worn.user-1')).toBe(JSON.stringify({ day: '2026-11-09', outfits: ['e,f'] }));
  expect(isWornToday('user-1', DAY, ['a', 'b'])).toBe(false);
});

test('marking the same outfit twice stores it once', () => {
  markWornToday('user-1', DAY, ['a', 'b']);
  markWornToday('user-1', DAY, ['b', 'a']);

  expect(kvGet('outfit.worn.user-1')).toBe(JSON.stringify({ day: DAY, outfits: ['a,b'] }));
});

test('a record that does not parse counts as nothing worn and is replaced on the next mark', () => {
  kvSet('outfit.worn.user-1', '{not json');
  expect(isWornToday('user-1', DAY, ['a', 'b'])).toBe(false);

  kvSet('outfit.worn.user-1', JSON.stringify({ day: DAY, outfits: [1, 2] }));
  expect(isWornToday('user-1', DAY, ['a', 'b'])).toBe(false);

  markWornToday('user-1', DAY, ['a', 'b']);
  expect(isWornToday('user-1', DAY, ['a', 'b'])).toBe(true);
});
