import { cacheOnboarding, cachedOnboarding } from '../../auth/deviceState';
import { kvGet, kvKeys, kvRemove, kvSet } from '../../lib/kv';
import {
  clearDeletionMarker,
  deletionMarkedAt,
  deletionState,
  forgetInterruptedDeletions,
  markDeletion,
} from '../deletionMarker';

const DELETING = '0b7f6d7e-1111-4c4c-9a9a-000000000001';
const REAUTH = '0b7f6d7e-2222-4c4c-9a9a-000000000002';
const ACTIVE = '0b7f6d7e-3333-4c4c-9a9a-000000000003';

beforeEach(() => {
  for (const key of kvKeys()) kvRemove(key);
});

test('marks, reads and clears a deletion under account.deleting.<id>', () => {
  expect(deletionState(DELETING)).toBeNull();

  markDeletion(DELETING, 'deleting', 1_700_000_000_000);
  expect(kvGet(`account.deleting.${DELETING}`)).toBe('deleting:1700000000000');
  expect(deletionState(DELETING)).toBe('deleting');
  expect(deletionMarkedAt(DELETING)).toBe(1_700_000_000_000);

  markDeletion(DELETING, 'reauth', 1_700_000_060_000);
  expect(deletionState(DELETING)).toBe('reauth');
  expect(deletionMarkedAt(DELETING)).toBe(1_700_000_060_000);

  clearDeletionMarker(DELETING);
  expect(deletionState(DELETING)).toBeNull();
});

test.each(['deleting', 'reauth'] as const)('an old-format marker (a bare %s) reads as written long ago', (state) => {
  kvSet(`account.deleting.${DELETING}`, state);

  expect(deletionState(DELETING)).toBe(state);
  expect(deletionMarkedAt(DELETING)).toBe(0);
});

test('an unreadable marker value counts as none', () => {
  kvSet(`account.deleting.${DELETING}`, 'maybe');
  kvSet(`account.deleting.${REAUTH}`, 'deleting:soon');

  expect(deletionState(DELETING)).toBeNull();
  expect(deletionMarkedAt(DELETING)).toBeNull();
  expect(deletionState(REAUTH)).toBeNull();
});

test("a session that ended drops a deleting account's data and marker, and keeps a reauth one's", () => {
  markDeletion(DELETING, 'deleting');
  kvSet(`closet.v1.${DELETING}`, 'x');
  kvSet(`today.occasion.${DELETING}.2026-11-09`, 'office');
  cacheOnboarding(DELETING, true);
  markDeletion(REAUTH, 'reauth');
  kvSet(`closet.v1.${REAUTH}`, 'x');

  forgetInterruptedDeletions(null);

  expect(deletionState(DELETING)).toBeNull();
  expect(kvGet(`closet.v1.${DELETING}`)).toBeNull();
  expect(kvGet(`today.occasion.${DELETING}.2026-11-09`)).toBeNull();
  expect(cachedOnboarding(DELETING)).toBeNull();
  expect(deletionState(REAUTH)).toBe('reauth');
  expect(kvGet(`closet.v1.${REAUTH}`)).toBe('x');
});

test("the signed-in user's own unfinished deletion is left for their session to retry", () => {
  markDeletion(ACTIVE, 'deleting');
  kvSet(`closet.v1.${ACTIVE}`, 'x');

  forgetInterruptedDeletions(ACTIVE);

  expect(deletionState(ACTIVE)).toBe('deleting');
  expect(kvGet(`closet.v1.${ACTIVE}`)).toBe('x');
});
