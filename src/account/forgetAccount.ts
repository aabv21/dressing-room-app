import { forgetAccount } from '../auth/deviceState';
import { QUEUE_PURGE_PREFIX } from '../closet/upload/queuePurge';
import { kvKeys, kvRemove, refuseUserKeys } from '../lib/kv';

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
