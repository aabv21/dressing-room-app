// The `apple-token` Edge Function's request handler. Right after Sign in with Apple the app sends
// the credential's one-time `authorizationCode`; this exchanges it at Apple's `/auth/token` for a
// refresh token and stores it in `public.apple_tokens` (service role), so `delete-account` can
// revoke it. `signInWithIdToken` keeps no Apple refresh token, which is why this exists.
// Runtime-neutral: every effect goes through the injected `fetch`, so Jest drives it under Node and
// `index.ts` serves it under Deno.
//
// The token is bound to the caller: it's stored only when the exchange's id_token (issued by Apple
// for this app) names the Apple user linked to the caller's account (`auth.identities`, read with the
// service role). Otherwise nothing is stored and the new token is revoked, best effort, so a code
// from someone else's sign-in can't park their token under this account.
//
// The app fires this and forgets it, so everything past the caller check answers 200 with an
// outcome word. The response and the logs never carry the code, the token or the Apple user id.

import { type AppleEnv, type AppleTokens, exchangeCode, revokeToken } from '../_shared/apple.ts';
import { isRecord } from '../_shared/extraction.ts';
import { restJson, serviceHeaders, type SupabaseEnv, upsert, userIdFromJwt } from '../_shared/userContext.ts';

export type AppleTokenDeps = { env: SupabaseEnv; apple: AppleEnv | null; fetch: typeof fetch; now?: () => number };

export type AppleTokenOutcome =
  | 'stored'
  | 'skipped'
  | 'invalid'
  | 'exchange_failed'
  | 'identity_mismatch'
  | 'lookup_failed'
  | 'store_failed';

/** Apple's authorization codes are short; anything far longer isn't one. */
const MAX_CODE_LENGTH = 2048;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function reply(outcome: AppleTokenOutcome | 'unauthorized' | 'method_not_allowed', status: number, body: unknown): Response {
  console.info(JSON.stringify({ outcome }));
  return json(status, body);
}

const answer = (outcome: AppleTokenOutcome): Response => reply(outcome, 200, { outcome });

async function readCode(request: Request): Promise<string | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (!isRecord(body) || typeof body.code !== 'string') return null;
  const code = body.code.trim();
  return code === '' || code.length > MAX_CODE_LENGTH ? null : code;
}

/**
 * The caller's Apple user ids (`auth.identities` rows with provider `apple`; GoTrue's `id` is the
 * provider's user id), read with the service role. Throws when the read fails or isn't the caller.
 */
async function appleIdentities(env: SupabaseEnv, fetchFn: typeof fetch, userId: string): Promise<string[]> {
  const user = await restJson(fetchFn, `${env.supabaseUrl}/auth/v1/admin/users/${userId}`, { headers: serviceHeaders(env) });
  if (!isRecord(user) || typeof user.id !== 'string' || user.id.toLowerCase() !== userId || !Array.isArray(user.identities)) {
    throw new Error('admin user: unexpected answer');
  }
  return (user.identities as unknown[]).flatMap((identity) =>
    isRecord(identity) && identity.provider === 'apple' && typeof identity.id === 'string' ? [identity.id] : [],
  );
}

/** Whether `subject` is one of the caller's Apple identities; null when they can't be read. */
async function belongsToCaller(
  env: SupabaseEnv,
  fetchFn: typeof fetch,
  userId: string,
  subject: string | null,
): Promise<boolean | null> {
  try {
    const identities = await appleIdentities(env, fetchFn, userId);
    return subject !== null && identities.includes(subject);
  } catch {
    return null;
  }
}

/** Stores the token when it's the caller's own Apple user's; the outcome either way. */
async function keepIfOwned(
  env: SupabaseEnv,
  fetchFn: typeof fetch,
  userId: string,
  tokens: AppleTokens,
): Promise<AppleTokenOutcome> {
  const owned = await belongsToCaller(env, fetchFn, userId, tokens.subject);
  if (owned === null) return 'lookup_failed';
  if (!owned) return 'identity_mismatch';
  const stored = await upsert(env, fetchFn, 'apple_tokens', { user_id: userId, refresh_token: tokens.refreshToken });
  return stored ? 'stored' : 'store_failed';
}

export async function handleAppleToken(request: Request, deps: AppleTokenDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  if (request.method !== 'POST') return reply('method_not_allowed', 405, { error: 'method_not_allowed' });
  const userId = userIdFromJwt(request.headers.get('authorization'));
  if (userId === null) return reply('unauthorized', 401, { error: 'unauthorized' });

  const code = await readCode(request);
  if (code === null) return answer('invalid');
  if (deps.apple === null) return answer('skipped');

  const { apple, env, fetch: fetchFn } = deps;
  const tokens = await exchangeCode(apple, fetchFn, code, now());
  if (tokens === null) return answer('exchange_failed');
  const outcome = await keepIfOwned(env, fetchFn, userId, tokens);
  // A token this account doesn't keep shouldn't stay live with Apple; a failed revoke changes nothing.
  if (outcome !== 'stored') await revokeToken(apple, fetchFn, tokens.refreshToken, now());
  return answer(outcome);
}
