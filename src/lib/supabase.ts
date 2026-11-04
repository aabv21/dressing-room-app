import { createClient } from '@supabase/supabase-js';
import 'expo-sqlite/localStorage/install';
import { AppState } from 'react-native';

import type { Database } from './database.types';

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

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

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
