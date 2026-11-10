// Sign in with Apple's server-to-server calls: the ES256 client secret, the authorization-code
// exchange (`/auth/token`) that yields the refresh token and the Apple user it belongs to, and its
// revocation (`/auth/revoke`) when the account is deleted. `signInWithIdToken` keeps no Apple refresh token, so `apple-token` exchanges
// the code at sign-in and stores it (`public.apple_tokens`) for `delete-account` to revoke.
//
// Runtime-neutral: WebCrypto (`crypto.subtle`), `atob`/`btoa`, `URLSearchParams` and the injected
// `fetch` only, so Jest drives it under Node and the Edge Functions run it under Deno.

import { isRecord } from './extraction.ts';

/** The Apple key and app ids; null where a function is given none (the calls are then skipped). */
export type AppleEnv = {
  /** `APPLE_TEAM_ID`, the client secret's `iss`. */
  teamId: string;
  /** `APPLE_KEY_ID`, the client secret's `kid`. */
  keyId: string;
  /** `APPLE_PRIVATE_KEY`, the `.p8` file's PKCS#8 PEM (literal `\n`s are accepted). */
  privateKey: string;
  /** `APPLE_CLIENT_ID`, the app's bundle id: the client secret's `sub` and the `client_id`. */
  clientId: string;
  /** `APPLE_BASE_URL`; Apple itself unless a mock is set locally. */
  baseUrl: string;
};

export const APPLE_DEFAULT_BASE_URL = 'https://appleid.apple.com';
/** The client secret's `aud`: always Apple, whichever host the calls go to. */
export const APPLE_AUDIENCE = 'https://appleid.apple.com';
/** Each call signs a fresh secret, so it only has to outlive the request (Apple allows up to 6 months). */
export const CLIENT_SECRET_TTL_S = 300;
export const APPLE_TIMEOUT_MS = 10_000;

const REQUIRED = ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'APPLE_CLIENT_ID'] as const;

/**
 * The Apple env from the function's variables, or null when any of the four required ones is
 * missing, blank or an unresolved `env(...)` reference: a bare `supabase start` without the
 * variable the config names can pass that literal string through instead of leaving it unset.
 */
export function appleEnvFrom(get: (name: string) => string | undefined): AppleEnv | null {
  const values = REQUIRED.map((name) => get(name)?.trim() ?? '');
  const [teamId = '', keyId = '', privateKey = '', clientId = ''] = values;
  if (values.some((value) => value === '' || value.startsWith('env('))) return null;
  const baseUrl = get('APPLE_BASE_URL')?.trim() ?? '';
  return { teamId, keyId, privateKey, clientId, baseUrl: baseUrl === '' ? APPLE_DEFAULT_BASE_URL : baseUrl };
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const encodeJson = (value: unknown): string => base64url(new TextEncoder().encode(JSON.stringify(value)));

/** The DER bytes inside a PKCS#8 PEM; throws when the body isn't base64. */
function pkcs8Bytes(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/\\n/g, '\n')
    // The armor lines (`-----BEGIN …-----` / `-----END …-----`).
    .replace(/-----[A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

/**
 * The client secret Apple's `/auth/token` and `/auth/revoke` take: a JWT signed with the `.p8` key
 * (ES256), header `{ alg, kid }`, claims `iss` (team), `sub` (bundle id), `aud`, `iat` and `exp`.
 * WebCrypto's ECDSA signature is already the raw `r || s` pair JWS wants. Throws when the key can't
 * be imported.
 */
export async function appleClientSecret(env: AppleEnv, now: number): Promise<string> {
  const iat = Math.floor(now / 1000);
  const signingInput = `${encodeJson({ alg: 'ES256', kid: env.keyId })}.${encodeJson({
    iss: env.teamId,
    sub: env.clientId,
    aud: APPLE_AUDIENCE,
    iat,
    exp: iat + CLIENT_SECRET_TTL_S,
  })}`;
  const key = await crypto.subtle.importKey('pkcs8', pkcs8Bytes(env.privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

/**
 * POSTs a form to `{baseUrl}{path}` with a fresh client secret: whether Apple answered 2xx and its
 * JSON body (null when there is none). Null on any failure, the timeout (which covers reading the
 * body) included.
 */
async function postForm(
  env: AppleEnv,
  fetchFn: typeof fetch,
  path: string,
  fields: Record<string, string>,
  now: number,
): Promise<{ ok: boolean; body: unknown } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, APPLE_TIMEOUT_MS);
  try {
    const clientSecret = await appleClientSecret(env, now);
    const response = await fetchFn(`${env.baseUrl.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.clientId, client_secret: clientSecret, ...fields }).toString(),
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text === '' ? null : (JSON.parse(text) as unknown);
    } catch {
      body = null;
    }
    return { ok: response.ok, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The Apple user id (`sub`) of an id_token Apple issued for `clientId`; null when it isn't one (another
 * issuer or audience, no `sub`, or not a JWT). The signature isn't checked: this only reads the
 * id_token from `/auth/token`'s answer to this server's own call to Apple over TLS.
 */
export function appleSubject(idToken: unknown, clientId: string): string | null {
  if (typeof idToken !== 'string') return null;
  const [, payload, ...rest] = idToken.split('.');
  if (payload === undefined || rest.length !== 1) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    const claims: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
    if (!isRecord(claims) || claims.iss !== APPLE_AUDIENCE) return null;
    const audiences: unknown[] = Array.isArray(claims.aud) ? (claims.aud as unknown[]) : [claims.aud];
    if (!audiences.includes(clientId)) return null;
    return typeof claims.sub === 'string' && claims.sub !== '' ? claims.sub : null;
  } catch {
    return null;
  }
}

/** What a code exchange yields: the refresh token, and the Apple user it's for (null when the id_token doesn't say). */
export type AppleTokens = { refreshToken: string; subject: string | null };

/** Exchanges a sign-in authorization code at `/auth/token`; null when Apple refuses or can't be reached. */
export async function exchangeCode(env: AppleEnv, fetchFn: typeof fetch, code: string, now: number): Promise<AppleTokens | null> {
  const answer = await postForm(env, fetchFn, '/auth/token', { code, grant_type: 'authorization_code' }, now);
  if (answer === null || !answer.ok || !isRecord(answer.body)) return null;
  const { refresh_token: refreshToken, id_token: idToken } = answer.body;
  if (typeof refreshToken !== 'string' || refreshToken === '') return null;
  return { refreshToken, subject: appleSubject(idToken, env.clientId) };
}

/** Revokes a refresh token; false when Apple refuses or can't be reached (callers carry on regardless). */
export async function revokeToken(env: AppleEnv, fetchFn: typeof fetch, refreshToken: string, now: number): Promise<boolean> {
  const answer = await postForm(env, fetchFn, '/auth/revoke', { token: refreshToken, token_type_hint: 'refresh_token' }, now);
  return answer?.ok === true;
}
