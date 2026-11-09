/** @jest-environment node */
// supabase/functions/_shared/__tests__/apple.test.ts
import { KeyObject } from 'node:crypto';

import {
  APPLE_AUDIENCE,
  APPLE_DEFAULT_BASE_URL,
  appleClientSecret,
  type AppleEnv,
  appleEnvFrom,
  CLIENT_SECRET_TTL_S,
  appleSubject,
  exchangeCode,
  revokeToken,
} from '../apple.ts';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const SIX_MONTHS_S = 15_777_000;

const fromBase64url = (text: string): Buffer => Buffer.from(text, 'base64url');

/** A fresh P-256 key pair, the private half as the `.p8` PKCS#8 PEM Apple hands out. */
async function testKeys(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pem = KeyObject.from(pair.privateKey).export({ type: 'pkcs8', format: 'pem' });
  return { pem, publicKey: pair.publicKey };
}

let keys: { pem: string; publicKey: CryptoKey };
let env: AppleEnv;

beforeAll(async () => {
  keys = await testKeys();
  env = {
    teamId: 'TEAM123456',
    keyId: 'KEY1234567',
    privateKey: keys.pem,
    clientId: 'com.example.dressingroom',
    baseUrl: 'http://apple.test',
  };
});

function decodeJwt(jwt: string): { header: unknown; claims: unknown; signingInput: string; signature: Buffer } {
  const parts = jwt.split('.');
  expect(parts).toHaveLength(3);
  const [header = '', claims = '', signature = ''] = parts;
  for (const part of parts) expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
  return {
    header: JSON.parse(fromBase64url(header).toString('utf8')) as unknown,
    claims: JSON.parse(fromBase64url(claims).toString('utf8')) as unknown,
    signingInput: `${header}.${claims}`,
    signature: fromBase64url(signature),
  };
}

describe('appleEnvFrom', () => {
  const full = new Map<string, string>([
    ['APPLE_TEAM_ID', 'TEAM123456'],
    ['APPLE_KEY_ID', 'KEY1234567'],
    ['APPLE_PRIVATE_KEY', 'pem'],
    ['APPLE_CLIENT_ID', 'com.example.dressingroom'],
  ]);

  test('reads the four ids and the key, defaulting the base URL to Apple', () => {
    expect(appleEnvFrom((name) => full.get(name))).toEqual({
      teamId: 'TEAM123456',
      keyId: 'KEY1234567',
      privateKey: 'pem',
      clientId: 'com.example.dressingroom',
      baseUrl: APPLE_DEFAULT_BASE_URL,
    });
    expect(APPLE_DEFAULT_BASE_URL).toBe('https://appleid.apple.com');
  });

  test('takes APPLE_BASE_URL when it is set', () => {
    const withBase = new Map(full).set('APPLE_BASE_URL', 'http://host.docker.internal:54498');
    expect(appleEnvFrom((name) => withBase.get(name))?.baseUrl).toBe('http://host.docker.internal:54498');
  });

  test.each(['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'APPLE_CLIENT_ID'])(
    'is null when %s is missing or blank',
    (name) => {
      const missing = new Map(full);
      missing.delete(name);
      expect(appleEnvFrom((key) => missing.get(key))).toBeNull();
      const blank = new Map(full).set(name, '  ');
      expect(appleEnvFrom((key) => blank.get(key))).toBeNull();
    },
  );

  test('is null when a value is an unresolved env(...) reference (a bare `supabase start`)', () => {
    const unresolved = new Map(full).set('APPLE_PRIVATE_KEY', 'env(LOCAL_APPLE_PRIVATE_KEY)');
    expect(appleEnvFrom((key) => unresolved.get(key))).toBeNull();
    const padded = new Map(full).set('APPLE_TEAM_ID', '  env(LOCAL_APPLE_TEAM_ID)');
    expect(appleEnvFrom((key) => padded.get(key))).toBeNull();
  });
});

describe('appleClientSecret', () => {
  test('is an ES256 JWT with the key id, the Apple claims and a signature the public key verifies', async () => {
    const secret = await appleClientSecret(env, NOW);
    const { header, claims, signingInput, signature } = decodeJwt(secret);

    expect(header).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
    const iat = Math.floor(NOW / 1000);
    expect(claims).toEqual({
      iss: 'TEAM123456',
      sub: 'com.example.dressingroom',
      aud: APPLE_AUDIENCE,
      iat,
      exp: iat + CLIENT_SECRET_TTL_S,
    });
    expect(APPLE_AUDIENCE).toBe('https://appleid.apple.com');
    expect(CLIENT_SECRET_TTL_S).toBeGreaterThan(0);
    expect(CLIENT_SECRET_TTL_S).toBeLessThanOrEqual(SIX_MONTHS_S);

    // JWS ES256 is the raw r || s pair (64 bytes), which is what WebCrypto's ECDSA produces and verifies.
    expect(signature).toHaveLength(64);
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.publicKey,
      new Uint8Array(signature),
      new TextEncoder().encode(signingInput),
    );
    expect(valid).toBe(true);
  });

  test('keeps the audience on Apple even when the base URL points elsewhere', async () => {
    const { claims } = decodeJwt(await appleClientSecret({ ...env, baseUrl: 'http://mock.test' }, NOW));
    expect(claims).toMatchObject({ aud: 'https://appleid.apple.com' });
  });

  test('accepts a PEM whose newlines were pasted as literal \\n', async () => {
    const escaped = keys.pem.replace(/\n/g, '\\n');
    const { signingInput, signature } = decodeJwt(await appleClientSecret({ ...env, privateKey: escaped }, NOW));
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.publicKey,
      new Uint8Array(signature),
      new TextEncoder().encode(signingInput),
    );
    expect(valid).toBe(true);
  });

  test('rejects a key that is not a PKCS#8 P-256 key', async () => {
    await expect(appleClientSecret({ ...env, privateKey: 'not a key' }, NOW)).rejects.toThrow();
  });
});

