// Reclaims a push token another account holds under another device secret, by proving this phone
// receives its pushes (docs/api.md#push-claim). Logs only outcome words.

import type { PushEnv, ServiceEnv } from '../_shared/env.ts';
import { isRecord } from '../_shared/guards.ts';
import { callerOf, reply, secretMatches } from '../_shared/http.ts';
import { sendPushes } from '../_shared/push.ts';
import { restJson, serviceHeaders } from '../_shared/userContext.ts';

export type PushClaimEnv = ServiceEnv & PushEnv;

export type PushClaimDeps = { env: PushClaimEnv; fetch: typeof fetch };

export const CLAIM_CODE_LENGTH = 8;
// No 0/O or 1/I, should anyone ever read a code aloud; 32 symbols, so a byte maps without bias.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const TOKEN = /^(ExponentPushToken|ExpoPushToken)\[.+\]$/;
const MAX_TOKEN_LENGTH = 255;
// CODE_ALPHABET, CLAIM_CODE_LENGTH long.
const CODE = /^[A-HJ-NP-Z2-9]{8}$/;
const DEVICE_SECRET = /^[0-9a-f]{32,128}$/;
// The claiming phone's own random value, echoed in the code push (32 to 128 hex characters).
const NONCE = /^[0-9a-f]{32,128}$/;

type Start = { token: string; step: 'start'; nonce: string };
type Confirm = {
  token: string;
  step: 'confirm';
  code: string;
  nonce: string;
  device_secret: string;
  platform: 'ios' | 'android';
  review_ready: boolean;
  weekly: boolean;
};

function parse(body: unknown): Start | Confirm | null {
  if (!isRecord(body) || typeof body.token !== 'string' || body.token.length > MAX_TOKEN_LENGTH || !TOKEN.test(body.token)) {
    return null;
  }
  if (typeof body.nonce !== 'string' || !NONCE.test(body.nonce)) return null;
  if (body.step === 'start') return { token: body.token, step: 'start', nonce: body.nonce };
  if (
    body.step !== 'confirm' ||
    typeof body.code !== 'string' ||
    !CODE.test(body.code) ||
    typeof body.device_secret !== 'string' ||
    !DEVICE_SECRET.test(body.device_secret) ||
    (body.platform !== 'ios' && body.platform !== 'android') ||
    typeof body.review_ready !== 'boolean' ||
    typeof body.weekly !== 'boolean'
  ) {
    return null;
  }
  return {
    token: body.token,
    step: 'confirm',
    code: body.code,
    nonce: body.nonce,
    device_secret: body.device_secret,
    platform: body.platform,
    review_ready: body.review_ready,
    weekly: body.weekly,
  };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CLAIM_CODE_LENGTH));
  return Array.from(bytes, (byte) => CODE_ALPHABET.charAt(byte % CODE_ALPHABET.length)).join('');
}

function rpc(deps: PushClaimDeps, name: string, args: Record<string, unknown>): Promise<unknown> {
  return restJson(deps.fetch, `${deps.env.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { ...serviceHeaders(deps.env), 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
}

/**
 * The same 202 whether a code went out or not (rate limited, a token nobody holds, the caller's own).
 * Its timing can tell whether a token is held, which register_push_token's 42501 already does.
 */
async function start(deps: PushClaimDeps, userId: string, claim: Start): Promise<Response> {
  const code = newCode();
  const started = await rpc(deps, 'start_push_claim', {
    p_user_id: userId,
    p_token: claim.token,
    p_code_hash: await sha256Hex(code),
    p_nonce_hash: await sha256Hex(claim.nonce),
  });
  // Only to the claimed token: the code proves this phone receives that token's pushes.
  if (started === true) {
    await sendPushes(deps.env, deps.fetch, [{ to: claim.token, data: { type: 'push-claim', code, nonce: claim.nonce } }]);
  }
  return reply('accepted', 202, { outcome: 'accepted' });
}

async function confirm(deps: PushClaimDeps, userId: string, claim: Confirm): Promise<Response> {
  const invalid = (): Response => reply('invalid_code', 403, { error: 'invalid_code' });
  // The attempt is spent before the compare, so 5 wrong codes end the claim whatever happens next.
  const expected = await rpc(deps, 'push_claim_attempt', {
    p_user_id: userId,
    p_token: claim.token,
    p_nonce_hash: await sha256Hex(claim.nonce),
  });
  if (typeof expected !== 'string' || !secretMatches(await sha256Hex(claim.code), expected)) return invalid();
  const finished = await rpc(deps, 'finish_push_claim', {
    p_user_id: userId,
    p_token: claim.token,
    p_platform: claim.platform,
    p_review_ready: claim.review_ready,
    p_weekly: claim.weekly,
    p_device_secret: claim.device_secret,
  });
  return finished === true ? reply('claimed', 200, { outcome: 'claimed' }) : invalid();
}

export async function handlePushClaim(request: Request, deps: PushClaimDeps): Promise<Response> {
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  const caller = callerOf(request);
  if (caller === null) return reply('invalid', 401, { error: 'unauthorized' });
  let body: unknown;
  try {
    body = (await request.json()) as unknown;
  } catch {
    body = null;
  }
  const claim = parse(body);
  if (claim === null) return reply('invalid', 400, { error: 'invalid_body' });
  try {
    return claim.step === 'start' ? await start(deps, caller.userId, claim) : await confirm(deps, caller.userId, claim);
  } catch {
    return reply('error', 500, { error: 'internal' });
  }
}
