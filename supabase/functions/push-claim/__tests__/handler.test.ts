/** @jest-environment node */
// supabase/functions/push-claim/__tests__/handler.test.ts
import { createHash } from 'node:crypto';

import { CLAIM_CODE_LENGTH, handlePushClaim, type PushClaimEnv } from '../handler.ts';

const { jest } = import.meta;

const ENV: PushClaimEnv = {
  supabaseUrl: 'http://supabase.test',
  serviceRoleKey: 'service-role-test',
  expoPushUrl: 'http://expo.test/--/api/v2/push/send',
  expoAccessToken: '',
};

const USER_ID = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const TOKEN = 'ExponentPushToken[phone-a]';
const SECRET = '2b'.repeat(32);
const CODE = 'K7M2P9QX';
const NONCE = 'a1'.repeat(16);
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

const base64url = (text: string): string => Buffer.from(text, 'utf8').toString('base64url');
const AUTH = `Bearer ${base64url(JSON.stringify({ alg: 'HS256' }))}.${base64url(JSON.stringify({ sub: USER_ID, role: 'authenticated' }))}.sig`;

type Route = 'start' | 'attempt' | 'finish' | 'expo';
type Call = { route: Route; body: unknown; headers: Headers };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const DEFAULTS: Record<Route, () => Response> = {
  start: () => json(200, true),
  attempt: () => json(200, sha256(CODE)),
  finish: () => json(200, true),
  expo: () => json(200, { data: [{ status: 'ok', id: 'r' }] }),
};

function fakeFetch(overrides: Partial<Record<Route, () => Response>> = {}) {
  const calls: Call[] = [];
  const fetchFn = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const route: Route | null =
      url.href === ENV.expoPushUrl
        ? 'expo'
        : url.pathname === '/rest/v1/rpc/start_push_claim'
          ? 'start'
          : url.pathname === '/rest/v1/rpc/push_claim_attempt'
            ? 'attempt'
            : url.pathname === '/rest/v1/rpc/finish_push_claim'
              ? 'finish'
              : null;
    if (route === null) return Promise.reject(new Error(`unexpected ${url.href}`));
    calls.push({ route, body, headers: new Headers(init.headers) });
    const answer = new Map(Object.entries({ ...DEFAULTS, ...overrides })).get(route);
    return answer === undefined ? Promise.reject(new Error(route)) : Promise.resolve(answer());
  }) as typeof fetch;
  return { fetchFn, calls };
}

function request(body: unknown, authorization: string | null = AUTH): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  const header = authorization ?? undefined;
  if (header !== undefined) headers.set('authorization', header);
  return new Request('http://functions.test/push-claim', { method: 'POST', headers, body: JSON.stringify(body) });
}

const confirm = (overrides: Record<string, unknown> = {}) => ({
  token: TOKEN,
  step: 'confirm',
  code: CODE,
  nonce: NONCE,
  device_secret: SECRET,
  platform: 'android',
  review_ready: true,
  weekly: false,
  ...overrides,
});

let infoSpy: jest.SpiedFunction<typeof console.info>;

beforeEach(() => {
  infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  infoSpy.mockRestore();
});

describe('start', () => {
  test('stores the hash of a fresh code and pushes the code as data only to that token, answering 202', async () => {
    const { fetchFn, calls } = fakeFetch();

    const response = await handlePushClaim(request({ token: TOKEN, step: 'start', nonce: NONCE }), { env: ENV, fetch: fetchFn });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ outcome: 'accepted' });
    const start = calls.find((call) => call.route === 'start');
    const stored = start?.body as { p_user_id: string; p_token: string; p_code_hash: string; p_nonce_hash: string };
    expect(stored.p_user_id).toBe(USER_ID);
    expect(stored.p_token).toBe(TOKEN);
    expect(stored.p_nonce_hash).toBe(sha256(NONCE));
    expect(start?.headers.get('authorization')).toBe(`Bearer ${ENV.serviceRoleKey}`);
    const pushed = calls.find((call) => call.route === 'expo')?.body as { to: string; data: { type: string; code: string; nonce: string } }[];
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.to).toBe(TOKEN);
    expect(pushed[0]?.data.type).toBe('push-claim');
    // The nonce comes back so the claiming phone answers only its own claim's code.
    expect(pushed[0]?.data.nonce).toBe(NONCE);
    expect(pushed[0]?.data.code).toMatch(/^[A-HJ-NP-Z2-9]+$/);
    expect(pushed[0]?.data.code).toHaveLength(CLAIM_CODE_LENGTH);
    expect(sha256(pushed[0]?.data.code ?? '')).toBe(stored.p_code_hash);
  });

  test('rate limited (or a token nobody holds): no push, and the same 202', async () => {
    const { fetchFn, calls } = fakeFetch({ start: () => json(200, false) });

    const response = await handlePushClaim(request({ token: TOKEN, step: 'start', nonce: NONCE }), { env: ENV, fetch: fetchFn });

    expect(response.status).toBe(202);
    expect(calls.some((call) => call.route === 'expo')).toBe(false);
  });

  test('two starts make two different codes', async () => {
    const first = fakeFetch();
    const second = fakeFetch();
    await handlePushClaim(request({ token: TOKEN, step: 'start', nonce: NONCE }), { env: ENV, fetch: first.fetchFn });
    await handlePushClaim(request({ token: TOKEN, step: 'start', nonce: NONCE }), { env: ENV, fetch: second.fetchFn });
    const hashOf = (calls: Call[]) => (calls.find((call) => call.route === 'start')?.body as { p_code_hash: string }).p_code_hash;
    expect(hashOf(first.calls)).not.toBe(hashOf(second.calls));
  });
});

