// signOutLocally against a REAL supabase-js client: once the account is deleted, Auth rejects the
// session's tokens, and the device must still end signed out with nothing left in storage.
jest.mock('../../lib/supabase', () => ({
  supabase: {},
  clearPersistedAuth: jest.fn(),
}));

import { createClient } from '@supabase/supabase-js';

import type { Database } from '../../lib/database.types';
import { authStorageKeyFor, clearPersistedAuthIn } from '../../lib/storedSession';
import { signOutLocally } from '../emailAuth';

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

function session(expiresAt: number) {
  return JSON.stringify({
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user: { id: 'user-1', email: 'ana@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
  });
}

function authError(status: number, code: string): Response {
  return new Response(JSON.stringify({ code: status, error_code: code, msg: code }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// auth-js logs each refused or failed refresh with console.warn; those are the cases under test.
beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function signOutWith(storedSession: string, fetchFn: jest.Mock) {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, storedSession);
  storage.setItem(`${STORAGE_KEY}-user`, '{}');
  const client = createClient<Database>(SUPABASE_URL, 'anon-key', {
    auth: { storage, storageKey: STORAGE_KEY, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false },
    global: { fetch: fetchFn },
  });
  const events: string[] = [];
  const { data } = client.auth.onAuthStateChange((event) => {
    events.push(event);
  });
  const clearStoredAuth = jest.fn(() => {
    clearPersistedAuthIn(storage, STORAGE_KEY);
  });
  await signOutLocally(client, clearStoredAuth);
  data.subscription.unsubscribe();
  return { storage, events, clearStoredAuth };
}

test('a valid token whose user is gone: Auth answers user_not_found and the device signs out', async () => {
  const fetchFn = jest.fn(() => Promise.resolve(authError(403, 'user_not_found')));

  const { storage, events } = await signOutWith(session(Math.floor(Date.now() / 1000) + 3600), fetchFn);

  expect(events).toContain('SIGNED_OUT');
  expect([...storage.items.keys()]).toEqual([]);
});

test('an expired token whose refresh token went with the user still ends signed out', async () => {
  const fetchFn = jest.fn(() => Promise.resolve(authError(400, 'refresh_token_not_found')));

  const { storage, events } = await signOutWith(session(Math.floor(Date.now() / 1000) - 3600), fetchFn);

  expect(events).toContain('SIGNED_OUT');
  expect([...storage.items.keys()]).toEqual([]);
});

test('offline, a sign-out supabase-js cannot finish clears the stored session directly', async () => {
  const fetchFn = jest.fn(() => Promise.reject(new TypeError('Network request failed')));

  // auth-js retries a refresh that fails for lack of network with backoff for up to 30 s.
  jest.useFakeTimers();
  let outcome: Awaited<ReturnType<typeof signOutWith>> | undefined;
  void signOutWith(session(Math.floor(Date.now() / 1000) - 3600), fetchFn).then((value) => {
    outcome = value;
  });
  for (let elapsed = 0; outcome === undefined && elapsed < 120_000; elapsed += 1_000) {
    await jest.advanceTimersByTimeAsync(1_000);
  }
  jest.useRealTimers();

  expect(outcome?.clearStoredAuth).toHaveBeenCalledTimes(1);
  expect(outcome?.events).toContain('SIGNED_OUT');
  expect([...(outcome?.storage.items.keys() ?? ['unfinished'])]).toEqual([]);
});
