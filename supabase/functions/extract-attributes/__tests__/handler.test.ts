/** @jest-environment node */
// supabase/functions/extract-attributes/__tests__/handler.test.ts
import { readFileSync } from 'node:fs';

import { type ExtractEnv, handleExtract } from '../handler.ts';

const { jest } = import.meta;

const GARMENT_ID = '3f0c9a52-6d1e-4c8b-9a77-2b1f5e0d4c11';
const USER_ID = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

const ENV: ExtractEnv = {
  supabaseUrl: 'http://supabase.test',
  serviceRoleKey: 'service-role-test',
  webhookSecret: 'webhook-secret-test',
  anthropicApiKey: 'anthropic-key-test',
  anthropicBaseUrl: 'http://anthropic.test',
};

// Larger than one base64 chunk so the chunked encoder's seams are exercised.
const IMAGE = Uint8Array.from({ length: 100_003 }, (_, index) => (index * 31 + 7) % 256);
const IMAGE_BASE64 = Buffer.from(IMAGE).toString('base64');

function fixture(name: string): unknown {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed fixture directory in the repo, not user input.
  return JSON.parse(readFileSync(new URL(`../../_shared/__tests__/fixtures/${name}.json`, import.meta.url), 'utf8')) as unknown;
}

type RouteName = 'garment' | 'rpc' | 'profile' | 'storage' | 'claude' | 'patch';
type Call = { route: RouteName; method: string; url: string; headers: Headers; body: string | undefined };
type Handler = (init: RequestInit) => Response | Promise<Response>;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const DEFAULT_ROUTES: Record<RouteName, Handler> = {
  garment: () => json(200, [{ id: GARMENT_ID, user_id: USER_ID, extraction_status: 'pending', reviewed_at: null }]),
  rpc: () => json(200, true),
  profile: () => json(200, [{ clothing_type: 'masculine' }]),
  storage: () => new Response(IMAGE, { status: 200, headers: { 'content-type': 'image/webp' } }),
  claude: () => json(200, fixture('claude-ok')),
  patch: () => json(200, [{ id: GARMENT_ID }]),
};

function routeOf(method: string, url: URL): RouteName {
  if (url.origin === ENV.anthropicBaseUrl && url.pathname === '/v1/messages' && method === 'POST') return 'claude';
  if (url.pathname === '/rest/v1/garments' && method === 'GET') return 'garment';
  if (url.pathname === '/rest/v1/garments' && method === 'PATCH') return 'patch';
  if (url.pathname === '/rest/v1/rpc/consume_quota' && method === 'POST') return 'rpc';
  if (url.pathname === '/rest/v1/profiles' && method === 'GET') return 'profile';
  if (url.pathname.startsWith('/storage/v1/object/') && method === 'GET') return 'storage';
  throw new Error(`unexpected request ${method} ${url.href}`);
}

/** A fake `fetch` that routes by URL and method and records every call. */
function fakeFetch(overrides: Partial<Record<RouteName, Handler>> = {}) {
  const calls: Call[] = [];
  const routes = new Map(Object.entries({ ...DEFAULT_ROUTES, ...overrides })) as Map<RouteName, Handler>;
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init.method ?? 'GET';
    const route = routeOf(method, new URL(href));
    calls.push({
      route,
      method,
      url: href,
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? init.body : undefined,
    });
    const handler = routes.get(route);
    if (handler === undefined) throw new Error(`no handler for ${route}`);
    return handler(init);
  };
  return { fetch, calls };
}

