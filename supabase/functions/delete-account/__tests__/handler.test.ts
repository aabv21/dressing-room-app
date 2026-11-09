/** @jest-environment node */
// supabase/functions/delete-account/__tests__/handler.test.ts
import { KeyObject } from 'node:crypto';

import type { AppleEnv } from '../../_shared/apple.ts';
import type { SupabaseEnv } from '../../_shared/userContext.ts';
import { handleDeleteAccount, LIST_CONCURRENCY, REMOVE_CHUNK } from '../handler.ts';

const { jest } = import.meta;

const USER_ID = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER_ID = '9b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
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

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const garmentId = (n: number): string => `10000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

/** `count` garment folders under `userId/`, each holding `full.webp` and `thumb.webp`. */
function photoPaths(userId: string, count: number): string[] {
  return Array.from({ length: count }, (_, n) => [`${userId}/${garmentId(n)}/full.webp`, `${userId}/${garmentId(n)}/thumb.webp`]).flat();
}

type Step =
  | { kind: 'whoami' }
  | { kind: 'list'; prefix: string; offset: number }
  | { kind: 'remove'; paths: string[] }
  | { kind: 'token' }
  | { kind: 'revoke'; token: string | null }
  | { kind: 'deleteUser'; id: string };

type World = {
  objects: Set<string>;
  tokens: Map<string, string>;
  users: Set<string>;
  failRemoveAt?: number;
  failList?: boolean;
  /** The most storage list calls in flight at once, recorded by the fake. */
  listPeak?: number;
  revoke?: () => Response | Promise<Response>;
  tokenRead?: () => Response | Promise<Response>;
  deleteUser?: () => Response | Promise<Response>;
  /** Overrides `GET /auth/v1/user`; by default it answers the token's user while it exists, else GoTrue's 403 user_not_found. */
  whoami?: () => Response | Promise<Response>;
};

/** Storage's `list`: the entries one level under `prefix`, folders with a null id, sorted by name and paged. */
function listEntries(objects: ReadonlySet<string>, prefix: string, limit: number, offset: number): unknown[] {
  const entries = new Map<string, boolean>();
  for (const path of objects) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    entries.set(slash === -1 ? rest : rest.slice(0, slash), slash !== -1);
  }
  return [...entries]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(offset, offset + limit)
    .map(([name, folder]) => (folder ? { name, id: null, metadata: null } : { name, id: `obj-${name}`, metadata: { size: 1 } }));
}

const hrefOf = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

function fakeFetch(world: World): { fetch: typeof fetch; steps: Step[] } {
  const steps: Step[] = [];
  let removes = 0;
  let listsInFlight = 0;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(hrefOf(input));
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? init.body : '';
    if (url.origin === ENV.supabaseUrl && url.pathname === '/auth/v1/user' && method === 'GET') {
      // The caller check goes as the caller: the user's own token with the anon key.
      expect(headers.get('authorization')).toBe(AUTH);
      expect(headers.get('apikey')).toBe('anon-key-test');
      steps.push({ kind: 'whoami' });
      if (world.whoami !== undefined) return world.whoami();
      if (!world.users.has(USER_ID)) {
        return json(403, { code: 403, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' });
      }
      return json(200, { id: USER_ID, aud: 'authenticated', role: 'authenticated' });
    }
    if (url.origin === ENV.supabaseUrl) {
      // Everything this function sends to Supabase goes with the service role.
      expect(headers.get('authorization')).toBe('Bearer service-role-test');
      expect(headers.get('apikey')).toBe('service-role-test');
    }
    if (url.origin === ENV.supabaseUrl && url.pathname === '/storage/v1/object/list/garments' && method === 'POST') {
      const { prefix, limit, offset } = JSON.parse(body) as { prefix: string; limit: number; offset: number };
      steps.push({ kind: 'list', prefix, offset });
      if (world.failList === true) return json(500, { error: 'boom' });
      listsInFlight += 1;
      world.listPeak = Math.max(world.listPeak ?? 0, listsInFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      listsInFlight -= 1;
      return json(200, listEntries(world.objects, prefix, limit, offset));
    }
    if (url.origin === ENV.supabaseUrl && url.pathname === '/storage/v1/object/garments' && method === 'DELETE') {
      const { prefixes } = JSON.parse(body) as { prefixes: string[] };
      steps.push({ kind: 'remove', paths: prefixes });
      removes += 1;
      if (world.failRemoveAt === removes) return Promise.reject(new TypeError('network dropped'));
      for (const path of prefixes) world.objects.delete(path);
      return json(200, prefixes.map((name) => ({ name })));
    }
    if (url.origin === ENV.supabaseUrl && url.pathname === '/rest/v1/apple_tokens' && method === 'GET') {
      steps.push({ kind: 'token' });
      if (world.tokenRead !== undefined) return world.tokenRead();
      const userId = url.searchParams.get('user_id')?.replace(/^eq\./, '') ?? '';
      const stored = world.tokens.get(userId);
      return json(200, stored === undefined ? [] : [{ refresh_token: stored }]);
    }
    if (url.origin === 'http://apple.test' && url.pathname === '/auth/revoke' && method === 'POST') {
      steps.push({ kind: 'revoke', token: new URLSearchParams(body).get('token') });
      return (world.revoke ?? (() => new Response(null, { status: 200 })))();
    }
    if (url.origin === ENV.supabaseUrl && url.pathname.startsWith('/auth/v1/admin/users/') && method === 'DELETE') {
      const id = url.pathname.slice('/auth/v1/admin/users/'.length);
      steps.push({ kind: 'deleteUser', id });
      if (world.deleteUser !== undefined) return world.deleteUser();
      if (!world.users.delete(id)) return json(404, { code: 404, error_code: 'user_not_found', msg: 'User not found' });
      // The auth user's rows cascade away with it.
      world.tokens.delete(id);
      return json(200, {});
    }
    throw new Error(`unexpected request ${method} ${url.href}`);
  }) as typeof fetch;
  return { fetch: fetchFn, steps };
}

function world(overrides: Partial<World> = {}): World {
  return {
    objects: new Set([...photoPaths(USER_ID, 3), ...photoPaths(OTHER_ID, 2)]),
    tokens: new Map([
      [USER_ID, 'refresh-user'],
      [OTHER_ID, 'refresh-other'],
    ]),
    users: new Set([USER_ID, OTHER_ID]),
    ...overrides,
  };
}

function request(init: { method?: string; auth?: string | null } = {}): Request {
  const headers = new Headers();
  const header = init.auth === undefined ? AUTH : init.auth;
  if (header !== null) headers.set('authorization', header);
  return new Request('http://functions.test/delete-account', { method: init.method ?? 'POST', headers });
}

let infoSpy: jest.SpiedFunction<typeof console.info>;

beforeEach(() => {
  infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  infoSpy.mockRestore();
});

const kinds = (steps: readonly Step[]): string[] => steps.map((step) => step.kind);
const removed = (steps: readonly Step[]): string[] => steps.flatMap((step) => (step.kind === 'remove' ? step.paths : []));

describe('delete-account', () => {
  test('removes every object under the caller, revokes Apple, then deletes the user, in that order', async () => {
    const state = world();
    const { fetch: fetchFn, steps } = fakeFetch(state);

    const response = await handleDeleteAccount(request(), { env: ENV, apple, fetch: fetchFn, now: () => NOW });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'deleted' });
    expect(removed(steps).sort()).toEqual(photoPaths(USER_ID, 3).sort());
    expect([...state.objects].sort()).toEqual(photoPaths(OTHER_ID, 2).sort());

    const order = kinds(steps).filter((kind) => kind !== 'list');
    expect(order).toEqual(['whoami', 'remove', 'token', 'revoke', 'deleteUser']);
    expect(steps[0]).toEqual({ kind: 'whoami' });
    expect(steps.findLastIndex((step) => step.kind === 'list')).toBeLessThan(steps.findIndex((step) => step.kind === 'remove'));
    expect(steps.find((step) => step.kind === 'revoke')).toEqual({ kind: 'revoke', token: 'refresh-user' });
    expect(steps.find((step) => step.kind === 'deleteUser')).toEqual({ kind: 'deleteUser', id: USER_ID });
    expect(state.users.has(USER_ID)).toBe(false);
    expect(state.users.has(OTHER_ID)).toBe(true);
  });

  test('lists every page and removes in chunks of 1000 when there are more than 1000 objects', async () => {
    // 1001 garment folders → two pages of the user folder, and 2002 objects → three remove calls.
    const state = world({ objects: new Set([...photoPaths(USER_ID, 1001), ...photoPaths(OTHER_ID, 2)]) });
    const { fetch: fetchFn, steps } = fakeFetch(state);

    const response = await handleDeleteAccount(request(), { env: ENV, apple, fetch: fetchFn, now: () => NOW });

    expect(response.status).toBe(200);
    expect(REMOVE_CHUNK).toBe(1000);
    const userFolderPages = steps.filter((step) => step.kind === 'list' && step.prefix === `${USER_ID}/`);
    expect(userFolderPages.map((step) => (step.kind === 'list' ? step.offset : -1))).toEqual([0, 1000]);
    const chunks = steps.flatMap((step) => (step.kind === 'remove' ? [step.paths.length] : []));
    expect(chunks).toEqual([1000, 1000, 2]);
    expect(removed(steps)).toHaveLength(2002);
    expect([...state.objects].filter((path) => path.startsWith(`${USER_ID}/`))).toEqual([]);
    expect(removed(steps).every((path) => path.startsWith(`${USER_ID}/`))).toBe(true);
  });

  test.each([
    ['Apple refuses the revoke', { revoke: () => json(400, { error: 'invalid_client' }) }],
    ['Apple is unreachable', { revoke: () => Promise.reject(new TypeError('fetch failed')) }],
    ['the token row cannot be read', { tokenRead: () => json(500, { message: 'boom' }) }],
  ] satisfies [string, Partial<World>][])('still deletes the user when %s', async (_name, overrides) => {
    const state = world(overrides);
    const { fetch: fetchFn, steps } = fakeFetch(state);

    const response = await handleDeleteAccount(request(), { env: ENV, apple, fetch: fetchFn, now: () => NOW });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'deleted' });
    expect(kinds(steps).at(-1)).toBe('deleteUser');
    expect(state.users.has(USER_ID)).toBe(false);
  });

  test('skips the revoke when the user has no Apple token, and when the Apple env is missing', async () => {
    const noToken = world({ tokens: new Map() });
    const first = fakeFetch(noToken);
    const response = await handleDeleteAccount(request(), { env: ENV, apple, fetch: first.fetch, now: () => NOW });
    expect(response.status).toBe(200);
    expect(kinds(first.steps)).not.toContain('revoke');

    const noApple = world();
    const second = fakeFetch(noApple);
    const skipped = await handleDeleteAccount(request(), { env: ENV, apple: null, fetch: second.fetch, now: () => NOW });
    expect(skipped.status).toBe(200);
    expect(kinds(second.steps)).not.toContain('token');
    expect(kinds(second.steps)).not.toContain('revoke');
    expect(noApple.users.has(USER_ID)).toBe(false);
  });

  test('a retry after the user is already gone answers deleted', async () => {
    const state = world();
    const first = fakeFetch(state);
    await handleDeleteAccount(request(), { env: ENV, apple, fetch: first.fetch, now: () => NOW });
    expect(state.users.has(USER_ID)).toBe(false);

    const retry = fakeFetch(state);
    const response = await handleDeleteAccount(request(), { env: ENV, apple, fetch: retry.fetch, now: () => NOW });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'deleted' });
    // The caller check finds the user gone, so nothing else is touched.
    expect(kinds(retry.steps)).toEqual(['whoami']);
  });

  test.each([
    ['GoTrue’s 403 user_not_found', () => json(403, { code: 403, error_code: 'user_not_found', msg: 'gone' })],
    ['a 404 with user_not_found', () => json(404, { code: 404, error_code: 'user_not_found', msg: 'User not found' })],
  ])('answers deleted without touching anything when the caller check gives %s', async (_name, whoami) => {
    const state = world({ whoami });
    const { fetch: fetchFn, steps } = fakeFetch(state);

    const response = await handleDeleteAccount(request(), { env: ENV, apple, fetch: fetchFn, now: () => NOW });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'deleted' });
    expect(kinds(steps)).toEqual(['whoami']);
    expect(state.objects.size).toBe(10);
  });

  test.each([
    ['answers 500', () => json(500, { msg: 'boom' })],
    ['answers a bare 404 (a misrouted gateway)', () => json(404, { message: 'no Route matched with those values' })],
    ['answers 403 for another reason', () => json(403, { code: 403, error_code: 'session_not_found', msg: 'no session' })],
    ['is unreachable', () => Promise.reject(new TypeError('fetch failed'))],
    ['names another user', () => json(200, { id: OTHER_ID })],
    ['answers something that is not a user', () => json(200, { nope: true })],
  ] satisfies [string, () => Response | Promise<Response>][])(
    'answers 500 and deletes nothing when the caller check %s',
    async (_name, whoami) => {
      const state = world({ whoami });
      const { fetch: fetchFn, steps } = fakeFetch(state);

      const response = await handleDeleteAccount(request(), { env: ENV, apple, fetch: fetchFn, now: () => NOW });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'internal' });
      expect(kinds(steps)).toEqual(['whoami']);
      expect(state.users.has(USER_ID)).toBe(true);
      expect(state.objects.size).toBe(10);
    },
  );

  test('lists the garment folders a few at a time, all before the first removal', async () => {
    const state = world({ objects: new Set([...photoPaths(USER_ID, 40), ...photoPaths(OTHER_ID, 2)]) });
    const { fetch: fetchFn, steps } = fakeFetch(state);

    const response = await handleDeleteAccount(request(), { env: ENV, apple, fetch: fetchFn, now: () => NOW });

    expect(response.status).toBe(200);
    expect(LIST_CONCURRENCY).toBe(5);
    expect(state.listPeak).toBeGreaterThan(1);
    expect(state.listPeak).toBeLessThanOrEqual(LIST_CONCURRENCY);
    expect(steps.filter((step) => step.kind === 'list')).toHaveLength(41);
    expect(steps.findLastIndex((step) => step.kind === 'list')).toBeLessThan(steps.findIndex((step) => step.kind === 'remove'));
    expect(removed(steps)).toHaveLength(80);
  });

  test('a network drop during removal keeps the user, and a retry finishes the job', async () => {
    const state = world({ objects: new Set([...photoPaths(USER_ID, 600), ...photoPaths(OTHER_ID, 2)]), failRemoveAt: 2 });
    const first = fakeFetch(state);

    const failed = await handleDeleteAccount(request(), { env: ENV, apple, fetch: first.fetch, now: () => NOW });

    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'internal' });
    expect(kinds(first.steps)).not.toContain('revoke');
    expect(kinds(first.steps)).not.toContain('deleteUser');
    expect(state.users.has(USER_ID)).toBe(true);
    expect([...state.objects].filter((path) => path.startsWith(`${USER_ID}/`))).toHaveLength(200);

    delete state.failRemoveAt;
    const retry = fakeFetch(state);
    const response = await handleDeleteAccount(request(), { env: ENV, apple, fetch: retry.fetch, now: () => NOW });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'deleted' });
    expect(removed(retry.steps)).toHaveLength(200);
    expect(kinds(retry.steps).filter((kind) => kind !== 'list')).toEqual(['whoami', 'remove', 'token', 'revoke', 'deleteUser']);
    expect(state.users.has(USER_ID)).toBe(false);
  });

  test('a failed listing deletes nothing and answers 500', async () => {
    const state = world({ failList: true });
    const { fetch: fetchFn, steps } = fakeFetch(state);

    const response = await handleDeleteAccount(request(), { env: ENV, apple, fetch: fetchFn, now: () => NOW });

    expect(response.status).toBe(500);
    expect(kinds(steps)).toEqual(['whoami', 'list']);
    expect(state.users.has(USER_ID)).toBe(true);
  });

  test('a failed user deletion answers 500, so the app can retry', async () => {
    const state = world({ deleteUser: () => json(500, { msg: 'boom' }) });
    const { fetch: fetchFn } = fakeFetch(state);

    const response = await handleDeleteAccount(request(), { env: ENV, apple, fetch: fetchFn, now: () => NOW });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal' });
  });

  test('answers 401 without a user token and 405 for another method, touching nothing', async () => {
    const state = world();
    const { fetch: fetchFn, steps } = fakeFetch(state);

    const anon = await handleDeleteAccount(request({ auth: `Bearer ${token({ role: 'anon' })}` }), { env: ENV, apple, fetch: fetchFn });
    expect(anon.status).toBe(401);
    const missing = await handleDeleteAccount(request({ auth: null }), { env: ENV, apple, fetch: fetchFn });
    expect(missing.status).toBe(401);
    const get = await handleDeleteAccount(request({ method: 'GET' }), { env: ENV, apple, fetch: fetchFn });
    expect(get.status).toBe(405);
    expect(steps).toHaveLength(0);
  });

  test('logs only outcome words, never the token or the user id', async () => {
    const { fetch: fetchFn } = fakeFetch(world());

    await handleDeleteAccount(request(), { env: ENV, apple, fetch: fetchFn, now: () => NOW });

    const logged = infoSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).toContain('deleted');
    expect(logged).not.toContain('refresh-user');
    expect(logged).not.toContain(USER_ID);
  });
});
