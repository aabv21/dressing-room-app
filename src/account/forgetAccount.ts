import { forgetAccount } from '../auth/deviceState';
import { kvKeys, kvRemove } from '../lib/kv';

/**
 * Removes what this device keeps for a deleted account: every kv entry keyed by the user's id
 * (`closet.v1.<id>`, `outfit.worn.<id>`, `today.lucky.<id>`, `forYou.ideas.<id>`, each day's
 * `today.occasion.<id>.<date>`, and any later key that follows the same `<name>.<id>[.<more>]`
 * convention), plus the onboarding status and pending language save kept for offline launches.
 * Device-wide settings (the language preference) stay.
 */
export function forgetAccountOnDevice(userId: string): void {
  for (const key of kvKeys()) {
    if (key.split('.').includes(userId)) {
      kvRemove(key);
    }
  }
  forgetAccount(userId);
}