function webhook(
  body: unknown = { garment_id: GARMENT_ID },
  { secret = ENV.webhookSecret, method = 'POST' }: { secret?: string; method?: string } = {},
): Request {
  return new Request('http://functions.test/extract-attributes', {
    method,
    headers: { 'content-type': 'application/json', 'x-webhook-secret': secret },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}

function patchBody(calls: Call[]): Record<string, unknown> {
  const patch = calls.find((call) => call.route === 'patch');
  if (patch?.body === undefined) throw new Error('no PATCH call');
  return JSON.parse(patch.body) as Record<string, unknown>;
}

let infoSpy: jest.SpyInstance<void, Parameters<typeof console.info>>;

beforeEach(() => {
  infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  infoSpy.mockRestore();
  jest.useRealTimers();
});

describe('request checks', () => {
  test('a wrong secret is rejected with 401 before any fetch', async () => {
    const { fetch, calls } = fakeFetch();
    const response = await handleExtract(webhook(undefined, { secret: 'nope' }), { env: ENV, fetch });
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test('a secret of the right length that differs only in its last character is rejected with 401', async () => {
    const { fetch, calls } = fakeFetch();
    const almost = `${ENV.webhookSecret.slice(0, -1)}X`;
    expect((await handleExtract(webhook(undefined, { secret: almost }), { env: ENV, fetch })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test('a missing secret is rejected with 401', async () => {
    const { fetch, calls } = fakeFetch();
    const request = new Request('http://functions.test/extract-attributes', {
      method: 'POST',
      body: JSON.stringify({ garment_id: GARMENT_ID }),
    });
    expect((await handleExtract(request, { env: ENV, fetch })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test('a method other than POST is rejected with 405', async () => {
    const { fetch, calls } = fakeFetch();
    const response = await handleExtract(webhook(undefined, { method: 'GET' }), { env: ENV, fetch });
    expect(response.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  test.each([
    ['a bad uuid', { garment_id: 'not-a-uuid' }],
    ['a missing garment_id', {}],
    ['a non-object body', [GARMENT_ID]],
  ])('%s is rejected with 400', async (_label, body) => {
    const { fetch, calls } = fakeFetch();
    const response = await handleExtract(webhook(body), { env: ENV, fetch });
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('extraction', () => {
  test('the happy path loads, consumes quota, reads the profile and photo, asks Claude and writes back', async () => {
    const { fetch, calls } = fakeFetch();
    const response = await handleExtract(webhook(), { env: ENV, fetch });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'done' });
    expect(calls.map((call) => `${call.method} ${call.route}`)).toEqual([
      'GET garment',
      'POST rpc',
      'GET profile',
      'GET storage',
      'POST claude',
      'PATCH patch',
    ]);

    const [garment, rpc, profile, storage, claude, patch] = calls;
    expect(garment?.url).toBe(
      `${ENV.supabaseUrl}/rest/v1/garments?id=eq.${GARMENT_ID}&select=id,user_id,extraction_status,reviewed_at`,
    );
    for (const call of [garment, rpc, profile, storage, patch]) {
      expect(call?.headers.get('apikey')).toBe(ENV.serviceRoleKey);
      expect(call?.headers.get('authorization')).toBe(`Bearer ${ENV.serviceRoleKey}`);
    }
    expect(JSON.parse(rpc?.body ?? '')).toEqual({ p_user_id: USER_ID, p_kind: 'extraction', p_limit: 100 });
    expect(profile?.url).toBe(`${ENV.supabaseUrl}/rest/v1/profiles?user_id=eq.${USER_ID}&select=clothing_type`);
    expect(storage?.url).toBe(`${ENV.supabaseUrl}/storage/v1/object/garments/${USER_ID}/${GARMENT_ID}/full.webp`);

    expect(claude?.headers.get('x-api-key')).toBe(ENV.anthropicApiKey);
    expect(claude?.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(claude?.headers.get('content-type')).toBe('application/json');
    const claudeBody = JSON.parse(claude?.body ?? '') as {
      messages: { content: { type: string; source?: { data: string } }[] }[];
      output_config: { format: { schema: { properties: { category: { enum: string[] } } } } };
    };
    expect(claudeBody.messages[0]?.content[0]?.source?.data).toBe(IMAGE_BASE64);
    // The profile said masculine, so the schema offers no feminine-only categories.
    expect(claudeBody.output_config.format.schema.properties.category.enum).not.toContain('skirt');

    expect(patch?.url).toContain(`id=eq.${GARMENT_ID}`);
    expect(patch?.url).toContain('extraction_status=eq.pending');
    // A review saved while the extraction ran (a device clock ahead, or a slow model) is never overwritten.
    expect(patch?.url).toContain('reviewed_at=is.null');
    // The write returns the ids it matched, so a write that matched nothing is reported as skipped.
    expect(patch?.url).toContain('select=id');
    expect(patch?.headers.get('prefer')).toBe('return=representation');
    expect(patchBody(calls)).toEqual({
      category: 'jeans',
      colors: ['navy', 'light_blue'],
      pattern: 'solid',
      material: 'denim',
      formality: 2,
      seasons: ['spring', 'autumn', 'winter'],
      warmth: 2,
      fit: 'regular',
      occasions: ['university', 'going_out', 'home'],
      uncertain_fields: [],
      extraction_status: 'done',
    });
  });

  test.each([
    'claude-adversarial-extra-fields',
    'claude-adversarial-out-of-enum',
    'claude-adversarial-instruction',
  ])('%s writes only the attribute columns, uncertain_fields and done, to a pending row', async (name) => {
    const { fetch, calls } = fakeFetch({ claude: () => json(200, fixture(name)) });
    const response = await handleExtract(webhook(), { env: ENV, fetch });

    expect(await response.json()).toEqual({ outcome: 'done' });
    const patch = calls.find((call) => call.route === 'patch');
    expect(patch?.url).toContain(`id=eq.${GARMENT_ID}`);
    expect(patch?.url).toContain('extraction_status=eq.pending');
    const body = patchBody(calls);
    expect(Object.keys(body).sort()).toEqual([
      'category',
      'colors',
      'extraction_status',
      'fit',
      'formality',
      'material',
      'occasions',
      'pattern',
      'seasons',
      'uncertain_fields',
      'warmth',
    ]);
    expect(body.extraction_status).toBe('done');
    expect(JSON.stringify(body)).not.toMatch(/ignore|system|override|update|javascript/i);
  });

  test('a profile without a clothing type offers every category', async () => {
    const { fetch, calls } = fakeFetch({ profile: () => json(200, [{ clothing_type: null }]) });
    await handleExtract(webhook(), { env: ENV, fetch });
    const claude = calls.find((call) => call.route === 'claude');
    const body = JSON.parse(claude?.body ?? '') as {
      output_config: { format: { schema: { properties: { category: { enum: string[] } } } } };
    };
    expect(body.output_config.format.schema.properties.category.enum).toEqual(
      expect.arrayContaining(['skirt', 'tie']),
    );
  });

  test('an exhausted quota marks the garment over_quota and never calls Claude', async () => {
    const { fetch, calls } = fakeFetch({ rpc: () => json(200, false) });
    const response = await handleExtract(webhook(), { env: ENV, fetch });

    expect(await response.json()).toEqual({ outcome: 'over_quota' });
    expect(calls.some((call) => call.route === 'claude')).toBe(false);
    expect(calls.find((call) => call.route === 'patch')?.url).toContain('extraction_status=eq.pending');
    expect(patchBody(calls)).toEqual({ extraction_status: 'over_quota' });
  });

  test.each([
    ['Claude answers 500', { claude: () => json(500, { type: 'error' }) }],
    ['Claude is unreachable', { claude: () => Promise.reject(new TypeError('fetch failed')) }],
    ['Claude refuses', { claude: () => json(200, fixture('claude-refusal')) }],
    ['Claude answers garbage', { claude: () => json(200, fixture('claude-invalid')) }],
    ['the photo is not a garment', { claude: () => json(200, fixture('claude-not-garment')) }],
    ['Claude answers a non-JSON body', { claude: () => new Response('<html>', { status: 200 }) }],
    ['the photo is missing (storage 404)', { storage: () => json(404, { error: 'not_found' }) }],
    ['the quota check errors', { rpc: () => json(500, { message: 'boom' }) }],
  ] satisfies [string, Partial<Record<RouteName, Handler>>][])('%s → failed', async (_label, overrides) => {
    const { fetch, calls } = fakeFetch(overrides);
    const response = await handleExtract(webhook(), { env: ENV, fetch });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'failed' });
    expect(calls.at(-1)?.route).toBe('patch');
    expect(calls.at(-1)?.url).toContain('extraction_status=eq.pending');
    expect(patchBody(calls)).toEqual({ extraction_status: 'failed' });
  });

  test('a Claude call that never resolves is aborted after 30 s and marks the garment failed', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    const { fetch, calls } = fakeFetch({
      claude: (init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    });

    const pending = handleExtract(webhook(), { env: ENV, fetch });
    await jest.advanceTimersByTimeAsync(29_999);
    expect(calls.map((call) => call.route)).toEqual(['garment', 'rpc', 'profile', 'storage', 'claude']);

    await jest.advanceTimersByTimeAsync(1);
    const response = await pending;
    expect(await response.json()).toEqual({ outcome: 'failed' });
    expect(patchBody(calls)).toEqual({ extraction_status: 'failed' });
  });

  test('a garment that is no longer pending is skipped with no further calls', async () => {
    const { fetch, calls } = fakeFetch({
      garment: () => json(200, [{ id: GARMENT_ID, user_id: USER_ID, extraction_status: 'done', reviewed_at: null }]),
    });
    const response = await handleExtract(webhook(), { env: ENV, fetch });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'skipped' });
    expect(calls.map((call) => call.route)).toEqual(['garment']);
  });

  test('a garment the user already reviewed is skipped with no quota, Claude or write-back', async () => {
    const { fetch, calls } = fakeFetch({
      garment: () =>
        json(200, [{ id: GARMENT_ID, user_id: USER_ID, extraction_status: 'pending', reviewed_at: '2026-11-09T12:00:00Z' }]),
    });
    const response = await handleExtract(webhook(), { env: ENV, fetch });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'skipped' });
    expect(calls.map((call) => call.route)).toEqual(['garment']);
  });

  test('a garment reviewed while Claude was answering is skipped: the guarded write matched no row', async () => {
    const { fetch, calls } = fakeFetch({ patch: () => json(200, []) });
    const response = await handleExtract(webhook(), { env: ENV, fetch });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'skipped' });
    expect(calls.at(-1)?.route).toBe('patch');
    expect(infoSpy.mock.calls).toEqual([[JSON.stringify({ garment_id: GARMENT_ID, outcome: 'skipped' })]]);
  });

  test('an over-quota write that matched no row is skipped too', async () => {
    const { fetch } = fakeFetch({ rpc: () => json(200, false), patch: () => json(200, []) });
    const response = await handleExtract(webhook(), { env: ENV, fetch });
    expect(await response.json()).toEqual({ outcome: 'skipped' });
  });

  test('a write-back answer that is not an array answers 500', async () => {
    const { fetch } = fakeFetch({ patch: () => json(200, { id: GARMENT_ID }) });
    const response = await handleExtract(webhook(), { env: ENV, fetch });
    expect(response.status).toBe(500);
  });

  test('a garment that does not exist is skipped', async () => {
    const { fetch, calls } = fakeFetch({ garment: () => json(200, []) });
    const response = await handleExtract(webhook(), { env: ENV, fetch });
    expect(await response.json()).toEqual({ outcome: 'skipped' });
    expect(calls).toHaveLength(1);
  });

  test('a database error loading the garment answers 500 without calling Claude', async () => {
    const { fetch, calls } = fakeFetch({ garment: () => json(503, { message: 'unavailable' }) });
    const response = await handleExtract(webhook(), { env: ENV, fetch });
    expect(response.status).toBe(500);
    expect(calls.map((call) => call.route)).toEqual(['garment']);
  });
});

describe('logging', () => {
  test('logs only the garment id and the outcome, never the image, prompt or model output', async () => {
    const otherSpies = (['log', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    const { fetch } = fakeFetch();
    await handleExtract(webhook(), { env: ENV, fetch });
    const { fetch: failingFetch } = fakeFetch({ claude: () => json(200, fixture('claude-invalid')) });
    await handleExtract(webhook(), { env: ENV, fetch: failingFetch });

    expect(infoSpy.mock.calls).toEqual([
      [JSON.stringify({ garment_id: GARMENT_ID, outcome: 'done' })],
      [JSON.stringify({ garment_id: GARMENT_ID, outcome: 'failed' })],
    ]);
    for (const args of infoSpy.mock.calls) {
      const line = args.map(String).join(' ');
      expect(line).not.toContain('data:');
      expect(line).not.toContain('base64');
      expect(line).not.toContain(IMAGE_BASE64.slice(0, 64));
      expect(line).not.toContain('jeans');
    }
    for (const spy of otherSpies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
