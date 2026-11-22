import type { SupabaseClient } from '@supabase/supabase-js';

import { clearPersistedAuth, readStoredSession, supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { toAuthErrorKey } from './errors';
import type { AuthErrorKey } from './errors';

export type Result = { ok: true } | { ok: false; error: AuthErrorKey };

/**
 * With email confirmations off (local dev), `signUp` returns a session that `AuthProvider` picks up.
 * With them on, there is no session until the link is clicked, so `needsConfirmation` makes the screen
 * show "check your email" instead of waiting with no feedback.
 */
export type SignUpResult = { ok: true; needsConfirmation: boolean } | { ok: false; error: AuthErrorKey };

export type Client = SupabaseClient<Database>;

/**
 * No Apple/Google imports (unlike `socialAuth.ts`), so this module loads under plain Node in the
 * `integration` Jest project. `client` defaults to the `supabase` singleton; tests pass their own.
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  client: Client = supabase,
): Promise<SignUpResult> {
  const { data, error } = await client.auth.signUp({ email, password });
  if (error !== null) {
    return { ok: false, error: toAuthErrorKey(error) };
  }
  return { ok: true, needsConfirmation: data.session === null };
}

export async function signInWithEmail(email: string, password: string, client: Client = supabase): Promise<Result> {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error !== null) {
    return { ok: false, error: toAuthErrorKey(error) };
  }
  return { ok: true };
}

/**
 * `{ ok: true }` for an unknown email (Supabase never reveals one) and for `over_email_send_rate_limit`
 * (a code was already sent recently); other failures, e.g. `over_request_rate_limit`, surface.
 * NOTE: hitting the hourly cap `[auth.rate_limit].email_sent` also reads as sent; upgrade: split on distinct codes.
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
 * A failed `updateUser` signs out locally (global would revoke other devices) so a retry starts clean.
 * NOTE: a kill mid-reset signs in without a new password (the code proved ownership); upgrade: flag it, sign out on launch.
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

async function signOutWithScope(client: Client, scope?: 'local'): Promise<Result> {
  try {
    const { error } = await (scope === undefined ? client.auth.signOut() : client.auth.signOut({ scope }));
    return error === null ? { ok: true } : { ok: false, error: toAuthErrorKey(error) };
  } catch (error) {
    return { ok: false, error: toAuthErrorKey(error) };
  }
}

/**
 * Global scope revokes the refresh tokens; offline it falls back to local. With an expired token
 * supabase-js gives up refreshing without clearing, so the stored session is deleted and the local
 * sign-out retried, which emits SIGNED_OUT (after up to ~30 s of refresh retries).
 * NOTE: the refresh token stays valid on the server until it expires; upgrade: retry the revoke on next sign-in. */
export async function signOut(client: Client = supabase, clearStoredAuth: () => void = clearPersistedAuth): Promise<Result> {
  const result = await signOutWithScope(client);
  if (result.ok || result.error !== 'auth.error.network') {
    return result;
  }
  const local = await signOutWithScope(client, 'local');
  if (local.ok || local.error !== 'auth.error.network') {
    return local;
  }
  clearStoredAuth();
  return signOutWithScope(client, 'local');
}

/**
 * Local sign-out after the account was deleted (Auth now rejects its tokens). Never fails: when
 * supabase-js can't finish, the stored session is deleted directly and the local sign-out retried.
 */
export async function signOutLocally(
  client: Client = supabase,
  clearStoredAuth: () => void = clearPersistedAuth,
): Promise<void> {
  const local = await signOutWithScope(client, 'local');
  if (local.ok) {
    return;
  }
  clearStoredAuth();
  await signOutWithScope(client, 'local');
}

/**
 * The stored session's user, read with no request. A deletion that outlives its screen checks it so it
 * never acts on another account that signed in meanwhile.
 */
export function storedSessionUserId(
  read: () => { userId: string } | null = readStoredSession,
): string | null {
  return read()?.userId ?? null;
}