type Sent = { url: string; method: string | undefined; contentType: string | null; form: URLSearchParams };

const hrefOf = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

/** A fetch that records each request's form body and answers with `reply`. */
function recordingFetch(reply: () => Response | Promise<Response>): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    sent.push({
      url: hrefOf(input),
      method: init?.method,
      contentType: headers.get('content-type'),
      form: new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
    });
    return reply();
  }) as typeof fetch;
  return { fetch: fetchFn, sent };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const encodeSegment = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
/** An id_token as Apple's `/auth/token` returns it (the signature isn't checked, so any bytes do). */
const idToken = (claims: unknown): string => `${encodeSegment({ alg: 'RS256', kid: 'apple-kid' })}.${encodeSegment(claims)}.c2ln`;
const APPLE_CLAIMS = { iss: 'https://appleid.apple.com', aud: 'com.example.dressingroom', sub: '001234.abcdef.0987', iat: 1, exp: 2 };

const TOKEN_BODY = {
  access_token: 'access-test',
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'refresh-test',
  id_token: idToken(APPLE_CLAIMS),
};

describe('appleSubject', () => {
  test('is the sub of an id_token issued by Apple for this app', () => {
    expect(appleSubject(idToken(APPLE_CLAIMS), 'com.example.dressingroom')).toBe('001234.abcdef.0987');
    expect(appleSubject(idToken({ ...APPLE_CLAIMS, aud: ['other', 'com.example.dressingroom'] }), 'com.example.dressingroom')).toBe(
      '001234.abcdef.0987',
    );
  });

  test.each([
    ['another issuer', idToken({ ...APPLE_CLAIMS, iss: 'https://evil.example' })],
    ['another audience', idToken({ ...APPLE_CLAIMS, aud: 'com.example.other' })],
    ['no sub', idToken({ ...APPLE_CLAIMS, sub: undefined })],
    ['an empty sub', idToken({ ...APPLE_CLAIMS, sub: '' })],
    ['a claims segment that is not JSON', `${encodeSegment({})}.bm90IGpzb24.c2ln`],
    ['something that is not a JWT', 'not-a-jwt'],
  ])('is null for %s', (_name, token) => {
    expect(appleSubject(token, 'com.example.dressingroom')).toBeNull();
  });

  test('is null when there is no id_token at all', () => {
    expect(appleSubject(undefined, 'com.example.dressingroom')).toBeNull();
  });
});

