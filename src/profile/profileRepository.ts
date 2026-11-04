import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Tables } from '../lib/database.types';
import { supabase } from '../lib/supabase';

export type Profile = Tables<'profiles'>;

/**
 * Minimal profile read needed by `AuthProvider` to derive `onboardingComplete`. Task 6 extends
 * this module with the writes (`upsertProfile`, step-by-step onboarding saves) that build on this
 * read; keep this function's signature stable for that task to build on.
 */
export async function getProfile(userId: string, client: SupabaseClient<Database> = supabase): Promise<Profile | null> {
  const { data, error } = await client.from('profiles').select('*').eq('user_id', userId).maybeSingle();
  if (error !== null) {
    throw error;
  }
  return data;
}
