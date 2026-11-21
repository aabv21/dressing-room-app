import { createClient } from '@supabase/supabase-js';
import 'expo-sqlite/localStorage/install';
import { AppState } from 'react-native';

import { authStorageKeyFor, clearPersistedAuthIn, parseStoredSession } from './storedSession';
import type { StoredSession } from './storedSession';
import type { Database } from './database.types';
import { fetchWithTimeout } from './fetchWithTimeout';

// `expo-sqlite/localStorage/install` installs a SQLite-backed `localStorage` before `createClient` reads
// it (typed by the DOM lib). Expo inlines only literal `process.env.EXPO_PUBLIC_*` member expressions.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (supabaseUrl === undefined) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL environment variable.');
}
if (supabaseAnonKey === undefined) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_ANON_KEY environment variable.');
}

// supabase-js's own default key, spelled out so `readStoredSession` and `clearPersistedAuth` use
// the same entries the client writes.
const authStorageKey = authStorageKeyFor(supabaseUrl);

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: localStorage,
    storageKey: authStorageKey,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: { fetch: fetchWithTimeout },
});

/**
 * Read straight from storage: offline with an expired token supabase-js reports no session at launch
 * while still storing it and retrying, so this keeps the app signed in meanwhile.
 */
export function readStoredSession(): StoredSession | null {
  return parseStoredSession(localStorage.getItem(authStorageKey));
}

/** Deletes this client's persisted session entries, for a sign-out supabase-js can't complete. */
export function clearPersistedAuth(): void {
  clearPersistedAuthIn(localStorage, authStorageKey);
}

/**
 * Refreshes tokens only in the foreground (supabase-js's React Native guidance): in the background it
 * wastes battery and can throw once the request outlives the background window.
 */
export function startAuthAutoRefresh(): () => void {
  const subscription = AppState.addEventListener('change', (status) => {
    if (status === 'active') {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  });
  return () => {
    subscription.remove();
  };
}
