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

export function kvSet(key: string, value: string): void {
  Storage.setItemSync(key, value);
}

export function kvRemove(key: string): void {
  Storage.removeItemSync(key);
}

/** Every key in the store (account deletion uses it to find the per-user keys). */
export function kvKeys(): string[] {
  return Storage.getAllKeysSync();
}
