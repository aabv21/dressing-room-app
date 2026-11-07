import { createClient } from '@supabase/supabase-js';
import 'expo-sqlite/localStorage/install';
import { AppState } from 'react-native';

import { authStorageKeyFor, clearPersistedAuthIn, parseStoredSession } from './storedSession';
import type { StoredSession } from './storedSession';
import type { Database } from './database.types';
import { fetchWithTimeout } from './fetchWithTimeout';

// `expo-sqlite/localStorage/install` installs a SQLite-backed `localStorage` global (see
// expo-sqlite's `localStorage/install.js`) before `createClient` reads it below. The `localStorage`
// identifier itself comes from the DOM lib Expo's base tsconfig includes; there is no DOM here at
// runtime, but the shape matches what expo-sqlite installs.
//
// Expo inlines `process.env.EXPO_PUBLIC_*` at build time via static analysis, so these must be
// literal member expressions — a dynamic `process.env[name]` lookup would not be replaced and
// would read `undefined` at runtime. See AGENTS.md and the Expo env vars docs.
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
 * The persisted session's user, read straight from storage. supabase-js reports no session at
 * launch when an expired access token can't be refreshed for lack of network, although the session
 * is still stored and its refresh keeps being retried; this lets the app stay signed in meanwhile.
 */
export function readStoredSession(): StoredSession | null {
  return parseStoredSession(localStorage.getItem(authStorageKey));
}

/** Deletes this client's persisted session entries, for a sign-out supabase-js can't complete. */
export function clearPersistedAuth(): void {
  clearPersistedAuthIn(localStorage, authStorageKey);
}

/**
 * Ties Supabase's background token refresh to the app's foreground/background state, per
 * supabase-js's React Native guidance: refreshing while backgrounded wastes battery and can
 * throw once the refresh request outlives the app's background execution window.
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
