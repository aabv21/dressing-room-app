import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Tables } from '../lib/database.types';
import { runRequest, type RequestError, type RequestOutcome } from '../lib/requestResult';
import { supabase } from '../lib/supabase';

export type Profile = Tables<'profiles'>;
export type ProfilePatch = Partial<Omit<Profile, 'user_id' | 'created_at' | 'updated_at'>>;

export type ProfileErrorKey = `profile.error.${RequestError}`;
export type Result = { ok: true } | { ok: false; error: ProfileErrorKey };

type Client = SupabaseClient<Database>;

async function run(
  request: () => PromiseLike<RequestOutcome>,
  applied?: (response: RequestOutcome) => boolean,
): Promise<Result> {
  const result = await runRequest(request, applied);
  return result.ok ? result : { ok: false, error: `profile.error.${result.error}` };
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
 * Updates only the columns present in `patch` on the user's existing row (the signup trigger
 * creates it). Never an upsert: Postgres checks an `INSERT … ON CONFLICT DO UPDATE`'s proposed
 * insert row against every CHECK constraint, so a partial patch (e.g. only `city_lat`) failed the
 * lat/lon pair check even though the stored row satisfies it. An update that reaches no row (one
 * this session can't see) is reported as an error rather than a silent success. Un-completing
 * onboarding is never a client action: a `null` `onboarding_completed_at` is dropped rather than
 * written, so no screen can reset a finished profile back into onboarding.
 */
export async function saveProfile(userId: string, patch: ProfilePatch, client: Client = supabase): Promise<Result> {
  const { onboarding_completed_at: completedAt, ...rest } = patch;
  const columns = completedAt === null || completedAt === undefined ? rest : { ...rest, onboarding_completed_at: completedAt };
  return run(
    () => client.from('profiles').update(columns).eq('user_id', userId).select('user_id'),
    ({ data }) => Array.isArray(data) && data.length > 0,
  );
}

/**
 * Marks onboarding complete with the server's clock: the `profiles_stamp_onboarding_completed_at`
 * trigger replaces any non-null value with `now()` (and `'now'` is also Postgres's own input
 * literal for the current time), so the device clock never reaches the row. The `is null` filter
 * (and the trigger) keep the original completion time if the profile was already complete, e.g.
 * onboarding shown again after a failed launch-time profile read.
 */
export async function completeOnboarding(userId: string, client: Client = supabase): Promise<Result> {
  return run(() =>
    client
      .from('profiles')
      .update({ onboarding_completed_at: 'now' })
      .eq('user_id', userId)
      .is('onboarding_completed_at', null),
  );
}
