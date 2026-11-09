/** @jest-environment node */
// supabase/functions/rate-outfit/__tests__/handler.test.ts
import { readFileSync } from 'node:fs';

import { mulberry32 } from '../../_shared/outfitRules.ts';
import { composeRating, parseJevAnswers, pickReasons, RATING_DIMENSIONS, RATING_LEVELS } from '../../_shared/rating.ts';
import type { FnEnv } from '../../_shared/userContext.ts';
import { handleRate, type RatingResult } from '../handler.ts';
import { fakeTime } from '../../_shared/__tests__/fakeTime.ts';

const { jest } = import.meta;

const USER_ID = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const TOP = '10000000-0000-4000-8000-000000000001';
const BOTTOM = '10000000-0000-4000-8000-000000000002';
const SHOES = '10000000-0000-4000-8000-000000000003';
const BOOTS = '10000000-0000-4000-8000-000000000004';
const LOAFERS = '10000000-0000-4000-8000-000000000005';
const LAUNDRY_HEELS = '10000000-0000-4000-8000-000000000006';
const OTHER_TOP = '10000000-0000-4000-8000-000000000007';
const UNREVIEWED = '10000000-0000-4000-8000-000000000008';
const DELETED = '10000000-0000-4000-8000-0000000000ff';
const DATE = '2026-11-08';

const ENV: FnEnv = {
  supabaseUrl: 'http://supabase.test',
  anonKey: 'anon-key-test',
  serviceRoleKey: 'service-role-test',
  typesafeApiKey: 'typesafe-key-test',
  typesafeBaseUrl: 'http://typesafe.test',
  anthropicApiKey: 'anthropic-key-test',
  anthropicBaseUrl: 'http://anthropic.test',
  openMeteoUrl: 'http://open-meteo.test',
  geocodingUrl: 'http://geocoding.test',
};

const base64url = (text: string): string =>
  Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (claims: unknown): string =>
  `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}.signature`;
const AUTH = `Bearer ${token({ sub: USER_ID, role: 'authenticated' })}`;

function fixture(name: string): Record<string, unknown> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed fixture directory in the repo, not user input.
  return JSON.parse(readFileSync(new URL(`../../_shared/__tests__/fixtures/${name}.json`, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;
}

type Answers = Record<string, Record<string, unknown>>;

/** A fixture with its answers changed by `change`. */
function jevFixture(name: string, change: (answers: Answers) => void = () => undefined): unknown {
  const body = structuredClone(fixture(name)) as { answers: Answers };
  change(body.answers);
  return body;
}

const LEVELS = new Map<string, number>(Object.entries(RATING_LEVELS));

/** A Jev body whose every dimension sits at `fraction` of its scale, so the composite is `round(100 · fraction)`. */
function jevAt(fraction: number, choice = 'none'): unknown {
  return {
    model: 'jev-1.14.0',
    answers: {
      ...Object.fromEntries(
        RATING_DIMENSIONS.map((dimension) => [
          dimension,
          { type: 'score', score: fraction * ((LEVELS.get(dimension) ?? 0) - 1), confidence: 0.5 },
        ]),
      ),
      inappropriate_for_occasion: { type: 'noul', noul: 0.05 },
      unsafe_for_weather: { type: 'noul', noul: 0.05 },
      weakest_piece: { type: 'choice', choice, confidence: 0.5 },
    },
  };
}

const FALLBACK_OUTPUT = {
  color_harmony: 3,
  pattern_mix: 2,
  formality_coherence: 2,
  silhouette_balance: 2,
  body_flattery: 2,
  weather_fit: 3,
  occasion_fit: 3,
  style_match: 2,
  inappropriate_for_occasion: false,
  unsafe_for_weather: false,
  weakest_piece: 'top',
};

function claudeMessage(output: unknown): unknown {
  return {
    id: 'msg_fixture_fallback',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text: JSON.stringify(output) }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1450, output_tokens: 90 },
  };
}

type Row = Record<string, unknown>;

const garment = (id: string, category: string | null, extra: Row = {}): Row => ({
  id,
  category,
  colors: ['white'],
  pattern: 'solid',
  formality: 2,
  seasons: [],
  warmth: 2,
  fit: 'regular',
  status: 'available',
  last_worn_at: null,
  updated_at: '2026-11-01T00:00:00Z',
  ...extra,
});

function closet(): Map<string, Row> {
  return new Map(
    [
      garment(TOP, 't_shirt', { colors: ['cream'] }),
      garment(BOTTOM, 'jeans', { colors: ['navy'] }),
      garment(SHOES, 'sneakers'),
      garment(BOOTS, 'boots', { colors: ['brown'] }),
      garment(LOAFERS, 'loafers', { colors: ['black'] }),
      garment(LAUNDRY_HEELS, 'heels', { status: 'laundry' }),
      garment(OTHER_TOP, 'shirt', { colors: ['light_blue'] }),
      garment(UNREVIEWED, null),
    ].map((row) => [String(row.id), row]),
  );
}

const PROFILE: Row = {
  clothing_type: 'feminine',
  body_type: 'pear',
  height_cm: 164,
  waist_cm: 71,
  hips_cm: 99,
  chest_cm: 88,
  top_size: 'M',
  age_group: '25_34',
  styles: ['casual'],
  city_name: 'Madrid',
  city_lat: 40.4168,
  city_lon: -3.7038,
  updated_at: '2026-11-01T00:00:00Z',
};

const WEATHER = { tempC: 15, condition: 'cloudy', band: 'cool', rain: false };

