// Deletes every push_tokens row holding one token, with no session needed: a phone that signed out
// offline retries here (docs/api.md#push-unregister). Logs only an outcome word.

import type { ServiceEnv } from '../_shared/env.ts';
import { isRecord } from '../_shared/guards.ts';
import { reply } from '../_shared/http.ts';
import { deleteTokens } from '../_shared/push.ts';

export type PushUnregisterDeps = { env: ServiceEnv; fetch: typeof fetch };

/** One token's JSON is well under this; anything bigger is refused unread. */
export const MAX_BODY_BYTES = 1024;

// The same shape and cap as push_tokens' check constraint.
const TOKEN = /^(ExponentPushToken|ExpoPushToken)\[.+\]$/;
const MAX_TOKEN_LENGTH = 255;

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return 'too_large';
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

// NOTE: knowing a token is enough to unregister it, the same trust as registering one; upgrade: a signed per-device secret, if tokens ever leak.
export async function handlePushUnregister(request: Request, deps: PushUnregisterDeps): Promise<Response> {
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return reply('invalid', 413, { error: 'payload_too_large' });
  const body = await readBody(request);
  if (body === 'too_large') return reply('invalid', 413, { error: 'payload_too_large' });
  if (!isRecord(body) || typeof body.token !== 'string' || body.token.length > MAX_TOKEN_LENGTH || !TOKEN.test(body.token)) {
    return reply('invalid', 400, { error: 'invalid_body' });
  }
  try {
    await deleteTokens(deps.env, deps.fetch, [body.token]);
  } catch {
    return reply('error', 500, { error: 'internal' });
  }
  // The same answer whether a row matched or not, so the call can't tell which tokens exist.
  console.info(JSON.stringify({ outcome: 'unregistered' }));
  return new Response(null, { status: 204 });
}
