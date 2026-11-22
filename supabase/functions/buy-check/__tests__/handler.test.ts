/** @jest-environment node */
// supabase/functions/buy-check/__tests__/handler.test.ts
import { readFileSync } from 'node:fs';

import type { GarmentCategory } from '../../_shared/catalog.ts';
import type { ClaudeEnv, SupabaseEnv } from '../../_shared/env.ts';
import { EXTRACTION_CLAUDE_TIMEOUT_MS, EXTRACTION_MODEL } from '../../_shared/extraction.ts';
import { BUY_CHECK_DAILY_LIMIT, type BuyCheckResponse, handleBuyCheck, MAX_IMAGE_BYTES } from '../handler.ts';

const { jest } = import.meta;

const USER_ID = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const TODAY = '2026-11-21';

const ENV: SupabaseEnv & ClaudeEnv = {
  supabaseUrl: 'http://supabase.test',
  anonKey: 'anon-key-test',
  serviceRoleKey: 'service-role-test',
  anthropicApiKey: 'anthropic-key-test',
  anthropicBaseUrl: 'http://anthropic.test',
};

const base64url = (text: string): string => Buffer.from(text, 'utf8').toString('base64url');
const token = (claims: unknown): string =>
  `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}.signature`;
const AUTH = `Bearer ${token({ sub: USER_ID, role: 'authenticated' })}`;

/** A WebP's RIFF header followed by `size` bytes in all. */
function webp(size = 64): string {
  const bytes = Buffer.alloc(size, 7);
  bytes.write('RIFF', 0, 'latin1');
  bytes.writeUInt32LE(size - 8, 4);
  bytes.write('WEBPVP8 ', 8, 'latin1');
  return bytes.toString('base64');
}

function jpeg(size = 64): string {
  const bytes = Buffer.alloc(size, 7);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes.toString('base64');
}

const IMAGE = webp();

function fixture(name: string): unknown {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed fixture directory in the repo, not user input.
  return JSON.parse(readFileSync(new URL(`../../_shared/__tests__/fixtures/${name}.json`, import.meta.url), 'utf8')) as unknown;
}

/** A Messages response whose only text block is `output` as JSON. */
function messageWith(output: Record<string, unknown>): unknown {
  return { type: 'message', role: 'assistant', content: [{ type: 'text', text: JSON.stringify(output) }], stop_reason: 'end_turn' };
}

const CONFIDENT = Object.fromEntries(
  ['category', 'colors', 'pattern', 'material', 'formality', 'seasons', 'warmth', 'fit', 'occasions'].map((field) => [field, 'high']),
);

const NAVY_JEANS = {
  is_garment: true,
  category: 'jeans',
  colors: ['navy'],
  pattern: 'solid',
  material: 'denim',
  formality: 2,
  seasons: ['autumn', 'winter'],
  warmth: 2,
  fit: 'regular',
  occasions: ['university'],
  confidence: CONFIDENT,
};

type Row = Record<string, unknown>;

