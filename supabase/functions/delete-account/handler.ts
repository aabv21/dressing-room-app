// The `delete-account` Edge Function's request handler: deletes the signed-in caller's account.
//   0. The caller is confirmed with `GET /auth/v1/user` and the caller's own token (the gateway has
//      verified the JWT; this makes sure Auth still knows the user before anything irreversible).
//      An unknown user means a previous attempt already finished: `deleted`, touching nothing.
//   1. Every object under `garments/{uid}/` is listed (1000 entries per page, the garment folders
//      `LIST_CONCURRENCY` at a time), and only then removed, 1000 paths per call.
//   2. The stored Apple refresh token, if there is one, is revoked with Apple. A failed revoke (or a
//      failed read of the token row) never blocks the deletion.
//   3. The auth user is deleted (`DELETE /auth/v1/admin/users/{id}`); every public table cascades
//      from `auth.users`, `apple_tokens` included.
// Steps 1–3 use the service role. Safe to retry: a failure in step 0, 1 or 3 answers 500 with the
// user still there, so a retry starts over with whatever is left; once the user is gone, a retry
// (the caller's token is still valid until it expires) stops at step 0 and answers `deleted`.
// Runtime-neutral: every effect goes through the injected `fetch`, so Jest drives it under Node and
// `index.ts` serves it under Deno. Logs carry only outcome words.

import { type AppleEnv, revokeToken } from '../_shared/apple.ts';
import { isRecord } from '../_shared/extraction.ts';
import {
  mapLimit,
  restJson,
  restRows,
  serviceHeaders,
  type SupabaseEnv,
  UpstreamError,
  userHeaders,
  userIdFromJwt,
} from '../_shared/userContext.ts';

export type DeleteAccountDeps = { env: SupabaseEnv; apple: AppleEnv | null; fetch: typeof fetch; now?: () => number };

const BUCKET = 'garments';
/** Storage's list page size and the most paths one remove call takes. */
export const LIST_PAGE = 1000;
export const REMOVE_CHUNK = 1000;
/** At most this many folder listings in flight at once. */
export const LIST_CONCURRENCY = 5;

type Revoke = 'revoked' | 'revoke_failed' | 'no_token' | 'skipped';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function reply(outcome: string, status: number, body: unknown, revoke?: Revoke): Response {
  console.info(JSON.stringify(revoke === undefined ? { outcome } : { outcome, revoke }));
  return json(status, body);
}

/** The entries one level under `prefix` (which ends in `/`): files by path, folders by their own prefix. */
async function listLevel(
  env: SupabaseEnv,
  fetchFn: typeof fetch,
  prefix: string,
): Promise<{ files: string[]; folders: string[] }> {
  const files: string[] = [];
  const folders: string[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const page = await restJson(fetchFn, `${env.supabaseUrl}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { ...serviceHeaders(env), 'content-type': 'application/json' },
      body: JSON.stringify({ prefix, limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!Array.isArray(page)) throw new UpstreamError('storage list: not an array');
    for (const entry of page as unknown[]) {
      if (!isRecord(entry) || typeof entry.name !== 'string' || entry.name === '' || entry.name.includes('/')) {
        throw new UpstreamError('storage list: unexpected entry');
      }
      if (entry.id === null) folders.push(`${prefix}${entry.name}/`);
      else files.push(`${prefix}${entry.name}`);
    }
    if (page.length < LIST_PAGE) return { files, folders };
  }
}

/**
 * Every object path under `prefix`. Storage's list answers one level at a time, a folder with a
 * null `id`, so each level is paged until a short page and its folders are listed
 * `LIST_CONCURRENCY` at a time.
 */
async function listObjects(env: SupabaseEnv, fetchFn: typeof fetch, prefix: string): Promise<string[]> {
  const { files, folders } = await listLevel(env, fetchFn, prefix);
  const nested = await mapLimit(folders, LIST_CONCURRENCY, (folder) => listObjects(env, fetchFn, folder));
  return [...files, ...nested.flat()];
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

async function removeObjects(env: SupabaseEnv, fetchFn: typeof fetch, paths: readonly string[]): Promise<void> {
  for (let start = 0; start < paths.length; start += REMOVE_CHUNK) {
    const response = await fetchFn(`${env.supabaseUrl}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: { ...serviceHeaders(env), 'content-type': 'application/json' },
      body: JSON.stringify({ prefixes: paths.slice(start, start + REMOVE_CHUNK) }),
    });
    if (!response.ok) throw new UpstreamError(`storage remove: HTTP ${String(response.status)}`);
  }
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

/** Deletes the auth user; a 404 means a previous attempt already did. */
async function deleteUser(env: SupabaseEnv, fetchFn: typeof fetch, userId: string): Promise<void> {
  const response = await fetchFn(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: serviceHeaders(env),
  });
  if (!response.ok && response.status !== 404) throw new UpstreamError(`admin delete: HTTP ${String(response.status)}`);
}

export async function handleDeleteAccount(request: Request, deps: DeleteAccountDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  const auth = request.headers.get('authorization');
  const userId = userIdFromJwt(auth);
  if (auth === null || userId === null) return reply('invalid', 401, { error: 'unauthorized' });

  const { env, fetch: fetchFn } = deps;
  try {
    if (!(await callerExists(env, fetchFn, auth, userId))) return reply('already_deleted', 200, { outcome: 'deleted' });
  } catch {
    return reply('error', 500, { error: 'internal' });
  }
  try {
    await removeObjects(env, fetchFn, await listObjects(env, fetchFn, `${userId}/`));
  } catch {
    return reply('error', 500, { error: 'internal' });
  }
  const revoke = await revokeApple(deps, userId, now());
  try {
    await deleteUser(env, fetchFn, userId);
  } catch {
    return reply('error', 500, { error: 'internal' }, revoke);
  }
  return reply('deleted', 200, { outcome: 'deleted' }, revoke);
}
