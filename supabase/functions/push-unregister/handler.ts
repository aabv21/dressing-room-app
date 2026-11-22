// Deletes this phone's push_tokens rows, with no session needed: a phone that signed out offline
// retries here with its token and device secret (docs/api.md#push-unregister). Logs only an outcome word.

import type { ServiceEnv } from '../_shared/env.ts';
import { isRecord } from '../_shared/guards.ts';
import { reply } from '../_shared/http.ts';
import { restJson, serviceHeaders } from '../_shared/userContext.ts';

export type PushUnregisterDeps = { env: ServiceEnv; fetch: typeof fetch };

/** One token and secret's JSON is well under this; anything bigger is refused unread. */
export const MAX_BODY_BYTES = 1024;

// The same rules as push_tokens' token check and register_push_token()'s secret check.
const TOKEN = /^(ExponentPushToken|ExpoPushToken)\[.+\]$/;
const MAX_TOKEN_LENGTH = 255;
const DEVICE_SECRET = /^[0-9a-f]{32,128}$/;

type Body = { token: string; device_secret: string };

function isBody(value: unknown): value is Body {
  return (
    isRecord(value) &&
    typeof value.token === 'string' &&
    value.token.length <= MAX_TOKEN_LENGTH &&
    TOKEN.test(value.token) &&
    typeof value.device_secret === 'string' &&
    DEVICE_SECRET.test(value.device_secret)
  );
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return 'too_large';
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function handlePushUnregister(request: Request, deps: PushUnregisterDeps): Promise<Response> {
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return reply('invalid', 413, { error: 'payload_too_large' });
  }
  const body = await readBody(request);
  if (body === 'too_large') return reply('invalid', 413, { error: 'payload_too_large' });
  if (!isBody(body)) return reply('invalid', 400, { error: 'invalid_body' });

  // Only rows registered with this phone's secret match: knowing the token alone deletes nothing.
  const filter = [
    `token=eq.${encodeURIComponent(body.token)}`,
    `device_secret_hash=eq.${await sha256Hex(body.device_secret)}`,
    'select=token',
  ].join('&');
  try {
    await restJson(deps.fetch, `${deps.env.supabaseUrl}/rest/v1/push_tokens?${filter}`, {
      method: 'DELETE',
      headers: { ...serviceHeaders(deps.env), prefer: 'return=representation' },
    });
  } catch {
    return reply('error', 500, { error: 'internal' });
  }
  // The same answer whether a row matched or not, so the call can't tell which tokens exist.
  console.info(JSON.stringify({ outcome: 'unregistered' }));
  return new Response(null, { status: 204 });
}