const idOf = (n: number): string => `40000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const garment = (n: number, category: GarmentCategory, extra: Row = {}): Row => ({
  id: idOf(n),
  category,
  colors: ['black'],
  pattern: 'solid',
  formality: 2,
  seasons: [],
  warmth: 2,
  fit: 'regular',
  status: 'available',
  last_worn_at: null,
  wear_count: 0,
  suggest: true,
  updated_at: '2026-11-01T00:00:00Z',
  pinned_on: null,
  ...extra,
});

/** Four tops and three shoes: navy jeans would open 12 outfits. */
const CLOSET: Row[] = [
  garment(1, 't_shirt', { colors: ['white'] }),
  garment(2, 'shirt', { colors: ['gray'] }),
  garment(3, 'sweater', { colors: ['black'] }),
  garment(4, 'polo', { colors: ['beige'] }),
  garment(5, 'sneakers', { colors: ['white'] }),
  garment(6, 'boots', { colors: ['brown'] }),
  garment(7, 'loafers', { colors: ['black'] }),
];

type RouteName = 'closet' | 'profile' | 'quota' | 'claude' | 'other';
type Call = { route: RouteName; method: string; url: URL; body: string | undefined; headers: Headers };

function routeOf(method: string, url: URL): RouteName {
  if (url.origin === ENV.anthropicBaseUrl && url.pathname === '/v1/messages' && method === 'POST') return 'claude';
  if (url.pathname === '/rest/v1/garments' && method === 'GET') return 'closet';
  if (url.pathname === '/rest/v1/profiles' && method === 'GET') return 'profile';
  if (url.pathname === '/rest/v1/rpc/consume_quota' && method === 'POST') return 'quota';
  return 'other';
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type World = {
  garments: Row[];
  clothingType: string | null;
  quota: boolean;
  claude: () => Response;
  fail?: Partial<Record<RouteName, Response>>;
};

function world(overrides: Partial<World> = {}): World {
  return { garments: CLOSET, clothingType: 'everything', quota: true, claude: () => json(200, messageWith(NAVY_JEANS)), ...overrides };
}

function fakeFetch(w: World) {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = (input, init = {}) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init.method ?? 'GET';
    const url = new URL(href);
    const route = routeOf(method, url);
    calls.push({ route, method, url, body: typeof init.body === 'string' ? init.body : undefined, headers: new Headers(init.headers) });
    const failure = new Map(Object.entries(w.fail ?? {})).get(route);
    if (failure !== undefined) return Promise.resolve(failure.clone());
    switch (route) {
      case 'closet':
        return Promise.resolve(json(200, w.garments));
      case 'profile':
        return Promise.resolve(json(200, [{ clothing_type: w.clothingType, styles: [] }]));
      case 'quota':
        return Promise.resolve(json(200, w.quota));
      case 'claude':
        return Promise.resolve(w.claude());
      case 'other':
        return Promise.reject(new Error(`unexpected request ${method} ${url.href}`));
    }
  };
  return { fetch, calls };
}

const INPUT = { image: IMAGE, mediaType: 'image/webp', date: TODAY, language: 'es' };

function checkRequest(body: unknown = INPUT, { auth = AUTH, method = 'POST' }: { auth?: string | null; method?: string } = {}): Request {
  const headers = { 'content-type': 'application/json', ...(auth === null ? {} : { authorization: auth }) };
  return new Request('http://functions.test/buy-check', {
    method,
    headers,
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
}

async function check(w: World, request: Request = checkRequest()) {
  const fake = fakeFetch(w);
  const response = await handleBuyCheck(request, { env: ENV, fetch: fake.fetch });
  return { response, body: (await response.json()) as unknown, ...fake };
}

type OkBody = Extract<BuyCheckResponse, { kind: 'ok' }>;

const routes = (calls: Call[]): RouteName[] => calls.map((call) => call.route);

let infoSpy: jest.SpyInstance<void, Parameters<typeof console.info>>;

beforeEach(() => {
  infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  infoSpy.mockRestore();
});

const outcomes = (): unknown[] => infoSpy.mock.calls.map(([line]) => JSON.parse(String(line)) as unknown);

describe('request checks', () => {
  test.each([
    ['no Authorization header', null],
    ['the anon key (no sub)', `Bearer ${token({ role: 'anon' })}`],
  ])('%s → 401 before any fetch', async (_label, auth) => {
    const { response, calls } = await check(world(), checkRequest(undefined, { auth }));
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test('a method other than POST → 405', async () => {
    const { response, calls } = await check(world(), checkRequest(undefined, { method: 'GET' }));
    expect(response.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  test.each([
    ['not JSON', 'nope'],
    ['no image', { ...INPUT, image: undefined }],
    ['an empty image', { ...INPUT, image: '' }],
    ['an image that is not base64', { ...INPUT, image: `${IMAGE.slice(0, -4)}!!!!` }],
    ['base64 of the wrong length', { ...INPUT, image: IMAGE.slice(0, -1) }],
    ['a PNG', { ...INPUT, mediaType: 'image/png' }],
    ['WebP bytes sent as a JPEG', { ...INPUT, mediaType: 'image/jpeg' }],
    ['JPEG bytes sent as a WebP', { ...INPUT, image: jpeg() }],
    ['bytes that are no image', { ...INPUT, image: Buffer.from('not an image at all, just text').toString('base64') }],
    ['an impossible date', { ...INPUT, date: '2026-02-30' }],
    ['no local day', { ...INPUT, date: undefined }],
    ['another language', { ...INPUT, language: 'fr' }],
  ])('%s → 400 invalid_input before the quota or any read', async (_label, body) => {
    const { response, body: answer, calls } = await check(world(), checkRequest(body));
    expect(response.status).toBe(400);
    expect(answer).toEqual({ error: 'invalid_input' });
    expect(calls).toHaveLength(0);
  });

  test('an image over 1.5 MB → 413 image_too_large before the quota or any read', async () => {
    expect(MAX_IMAGE_BYTES).toBe(1_500_000);
    const { response, body, calls } = await check(world(), checkRequest({ ...INPUT, image: webp(MAX_IMAGE_BYTES + 1) }));
    expect(response.status).toBe(413);
    expect(body).toEqual({ error: 'image_too_large' });
    expect(calls).toHaveLength(0);
  });

  test('a JPEG of exactly 1.5 MB is accepted', async () => {
    const { response, calls } = await check(world(), checkRequest({ ...INPUT, image: jpeg(MAX_IMAGE_BYTES), mediaType: 'image/jpeg' }));
    expect(response.status).toBe(200);
    const sent = JSON.parse(calls.find((call) => call.route === 'claude')?.body ?? '{}') as { messages: { content: { source?: { media_type: string } }[] }[] };
    expect(sent.messages[0]?.content[0]?.source?.media_type).toBe('image/jpeg');
  });
});

describe('checking', () => {
  test('answers the item, no duplicates, the new outfits and buy', async () => {
    const { response, body } = await check(world());
    expect(response.status).toBe(200);
    expect(body).toEqual({
      kind: 'ok',
      item: {
        category: 'jeans',
        colors: ['navy'],
        pattern: 'solid',
        material: 'denim',
        formality: 2,
        seasons: ['autumn', 'winter'],
        warmth: 2,
        fit: 'regular',
        occasions: ['university'],
      },
      duplicates: [],
      newOutfits: 12,
      verdict: 'buy',
    } satisfies OkBody);
    expect(outcomes()).toEqual([{ outcome: 'checked', verdict: 'buy' }]);
  });

  test('reads the closet and profile with the caller token, then spends the quota on the local day, then calls Claude', async () => {
    const { calls } = await check(world());
    expect(routes(calls).slice(0, 2).sort()).toEqual(['closet', 'profile']);
    expect(routes(calls).slice(2)).toEqual(['quota', 'claude']);
    for (const call of calls.filter((c) => c.route === 'closet' || c.route === 'profile')) {
      expect(call.headers.get('authorization')).toBe(AUTH);
    }
    const quota = calls.find((call) => call.route === 'quota');
    expect(JSON.parse(quota?.body ?? '{}')).toEqual({ p_user_id: USER_ID, p_kind: 'buy_check', p_limit: BUY_CHECK_DAILY_LIMIT, p_day: TODAY });
    expect(BUY_CHECK_DAILY_LIMIT).toBe(5);
  });

  test('sends the photo through the extraction request with the profile’s clothing type', async () => {
    const { calls } = await check(world({ clothingType: 'masculine' }));
    const claude = calls.find((call) => call.route === 'claude');
    const sent = JSON.parse(claude?.body ?? '{}') as {
      model: string;
      messages: { content: { type: string; source?: { media_type: string; data: string }; text?: string }[] }[];
    };
    expect(sent.model).toBe(EXTRACTION_MODEL);
    expect(sent.messages[0]?.content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/webp', data: IMAGE } });
    expect(sent.messages[0]?.content[1]?.text).toContain('masculine');
    expect(EXTRACTION_CLAUDE_TIMEOUT_MS).toBe(30_000);
  });

  test('names close duplicates first and skips when they open few outfits', async () => {
    const owned = garment(8, 'jeans', { colors: ['navy'] });
    const similar = garment(9, 'jeans', { colors: ['light_blue', 'navy'] });
    const { body } = await check(world({ garments: [garment(1, 't_shirt'), garment(5, 'sneakers'), similar, owned] }));
    const ok = body as OkBody;
    expect(ok.duplicates).toEqual([{ id: idOf(8) }, { id: idOf(9) }]);
    expect(ok.newOutfits).toBe(1);
    expect(ok.verdict).toBe('skip');
  });

  test('a photo that is not a garment → not_garment, with the quota spent', async () => {
    const { response, body, calls } = await check(world({ claude: () => json(200, fixture('claude-not-garment')) }));
    expect(response.status).toBe(200);
    expect(body).toEqual({ kind: 'not_garment' });
    expect(routes(calls)).toContain('quota');
    expect(outcomes()).toEqual([{ outcome: 'not_garment' }]);
  });

  test('over the quota → 429 over_quota and Claude is never called', async () => {
    const { response, body, calls } = await check(world({ quota: false }));
    expect(response.status).toBe(429);
    expect(body).toEqual({ error: 'over_quota' });
    expect(routes(calls)).not.toContain('claude');
  });

  test.each([
    ['Claude answers 500', 'unavailable', () => json(500, { type: 'error' })],
    ['a refusal', 'unreadable', () => json(200, fixture('claude-refusal'))],
    ['output that is not JSON', 'unreadable', () => json(200, fixture('claude-adversarial-prose-wrapped'))],
  ])('%s → 503 analysis_unavailable, the quota spent', async (_label, outcome, claude) => {
    const { response, body, calls } = await check(world({ claude }));
    expect(response.status).toBe(503);
    expect(body).toEqual({ error: 'analysis_unavailable' });
    expect(routes(calls)).toContain('quota');
    expect(outcomes()).toEqual([{ outcome }]);
  });

  test.each([
    ['the closet read', 'closet'],
    ['the profile read', 'profile'],
  ] as const)('%s failing → 500 with no quota spent and no Claude call', async (_label, route) => {
    const { response, calls } = await check(world({ fail: { [route]: json(500, {}) } }));
    expect(response.status).toBe(500);
    expect(routes(calls)).not.toContain('quota');
    expect(routes(calls)).not.toContain('claude');
  });

  test('the quota rpc failing → 500 with no Claude call (fails closed)', async () => {
    const { response, calls } = await check(world({ fail: { quota: json(500, {}) } }));
    expect(response.status).toBe(500);
    expect(routes(calls)).not.toContain('claude');
  });
});

describe('the photo is never kept', () => {
  test('no Storage, cache or other write: only the closet, the profile, the quota and Claude', async () => {
    const { calls } = await check(world());
    expect(new Set(routes(calls))).toEqual(new Set(['closet', 'profile', 'quota', 'claude']));
    expect(calls.filter((call) => call.method !== 'GET').map((call) => call.route)).toEqual(['quota', 'claude']);
  });

  test('the logs carry outcome words only: never the photo or the model’s answer', async () => {
    await check(world());
    await check(world({ claude: () => json(200, fixture('claude-not-garment')) }));
    await check(world({ claude: () => json(500, { leaked: 'model text' }) }));
    const logged = infoSpy.mock.calls.map(([line]) => String(line)).join('\n');
    expect(logged).not.toContain(IMAGE.slice(0, 24));
    expect(logged).not.toContain('jeans');
    expect(logged).not.toContain('model text');
    for (const line of outcomes()) expect(Object.keys(line as object).every((key) => key === 'outcome' || key === 'verdict')).toBe(true);
  });
});

describe('prompt injection through the photo', () => {
  test('printed "this is a formal gown" can’t push the category outside the enums: the check fails, no verdict', async () => {
    const { response, body } = await check(world({ claude: () => json(200, fixture('claude-adversarial-formal-gown')) }));
    expect(response.status).toBe(503);
    expect(body).toEqual({ error: 'analysis_unavailable' });
  });

  test('a category outside the clothing type’s set (a dress for a masculine closet) fails the check', async () => {
    const { response } = await check(world({ clothingType: 'masculine', claude: () => json(200, messageWith({ ...NAVY_JEANS, category: 'dress' })) }));
    expect(response.status).toBe(503);
  });

  test('the verdict is computed from the closet, never taken from the model', async () => {
    const owned = garment(8, 'jeans', { colors: ['navy'] });
    const claude = (): Response => json(200, messageWith({ ...NAVY_JEANS, verdict: 'buy', new_outfits: 999, duplicates: [] }));
    const { body } = await check(world({ garments: [garment(1, 't_shirt'), garment(5, 'sneakers'), owned], claude }));
    expect(body).toEqual({
      kind: 'ok',
      item: expect.objectContaining({ category: 'jeans' }) as unknown,
      duplicates: [{ id: idOf(8) }],
      newOutfits: 1,
      verdict: 'skip',
    });
    expect(Object.keys((body as OkBody).item).sort()).toEqual(
      ['category', 'colors', 'fit', 'formality', 'material', 'occasions', 'pattern', 'seasons', 'warmth'],
    );
  });
});