type RouteName =
  | 'garments'
  | 'closet'
  | 'profile'
  | 'weatherGet'
  | 'weatherPut'
  | 'forecast'
  | 'quota'
  | 'cacheGet'
  | 'cachePut'
  | 'jev'
  | 'claude';
type Call = { route: RouteName; url: URL; headers: Headers; body: string | undefined };
type JevState = { outfit: { slot: string; category: string }[]; context: { weather: unknown } };

function routeOf(method: string, url: URL): RouteName {
  if (url.origin === ENV.typesafeBaseUrl && url.pathname === '/v1/systemone' && method === 'POST') return 'jev';
  if (url.origin === ENV.anthropicBaseUrl && url.pathname === '/v1/messages' && method === 'POST') return 'claude';
  if (url.origin === ENV.openMeteoUrl && url.pathname === '/v1/forecast') return 'forecast';
  if (url.pathname === '/rest/v1/garments' && method === 'GET') return url.searchParams.has('id') ? 'garments' : 'closet';
  if (url.pathname === '/rest/v1/profiles' && method === 'GET') return 'profile';
  if (url.pathname === '/rest/v1/weather_cache') return method === 'GET' ? 'weatherGet' : 'weatherPut';
  if (url.pathname === '/rest/v1/rpc/consume_quota' && method === 'POST') return 'quota';
  if (url.pathname === '/rest/v1/rating_cache') return method === 'GET' ? 'cacheGet' : 'cachePut';
  throw new Error(`unexpected request ${method} ${url.href}`);
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type World = {
  garments: Map<string, Row>;
  profile: Row | null;
  quota: boolean;
  /** Jev's answer for one request; the default rates every outfit with jev-ok. */
  jev: (state: JevState) => Response | Promise<Response>;
  claude: () => Response | Promise<Response>;
  /** rating_cache rows by cache_key, as stored (the result keeps its internal `degraded` marker). */
  ratingCache: Map<string, { result: unknown; created_at: string }>;
  /** False: weather_cache misses and the forecast is fetched through `forecast`. */
  weatherCached: boolean;
  forecast: (init: RequestInit) => Response | Promise<Response>;
  fail?: Partial<Record<RouteName, Response>>;
};

function world(overrides: Partial<World> = {}): World {
  return {
    garments: closet(),
    profile: PROFILE,
    quota: true,
    jev: () => json(200, fixture('jev-ok')),
    claude: () => json(200, claudeMessage(FALLBACK_OUTPUT)),
    ratingCache: new Map(),
    weatherCached: true,
    forecast: () => json(500, {}),
    ...overrides,
  };
}

/** A fake `fetch` over `w` that routes by URL and method and records every call. */
function fakeFetch(w: World) {
  const calls: Call[] = [];
  let jevInFlight = 0;
  let jevPeak = 0;
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init.method ?? 'GET';
    const url = new URL(href);
    const route = routeOf(method, url);
    const body = typeof init.body === 'string' ? init.body : undefined;
    calls.push({ route, url, headers: new Headers(init.headers), body });
    const failure = new Map(Object.entries(w.fail ?? {})).get(route);
    if (failure !== undefined) return failure.clone();
    switch (route) {
      case 'garments': {
        const ids = (url.searchParams.get('id') ?? '').replace(/^in\.\(|\)$/g, '').split(',');
        return json(200, ids.flatMap((id) => w.garments.get(id) ?? []));
      }
      case 'closet':
        return json(200, [...w.garments.values()]);
      case 'profile':
        return json(200, w.profile === null ? [] : [w.profile]);
      case 'weatherGet':
        return json(200, w.weatherCached ? [{ payload: { weather: WEATHER, lat: 40.42, lon: -3.7 } }] : []);
      case 'forecast':
        return w.forecast(init);
      case 'weatherPut':
        return new Response(null, { status: 201 });
      case 'quota':
        return json(200, w.quota);
      case 'cacheGet': {
        const key = (url.searchParams.get('cache_key') ?? '').replace(/^eq\./, '');
        const row = w.ratingCache.get(key);
        return json(200, row === undefined ? [] : [row]);
      }
      case 'cachePut': {
        const row = JSON.parse(body ?? '{}') as { cache_key: string; result: unknown; created_at: string };
        w.ratingCache.set(row.cache_key, { result: row.result, created_at: row.created_at });
        return new Response(null, { status: 201 });
      }
      case 'jev': {
        jevInFlight += 1;
        jevPeak = Math.max(jevPeak, jevInFlight);
        try {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return await w.jev((JSON.parse(body ?? '{}') as { state: JevState }).state);
        } finally {
          jevInFlight -= 1;
        }
      }
      case 'claude':
        return w.claude();
    }
  };
  return { fetch, calls, jevPeak: () => jevPeak };
}

