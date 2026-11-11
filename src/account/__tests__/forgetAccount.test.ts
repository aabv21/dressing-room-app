import { cacheOnboarding, cachedOnboarding, isLanguageSavePending, markLanguageSavePending } from '../../auth/deviceState';
import { queuePurgeRequests, requestQueuePurge } from '../../closet/upload/queuePurge';
import { allowUserKeys, kvGet, kvKeys, kvRemove, kvSet } from '../../lib/kv';
import { forgetAccountOnDevice, forgetDisplayCaches } from '../forgetAccount';

const USER = '0b7f6d7e-1111-4c4c-9a9a-000000000001';
const OTHER = '0b7f6d7e-2222-4c4c-9a9a-000000000002';

beforeEach(() => {
  for (const key of kvKeys()) kvRemove(key);
  allowUserKeys(USER);
});

test("removes every kv entry kept under the user's id, the day's occasions included", () => {
  for (const key of [
    `closet.v1.${USER}`,
    `outfit.worn.${USER}`,
    `today.lucky.${USER}`,
    `forYou.ideas.${USER}`,
    // The offline wear history and the queued "I'll wear it"s (Plan 6d).
    `wears.v1.${USER}`,
    `wear.queue.${USER}`,
    `today.occasion.${USER}.2026-11-08`,
    `today.occasion.${USER}.2026-11-09`,
  ]) {
    kvSet(key, 'x');
  }

  forgetAccountOnDevice(USER);

  expect(kvKeys()).toEqual([]);
});

test("keeps another account's entries and the device-wide settings", () => {
  kvSet(`closet.v1.${OTHER}`, 'x');
  kvSet(`today.occasion.${OTHER}.2026-11-09`, 'office');
  kvSet('locale-preference', 'es');
  kvSet(`closet.v1.${USER}`, 'x');

  forgetAccountOnDevice(USER);

  expect(kvGet(`closet.v1.${OTHER}`)).toBe('x');
  expect(kvGet(`today.occasion.${OTHER}.2026-11-09`)).toBe('office');
  expect(kvGet('locale-preference')).toBe('es');
  expect(kvGet(`closet.v1.${USER}`)).toBeNull();
});

test("drops the user's onboarding status and pending language save", () => {
  cacheOnboarding(USER, true);
  markLanguageSavePending(USER);

  forgetAccountOnDevice(USER);

  expect(cachedOnboarding(USER)).toBeNull();
  expect(isLanguageSavePending(USER)).toBe(false);
});

test("leaves another account's onboarding status and pending language save", () => {
  cacheOnboarding(OTHER, true);
  markLanguageSavePending(OTHER);

  forgetAccountOnDevice(USER);

  expect(cachedOnboarding(OTHER)).toBe(true);
  expect(isLanguageSavePending(OTHER)).toBe(true);
});

test("refuses the user's later writes, with or without the id in the key, and only that user's", () => {
  forgetAccountOnDevice(USER);

  kvSet(`closet.v1.${USER}`, 'late');
  kvSet(`today.occasion.${USER}.2026-11-09`, 'office');
  cacheOnboarding(USER, true);
  markLanguageSavePending(USER);
  kvSet(`closet.v1.${OTHER}`, 'x');

  expect(kvKeys()).toEqual([`closet.v1.${OTHER}`]);
});

test('the account signing in again lifts the refusal', () => {
  forgetAccountOnDevice(USER);
  allowUserKeys(USER);

  kvSet(`closet.v1.${USER}`, 'x');

  expect(kvGet(`closet.v1.${USER}`)).toBe('x');
});

test("keeps a queue purge request for the user, which outlives the account's other data", () => {
  requestQueuePurge(USER);
  kvSet(`closet.v1.${USER}`, 'x');

  forgetAccountOnDevice(USER);

  expect(queuePurgeRequests()).toEqual([USER]);
  expect(kvGet(`closet.v1.${USER}`)).toBeNull();
});

test('forgetDisplayCaches drops the display caches and keeps the queues and Logged ✓', () => {
  const display = [`closet.v1.${USER}`, `today.lucky.${USER}`, `forYou.ideas.${USER}`, `wears.v1.${USER}`];
  const kept = [`wear.queue.${USER}`, `outfit.worn.${USER}`, `queue.purge.${USER}`, 'closet.v1.other-user'];
  for (const key of [...display, ...kept]) kvSet(key, 'x');

  forgetDisplayCaches(USER);

  expect(kvKeys().sort()).toEqual([...kept].sort());
  // Unlike a deletion, the account can still write: it may sign in again at once.
  kvSet(`closet.v1.${USER}`, 'y');
  expect(kvKeys()).toContain(`closet.v1.${USER}`);
});