describe('exchangeCode', () => {
  test('posts the code to /auth/token as a form and returns the refresh token', async () => {
    const { fetch: fetchFn, sent } = recordingFetch(() => json(200, TOKEN_BODY));

    await expect(exchangeCode(env, fetchFn, 'code-test', NOW)).resolves.toEqual({
      refreshToken: 'refresh-test',
      subject: '001234.abcdef.0987',
    });

    expect(sent).toHaveLength(1);
    const [request] = sent;
    expect(request?.url).toBe('http://apple.test/auth/token');
    expect(request?.method).toBe('POST');
    expect(request?.contentType).toBe('application/x-www-form-urlencoded');
    expect(request?.form.get('client_id')).toBe('com.example.dressingroom');
    expect(request?.form.get('code')).toBe('code-test');
    expect(request?.form.get('grant_type')).toBe('authorization_code');
    expect(decodeJwt(request?.form.get('client_secret') ?? '').header).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
  });

  test('keeps the refresh token with a null subject when the id_token is missing or not for this app', async () => {
    const { fetch: missing } = recordingFetch(() => json(200, { ...TOKEN_BODY, id_token: undefined }));
    await expect(exchangeCode(env, missing, 'code-test', NOW)).resolves.toEqual({ refreshToken: 'refresh-test', subject: null });
    const { fetch: foreign } = recordingFetch(() => json(200, { ...TOKEN_BODY, id_token: idToken({ ...APPLE_CLAIMS, aud: 'x' }) }));
    await expect(exchangeCode(env, foreign, 'code-test', NOW)).resolves.toEqual({ refreshToken: 'refresh-test', subject: null });
  });

  test('trims a trailing slash off the base URL', async () => {
    const { fetch: fetchFn, sent } = recordingFetch(() => json(200, TOKEN_BODY));
    await exchangeCode({ ...env, baseUrl: 'http://apple.test/' }, fetchFn, 'code-test', NOW);
    expect(sent[0]?.url).toBe('http://apple.test/auth/token');
  });

  test.each([
    ['an error answer', () => json(400, { error: 'invalid_grant' })],
    ['an answer without a refresh token', () => json(200, { ...TOKEN_BODY, refresh_token: undefined })],
    ['an empty refresh token', () => json(200, { ...TOKEN_BODY, refresh_token: '' })],
    ['a body that is not JSON', () => new Response('<html>', { status: 200 })],
    ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
  ])('is null on %s', async (_name, reply) => {
    const { fetch: fetchFn } = recordingFetch(reply);
    await expect(exchangeCode(env, fetchFn, 'code-test', NOW)).resolves.toBeNull();
  });

  test('is null when the key cannot sign, without calling Apple', async () => {
    const { fetch: fetchFn, sent } = recordingFetch(() => json(200, TOKEN_BODY));
    await expect(exchangeCode({ ...env, privateKey: 'not a key' }, fetchFn, 'code-test', NOW)).resolves.toBeNull();
    expect(sent).toHaveLength(0);
  });
});

describe('revokeToken', () => {
  test('posts the refresh token to /auth/revoke as a form and is true on success', async () => {
    const { fetch: fetchFn, sent } = recordingFetch(() => new Response(null, { status: 200 }));

    await expect(revokeToken(env, fetchFn, 'refresh-test', NOW)).resolves.toBe(true);

    expect(sent).toHaveLength(1);
    const [request] = sent;
    expect(request?.url).toBe('http://apple.test/auth/revoke');
    expect(request?.method).toBe('POST');
    expect(request?.contentType).toBe('application/x-www-form-urlencoded');
    expect(request?.form.get('client_id')).toBe('com.example.dressingroom');
    expect(request?.form.get('token')).toBe('refresh-test');
    expect(request?.form.get('token_type_hint')).toBe('refresh_token');
    expect(decodeJwt(request?.form.get('client_secret') ?? '').claims).toMatchObject({ iss: 'TEAM123456' });
  });

  test.each([
    ['an error answer', () => json(400, { error: 'invalid_client' })],
    ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
  ])('is false on %s', async (_name, reply) => {
    const { fetch: fetchFn } = recordingFetch(reply);
    await expect(revokeToken(env, fetchFn, 'refresh-test', NOW)).resolves.toBe(false);
  });

  test('is false when the key cannot sign', async () => {
    const { fetch: fetchFn, sent } = recordingFetch(() => new Response(null, { status: 200 }));
    await expect(revokeToken({ ...env, privateKey: 'not a key' }, fetchFn, 'refresh-test', NOW)).resolves.toBe(false);
    expect(sent).toHaveLength(0);
  });
});
