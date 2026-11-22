import Storage from 'expo-sqlite/kv-store';

/** The app's only `expo-sqlite/kv-store` caller: small on-device values go through these. */

export function kvGet(key: string): string | null {
  return Storage.getItemSync(key);
}

/** `raw` parsed as JSON when it passes `guard`; null when absent, unreadable or of another shape. */
export function parseJson<T>(raw: string | null, guard: (value: unknown) => value is T): T | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return guard(value) ? value : null;
}

/** The value stored under `key`, read like `parseJson`. */
export function kvGetJson<T>(key: string, guard: (value: unknown) => value is T): T | null {
  return parseJson(kvGet(key), guard);
}

// Accounts whose data was dropped (a deletion): a key with their id as a segment is refused, so a
// request resolving after the cleanup (a closet re-sign, For you, a logged wear) can't bring it back.
const refusedUsers = new Set<string>();
// Single keys refused after an explicit sign-out (an account's display caches), so a request that
// resolves after the sign-out can't write them back for the next person on the phone.
const refusedKeys = new Set<string>();

export function kvSet(key: string, value: string): void {
  if (refusedKeys.has(key)) {
    return;
  }
  if (refusedUsers.size > 0 && key.split('.').some((segment) => refusedUsers.has(segment))) {
    return;
  }
  Storage.setItemSync(key, value);
}

/** Refuses later writes to exactly these keys until `allowUserKeys` lifts the account they name. */
export function refuseKeys(keys: readonly string[]): void {
  for (const key of keys) refusedKeys.add(key);
}

/**
 * Refuses `<name>.<userId>[.<more>]` writes (and `kvUserRefused` checkers) until `allowUserKeys`.
 * NOTE: in memory, so it lasts the process: enough, since a deleted account can't sign in again.
 */
export function refuseUserKeys(userId: string): void {
  refusedUsers.add(userId);
}

/** Lifts `refuseUserKeys` and `refuseKeys` for `userId`: that account signed in again, so it still exists. */
export function allowUserKeys(userId: string): void {
  refusedUsers.delete(userId);
  for (const key of refusedKeys) {
    if (key.split('.').includes(userId)) refusedKeys.delete(key);
  }
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
