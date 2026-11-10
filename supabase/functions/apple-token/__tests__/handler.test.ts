/** @jest-environment node */
// supabase/functions/apple-token/__tests__/handler.test.ts
import { KeyObject } from 'node:crypto';

import type { AppleEnv } from '../../_shared/apple.ts';
import type { SupabaseEnv } from '../../_shared/userContext.ts';
import { handleAppleToken } from '../handler.ts';

const { jest } = import.meta;

const USER_ID = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const NOW = Date.parse('2026-11-09T12:00:00Z');

const ENV: SupabaseEnv = {
  supabaseUrl: 'http://supabase.test',
  anonKey: 'anon-key-test',
  serviceRoleKey: 'service-role-test',
};

const base64url = (text: string): string => Buffer.from(text, 'utf8').toString('base64url');
const token = (claims: unknown): string =>
  `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}.signature`;
const AUTH = `Bearer ${token({ sub: USER_ID, role: 'authenticated' })}`;

let apple: AppleEnv;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  apple = {
    teamId: 'TEAM123456',
    keyId: 'KEY1234567',
    privateKey: KeyObject.from(pair.privateKey).export({ type: 'pkcs8', format: 'pem' }),
    clientId: 'com.example.dressingroom',
    baseUrl: 'http://apple.test',
  };
});

type Call = { url: URL; method: string; headers: Headers; body: string | undefined };

type Reply = () => Response | Promise<Response>;
type Replies = { token?: Reply; upsert?: Reply; adminUser?: Reply; revoke?: Reply };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const APPLE_SUB = '001234.abcdef.0987';
const encodeSegment = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const idToken = (claims: unknown): string => `${encodeSegment({ alg: 'RS256', kid: 'apple-kid' })}.${encodeSegment(claims)}.c2ln`;
const ID_CLAIMS = { iss: 'https://appleid.apple.com', aud: 'com.example.dressingroom', sub: APPLE_SUB };
const TOKEN_BODY = {
  access_token: 'access-test',
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'refresh-test',
  id_token: idToken(ID_CLAIMS),
};

/** The admin user read, with the given identities (GoTrue's `id` is the provider's user id). */
const adminUser = (identities: { provider: string; id: string }[]): Reply => () =>
  json(200, {
    id: USER_ID,
    identities: identities.map((identity) => ({ ...identity, identity_id: 'f0000000-0000-4000-8000-000000000001', user_id: USER_ID })),
  });

const hrefOf = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

