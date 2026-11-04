import type { SupabaseClient } from '@supabase/supabase-js';

import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { toAuthErrorKey } from './errors';
import type { AuthErrorKey } from './errors';

export type Result = { ok: true } | { ok: false; error: AuthErrorKey };

export type Client = SupabaseClient<Database>;

/**
 * Email/password and session functions only — no Apple/Google imports, so this module (unlike
 * `socialAuth.ts`) loads under plain Node once `integration/`'s `moduleNameMapper` (see
 * jest.config.ts) stubs out `../lib/supabase`'s native imports. Every function here defaults
 * `client` to the real `supabase` singleton — the production path screens use when they call these
 * functions with no client at all, the same pattern `src/profile/profileRepository.ts` uses;
 * `integration/*.int.test.ts` and every unit test instead pass an explicit client.
 */
export async function signUpWithEmail(email: string, password: string, client: Client = supabase): Promise<Result> {
  const { error } = await client.auth.signUp({ email, password });
  if (error !== null) {
    return { ok: false, error: toAuthErrorKey(error) };
  }
  return { ok: true };
}

export async function signInWithEmail(email: string, password: string, client: Client = supabase): Promise<Result> {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error !== null) {
    return { ok: false, error: toAuthErrorKey(error) };
  }
  return { ok: true };
}

/**
 * Always resolves `{ ok: true }` for an unknown email (Supabase's own `resetPasswordForEmail`
 * already behaves this way — it never reports whether the address has an account). Ruling P2-R6:
 * also `{ ok: true }` for `over_email_send_rate_limit` — that code means a code was already sent
 * recently, so the user already has what they need; a real failure (e.g. the broader
 * `over_request_rate_limit`, or network) is the only case this surfaces as an error.
 */
export async function requestPasswordReset(email: string, client: Client = supabase): Promise<Result> {
  const { error } = await client.auth.resetPasswordForEmail(email);
  const silencedCodes: ReadonlyArray<string | undefined> = ['user_not_found', 'over_email_send_rate_limit'];
  if (error !== null && !silencedCodes.includes(error.code)) {
    return { ok: false, error: toAuthErrorKey(error) };
  }
  return { ok: true };
}

/**
 * Ruling P2-R5: if `updateUser` fails after a successful `verifyOtp`, the client is left holding a
 * live recovery session the user never asked to keep. Signing out locally (this device only, not
 * `{ scope: 'global' }`, which would also revoke every other signed-in device) clears it so a
 * retry starts clean, and so `AuthProvider`'s `onAuthStateChange` doesn't see a session it should
 * treat as mid-reset forever.
 */
export async function confirmPasswordReset(
  email: string,
  code: string,
  newPassword: string,
  client: Client = supabase,
): Promise<Result> {
  const { error: verifyError } = await client.auth.verifyOtp({ email, token: code, type: 'recovery' });
  if (verifyError !== null) {
    return { ok: false, error: toAuthErrorKey(verifyError) };
  }

  const { error: updateError } = await client.auth.updateUser({ password: newPassword });
  if (updateError !== null) {
    await client.auth.signOut({ scope: 'local' });
    return { ok: false, error: toAuthErrorKey(updateError) };
  }
  return { ok: true };
}

export async function signOut(client: Client = supabase): Promise<Result> {
  const { error } = await client.auth.signOut();
  if (error !== null) {
    return { ok: false, error: toAuthErrorKey(error) };
  }
  return { ok: true };
}