function rateRequest(
  body: unknown = { garment_ids: [TOP, BOTTOM, SHOES], occasion: 'university', date: DATE },
  { auth = AUTH, method = 'POST' }: { auth?: string | null; method?: string } = {},
): Request {
  const headers = { 'content-type': 'application/json', ...(auth === null ? {} : { authorization: auth }) };
  return new Request('http://functions.test/rate-outfit', {
    method,
    headers,
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
}

async function rate(w: World, request: Request = rateRequest()) {
  const fake = fakeFetch(w);
  const response = await handleRate(request, { env: ENV, fetch: fake.fetch, rand: mulberry32(7) });
  return { response, body: (await response.json()) as unknown, ...fake };
}

const cachedResults = (w: World): unknown[] => [...w.ratingCache.values()].map((row) => row.result);

const routes = (calls: Call[]): RouteName[] => calls.map((call) => call.route);
const count = (calls: Call[], route: RouteName): number => calls.filter((call) => call.route === route).length;
const shoesOf = (state: JevState): string | undefined => state.outfit.find((piece) => piece.slot === 'shoes')?.category;

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
    ['garbage', 'Bearer nope'],
  ])('%s → 401 before any fetch', async (_label, auth) => {
    const { response, calls } = await rate(world(), rateRequest(undefined, { auth }));
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test('a method other than POST → 405', async () => {
    const { response, calls } = await rate(world(), rateRequest(undefined, { method: 'GET' }));
    expect(response.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  test.each([
    ['one garment', { garment_ids: [TOP], occasion: null, date: DATE }],
    ['seven garments', { garment_ids: [TOP, BOTTOM, SHOES, BOOTS, LOAFERS, OTHER_TOP, UNREVIEWED], occasion: null, date: DATE }],
    ['a repeated id', { garment_ids: [TOP, BOTTOM, TOP.toUpperCase()], occasion: null, date: DATE }],
    ['an id that is not a uuid', { garment_ids: [TOP, 'shoes'], occasion: null, date: DATE }],
    ['an unknown occasion', { garment_ids: [TOP, BOTTOM, SHOES], occasion: 'beach', date: DATE }],
    ['a missing occasion', { garment_ids: [TOP, BOTTOM, SHOES], date: DATE }],
    ['an impossible date', { garment_ids: [TOP, BOTTOM, SHOES], occasion: null, date: '2026-02-30' }],
    ['a date with a time', { garment_ids: [TOP, BOTTOM, SHOES], occasion: null, date: '2026-11-08T10:00:00Z' }],
    ['a non-object body', [TOP, BOTTOM, SHOES]],
    ['a body that is not JSON', '{"garment_ids":'],
  ])('%s → 400 invalid_input', async (_label, body) => {
    const { response, body: answer, calls } = await rate(world(), rateRequest(body));
    expect(response.status).toBe(400);
    expect(answer).toEqual({ error: 'invalid_input' });
    expect(calls).toHaveLength(0);
  });
});

describe('rating', () => {
  test('the happy path returns the jev-ok score, unestimated, and writes rating_cache', async () => {
    const w = world();
    const { response, body, calls } = await rate(w);

    const parsed = parseJevAnswers(fixture('jev-ok'), RATING_LEVELS);
    if (parsed === null) throw new Error('fixture did not parse');
    const expected: RatingResult = {
      score: 80,
      label: 'good',
      confidence: 63,
      estimated: false,
      reasons: pickReasons(parsed.dims, ['cream', 'navy', 'white']),
      weakestSlot: 'shoes',
      swap: null,
      noBetterSwap: false,
    };
    expect(response.status).toBe(200);
    expect(body).toEqual(expected);
    expect(routes(calls)).toEqual(['garments', 'profile', 'weatherGet', 'cacheGet', 'quota', 'jev', 'cachePut']);
    expect(cachedResults(w)).toEqual([{ ...expected, degraded: false }]);

    const [garments, profile] = calls;
    for (const call of [garments, profile]) {
      expect(call?.headers.get('apikey')).toBe(ENV.anonKey);
      expect(call?.headers.get('authorization')).toBe(AUTH);
    }
    for (const call of calls.filter((c) => ['weatherGet', 'cacheGet', 'quota', 'cachePut'].includes(c.route))) {
      expect(call.headers.get('apikey')).toBe(ENV.serviceRoleKey);
      expect(call.headers.get('authorization')).toBe(`Bearer ${ENV.serviceRoleKey}`);
    }
    expect(JSON.parse(calls.find((call) => call.route === 'quota')?.body ?? '')).toEqual({
      p_user_id: USER_ID,
      p_kind: 'rating',
      p_limit: 50,
    });
    const put = JSON.parse(calls.find((call) => call.route === 'cachePut')?.body ?? '') as Row;
    expect(put.user_id).toBe(USER_ID);
    expect(put.cache_key).toMatch(/^[0-9a-f]{64}$/);

    const jev = calls.find((call) => call.route === 'jev');
    expect(jev?.headers.get('authorization')).toBe(`Bearer ${ENV.typesafeApiKey}`);
    const request = JSON.parse(jev?.body ?? '') as { model: string; state: Row };
    expect(request.model).toBe('jev-latest');
    expect(request.state).toEqual({
      user: { clothing_type: 'feminine', body_type: 'pear', height_bucket: 'medium', age_group: '25_34', styles: ['casual'] },
      context: { occasion: 'university', weather: WEATHER, season: 'autumn' },
      outfit: [
        { slot: 'top', category: 't_shirt', colors: ['cream'], pattern: 'solid', formality: 2, fit: 'regular' },
        { slot: 'bottom', category: 'jeans', colors: ['navy'], pattern: 'solid', formality: 2, fit: 'regular' },
        { slot: 'shoes', category: 'sneakers', colors: ['white'], pattern: 'solid', formality: 2, fit: 'regular' },
      ],
    });
    expect(outcomes()).toEqual([{ outcome: 'rated' }]);
  });

  test('a second identical call hits the cache: no Jev and no quota call', async () => {
    const w = world();
    const first = await rate(w);
    const second = await rate(w);
    expect(second.response.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(count(second.calls, 'jev')).toBe(0);
    expect(count(second.calls, 'quota')).toBe(0);
    expect(count(second.calls, 'cachePut')).toBe(0);
    expect(outcomes()).toEqual([{ outcome: 'rated' }, { outcome: 'cached' }]);
  });

  test('the same garments in another order hit the same cache entry', async () => {
    const w = world();
    await rate(w);
    const second = await rate(w, rateRequest({ garment_ids: [SHOES, TOP, BOTTOM], occasion: 'university', date: DATE }));
    expect(count(second.calls, 'jev')).toBe(0);
  });

  test('another occasion is another cache entry', async () => {
    const w = world();
    await rate(w);
    const second = await rate(w, rateRequest({ garment_ids: [TOP, BOTTOM, SHOES], occasion: 'office', date: DATE }));
    expect(count(second.calls, 'jev')).toBe(1);
  });

  test('the quota rpc failing → 500 with no Jev or Claude call and nothing cached (fails closed)', async () => {
    const w = world({ fail: { quota: json(500, { message: 'unavailable' }) } });
    const { response, calls } = await rate(w);
    expect(response.status).toBe(500);
    expect(count(calls, 'jev') + count(calls, 'claude') + count(calls, 'cachePut')).toBe(0);
  });

  test('quota false → 429 over_quota with no Jev call and nothing cached', async () => {
    const w = world({ quota: false });
    const { response, body, calls } = await rate(w);
    expect(response.status).toBe(429);
    expect(body).toEqual({ error: 'over_quota' });
    expect(count(calls, 'jev')).toBe(0);
    expect(count(calls, 'cachePut')).toBe(0);
    expect(outcomes()).toEqual([{ outcome: 'over_quota' }]);
  });

  test.each([
    ['Jev answers 500', () => json(500, { error: 'internal' })],
    ['Jev is unreachable', () => Promise.reject(new TypeError('fetch failed'))],
    ['Jev answers something unparseable', () => json(200, jevFixture('jev-ok', (a) => delete a.style_match))],
  ])('%s → the Claude fallback, estimated with a null confidence', async (_label, jev) => {
    const w = world({ jev });
    const { response, body, calls } = await rate(w);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ estimated: true, confidence: null, weakestSlot: 'top', swap: null, noBetterSwap: false });
    expect((body as RatingResult).score).toBeGreaterThanOrEqual(70);
    expect(count(calls, 'claude')).toBe(1);
    const claude = calls.find((call) => call.route === 'claude');
    expect(claude?.headers.get('x-api-key')).toBe(ENV.anthropicApiKey);
    expect(cachedResults(w)).toEqual([{ ...(body as Row), degraded: true }]);
    expect(body).not.toHaveProperty('degraded');
    expect(outcomes()).toEqual([{ outcome: 'fallback' }]);
  });

  test('Jev and Claude both failing → 503 rating_unavailable and nothing cached', async () => {
    const w = world({ jev: () => json(500, {}), claude: () => json(529, { type: 'error' }) });
    const { response, body, calls } = await rate(w);
    expect(response.status).toBe(503);
    expect(body).toEqual({ error: 'rating_unavailable' });
    expect(count(calls, 'cachePut')).toBe(0);
    expect(w.ratingCache.size).toBe(0);
    expect(outcomes()).toEqual([{ outcome: 'unavailable' }]);
  });

  test('a profile row carrying measurements never leaks them to Jev or Claude', async () => {
    const w = world({ jev: () => json(500, {}) });
    const { calls } = await rate(w);
    for (const route of ['jev', 'claude'] as const) {
      const sent = calls.find((call) => call.route === route)?.body ?? '';
      expect(sent).not.toBe('');
      for (const leak of ['height_cm', 'waist_cm', 'hips_cm', 'chest_cm', 'top_size', '"71"', ':71', ':99', ':88', 'Madrid', USER_ID, TOP]) {
        expect(sent).not.toContain(leak);
      }
    }
  });

  test('a deleted (or foreign) garment id → 404 garment_not_found with no quota or Jev call', async () => {
    const { response, body, calls } = await rate(
      world(),
      rateRequest({ garment_ids: [TOP, BOTTOM, DELETED], occasion: null, date: DATE }),
    );
    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'garment_not_found' });
    expect(count(calls, 'quota') + count(calls, 'jev')).toBe(0);
    expect(outcomes()).toEqual([{ outcome: 'invalid' }]);
  });

  test.each([
    ['a top-only outfit', [TOP, OTHER_TOP]],
    ['no shoes', [TOP, BOTTOM]],
    ['a garment without a category yet', [TOP, BOTTOM, SHOES, UNREVIEWED]],
  ])('%s → 422 incomplete with no quota or Jev call', async (_label, ids) => {
    const { response, body, calls } = await rate(world(), rateRequest({ garment_ids: ids, occasion: null, date: DATE }));
    expect(response.status).toBe(422);
    expect(body).toEqual({ error: 'incomplete' });
    expect(count(calls, 'quota') + count(calls, 'jev')).toBe(0);
  });

  test('an edited garment changes the cache key, so Jev is called again', async () => {
    const w = world();
    const first = await rate(w);
    w.garments.set(SHOES, garment(SHOES, 'sneakers', { colors: ['red'], updated_at: '2026-11-08T09:00:00Z' }));
    const second = await rate(w);
    expect(count(second.calls, 'jev')).toBe(1);
    expect(count(second.calls, 'quota')).toBe(1);
    const keyOf = (calls: Call[]): string | undefined =>
      (JSON.parse(calls.find((call) => call.route === 'cachePut')?.body ?? '{}') as { cache_key?: string }).cache_key;
    expect(keyOf(second.calls)).not.toBe(keyOf(first.calls));
  });

  test('logging a wear (only updated_at and last_worn_at change) keeps the cache key', async () => {
    const w = world();
    await rate(w);
    w.garments.set(
      SHOES,
      garment(SHOES, 'sneakers', { updated_at: '2026-11-08T09:00:00Z', last_worn_at: '2026-11-08T09:00:00Z' }),
    );
    const second = await rate(w);
    expect(count(second.calls, 'jev')).toBe(0);
    expect(outcomes()).toEqual([{ outcome: 'rated' }, { outcome: 'cached' }]);
  });

  test('a profile edit changes the cache key', async () => {
    const w = world();
    await rate(w);
    w.profile = { ...PROFILE, styles: ['elegant'], updated_at: '2026-11-08T09:00:00Z' };
    expect(count((await rate(w)).calls, 'jev')).toBe(1);
  });

  test('a database error loading the garments → 500 with no quota or Jev call', async () => {
    const w = world({ fail: { garments: json(503, { message: 'unavailable' }) } });
    const { response, body, calls } = await rate(w);
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'internal' });
    expect(count(calls, 'quota') + count(calls, 'jev')).toBe(0);
    expect(outcomes()).toEqual([{ outcome: 'error' }]);
  });
});

