// What every function does over HTTP: answering JSON with a logged outcome word, reading the body
// and the caller, and calling out with a deadline. Runtime-neutral, like the rest of `_shared`.

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
 * The `sub` of the bearer token, without verifying the signature: with `verify_jwt` on, the
 * gateway has already verified it before the function runs. Null for anything that isn't a
 * bearer JWT whose `sub` is a uuid (the anon and service-role keys have no `sub`).
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

/** Statuses whose response can't carry a body. */
const NULL_BODY = new Set([101, 204, 205, 304]);

/**
 * `fetchFn` with its signal aborted once `ms` passes, reading the body included: the answer comes
 * back already buffered, so a stalled body can't outlive the deadline either. Like the web
 * `fetch`, `fetchFn` must honor the signal; the abort rejects the call.
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
