import { kvGet, kvRemove, kvSet } from '../../lib/kv';
import { readStoredLucky, storedLuckyKey, storeLucky } from '../storedLucky';
import type { LuckyResponse } from '../types';

const DAY = '2026-11-08';

const LIST: LuckyResponse = {
  kind: 'ok',
  weather: { tempC: 24, condition: 'clear', band: 'hot', rain: false },
  outfits: [{ garmentIds: ['a', 'b', 'c'], score: 88, freshThisWeek: true }],
};
const OFFICE: LuckyResponse = { kind: 'ok', weather: null, outfits: [{ garmentIds: ['d', 'e'], score: null, freshThisWeek: false }] };
const TOO_SMALL: LuckyResponse = { kind: 'too_small', missing: ['shoes'], weather: null };

beforeEach(() => {
  kvRemove(storedLuckyKey('user-1'));
  kvRemove(storedLuckyKey('user-2'));
});

test('reads back the list stored for the same user, day and occasion', () => {
  storeLucky('user-1', DAY, null, LIST);
  storeLucky('user-1', DAY, 'office', OFFICE);

  expect(readStoredLucky('user-1', DAY, null)).toEqual(LIST);
  expect(readStoredLucky('user-1', DAY, 'office')).toEqual(OFFICE);
  expect(readStoredLucky('user-1', DAY, 'sport')).toBeNull();
});

test("another user's lists live under their own key", () => {
  storeLucky('user-1', DAY, null, LIST);

  expect(readStoredLucky('user-2', DAY, null)).toBeNull();
  expect(kvGet('today.lucky.user-2')).toBeNull();
  expect(kvGet('today.lucky.user-1')).not.toBeNull();
});

test("another day's lists aren't read, and a new day's write drops them", () => {
  storeLucky('user-1', DAY, null, LIST);
  storeLucky('user-1', DAY, 'office', OFFICE);
  expect(readStoredLucky('user-1', '2026-11-09', null)).toBeNull();

  storeLucky('user-1', '2026-11-09', null, TOO_SMALL);

  expect(JSON.parse(kvGet('today.lucky.user-1') ?? 'null')).toEqual({
    day: '2026-11-09',
    lists: [{ occasion: null, response: TOO_SMALL }],
  });
});

test('a newer list for the same occasion replaces the older one', () => {
  storeLucky('user-1', DAY, 'office', OFFICE);
  storeLucky('user-1', DAY, 'office', TOO_SMALL);

  expect(readStoredLucky('user-1', DAY, 'office')).toEqual(TOO_SMALL);
  expect(JSON.parse(kvGet('today.lucky.user-1') ?? 'null')).toEqual({
    day: DAY,
    lists: [{ occasion: 'office', response: TOO_SMALL }],
  });
});

test('a record that does not parse, or a list of another shape, counts as none', () => {
  kvSet('today.lucky.user-1', '{not json');
  expect(readStoredLucky('user-1', DAY, null)).toBeNull();

  kvSet(
    'today.lucky.user-1',
    JSON.stringify({
      day: DAY,
      lists: [
        { occasion: null, response: { kind: 'ok', weather: null, outfits: [{ garmentIds: 'a,b' }] } },
        { occasion: 'office', response: { kind: 'too_small', missing: ['cape'], weather: null } },
        { occasion: 'beach', response: LIST },
        { occasion: 'sport', response: LIST },
      ],
    }),
  );
  expect(readStoredLucky('user-1', DAY, null)).toBeNull();
  expect(readStoredLucky('user-1', DAY, 'office')).toBeNull();
  expect(readStoredLucky('user-1', DAY, 'sport')).toEqual(LIST);
});
