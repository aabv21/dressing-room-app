import { kvGet, kvSet } from '../../lib/kv';
import type { SavedOutfit } from '../savedOutfits';
import { readStoredSaved, storedSavedKey, storeSaved } from '../storedSaved';

const USER = 'user-1';
const OUTFIT: SavedOutfit = { id: 'o-1', savedAt: '2026-11-20T10:00:00Z', score: 82, garmentIds: ['g-1', 'g-2'] };

test('the key has the <name>.<id> shape the account cleanup clears', () => {
  expect(storedSavedKey(USER)).toBe('outfits.saved.v1.user-1');
});

test('round-trips the saved list', () => {
  storeSaved(USER, [OUTFIT, { ...OUTFIT, id: 'o-0', score: null }]);
  expect(kvGet(storedSavedKey(USER))).not.toBeNull();
  expect(readStoredSaved(USER)).toEqual([OUTFIT, { ...OUTFIT, id: 'o-0', score: null }]);
});

test('a malformed or missing value reads as null', () => {
  kvSet(storedSavedKey(USER), '[{"id":1}]');
  expect(readStoredSaved(USER)).toBeNull();
  kvSet(storedSavedKey(USER), 'not json');
  expect(readStoredSaved(USER)).toBeNull();
  expect(readStoredSaved('nobody')).toBeNull();
});
