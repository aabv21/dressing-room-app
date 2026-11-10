import { kvGet, kvRemove, kvSet } from '../../lib/kv';
import { readStoredForYou, storedForYouKey, storeForYou } from '../storedForYou';
import type { ForYouCard, ForYouResponse } from '../types';

const BLAZER: ForYouCard = {
  id: 'blazer-camel',
  category: 'blazer',
  colors: ['camel'],
  newOutfits: 14,
  combinesWith: 8,
  line: null,
  lineKey: 'forYou.line.outerwear',
  lineParams: {},
  searchQuery: 'blazer camel mujer',
};

const IDEAS: ForYouResponse = { kind: 'ok', ideas: [BLAZER] };
const IDEAS_EN: ForYouResponse = { kind: 'ok', ideas: [{ ...BLAZER, line: 'A camel blazer lifts your jeans.', searchQuery: 'camel blazer women' }] };

beforeEach(() => {
  kvRemove(storedForYouKey('user-1'));
  kvRemove(storedForYouKey('user-2'));
});

test('reads back the ideas stored for the same user and language', () => {
  storeForYou('user-1', 'es', IDEAS);
  storeForYou('user-1', 'en', IDEAS_EN);

  expect(readStoredForYou('user-1', 'es')).toEqual(IDEAS);
  expect(readStoredForYou('user-1', 'en')).toEqual(IDEAS_EN);
});

test("another user's ideas live under their own key", () => {
  storeForYou('user-1', 'es', IDEAS);

  expect(readStoredForYou('user-2', 'es')).toBeNull();
  expect(kvGet('forYou.ideas.user-2')).toBeNull();
  expect(kvGet('forYou.ideas.user-1')).not.toBeNull();
});

test('a newer answer replaces the older one, too_small included', () => {
  storeForYou('user-1', 'es', IDEAS);
  storeForYou('user-1', 'es', { kind: 'too_small' });

  expect(readStoredForYou('user-1', 'es')).toEqual({ kind: 'too_small' });
});

test.each([
  ['not JSON', '{'],
  ['an older shape', JSON.stringify({ es: { kind: 'ok', ideas: [{ id: 'x' }] } })],
  ['an unknown kind', JSON.stringify({ es: { kind: 'later' } })],
  ['an array', JSON.stringify([IDEAS])],
])('%s reads as nothing stored', (_name, raw) => {
  kvSet(storedForYouKey('user-1'), raw);

  expect(readStoredForYou('user-1', 'es')).toBeNull();
});
