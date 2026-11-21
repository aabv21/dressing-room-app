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
 * Updates only `patch`'s columns; never an upsert, and reaching no row is an error
 * (docs/database.md#writing-a-profile-update-never-a-partial-upsert). A `null`
 * `onboarding_completed_at` is dropped, so no screen can reset a finished profile into onboarding.
 */
export async function saveProfile(userId: string, patch: ProfilePatch, client: Client = supabase): Promise<Result> {
  const { onboarding_completed_at: completedAt, ...rest } = patch;
  const columns = completedAt === null || completedAt === undefined ? rest : { ...rest, onboarding_completed_at: completedAt };
  return run(
    () => client.from('profiles').update(columns).eq('user_id', userId).select('user_id'),
    ({ data }) => Array.isArray(data) && data.length > 0,
  );
}

/** Stamped by the server clock, keeping a first completion (docs/database.md#onboarding-completion-clock). */
export async function completeOnboarding(userId: string, client: Client = supabase): Promise<Result> {
  return run(() =>
    client
      .from('profiles')
      .update({ onboarding_completed_at: 'now' })
      .eq('user_id', userId)
      .is('onboarding_completed_at', null),
  );
}
