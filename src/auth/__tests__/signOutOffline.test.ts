// signOut against a REAL supabase-js client (not a fake): an offline launch restores a session
// whose access token has expired, and auth-js then fails both the global and the local sign-out
// with a retryable fetch error (it tries to refresh first and keeps the session). The user must
// still end up signed out, with nothing left in storage for the next launch to restore.
jest.mock('../../lib/supabase', () => ({
  supabase: {},
  clearPersistedAuth: jest.fn(),
}));

import { createClient } from '@supabase/supabase-js';

import type { Database } from '../../lib/database.types';
import { authStorageKeyFor, clearPersistedAuthIn, parseStoredSession } from '../../lib/storedSession';
import { signOut } from '../emailAuth';

const SUPABASE_URL = 'http://127.0.0.1:54421';
const STORAGE_KEY = authStorageKeyFor(SUPABASE_URL);

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string): string | null => items.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      items.set(key, value);
    },
    removeItem: (key: string): void => {
      items.delete(key);
    },
  };
}

function expiredSession() {
  const expiredAt = Math.floor(Date.now() / 1000) - 3600;
  return JSON.stringify({
    access_token: 'expired-access-token',
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiredAt,
    user: { id: 'user-1', email: 'ana@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
  });
}

test('offline, with an expired stored session, sign-out still signs out and clears storage', async () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, expiredSession());
  storage.setItem(`${STORAGE_KEY}-user`, '{}');
  storage.setItem(`${STORAGE_KEY}-code-verifier`, 'verifier');
  const offlineFetch = jest.fn(() => Promise.reject(new TypeError('Network request failed')));
  const client = createClient<Database>(SUPABASE_URL, 'anon-key', {
    auth: { storage, storageKey: STORAGE_KEY, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false },
    global: { fetch: offlineFetch },
  });
  const events: string[] = [];
  const { data } = client.auth.onAuthStateChange((event) => {
    events.push(event);
  });
  // The launch state the app restores from (see AuthProvider's INITIAL_SESSION branch).
  expect(parseStoredSession(storage.getItem(STORAGE_KEY))).toEqual({ userId: 'user-1', email: 'ana@example.com' });

  // auth-js retries a refresh that fails for lack of network with backoff for up to 30 s.
  jest.useFakeTimers();
  let result: Awaited<ReturnType<typeof signOut>> | undefined;
  void signOut(client, () => {
    clearPersistedAuthIn(storage, STORAGE_KEY);
  }).then((outcome) => {
    result = outcome;
  });
  for (let elapsed = 0; result === undefined && elapsed < 120_000; elapsed += 1_000) {
    await jest.advanceTimersByTimeAsync(1_000);
  }
  jest.useRealTimers();

  expect(result).toEqual({ ok: true });
  expect(events).toContain('SIGNED_OUT');
  expect([...storage.items.keys()]).toEqual([]);
  expect(offlineFetch).toHaveBeenCalled();
  data.subscription.unsubscribe();
});

test('clearPersistedAuthIn removes the session, its user entry and the PKCE verifier only', () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, 'session');
  storage.setItem(`${STORAGE_KEY}-user`, 'user');
  storage.setItem(`${STORAGE_KEY}-code-verifier`, 'verifier');
  storage.setItem('locale-preference', 'es');

  clearPersistedAuthIn(storage, STORAGE_KEY);

  expect([...storage.items.keys()]).toEqual(['locale-preference']);
});

test("authStorageKeyFor matches supabase-js's default key", () => {
  expect(authStorageKeyFor('http://127.0.0.1:54421')).toBe('sb-127-auth-token');
  expect(authStorageKeyFor('https://abcd1234.supabase.co')).toBe('sb-abcd1234-auth-token');
});
