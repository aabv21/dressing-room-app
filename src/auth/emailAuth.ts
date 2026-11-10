import type { SupabaseClient } from '@supabase/supabase-js';

import { clearPersistedAuth, supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { toAuthErrorKey } from './errors';
import type { AuthErrorKey } from './errors';

export type Result = { ok: true } | { ok: false; error: AuthErrorKey };

/**
 * Sign-up's own result additionally reports whether a session was issued. Local dev and v1 run
 * with `enable_confirmations = false`, so `signUp` returns a session immediately and
 * `needsConfirmation` is `false` — `AuthProvider`'s `onAuthStateChange` picks up the new session
 * and the root guard navigates on its own. Once confirmations are turned on (the integration
 * session), `data.session` comes back `null` until the user clicks the confirmation
 * link, so `needsConfirmation: true` tells the screen to show a "check your email" message instead
 * of sitting there with no feedback and no session to react to.
 */
export type SignUpResult = { ok: true; needsConfirmation: boolean } | { ok: false; error: AuthErrorKey };

export type Client = SupabaseClient<Database>;

/**
 * Email/password and session functions only — no Apple/Google imports, so this module (unlike
 * `socialAuth.ts`) loads under plain Node once `integration/`'s `moduleNameMapper` (see
 * jest.config.ts) stubs out `../lib/supabase`'s native imports. Every function here defaults
 * `client` to the real `supabase` singleton — the production path screens use when they call these
 * functions with no client at all, the same pattern `src/profile/profileRepository.ts` uses;
 * `integration/*.int.test.ts` and every unit test instead pass an explicit client.
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
 * Always resolves `{ ok: true }` for an unknown email (Supabase's own `resetPasswordForEmail`
 * already behaves this way — it never reports whether the address has an account). Also
 * `{ ok: true }` for `over_email_send_rate_limit` — that code means a code was already sent
 * recently, so the user already has what they need; a real failure (e.g. the broader
 * `over_request_rate_limit`, or network) is the only case this surfaces as an error. NOTE: GoTrue
 * sends the same code when the project-wide hourly email cap is hit, which this also reports as
 * sent; the ceiling is `[auth.rate_limit].email_sent` (see supabase/config.toml), so the hosted
 * project needs a generous cap. Upgrade path: tell the two apart if GoTrue ever gives them
 * different codes.
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
 * If `updateUser` fails after a successful `verifyOtp`, the client is left holding a live recovery
 * session the user never asked to keep. Signing out locally (this device only, not
 * `{ scope: 'global' }`, which would also revoke every other signed-in device) clears it so a
 * retry starts clean, and so `AuthProvider`'s `onAuthStateChange` doesn't see a session it should
 * treat as mid-reset forever. NOTE: if the app is killed between `verifyOtp` and `updateUser`, the
 * recovery session is already stored and the next launch signs the user in without a new password;
 * accepted, because the valid code already proved they own the email. Upgrade path: mark the reset
 * as pending on the device and sign out on launch while it is.
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
 * Signs out with supabase-js's default `global` scope, which also revokes the server-side refresh
 * tokens. Offline, that server call can't happen, so it falls back to `{ scope: 'local' }`, which
 * only clears this device's session: the user still gets signed out here.
 *
 * The local sign-out can fail offline too: with an expired access token (e.g. a session restored
 * on an offline launch), supabase-js first tries to refresh it, gets a network error and gives up
 * without clearing anything. Then the persisted session entries are deleted directly
 * (`clearStoredAuth`) and the local sign-out runs again: finding no session, supabase-js clears its
 * state and emits SIGNED_OUT. Offline that takes up to ~30 s (supabase-js's refresh retries).
 *
 * NOTE: the refresh token then stays valid on the server until it expires; upgrade path: retry the
 * revoke on the next sign-in if that ever matters. Any other failure is returned so the screen can
 * show it.
 */
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
