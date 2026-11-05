import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Tables } from '../lib/database.types';
import { supabase } from '../lib/supabase';

export type Profile = Tables<'profiles'>;
export type ProfilePatch = Partial<Omit<Profile, 'user_id' | 'created_at' | 'updated_at'>>;

export type ProfileErrorKey = 'profile.error.network' | 'profile.error.invalid' | 'profile.error.unknown';
export type Result = { ok: true } | { ok: false; error: ProfileErrorKey };

type Client = SupabaseClient<Database>;
type PostgrestLikeError = { code?: string };

/**
 * Postgres error classes that mean "the values were rejected" rather than "the request failed":
 * 23514 check_violation (the CHECK ranges), 23502 not_null_violation, 22P02 invalid enum/number
 * text, 22003 numeric out of range, 22001 string too long.
 */
const INVALID_VALUE_CODES: ReadonlySet<string> = new Set(['23514', '23502', '22P02', '22003', '22001']);

function toProfileErrorKey(error: PostgrestLikeError, status: number): ProfileErrorKey {
  // postgrest-js reports a rejected `fetch` (offline, DNS, timeout) as status 0 with an empty code.
  if (status === 0) {
    return 'profile.error.network';
  }
  if (error.code !== undefined && INVALID_VALUE_CODES.has(error.code)) {
    return 'profile.error.invalid';
  }
  return 'profile.error.unknown';
}

async function run(request: PromiseLike<{ error: PostgrestLikeError | null; status: number }>): Promise<Result> {
  try {
    const { error, status } = await request;
    if (error !== null) {
      return { ok: false, error: toProfileErrorKey(error, status) };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof TypeError ? 'profile.error.network' : 'profile.error.unknown' };
  }
}

/** Reads the signed-in user's profile row (RLS limits it to their own); `null` if there is none. */
export async function getProfile(userId: string, client: Client = supabase): Promise<Profile | null> {
  const { data, error } = await client.from('profiles').select('*').eq('user_id', userId).maybeSingle();
  if (error !== null) {
    throw error;
  }
  return data;
}

/**
 * Upserts only the columns present in `patch` (PostgREST merges on conflict, so absent columns keep
 * their saved values). Un-completing onboarding is never a client action: a `null`
 * `onboarding_completed_at` is dropped rather than written, so no screen can reset a finished
 * profile back into onboarding (P2 binding item a).
 */
export async function saveProfile(userId: string, patch: ProfilePatch, client: Client = supabase): Promise<Result> {
  const { onboarding_completed_at: completedAt, ...rest } = patch;
  const row = completedAt === null || completedAt === undefined ? rest : { ...rest, onboarding_completed_at: completedAt };
  return run(client.from('profiles').upsert({ user_id: userId, ...row }, { onConflict: 'user_id' }));
}

/**
 * Marks onboarding complete with the server's clock: the `profiles_stamp_onboarding_completed_at`
 * trigger replaces any non-null value with `now()` (and `'now'` is also Postgres's own input
 * literal for the current time), so the device clock never reaches the row. The `is null` filter
 * (and the trigger) keep the original completion time if the profile was already complete, e.g.
 * onboarding shown again after a failed launch-time profile read.
 */
export async function completeOnboarding(userId: string, client: Client = supabase): Promise<Result> {
  return run(
    client
      .from('profiles')
      .update({ onboarding_completed_at: 'now' })
      .eq('user_id', userId)
      .is('onboarding_completed_at', null),
  );
}