describe('unknown weather', () => {
  test('no city: weather null in the state, weather_fit neutral and unsafe_for_weather ignored', async () => {
    const unsafe = (): unknown =>
      jevFixture('jev-ok', (a) => {
        (a.weather_fit as Row).score = 0;
        (a.unsafe_for_weather as Row).noul = 0.95;
      });
    const w = world({ profile: { ...PROFILE, city_name: null, city_lat: null, city_lon: null }, jev: () => json(200, unsafe()) });
    const { response, body, calls } = await rate(w);

    expect(response.status).toBe(200);
    expect(count(calls, 'weatherGet')).toBe(0);
    const state = (JSON.parse(calls.find((call) => call.route === 'jev')?.body ?? '') as { state: JevState }).state;
    expect(state.context.weather).toBeNull();

    const parsed = parseJevAnswers(unsafe(), RATING_LEVELS);
    if (parsed === null) throw new Error('fixture did not parse');
    const neutral = { ...parsed.dims, weather_fit: { normalized: 0.5, confidence: parsed.dims.weather_fit.confidence } };
    expect(body).toMatchObject({ score: composeRating(neutral, false).score });
    expect((body as RatingResult).score).toBeGreaterThan(40);
  });

  test('with known weather, unsafe_for_weather still caps the score at 40', async () => {
    const w = world({ jev: () => json(200, jevFixture('jev-ok', (a) => ((a.unsafe_for_weather as Row).noul = 0.95))) });
    const { body } = await rate(w);
    expect(body).toMatchObject({ score: 40, label: 'poor' });
  });
});

