// Deletes the caller's account; the steps (0–4) and why a retry is safe: docs/database.md,
// "Account deletion and data export". The uid is always the verified JWT's `sub`. Logs carry outcome words only.

import { revokeToken } from '../_shared/apple.ts';
import type { AppleEnv, SupabaseEnv } from '../_shared/env.ts';
import { isRecord } from '../_shared/guards.ts';
import { callerOf, fetchWithDeadline, reply } from '../_shared/http.ts';
import { listUserObjects, removeObjects } from '../_shared/photoStore.ts';
import { restRows, serviceHeaders, UpstreamError, userHeaders } from '../_shared/userContext.ts';

export type DeleteAccountDeps = { env: SupabaseEnv; apple: AppleEnv | null; fetch: typeof fetch; now?: () => number };

// This function's storage limits are the photo store's.
export { LIST_CONCURRENCY, LIST_PAGE, REMOVE_CHUNK } from '../_shared/photoStore.ts';

type Revoke = 'revoked' | 'revoke_failed' | 'no_token' | 'skipped';

/** Each Auth call, the body included. */
export const AUTH_TIMEOUT_MS = 10_000;

/**
 * False only on Auth's `user_not_found`. Throws on anything else, a bare 404 included (a misrouted
 * gateway answers 404 too), so nothing is reported deleted on an answer that can't be trusted.
 */
async function callerExists(env: SupabaseEnv, fetchFn: typeof fetch, auth: string, userId: string): Promise<boolean> {
  const response = await fetchWithDeadline(fetchFn, `${env.supabaseUrl}/auth/v1/user`, { headers: userHeaders(env, auth) }, AUTH_TIMEOUT_MS);
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
  const response = await fetchWithDeadline(
    fetchFn,
    `${env.supabaseUrl}/auth/v1/admin/users/${userId}`,
    { method: 'DELETE', headers: serviceHeaders(env) },
    AUTH_TIMEOUT_MS,
  );
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
  const caller = callerOf(request);
  if (caller === null) return reply('invalid', 401, { error: 'unauthorized' });
  const { auth, userId } = caller;

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
      return reply('already_deleted', 200, { outcome: 'deleted' }, { revoke });
    }
  } catch {
    return reply('error', 500, { error: 'internal' }, { revoke });
  }
  try {
    await sweepStorage(env, fetchFn, userId);
  } catch {
    // Best effort: the user is gone either way, and a retry (step 0) sweeps again.
  }
  return reply('deleted', 200, { outcome: 'deleted' }, { revoke });
}
