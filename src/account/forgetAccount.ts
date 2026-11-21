import { forgetAccount } from '../auth/deviceState';
import { QUEUE_PURGE_PREFIX } from '../closet/upload/queuePurge';
import { kvKeys, kvRemove, refuseKeys, refuseUserKeys } from '../lib/kv';
import { cancelStoredReminder } from '../reminder/dailyReminder';

/**
 * Removes a deleted account's `<name>.<id>[.<more>]` kv keys and `deviceState` entries, refusing later
 * writes first so an in-flight request can't restore any. Device-wide settings and `queue.purge.<id>`
 * (removed once the queue provider carried it out) stay. The daily reminder is cancelled first, while
 * its id is still stored.
 */
export function forgetAccountOnDevice(userId: string): void {
  refuseUserKeys(userId);
  cancelStoredReminder(userId);
  for (const key of kvKeys()) {
    if (key.split('.').includes(userId) && !key.startsWith(QUEUE_PURGE_PREFIX)) {
      kvRemove(key);
    }
  }
  forgetAccount(userId);
}

/** The per-user kv caches that only speed up or fill screens; the server is their source of truth. */
const DISPLAY_CACHE_PREFIXES = ['closet.v1.', 'today.lucky.', 'forYou.ideas.', 'wears.v1.', 'outfits.saved.v1.'] as const;

/**
 * After an explicit sign-out, drops and refuses (until `allowUserKeys`) the display caches so the next
 * person on a shared phone can't read them. The queues, Logged ✓ and purge requests stay: unsent work.
 */
export function forgetDisplayCaches(userId: string): void {
  const keys = DISPLAY_CACHE_PREFIXES.map((prefix) => `${prefix}${userId}`);
  refuseKeys(keys);
  for (const key of keys) kvRemove(key);
}
