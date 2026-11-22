// Stores the caller's own Apple refresh token for `delete-account` (docs/database.md, "Account deletion and
// data export"). Past the caller check it answers 200; never returns or logs the code, token or Apple id.

import { type AppleTokens, exchangeCode, revokeToken } from '../_shared/apple.ts';
import type { AppleEnv, SupabaseEnv } from '../_shared/env.ts';
import { isRecord } from '../_shared/guards.ts';
import { callerOf, readJson, reply } from '../_shared/http.ts';
import { restJson, serviceHeaders, upsert } from '../_shared/userContext.ts';

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

const answer = (outcome: AppleTokenOutcome): Response => reply(outcome, 200, { outcome });

async function readCode(request: Request): Promise<string | null> {
  const body = await readJson(request);
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
  const caller = callerOf(request);
  if (caller === null) return reply('unauthorized', 401, { error: 'unauthorized' });
  const { userId } = caller;

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
