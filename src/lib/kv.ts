import Storage from 'expo-sqlite/kv-store';

/**
 * Synchronous key-value storage backed by `expo-sqlite/kv-store`'s SQLite-backed store. These
 * functions are the only intended callers of `expo-sqlite/kv-store` in this app — anything
 * that needs on-device persistence of small values (e.g. the locale preference) should go through
 * them rather than importing the store directly.
 */

export function kvGet(key: string): string | null {
  return Storage.getItemSync(key);
}

// Accounts whose device data was dropped (a deletion). A write to a key with one of their ids as
// a dot-separated segment is refused, so a request that resolves after the cleanup (a closet
// re-sign, For you, the lucky list, a logged wear) can't bring that data back.
const refusedUsers = new Set<string>();

export function kvSet(key: string, value: string): void {
  if (refusedUsers.size > 0 && key.split('.').some((segment) => refusedUsers.has(segment))) {
    return;
  }
  Storage.setItemSync(key, value);
}

/**
 * Refuses every later per-user write for `userId` (keys named `<name>.<userId>[.<more>]`, and the
 * writers that check `kvUserRefused`) until `allowUserKeys`. NOTE: kept in memory, so it lasts the
 * process: a deleted account can't sign in again, and the cleanup already removed what it had.
 */
export function refuseUserKeys(userId: string): void {
  refusedUsers.add(userId);
}

/** Lifts `refuseUserKeys`: that account signed in again, so it still exists. */
export function allowUserKeys(userId: string): void {
  refusedUsers.delete(userId);
}

export function kvUserRefused(userId: string): boolean {
  return refusedUsers.has(userId);
}

export function kvRemove(key: string): void {
  Storage.removeItemSync(key);
}

/** Every key in the store (account deletion uses it to find the per-user keys). */
export function kvKeys(): string[] {
  return Storage.getAllKeysSync();
}
