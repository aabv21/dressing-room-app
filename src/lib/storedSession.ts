import { isRecord } from '../../supabase/functions/_shared/guards.ts';
import { parseJson } from './kv';

export type StoredSession = { userId: string; email: string | null };

/**
 * Reads the session supabase-js persisted (its `sb-<ref>-auth-token` entry) without asking the
 * server. Only the user id and email are trusted from it, and only while it still holds a refresh
 * token: with one, supabase-js keeps retrying the refresh, and a rejected token removes the entry
 * and emits SIGNED_OUT.
 */
export function parseStoredSession(raw: string | null): StoredSession | null {
  const parsed = parseJson(raw, isRecord);
  if (parsed === null || typeof parsed['refresh_token'] !== 'string' || parsed['refresh_token'] === '') {
    return null;
  }
  const user = parsed['user'];
  if (!isRecord(user) || typeof user['id'] !== 'string' || user['id'] === '') {
    return null;
  }
  const email = user['email'];
  return { userId: user['id'], email: typeof email === 'string' ? email : null };
}

/** supabase-js's own default storage key for a project URL: `sb-<first host label>-auth-token`. */
export function authStorageKeyFor(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0] ?? ''}-auth-token`;
}

/**
 * Removes every entry supabase-js persists for a session under `storageKey` (the session, its
 * split-off user, and the PKCE code verifier), the same set its own sign-out removes.
 */
export function clearPersistedAuthIn(storage: { removeItem: (key: string) => void }, storageKey: string): void {
  for (const key of [storageKey, `${storageKey}-user`, `${storageKey}-code-verifier`]) {
    storage.removeItem(key);
  }
}
