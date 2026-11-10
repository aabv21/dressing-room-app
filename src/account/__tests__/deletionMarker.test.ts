import { cacheOnboarding, cachedOnboarding } from '../../auth/deviceState';
import { queuePurgeRequests } from '../../closet/upload/queuePurge';
import { allowUserKeys, kvGet, kvKeys, kvRemove, kvSet } from '../../lib/kv';
import {
  clearDeletionMarker,
  deletionState,
  DELETION_SETTLE_MS,
  forgetInterruptedDeletions,
  markDeletion,
  readDeletionMarker,
} from '../deletionMarker';

const NOW = 1_700_000_000_000;

const DELETING = '0b7f6d7e-1111-4c4c-9a9a-000000000001';
const REAUTH = '0b7f6d7e-2222-4c4c-9a9a-000000000002';
const ACTIVE = '0b7f6d7e-3333-4c4c-9a9a-000000000003';

beforeEach(() => {
  for (const key of kvKeys()) kvRemove(key);
  allowUserKeys(DELETING);
});

test('marks, reads and clears a deletion under account.deleting.<id>', () => {
  expect(deletionState(DELETING)).toBeNull();

  markDeletion(DELETING, 'deleting', 1_700_000_000_000);
  expect(kvGet(`account.deleting.${DELETING}`)).toBe('deleting:1700000000000');
  expect(deletionState(DELETING)).toBe('deleting');
  expect(readDeletionMarker(DELETING, NOW)).toEqual({ state: 'deleting', markedAt: 1_700_000_000_000 });

  markDeletion(DELETING, 'reauth', 1_700_000_060_000);
  expect(deletionState(DELETING)).toBe('reauth');
  expect(readDeletionMarker(DELETING, NOW)).toEqual({ state: 'reauth', markedAt: 1_700_000_060_000 });

  clearDeletionMarker(DELETING);
  expect(deletionState(DELETING)).toBeNull();
});

test.each([
  ['a bare state (the old format)', 'deleting'],
  ['an empty time', 'deleting:'],
  ['a time that is not a number', 'deleting:soon'],
  ['a negative time', 'deleting:-5'],
  ['a non-finite time', 'reauth:Infinity'],
  ['a time in the future', `reauth:${String(NOW + DELETION_SETTLE_MS + 1)}`],
])('a marker with %s still counts, with an untrusted time', (_name, value) => {
  kvSet(`account.deleting.${DELETING}`, value);

  expect(deletionState(DELETING)).toBe(value.startsWith('reauth') ? 'reauth' : 'deleting');
  expect(readDeletionMarker(DELETING, NOW)?.markedAt).toBeNull();
});

test('a value with another state counts as none', () => {
  kvSet(`account.deleting.${DELETING}`, 'maybe');
  kvSet(`account.deleting.${REAUTH}`, 'deletingX:1');

  expect(deletionState(DELETING)).toBeNull();
  expect(readDeletionMarker(DELETING, NOW)).toBeNull();
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

test("a session that ended asks the next queue provider to purge a deleting account's queue", () => {
  markDeletion(DELETING, 'deleting');
  markDeletion(REAUTH, 'reauth');

  forgetInterruptedDeletions(null);

  // Recorded even though that account's kv writes are refused from now on.
  expect(queuePurgeRequests()).toEqual([DELETING]);
  expect(deletionState(DELETING)).toBeNull();
});

test("the signed-in user's own unfinished deletion records no purge", () => {
  markDeletion(ACTIVE, 'deleting');

  forgetInterruptedDeletions(ACTIVE);

  expect(queuePurgeRequests()).toEqual([]);
});