function fakeFetch(replies: Replies = {}): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(hrefOf(input));
    const method = init?.method ?? 'GET';
    calls.push({ url, method, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.origin === 'http://apple.test' && url.pathname === '/auth/token' && method === 'POST') {
      return (replies.token ?? (() => json(200, TOKEN_BODY)))();
    }
    if (url.origin === 'http://apple.test' && url.pathname === '/auth/revoke' && method === 'POST') {
      return (replies.revoke ?? (() => new Response(null, { status: 200 })))();
    }
    if (url.origin === ENV.supabaseUrl && url.pathname === `/auth/v1/admin/users/${USER_ID}` && method === 'GET') {
      return (replies.adminUser ?? adminUser([{ provider: 'apple', id: APPLE_SUB }]))();
    }
    if (url.origin === ENV.supabaseUrl && url.pathname === '/rest/v1/apple_tokens' && method === 'POST') {
      return (replies.upsert ?? (() => new Response(null, { status: 201 })))();
    }
    throw new Error(`unexpected request ${method} ${url.href}`);
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

function request(body: unknown, init: { method?: string; auth?: string | null } = {}): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  const header = init.auth === undefined ? AUTH : init.auth;
  if (header !== null) headers.set('authorization', header);
  const method = init.method ?? 'POST';
  return new Request('http://functions.test/apple-token', {
    method,
    headers,
    ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

let infoSpy: jest.SpiedFunction<typeof console.info>;

beforeEach(() => {
  infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  infoSpy.mockRestore();
});

const logged = (): string => infoSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');

describe('apple-token', () => {
  test('exchanges the code and stores the refresh token with the service role, never returning it', async () => {
    const { fetch: fetchFn, calls } = fakeFetch();

    const response = await handleAppleToken(request({ code: 'code-test' }), { env: ENV, apple, fetch: fetchFn, now: () => NOW });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ outcome: 'stored' });
    expect(text).not.toContain('refresh-test');

    expect(calls.map(({ url, method }) => `${method} ${url.pathname}`)).toEqual([
      'POST /auth/token',
      `GET /auth/v1/admin/users/${USER_ID}`,
      'POST /rest/v1/apple_tokens',
    ]);
    const [exchange, identities, store] = calls;
    expect(identities?.headers.get('authorization')).toBe('Bearer service-role-test');
    expect(new URLSearchParams(exchange?.body).get('code')).toBe('code-test');
    expect(store?.headers.get('authorization')).toBe('Bearer service-role-test');
    expect(store?.headers.get('apikey')).toBe('service-role-test');
    expect(store?.headers.get('prefer')).toContain('resolution=merge-duplicates');
    expect(JSON.parse(store?.body ?? '{}')).toEqual({ user_id: USER_ID, refresh_token: 'refresh-test' });

    expect(logged()).not.toContain('code-test');
    expect(logged()).not.toContain('refresh-test');
    expect(logged()).toContain('stored');
  });

  test.each([
    ['another Apple identity', { adminUser: adminUser([{ provider: 'apple', id: '009999.other.0001' }]) }],
    ['no Apple identity', { adminUser: adminUser([{ provider: 'email', id: USER_ID }]) }],
    ['an id_token for another app', { token: () => json(200, { ...TOKEN_BODY, id_token: idToken({ ...ID_CLAIMS, aud: 'com.other' }) }) }],
    ['an id_token from another issuer', { token: () => json(200, { ...TOKEN_BODY, id_token: idToken({ ...ID_CLAIMS, iss: 'https://evil' }) }) }],
    ['no id_token', { token: () => json(200, { ...TOKEN_BODY, id_token: undefined }) }],
  ] satisfies [string, Replies][])('stores nothing and revokes the new token when the code is for %s', async (_name, replies) => {
    const { fetch: fetchFn, calls } = fakeFetch(replies);

    const response = await handleAppleToken(request({ code: 'code-test' }), { env: ENV, apple, fetch: fetchFn, now: () => NOW });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ outcome: 'identity_mismatch' });
    expect(text).not.toContain('refresh-test');
    expect(calls.some(({ url }) => url.pathname === '/rest/v1/apple_tokens')).toBe(false);
    const revoke = calls.find(({ url }) => url.pathname === '/auth/revoke');
    expect(new URLSearchParams(revoke?.body).get('token')).toBe('refresh-test');
    expect(logged()).not.toContain(APPLE_SUB);
  });

  test('a failed revoke after a mismatch still answers identity_mismatch', async () => {
    const { fetch: fetchFn } = fakeFetch({
      adminUser: adminUser([]),
      revoke: () => Promise.reject(new TypeError('fetch failed')),
    });

    const response = await handleAppleToken(request({ code: 'code-test' }), { env: ENV, apple, fetch: fetchFn, now: () => NOW });

    expect(await response.json()).toEqual({ outcome: 'identity_mismatch' });
  });

  test.each([
    ['answers 500', () => json(500, { msg: 'boom' })],
    ['is unreachable', () => Promise.reject(new TypeError('fetch failed'))],
    ['answers another user', () => json(200, { id: '9b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e', identities: [{ provider: 'apple', id: APPLE_SUB }] })],
  ] satisfies [string, Reply][])('stores nothing and revokes when the identity read %s', async (_name, reply) => {
    const { fetch: fetchFn, calls } = fakeFetch({ adminUser: reply });

    const response = await handleAppleToken(request({ code: 'code-test' }), { env: ENV, apple, fetch: fetchFn, now: () => NOW });

    expect(await response.json()).toEqual({ outcome: 'lookup_failed' });
    expect(calls.some(({ url }) => url.pathname === '/rest/v1/apple_tokens')).toBe(false);
    expect(calls.some(({ url }) => url.pathname === '/auth/revoke')).toBe(true);
  });

  test('skips without calling anything when the Apple env is missing', async () => {
    const { fetch: fetchFn, calls } = fakeFetch();

    const response = await handleAppleToken(request({ code: 'code-test' }), { env: ENV, apple: null, fetch: fetchFn });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'skipped' });
    expect(calls).toHaveLength(0);
  });

  test.each([
    ['Apple refuses the code', { token: () => json(400, { error: 'invalid_grant' }) }, 'exchange_failed'],
    ['Apple is unreachable', { token: () => Promise.reject(new TypeError('fetch failed')) }, 'exchange_failed'],
    ['the token row cannot be written', { upsert: () => json(500, { message: 'boom' }) }, 'store_failed'],
    ['the database is unreachable', { upsert: () => Promise.reject(new TypeError('fetch failed')) }, 'store_failed'],
  ] satisfies [string, Replies, string][])('answers 200 with an outcome when %s', async (_name, replies, outcome) => {
    const { fetch: fetchFn } = fakeFetch(replies);

    const response = await handleAppleToken(request({ code: 'code-test' }), { env: ENV, apple, fetch: fetchFn, now: () => NOW });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ outcome });
    expect(text).not.toContain('refresh-test');
  });

  test.each([
    ['no body', 'not json'],
    ['no code', {}],
    ['an empty code', { code: '' }],
    ['a code that is not a string', { code: 42 }],
    ['an absurdly long code', { code: 'x'.repeat(5000) }],
  ])('answers 200 invalid for %s, without calling Apple', async (_name, body) => {
    const { fetch: fetchFn, calls } = fakeFetch();

    const response = await handleAppleToken(request(body), { env: ENV, apple, fetch: fetchFn });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'invalid' });
    expect(calls).toHaveLength(0);
  });

  test('answers 401 without a user token and 405 for another method', async () => {
    const { fetch: fetchFn, calls } = fakeFetch();

    const anon = await handleAppleToken(request({ code: 'c' }, { auth: `Bearer ${token({ role: 'anon' })}` }), {
      env: ENV,
      apple,
      fetch: fetchFn,
    });
    expect(anon.status).toBe(401);
    const missing = await handleAppleToken(request({ code: 'c' }, { auth: null }), { env: ENV, apple, fetch: fetchFn });
    expect(missing.status).toBe(401);
    const get = await handleAppleToken(request(null, { method: 'GET' }), { env: ENV, apple, fetch: fetchFn });
    expect(get.status).toBe(405);
    expect(calls).toHaveLength(0);
  });
});
