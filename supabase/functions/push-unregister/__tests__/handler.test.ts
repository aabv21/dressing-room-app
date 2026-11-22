/** @jest-environment node */
// supabase/functions/push-unregister/__tests__/handler.test.ts
import { createHash } from 'node:crypto';

import type { ServiceEnv } from '../../_shared/env.ts';
import { handlePushUnregister, MAX_BODY_BYTES } from '../handler.ts';

const { jest } = import.meta;

const ENV: ServiceEnv = { supabaseUrl: 'http://supabase.test', serviceRoleKey: 'service-role-test' };
const TOKEN = 'ExponentPushToken[phone-a]';
const SECRET = '1a'.repeat(32);
const SECRET_HASH = createHash('sha256').update(SECRET).digest('hex');

type Call = { url: URL; method: string; headers: Headers };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeFetch(answer: () => Response = () => json(200, [{ token: TOKEN }])) {
  const calls: Call[] = [];
  const fetchFn = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url, method: init.method ?? 'GET', headers: new Headers(init.headers) });
    return Promise.resolve(answer());
  }) as typeof fetch;
  return { fetchFn, calls };
}

function request(body: unknown, { method = 'POST', raw }: { method?: string; raw?: string } = {}): Request {
  return new Request('http://functions.test/push-unregister', {
    method,
    headers: { 'content-type': 'application/json', apikey: 'anon-key' },
    ...(method === 'POST' ? { body: raw ?? JSON.stringify(body) } : {}),
  });
}

let infoSpy: jest.SpiedFunction<typeof console.info>;

beforeEach(() => {
  infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  infoSpy.mockRestore();
});

test('deletes only the rows holding that token under that device secret’s hash, and answers 204 with no body', async () => {
  const { fetchFn, calls } = fakeFetch();

  const response = await handlePushUnregister(request({ token: TOKEN, device_secret: SECRET }), { env: ENV, fetch: fetchFn });

  expect(response.status).toBe(204);
  expect(await response.text()).toBe('');
  expect(calls).toHaveLength(1);
  expect(calls[0]?.method).toBe('DELETE');
  expect(calls[0]?.url.pathname).toBe('/rest/v1/push_tokens');
  expect(calls[0]?.url.searchParams.get('token')).toBe(`eq.${TOKEN}`);
  expect(calls[0]?.url.searchParams.get('device_secret_hash')).toBe(`eq.${SECRET_HASH}`);
  expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${ENV.serviceRoleKey}`);
});

test('a wrong secret deletes nothing (no row matches its hash) and answers the same 204', async () => {
  const { fetchFn, calls } = fakeFetch(() => json(200, []));
  const response = await handlePushUnregister(request({ token: TOKEN, device_secret: '2b'.repeat(32) }), { env: ENV, fetch: fetchFn });
  expect(response.status).toBe(204);
  expect(calls[0]?.url.searchParams.get('device_secret_hash')).not.toBe(`eq.${SECRET_HASH}`);
});

test('a token no row holds answers the same 204, so it can’t probe which tokens exist', async () => {
  const { fetchFn } = fakeFetch(() => json(200, []));
  const response = await handlePushUnregister(request({ token: 'ExpoPushToken[nobody]', device_secret: SECRET }), { env: ENV, fetch: fetchFn });
  expect(response.status).toBe(204);
});

test.each([
  ['a token in another format', { token: 'not-a-token', device_secret: SECRET }],
  ['an empty bracket', { token: 'ExponentPushToken[]', device_secret: SECRET }],
  ['a token over 255 characters', { token: `ExponentPushToken[${'a'.repeat(240)}]`, device_secret: SECRET }],
  ['several tokens', { token: [TOKEN, TOKEN], device_secret: SECRET }],
  ['a list body', [TOKEN]],
  ['no token', { device_secret: SECRET }],
  ['no device secret', { token: TOKEN }],
  ['a device secret under 128 bits', { token: TOKEN, device_secret: 'abc123' }],
  ['a device secret that isn’t hex', { token: TOKEN, device_secret: 'z'.repeat(64) }],
])('%s is refused with 400 before any fetch', async (_label, body) => {
  const { fetchFn, calls } = fakeFetch();
  const response = await handlePushUnregister(request(body), { env: ENV, fetch: fetchFn });
  expect(response.status).toBe(400);
  expect(calls).toHaveLength(0);
});

test('a body that isn’t JSON is refused with 400', async () => {
  const { fetchFn, calls } = fakeFetch();
  expect((await handlePushUnregister(request(null, { raw: '{token' }), { env: ENV, fetch: fetchFn })).status).toBe(400);
  expect(calls).toHaveLength(0);
});

test(`a body over ${String(MAX_BODY_BYTES)} bytes is refused with 413 before any fetch`, async () => {
  const { fetchFn, calls } = fakeFetch();
  const raw = JSON.stringify({ token: TOKEN, device_secret: SECRET, padding: 'x'.repeat(MAX_BODY_BYTES) });
  expect((await handlePushUnregister(request(null, { raw }), { env: ENV, fetch: fetchFn })).status).toBe(413);
  expect(calls).toHaveLength(0);
});

test('a method other than POST is refused with 405', async () => {
  const { fetchFn, calls } = fakeFetch();
  expect((await handlePushUnregister(request(null, { method: 'GET' }), { env: ENV, fetch: fetchFn })).status).toBe(405);
  expect(calls).toHaveLength(0);
});

test('a database failure answers 500, so the phone keeps the token and tries again', async () => {
  const { fetchFn } = fakeFetch(() => json(500, { message: 'boom' }));
  expect((await handlePushUnregister(request({ token: TOKEN, device_secret: SECRET }), { env: ENV, fetch: fetchFn })).status).toBe(500);
});

test('logs only an outcome word, never the token or the secret', async () => {
  const { fetchFn } = fakeFetch();
  await handlePushUnregister(request({ token: TOKEN, device_secret: SECRET }), { env: ENV, fetch: fetchFn });
  expect(infoSpy.mock.calls).toEqual([[JSON.stringify({ outcome: 'unregistered' })]]);
});
