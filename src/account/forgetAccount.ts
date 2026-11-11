import { forgetAccount } from '../auth/deviceState';
import { QUEUE_PURGE_PREFIX } from '../closet/upload/queuePurge';
import { kvKeys, kvRemove, refuseKeys, refuseUserKeys } from '../lib/kv';

/**
 * Removes what this device keeps for a deleted account: every kv entry keyed by the user's id
 * (`closet.v1.<id>`, `outfit.worn.<id>`, `today.lucky.<id>`, `forYou.ideas.<id>`, each day's
 * `today.occasion.<id>.<date>`, and any later key that follows the same `<name>.<id>[.<more>]`
 * convention), plus the onboarding status and pending language save kept for offline launches.
 * Device-wide settings (the language preference) stay, and so does a queue purge request
 * (`queue.purge.<id>`), which is removed once the queue provider has carried it out. Later writes
 * for this user are refused first (`refuseUserKeys`), so a request still in flight can't write any
 * of it back.
 */
export function forgetAccountOnDevice(userId: string): void {
  refuseUserKeys(userId);
  for (const key of kvKeys()) {
    if (key.split('.').includes(userId) && !key.startsWith(QUEUE_PURGE_PREFIX)) {
      kvRemove(key);
    }
  }
  forgetAccount(userId);
}

/** The per-user kv caches that only speed up or fill screens; the server is their source of truth. */
const DISPLAY_CACHE_PREFIXES = ['closet.v1.', 'today.lucky.', 'forYou.ideas.', 'wears.v1.'] as const;

/**
 * Drops `userId`'s display caches (the closet with its signed URLs, Today's lists, the For you ideas,
 * the wear history) after an explicit sign-out, so the next person on a shared phone can't read
 * them, and refuses those keys until the account signs in again (`allowUserKeys`), so a request
 * still in flight can't write one back. The upload and wear queues, Logged ✓ and the purge requests
 * stay writable: they hold work not yet on the server.
 */
export function forgetDisplayCaches(userId: string): void {
  const keys = DISPLAY_CACHE_PREFIXES.map((prefix) => `${prefix}${userId}`);
  refuseKeys(keys);
  for (const key of keys) kvRemove(key);
}