describe('confirm', () => {
  test('a right code takes the token over with the new secret', async () => {
    const { fetchFn, calls } = fakeFetch();

    const response = await handlePushClaim(request(confirm()), { env: ENV, fetch: fetchFn });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'claimed' });
    expect(calls.map((call) => call.route)).toEqual(['attempt', 'finish']);
    expect(calls[0]?.body).toEqual({ p_user_id: USER_ID, p_token: TOKEN, p_nonce_hash: sha256(NONCE) });
    expect(calls[1]?.body).toEqual({
      p_user_id: USER_ID,
      p_token: TOKEN,
      p_platform: 'android',
      p_review_ready: true,
      p_weekly: false,
      p_device_secret: SECRET,
    });
  });

  test('a wrong code spends an attempt and takes nothing over', async () => {
    const { fetchFn, calls } = fakeFetch();

    const response = await handlePushClaim(request(confirm({ code: 'WRNGXY23' })), { env: ENV, fetch: fetchFn });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'invalid_code' });
    expect(calls.map((call) => call.route)).toEqual(['attempt']);
  });

  test.each([
    ['the 6th attempt', 'no attempts left'],
    ['an expired claim', 'expired'],
    ['no claim of this caller', 'missing'],
  ])('%s fails like a wrong code', async () => {
    // The database answers null for each: attempts spent, past expires_at, or another claimant.
    const { fetchFn, calls } = fakeFetch({ attempt: () => json(200, null) });

    const response = await handlePushClaim(request(confirm()), { env: ENV, fetch: fetchFn });

    expect(response.status).toBe(403);
    expect(calls.some((call) => call.route === 'finish')).toBe(false);
  });

  test('a claim that ended between the attempt and the finish fails like a wrong code', async () => {
    const { fetchFn } = fakeFetch({ finish: () => json(200, false) });
    expect((await handlePushClaim(request(confirm()), { env: ENV, fetch: fetchFn })).status).toBe(403);
  });

  test('a database failure answers 500', async () => {
    const { fetchFn } = fakeFetch({ attempt: () => json(500, {}) });
    expect((await handlePushClaim(request(confirm()), { env: ENV, fetch: fetchFn })).status).toBe(500);
  });
});

describe('request checks', () => {
  test('no signed-in caller: 401 before any fetch', async () => {
    const { fetchFn, calls } = fakeFetch();
    expect((await handlePushClaim(request({ token: TOKEN, step: 'start', nonce: NONCE }, null), { env: ENV, fetch: fetchFn })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test.each([
    ['a bad token', { token: 'nope', step: 'start', nonce: NONCE }],
    ['a start without a nonce', { token: TOKEN, step: 'start' }],
    ['a nonce under 128 bits', { token: TOKEN, step: 'start', nonce: 'abc' }],
    ['a confirm without the nonce', confirm({ nonce: undefined })],
    ['an unknown step', { token: TOKEN, step: 'steal', nonce: NONCE }],
    ['a confirm without a code', confirm({ code: undefined })],
    ['a code of another shape', confirm({ code: 'abc' })],
    ['a short device secret', confirm({ device_secret: 'abc' })],
    ['a bad platform', confirm({ platform: 'web' })],
    ['choices that aren’t booleans', confirm({ weekly: 'yes' })],
  ])('%s: 400 before any fetch', async (_label, body) => {
    const { fetchFn, calls } = fakeFetch();
    expect((await handlePushClaim(request(body), { env: ENV, fetch: fetchFn })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('logs outcome words only, never the token, code or secret', async () => {
    const { fetchFn } = fakeFetch();
    await handlePushClaim(request({ token: TOKEN, step: 'start', nonce: NONCE }), { env: ENV, fetch: fetchFn });
    await handlePushClaim(request(confirm()), { env: ENV, fetch: fetchFn });
    const lines = infoSpy.mock.calls.flat().map(String).join(' ');
    expect(lines).not.toContain('ExponentPushToken');
    expect(lines).not.toContain(CODE);
    expect(lines).not.toContain(SECRET);
  });
});