describe('swaps', () => {
  /** jev-low (36) with shoes as the weakest piece for the selected outfit; each other shoe rated by `shoes`. */
  const lowWith =
    (shoes: Record<string, unknown>) =>
    (state: JevState): Response => {
      const category = shoesOf(state);
      if (category === 'sneakers') {
        return json(200, jevFixture('jev-low', (a) => ((a.weakest_piece as Row).choice = 'shoes')));
      }
      const answer = category === undefined ? undefined : new Map(Object.entries(shoes)).get(category);
      if (answer === undefined) throw new Error(`unexpected swap candidate ${String(category)}`);
      return json(200, answer);
    };

  test('takes the candidate that beats the score by the most (+8 over +3)', async () => {
    const w = world({ jev: lowWith({ boots: jevAt(0.44), loafers: jevAt(0.39) }) });
    const { response, body, calls } = await rate(w);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      score: 36,
      label: 'poor',
      weakestSlot: 'shoes',
      swap: { fromId: SHOES, toId: BOOTS, score: 44 },
      noBetterSwap: false,
    });
    // The selected outfit, then one rating per eligible shoe: not the laundry heels or the current sneakers.
    expect(count(calls, 'jev')).toBe(3);
    expect(count(calls, 'closet')).toBe(1);
    const closetCall = calls.find((call) => call.route === 'closet');
    expect(closetCall?.headers.get('authorization')).toBe(AUTH);
    const swapStates = calls
      .filter((call) => call.route === 'jev')
      .slice(1)
      .map((call) => (JSON.parse(call.body ?? '') as { state: JevState }).state);
    expect(swapStates.map(shoesOf).sort()).toEqual(['boots', 'loafers']);
    for (const state of swapStates) {
      expect(state.outfit.map((piece) => piece.category)).toEqual(['t_shirt', 'jeans', shoesOf(state)]);
    }
    expect(cachedResults(w)).toEqual([{ ...(body as Row), degraded: false }]);
  });

  test('when no candidate beats the score by 5, there is no swap and noBetterSwap is true', async () => {
    const w = world({ jev: lowWith({ boots: jevAt(0.38), loafers: jevAt(0.39) }) });
    const { body } = await rate(w);
    expect(body).toMatchObject({ score: 36, swap: null, noBetterSwap: true });
  });

  test('exactly +5 is enough', async () => {
    const w = world({ jev: lowWith({ boots: jevAt(0.41), loafers: jevAt(0.3) }) });
    const { body } = await rate(w);
    expect(body).toMatchObject({ swap: { fromId: SHOES, toId: BOOTS, score: 41 }, noBetterSwap: false });
  });

  test('candidate ratings that all fail give no swap without claiming there is no better one', async () => {
    const w = world({
      jev: (state) =>
        shoesOf(state) === 'sneakers'
          ? json(200, jevFixture('jev-low', (a) => ((a.weakest_piece as Row).choice = 'shoes')))
          : json(500, {}),
    });
    const { body, calls } = await rate(w);
    expect(body).toMatchObject({ score: 36, estimated: false, swap: null, noBetterSwap: false });
    expect(count(calls, 'claude')).toBe(0);
  });

  test('no swap is looked for at 70 or above', async () => {
    const { calls } = await rate(world());
    expect(count(calls, 'closet')).toBe(0);
  });

  test('a weakest slot the outfit does not have is ignored: no closet read, no swap', async () => {
    const w = world({ jev: () => json(200, jevFixture('jev-low', (a) => ((a.weakest_piece as Row).choice = 'outerwear'))) });
    const { body, calls } = await rate(w);
    expect(body).toMatchObject({ score: 36, weakestSlot: null, swap: null, noBetterSwap: false });
    expect(count(calls, 'closet')).toBe(0);
    expect(count(calls, 'jev')).toBe(1);
  });

  test('a null weakest slot looks for no swap', async () => {
    const w = world({ jev: () => json(200, jevAt(0.3)) });
    const { body, calls } = await rate(w);
    expect(body).toMatchObject({ score: 30, weakestSlot: null, swap: null, noBetterSwap: false });
    expect(count(calls, 'closet')).toBe(0);
  });

  test('a fallback rating looks for no swap (Jev just failed)', async () => {
    const w = world({
      jev: () => json(500, {}),
      claude: () =>
        json(
          200,
          claudeMessage({ ...FALLBACK_OUTPUT, color_harmony: 0, formality_coherence: 0, occasion_fit: 0, weakest_piece: 'shoes' }),
        ),
    });
    const { body, calls } = await rate(w);
    expect(body).toMatchObject({ estimated: true, weakestSlot: 'shoes', swap: null, noBetterSwap: false });
    expect((body as RatingResult).score).toBeLessThan(70);
    expect(count(calls, 'closet')).toBe(0);
  });

  test('caps the candidates at 8, with at most 5 Jev calls in flight', async () => {
    const w = world({ jev: lowWith({ boots: jevAt(0.37), loafers: jevAt(0.37), flats: jevAt(0.37) }) });
    for (let index = 0; index < 10; index += 1) {
      const id = `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      w.garments.set(id, garment(id, 'flats'));
    }
    const { calls, jevPeak } = await rate(w);
    expect(count(calls, 'jev')).toBe(1 + 8);
    expect(jevPeak()).toBeLessThanOrEqual(5);
    expect(jevPeak()).toBe(5);
  });

  test('candidates must pass the occasion rules: a formality-5 shoe is not tried for sport', async () => {
    const w = world({ jev: lowWith({ boots: jevAt(0.44) }) });
    w.garments.set(LOAFERS, garment(LOAFERS, 'loafers', { formality: 5 }));
    w.garments.set(SHOES, garment(SHOES, 'sneakers', { formality: 1 }));
    w.garments.set(BOOTS, garment(BOOTS, 'boots', { formality: 2 }));
    w.garments.set(TOP, garment(TOP, 't_shirt', { formality: 1, colors: ['cream'] }));
    w.garments.set(BOTTOM, garment(BOTTOM, 'jeans', { formality: 1, colors: ['navy'] }));
    const { body, calls } = await rate(w, rateRequest({ garment_ids: [TOP, BOTTOM, SHOES], occasion: 'sport', date: DATE }));
    expect(count(calls, 'jev')).toBe(2);
    expect(body).toMatchObject({ swap: { fromId: SHOES, toId: BOOTS, score: 44 } });
  });

  test('a donated garment in the weakest slot is never a swap candidate', async () => {
    const DONATED_HEELS = '10000000-0000-4000-8000-000000000009';
    const w = world({ jev: lowWith({ boots: jevAt(0.44), loafers: jevAt(0.39) }) });
    w.garments.set(DONATED_HEELS, garment(DONATED_HEELS, 'heels', { status: 'donated' }));
    const { body, calls } = await rate(w);
    expect(body).toMatchObject({ swap: { fromId: SHOES, toId: BOOTS, score: 44 } });
    // Still just the selected outfit plus boots and loafers: not the laundry heels, not the donated ones.
    expect(count(calls, 'jev')).toBe(3);
    const swapStates = calls
      .filter((call) => call.route === 'jev')
      .slice(1)
      .map((call) => (JSON.parse(call.body ?? '') as { state: JevState }).state);
    expect(swapStates.map(shoesOf).sort()).toEqual(['boots', 'loafers']);
  });
});

describe('degraded results', () => {
  const lowShoes = (): Response => json(200, jevFixture('jev-low', (a) => ((a.weakest_piece as Row).choice = 'shoes')));
  const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();
  const age = (w: World, minutes: number): void => {
    for (const row of w.ratingCache.values()) row.created_at = minutesAgo(minutes);
  };

  test('a fallback rating is cached degraded: a hit at 59 min, a recomputing miss (with quota) at 61 min', async () => {
    const w = world({ jev: () => json(500, {}) });
    await rate(w);
    expect(cachedResults(w)).toEqual([expect.objectContaining({ degraded: true })]);

    age(w, 59);
    const hit = await rate(w);
    expect(count(hit.calls, 'quota') + count(hit.calls, 'jev') + count(hit.calls, 'claude')).toBe(0);
    expect(hit.body).not.toHaveProperty('degraded');
    expect(hit.body).toMatchObject({ estimated: true });

    age(w, 61);
    w.jev = () => json(200, fixture('jev-ok'));
    const miss = await rate(w);
    expect(count(miss.calls, 'quota')).toBe(1);
    expect(count(miss.calls, 'jev')).toBe(1);
    expect(miss.body).toMatchObject({ score: 80, estimated: false });
    expect(miss.body).not.toHaveProperty('degraded');
    expect(cachedResults(w)).toEqual([expect.objectContaining({ degraded: false })]);
    expect(outcomes()).toEqual([{ outcome: 'fallback' }, { outcome: 'cached' }, { outcome: 'rated' }]);
  });

  test('a recomputed entry that is still degraded restarts its hour', async () => {
    const w = world({ jev: () => json(500, {}) });
    await rate(w);
    age(w, 61);
    await rate(w);
    const again = await rate(w);
    expect(count(again.calls, 'quota')).toBe(0);
  });

  test('a non-degraded entry is still a hit after 5 days', async () => {
    const w = world();
    await rate(w);
    age(w, 5 * 24 * 60);
    const hit = await rate(w);
    expect(count(hit.calls, 'quota') + count(hit.calls, 'jev')).toBe(0);
    expect(hit.body).not.toHaveProperty('degraded');
  });

  test.each([
    ['the closet read fails', { fail: { closet: json(503, {}) } }],
    ['every candidate rating fails', {}],
  ])('a failed swap search (%s) is degraded', async (_label, overrides) => {
    const w = world({ jev: (state) => (shoesOf(state) === 'sneakers' ? lowShoes() : json(500, {})), ...overrides });
    const { body } = await rate(w);
    expect(body).toMatchObject({ swap: null, noBetterSwap: false });
    expect(body).not.toHaveProperty('degraded');
    expect(cachedResults(w)).toEqual([expect.objectContaining({ degraded: true })]);
  });

  test('a completed swap search, with or without a swap, is not degraded', async () => {
    const found = world({ jev: (state) => (shoesOf(state) === 'sneakers' ? lowShoes() : json(200, jevAt(0.44))) });
    await rate(found);
    expect(cachedResults(found)).toEqual([expect.objectContaining({ degraded: false, swap: expect.anything() as unknown })]);
    const none = world({ jev: (state) => (shoesOf(state) === 'sneakers' ? lowShoes() : json(200, jevAt(0.37))) });
    await rate(none);
    expect(cachedResults(none)).toEqual([expect.objectContaining({ degraded: false, noBetterSwap: true })]);
  });
});

describe('a cached swap is re-checked', () => {
  const withSwap = (): World =>
    world({
      jev: (state) =>
        shoesOf(state) === 'sneakers'
          ? json(200, jevFixture('jev-low', (a) => ((a.weakest_piece as Row).choice = 'shoes')))
          : json(200, shoesOf(state) === 'boots' ? jevAt(0.44) : jevAt(0.3)),
    });

  test('a swap target that is still available is kept, read with the user’s token', async () => {
    const w = withSwap();
    const first = await rate(w);
    const second = await rate(w);
    expect(second.body).toEqual(first.body);
    const check = second.calls.filter((call) => call.route === 'garments').at(-1);
    expect(check?.url.searchParams.get('id')).toBe(`in.(${BOOTS})`);
    expect(check?.headers.get('authorization')).toBe(AUTH);
  });

  test.each([
    ['deleted', (w: World) => w.garments.delete(BOOTS)],
    ['in the laundry', (w: World) => w.garments.set(BOOTS, garment(BOOTS, 'boots', { status: 'laundry' }))],
  ])('a swap target that is now %s is dropped from the answer, and the cache is not rewritten', async (_label, change) => {
    const w = withSwap();
    await rate(w);
    const stored = structuredClone([...w.ratingCache.values()]);
    change(w);
    const { body, calls } = await rate(w);
    expect(body).toMatchObject({ score: 36, swap: null, noBetterSwap: false });
    expect(count(calls, 'cachePut') + count(calls, 'jev') + count(calls, 'quota')).toBe(0);
    expect([...w.ratingCache.values()]).toEqual(stored);
  });

  test('a cached result without a swap reads no garment again', async () => {
    const w = world();
    await rate(w);
    const { calls } = await rate(w);
    expect(count(calls, 'garments')).toBe(1);
  });
});

describe('latency budget', () => {
  const { drive, trackDigests, untrackDigests } = fakeTime(jest);

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    trackDigests();
  });
  afterEach(() => {
    jest.useRealTimers();
    untrackDigests();
  });

  const after = <T,>(ms: number, init: RequestInit, value: () => T): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve(value());
      }, ms);
      init.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    });

  const hrefOf = (input: string | URL | Request): string =>
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const bodyOf = (init: RequestInit): string => (typeof init.body === 'string' ? init.body : '');

  /**
   * Advances fake time by `ms` in small steps, letting real macrotasks run between them: the cache
   * key's `crypto.subtle.digest` settles on a real event-loop turn, so one big jump would pass
   * timers the handler hasn't scheduled yet.
   */

  test('Jev times out at 10 s, then Claude answers at 19 s → 200, estimated', async () => {
    const fake = fakeFetch(world());
    const pending = handleRate(rateRequest(), {
      env: ENV,
      fetch: async (input, init = {}) => {
        if (hrefOf(input).startsWith(ENV.typesafeBaseUrl)) return after(60_000, init, () => json(200, fixture('jev-ok')));
        if (hrefOf(input).startsWith(ENV.anthropicBaseUrl)) {
          return after(19_000, init, () => json(200, claudeMessage(FALLBACK_OUTPUT)));
        }
        return fake.fetch(input, init);
      },
      rand: mulberry32(7),
    });
    await drive(10_000 + 19_000 + 200);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ estimated: true, confidence: null });
    expect(outcomes()).toEqual([{ outcome: 'fallback' }]);
  });

  test('a Claude answer slower than 20 s is abandoned → 503', async () => {
    const w = world({ jev: () => json(500, {}) });
    const fake = fakeFetch(w);
    const pending = handleRate(rateRequest(), {
      env: ENV,
      fetch: async (input, init = {}) =>
        hrefOf(input).startsWith(ENV.anthropicBaseUrl)
          ? after(20_500, init, () => json(200, claudeMessage(FALLBACK_OUTPUT)))
          : fake.fetch(input, init),
      rand: mulberry32(7),
    });
    await drive(20_000 + 200);
    expect((await pending).status).toBe(503);
  });

  test('when 15 s have passed before the swaps, no swap Jev call is made and the result is degraded', async () => {
    const w = world();
    const fake = fakeFetch(w);
    let jevCalls = 0;
    const pending = handleRate(rateRequest(), {
      env: ENV,
      fetch: async (input, init = {}) => {
        const url = new URL(hrefOf(input));
        // A slow garments read (6 s) plus a slow but in-time Jev answer (9.5 s).
        if (url.pathname === '/rest/v1/garments' && url.searchParams.has('id')) {
          return after(6_000, init, () => undefined).then(() => fake.fetch(input, init));
        }
        if (url.origin !== ENV.typesafeBaseUrl) return fake.fetch(input, init);
        jevCalls += 1;
        return after(9_500, init, () => json(200, jevFixture('jev-low', (a) => ((a.weakest_piece as Row).choice = 'shoes'))));
      },
      rand: mulberry32(7),
    });
    await drive(16_000);
    const response = await pending;
    expect(jevCalls).toBe(1);
    expect(fake.calls.some((call) => call.route === 'closet')).toBe(false);
    expect(await response.json()).toMatchObject({ score: 36, weakestSlot: 'shoes', swap: null, noBetterSwap: false });
    expect(cachedResults(w)).toEqual([expect.objectContaining({ degraded: true })]);
  });

  test('swap waves stop launching once 15 s have passed', async () => {
    const w = world();
    for (let index = 0; index < 10; index += 1) {
      const id = `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      w.garments.set(id, garment(id, 'flats'));
    }
    let swapCalls = 0;
    const fake = fakeFetch(w);
    const pending = handleRate(rateRequest(), {
      env: ENV,
      fetch: async (input, init = {}) => {
        if (!hrefOf(input).startsWith(ENV.typesafeBaseUrl)) return fake.fetch(input, init);
        const state = (JSON.parse(bodyOf(init)) as { state: JevState }).state;
        if (shoesOf(state) === 'sneakers') {
          return after(9_000, init, () => json(200, jevFixture('jev-low', (a) => ((a.weakest_piece as Row).choice = 'shoes'))));
        }
        swapCalls += 1;
        return after(7_000, init, () => json(200, jevAt(0.5)));
      },
      rand: mulberry32(7),
    });
    await drive(30_000);
    const response = await pending;
    // 8 candidates: the first wave of 5 starts at ~9 s; at ~16 s the budget is spent, so the other 3 never start.
    expect(swapCalls).toBe(5);
    expect(await response.json()).toMatchObject({ swap: null, noBetterSwap: false });
    expect(cachedResults(w)).toEqual([expect.objectContaining({ degraded: true })]);
  });

  test('a forecast that hangs is abandoned after 5 s: weather null and a neutral weather_fit', async () => {
    const w = world({ weatherCached: false });
    w.forecast = (init) => after(60_000, init, () => json(200, {}));
    const jevBodies: string[] = [];
    const fake = fakeFetch(w);
    const pending = handleRate(rateRequest(), {
      env: ENV,
      fetch: async (input, init = {}) => {
        if (hrefOf(input).startsWith(ENV.typesafeBaseUrl)) jevBodies.push(bodyOf(init));
        return fake.fetch(input, init);
      },
      rand: mulberry32(7),
    });
    await drive(4_900);
    expect(jevBodies).toHaveLength(0);
    await drive(600);
    const response = await pending;
    expect(response.status).toBe(200);
    const state = (JSON.parse(jevBodies[0] ?? '{}') as { state: JevState }).state;
    expect(state.context.weather).toBeNull();
    const parsed = parseJevAnswers(fixture('jev-ok'), RATING_LEVELS);
    if (parsed === null) throw new Error('fixture did not parse');
    const neutral = { ...parsed.dims, weather_fit: { normalized: 0.5, confidence: parsed.dims.weather_fit.confidence } };
    expect(await response.json()).toMatchObject({ score: composeRating(neutral, false).score });
    expect(fake.calls.some((call) => call.route === 'weatherPut')).toBe(false);
  });
});

describe('logging', () => {
  test('logs only an outcome word, never garment attributes, the profile or model output', async () => {
    const otherSpies = (['log', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    const w = world();
    await rate(w);
    await rate(w);
    await rate(world({ jev: () => json(500, {}) }));
    await rate(world({ jev: () => json(500, {}), claude: () => json(500, {}) }));
    await rate(world({ quota: false }));
    await rate(world(), rateRequest({ garment_ids: [TOP] }));

    expect(outcomes()).toEqual([
      { outcome: 'rated' },
      { outcome: 'cached' },
      { outcome: 'fallback' },
      { outcome: 'unavailable' },
      { outcome: 'over_quota' },
      { outcome: 'invalid' },
    ]);
    for (const [line] of infoSpy.mock.calls) {
      for (const leak of ['sneakers', 'jeans', 'cream', 'navy', 'score', 'pear', USER_ID, TOP]) {
        expect(String(line)).not.toContain(leak);
      }
    }
    for (const spy of otherSpies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
