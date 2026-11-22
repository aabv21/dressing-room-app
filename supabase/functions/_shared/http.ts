// What every function does over HTTP: JSON replies with a logged outcome word, the body and the
// caller, and outbound calls with a deadline.

import { isRecord, UUID } from './guards.ts';

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Answers `body` and logs the outcome word, plus any `words` given; never anything the caller sent. */
export function reply(outcome: string, status: number, body: unknown, words: Record<string, string> = {}): Response {
  console.info(JSON.stringify({ outcome, ...words }));
  return json(status, body);
}

/** The request's JSON body, or null when it isn't JSON. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * The bearer token's `sub`, unverified: with `verify_jwt` on, the gateway already verified it. Null
 * unless a bearer JWT with a uuid `sub` (the anon and service-role keys have none).
 */
export function userIdFromJwt(authHeader: string | null): string | null {
  if (authHeader === null) return null;
  const [scheme, jwt, ...rest] = authHeader.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || jwt === undefined || rest.length > 0) return null;
  const [, payload] = jwt.split('.');
  if (payload === undefined || payload === '') return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    const claims: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
    if (!isRecord(claims) || typeof claims.sub !== 'string' || !UUID.test(claims.sub)) return null;
    return claims.sub.toLowerCase();
  } catch {
    return null;
  }
}

/** The signed-in caller: the `Authorization` header to forward and its user id; null without one. */
export function callerOf(request: Request): { auth: string; userId: string } | null {
  const auth = request.headers.get('authorization');
  const userId = userIdFromJwt(auth);
  return auth === null || userId === null ? null : { auth, userId };
}

const encoder = new TextEncoder();

/** A webhook's shared secret check, in time that depends only on the expected secret's length. */
export function secretMatches(given: string | null, expected: string): boolean {
  if (given === null || expected === '') return false;
  const a = encoder.encode(given);
  const b = encoder.encode(expected);
  let difference = a.length ^ b.length;
  b.forEach((byte, index) => {
    difference |= byte ^ (a.at(index) ?? 0);
  });
  return difference === 0;
}

/** Statuses whose response can't carry a body. */
const NULL_BODY = new Set([101, 204, 205, 304]);

/**
 * Aborts after `ms`, reading the body included (it comes back buffered, so a stalled body can't
 * outlive the deadline). `fetchFn` must honor the signal.
 */
export async function fetchWithDeadline(fetchFn: typeof fetch, url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, ms);
  try {
    const response = await fetchFn(url, { ...init, signal: controller.signal });
    const body = NULL_BODY.has(response.status) ? null : await response.arrayBuffer();
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally {
    clearTimeout(timer);
  }
}
