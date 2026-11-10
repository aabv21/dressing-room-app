import { cacheOnboarding, cachedOnboarding, isLanguageSavePending, markLanguageSavePending } from '../../auth/deviceState';
import { allowUserKeys, kvGet, kvKeys, kvRemove, kvSet } from '../../lib/kv';
import { forgetAccountOnDevice } from '../forgetAccount';

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
