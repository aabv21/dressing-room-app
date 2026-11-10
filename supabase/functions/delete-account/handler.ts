// The `delete-account` Edge Function's request handler: deletes the signed-in caller's account.
//   0. The caller is confirmed with `GET /auth/v1/user` and the caller's own token (the gateway has
//      verified the JWT; this makes sure Auth still knows the user before anything irreversible).
//      An unknown user means a previous attempt already finished: the `{uid}/` folder is swept
//      once more (a photo the app uploaded while that attempt's answer was lost), then `deleted`.
//   1. Every object under `garments/{uid}/` is listed (1000 entries per page, the garment folders
//      `LIST_CONCURRENCY` at a time), and only then removed, 1000 paths per call; both go through
//      `_shared/photoStore.ts`.
//   2. The stored Apple refresh token, if there is one, is revoked with Apple. A failed revoke (or a
//      failed read of the token row) never blocks the deletion.
//   3. The auth user is deleted (`DELETE /auth/v1/admin/users/{id}`); every public table cascades
//      from `auth.users`, `apple_tokens` included. A 404 means a concurrent attempt deleted it
//      first, so the folder is swept again, as in step 0.
//   4. Once this call has deleted the user, the folder is swept one last time, best effort: another
//      device (or a token that is still valid) can upload between steps 1 and 3, because the
//      storage insert policy only checks the folder's uid. A failed sweep never changes the answer.
// Steps 1–4 use the service role. Safe to retry: a failure in step 0, 1 or 3 answers 500 with the
// user still there, so a retry starts over with whatever is left; once the user is gone, a retry
// (the caller's token is still valid until it expires) sweeps the folder at step 0 and answers
// `deleted`. The uid is always the verified JWT's `sub`, never anything from the request body.
// Runtime-neutral: every effect goes through the injected `fetch`, so Jest drives it under Node and
// `index.ts` serves it under Deno. Logs carry only outcome words.

import { type AppleEnv, revokeToken } from '../_shared/apple.ts';
import { isRecord } from '../_shared/extraction.ts';
import { listUserObjects, removeObjects } from '../_shared/photoStore.ts';
import {
  restRows,
  serviceHeaders,
  type SupabaseEnv,
  UpstreamError,
  userHeaders,
  userIdFromJwt,
} from '../_shared/userContext.ts';

export type DeleteAccountDeps = { env: SupabaseEnv; apple: AppleEnv | null; fetch: typeof fetch; now?: () => number };

// This function's storage limits are the photo store's.
export { LIST_CONCURRENCY, LIST_PAGE, REMOVE_CHUNK } from '../_shared/photoStore.ts';

type Revoke = 'revoked' | 'revoke_failed' | 'no_token' | 'skipped';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function reply(outcome: string, status: number, body: unknown, revoke?: Revoke): Response {
  console.info(JSON.stringify(revoke === undefined ? { outcome } : { outcome, revoke }));
  return json(status, body);
}

/**
 * Whether Auth still knows the caller, asked with the caller's own token: true for the token's
 * user, false only when Auth says the user doesn't exist (`error_code: 'user_not_found'`). Throws on
 * anything else, a bare 404 included (a misrouted gateway answers 404 too), so nothing is reported
 * deleted on an answer that can't be trusted.
 */
async function callerExists(env: SupabaseEnv, fetchFn: typeof fetch, auth: string, userId: string): Promise<boolean> {
  const response = await fetchFn(`${env.supabaseUrl}/auth/v1/user`, { headers: userHeaders(env, auth) });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (isRecord(body) && body.error_code === 'user_not_found') return false;
  if (!response.ok) throw new UpstreamError(`auth user: HTTP ${String(response.status)}`);
  if (!isRecord(body) || typeof body.id !== 'string' || body.id.toLowerCase() !== userId) {
    throw new UpstreamError('auth user: not the caller');
  }
  return true;
}

/** Revokes the caller's stored Apple token; never throws, so the deletion always goes on. */
async function revokeApple(deps: DeleteAccountDeps, userId: string, now: number): Promise<Revoke> {
  if (deps.apple === null) return 'skipped';
  let refreshToken: unknown;
  try {
    const [row] = await restRows(
      deps.fetch,
      `${deps.env.supabaseUrl}/rest/v1/apple_tokens?select=refresh_token&user_id=eq.${userId}`,
      serviceHeaders(deps.env),
    );
    refreshToken = isRecord(row) ? row.refresh_token : undefined;
  } catch {
    return 'revoke_failed';
  }
  if (typeof refreshToken !== 'string' || refreshToken === '') return 'no_token';
  return (await revokeToken(deps.apple, deps.fetch, refreshToken, now)) ? 'revoked' : 'revoke_failed';
}

/** Deletes the auth user: true when this call deleted it, false on a 404 (an earlier attempt did). */
async function deleteUser(env: SupabaseEnv, fetchFn: typeof fetch, userId: string): Promise<boolean> {
  const response = await fetchFn(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: serviceHeaders(env),
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new UpstreamError(`admin delete: HTTP ${String(response.status)}`);
  return true;
}

/** Lists and removes every object under `{uid}/`. */
async function sweepStorage(env: SupabaseEnv, fetchFn: typeof fetch, userId: string): Promise<void> {
  await removeObjects(env, fetchFn, await listUserObjects(env, fetchFn, userId));
}

export async function handleDeleteAccount(request: Request, deps: DeleteAccountDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  const auth = request.headers.get('authorization');
  const userId = userIdFromJwt(auth);
  if (auth === null || userId === null) return reply('invalid', 401, { error: 'unauthorized' });

  const { env, fetch: fetchFn } = deps;
  try {
    if (!(await callerExists(env, fetchFn, auth, userId))) {
      await sweepStorage(env, fetchFn, userId);
      return reply('already_deleted', 200, { outcome: 'deleted' });
    }
  } catch {
    return reply('error', 500, { error: 'internal' });
  }
  try {
    await sweepStorage(env, fetchFn, userId);
  } catch {
    return reply('error', 500, { error: 'internal' });
  }
  const revoke = await revokeApple(deps, userId, now());
  try {
    if (!(await deleteUser(env, fetchFn, userId))) {
      await sweepStorage(env, fetchFn, userId);
      return reply('already_deleted', 200, { outcome: 'deleted' }, revoke);
    }
  } catch {
    return reply('error', 500, { error: 'internal' }, revoke);
  }
  try {
    await sweepStorage(env, fetchFn, userId);
  } catch {
    // Best effort: the user is gone either way, and a retry (step 0) sweeps again.
  }
  return reply('deleted', 200, { outcome: 'deleted' }, revoke);
}
