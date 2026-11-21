/** @jest-environment node */
// supabase/functions/trip-plan/__tests__/handler.test.ts
import type { GarmentCategory } from '../../_shared/catalog.ts';
import type { SupabaseEnv, WeatherEnv } from '../../_shared/env.ts';
import { handleTripPlan, TRIP_DAILY_LIMIT, TRIP_TTL_MS, type TripResponse } from '../handler.ts';

const { jest } = import.meta;

const USER_ID = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const NOW = Date.parse('2026-11-21T15:00:00Z');
const TODAY = '2026-11-21';

const ENV: SupabaseEnv & WeatherEnv = {
  supabaseUrl: 'http://supabase.test',
  anonKey: 'anon-key-test',
  serviceRoleKey: 'service-role-test',
  openMeteoUrl: 'http://open-meteo.test',
  geocodingUrl: 'http://geocoding.test',
};

const base64url = (text: string): string => Buffer.from(text, 'utf8').toString('base64url');
const token = (claims: unknown): string =>
  `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}.signature`;
const AUTH = `Bearer ${token({ sub: USER_ID, role: 'authenticated' })}`;

type Row = Record<string, unknown>;

const idOf = (n: number): string => `30000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const garment = (n: number, category: GarmentCategory | null, extra: Row = {}): Row => ({
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

const CLOSET: Row[] = [
  garment(1, 't_shirt'),
  garment(2, 'shirt'),
  garment(3, 'jeans'),
  garment(4, 'pants'),
  garment(5, 'sneakers'),
  garment(6, 'coat', { warmth: 3 }),
];

const LISBON = { results: [{ name: 'Lisboa', country: 'Portugal', latitude: 38.72, longitude: -9.14 }] };

/** Open-Meteo's daily block for `n` days from `from`, all `max`/`min` with no rain. */
function daily(from: string, n: number, max = 22, min = 16): unknown {
  const time = Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
  return {
    daily: {
      time,
      temperature_2m_max: time.map(() => max),
      temperature_2m_min: time.map(() => min),
      precipitation_probability_max: time.map(() => 0),
      weather_code: time.map(() => 1),
    },
  };
}

type RouteName = 'closet' | 'profile' | 'dismissed' | 'geocode' | 'forecast' | 'quota' | 'cacheGet' | 'cachePut' | 'other';
type Call = { route: RouteName; url: URL; body: string | undefined };

function routeOf(method: string, url: URL): RouteName {
  if (url.origin === ENV.openMeteoUrl && url.pathname === '/v1/forecast') return 'forecast';
  if (url.origin === ENV.geocodingUrl && url.pathname === '/v1/search') return 'geocode';
  if (url.pathname === '/rest/v1/garments' && method === 'GET') return 'closet';
  if (url.pathname === '/rest/v1/profiles' && method === 'GET') return 'profile';
  if (url.pathname === '/rest/v1/dismissed_outfits' && method === 'GET') return 'dismissed';
  if (url.pathname === '/rest/v1/rpc/consume_quota' && method === 'POST') return 'quota';
  if (url.pathname === '/rest/v1/trip_cache') return method === 'GET' ? 'cacheGet' : 'cachePut';
  return 'other';
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type World = {
  garments: Row[];
  quota: boolean;
  geocode: () => Response;
  forecast: () => Response;
  cache: Map<string, { result: unknown; created_at: string }>;
  dismissed: string[];
  fail?: Partial<Record<RouteName, Response>>;
};

function world(overrides: Partial<World> = {}): World {
  return {
    garments: CLOSET,
    quota: true,
    geocode: () => json(200, LISBON),
    forecast: () => json(200, daily(TODAY, 16)),
    cache: new Map(),
    dismissed: [],
    ...overrides,
  };
}

function fakeFetch(w: World) {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = (input, init = {}) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init.method ?? 'GET';
    const url = new URL(href);
    const route = routeOf(method, url);
    const body = typeof init.body === 'string' ? init.body : undefined;
    calls.push({ route, url, body });
    const failure = new Map(Object.entries(w.fail ?? {})).get(route);
    if (failure !== undefined) return Promise.resolve(failure.clone());
    switch (route) {
      case 'closet':
        return Promise.resolve(json(200, w.garments));
      case 'profile':
        return Promise.resolve(json(200, [{ city_name: 'Madrid', city_lat: 40.4, city_lon: -3.7, styles: [] }]));
      case 'dismissed':
        return Promise.resolve(json(200, w.dismissed.map((outfit_key) => ({ outfit_key }))));
      case 'geocode':
        return Promise.resolve(w.geocode());
      case 'forecast':
        return Promise.resolve(w.forecast());
      case 'quota':
        return Promise.resolve(json(200, w.quota));
      case 'cacheGet': {
        const key = (url.searchParams.get('cache_key') ?? '').replace(/^eq\./, '');
        const row = w.cache.get(key);
        return Promise.resolve(json(200, row === undefined ? [] : [row]));
      }
      case 'cachePut': {
        const row = JSON.parse(body ?? '{}') as { cache_key: string; result: unknown; created_at: string };
        w.cache.set(row.cache_key, { result: row.result, created_at: row.created_at });
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      case 'other':
        throw new Error(`unexpected request ${method} ${url.href}`);
    }
  };
  return { fetch, calls };
}

const TRIP = { city: 'Lisboa', start: '2026-11-25', end: '2026-11-27', occasion: null, language: 'es', date: TODAY };

function tripRequest(body: unknown = TRIP, { auth = AUTH, method = 'POST' }: { auth?: string | null; method?: string } = {}): Request {
  const headers = { 'content-type': 'application/json', ...(auth === null ? {} : { authorization: auth }) };
  return new Request('http://functions.test/trip-plan', {
    method,
    headers,
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
}

async function plan(w: World, request: Request = tripRequest(), now = NOW) {
  const fake = fakeFetch(w);
  const response = await handleTripPlan(request, { env: ENV, fetch: fake.fetch, now: () => now });
  return { response, body: (await response.json()) as unknown, ...fake };
}

type OkBody = Extract<TripResponse, { kind: 'ok' }>;

const count = (calls: Call[], route: RouteName): number => calls.filter((call) => call.route === route).length;

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
    const { response, calls } = await plan(world(), tripRequest(undefined, { auth }));
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test('a method other than POST → 405', async () => {
    const { response, calls } = await plan(world(), tripRequest(undefined, { method: 'GET' }));
    expect(response.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  test.each([
    ['not JSON', 'nope'],
    ['no city', { ...TRIP, city: undefined }],
    ['a blank city', { ...TRIP, city: '   ' }],
    ['a city over 100 characters', { ...TRIP, city: 'x'.repeat(101) }],
    ['an impossible start', { ...TRIP, start: '2026-02-30' }],
    ['an end before the start', { ...TRIP, start: '2026-11-27', end: '2026-11-25' }],
    ['11 days', { ...TRIP, start: '2026-11-25', end: '2026-12-05' }],
    ['a start two days before the server’s date', { ...TRIP, start: '2026-11-19', end: '2026-11-20' }],
    ['a start more than a year ahead', { ...TRIP, start: '2027-11-23', end: '2027-11-24' }],
    ['an unknown occasion', { ...TRIP, occasion: 'beach' }],
    ['another language', { ...TRIP, language: 'fr' }],
    ['no local day', { ...TRIP, date: undefined }],
  ])('%s → 400 invalid_input, no fetch', async (_label, body) => {
    const { response, body: answer, calls } = await plan(world(), tripRequest(body));
    expect(response.status).toBe(400);
    expect(answer).toEqual({ error: 'invalid_input' });
    expect(calls).toHaveLength(0);
  });

  test('ten days, a missing occasion key and a start one day before the server’s date are accepted', async () => {
    const { response } = await plan(world(), tripRequest({ city: 'Lisboa', start: '2026-11-20', end: '2026-11-29', language: 'en', date: '2026-11-20' }));
    expect(response.status).toBe(200);
  });
});

describe('planning', () => {
  test('answers each day with its forecast and outfit, and the packing list by slot', async () => {
    const { response, body, calls } = await plan(world());

    expect(response.status).toBe(200);
    const ok = body as OkBody;
    expect(ok.kind).toBe('ok');
    expect(ok.city).toBe('Lisboa');
    expect(ok.days.map((day) => day.date)).toEqual(['2026-11-25', '2026-11-26', '2026-11-27']);
    for (const day of ok.days) {
      expect(day.weather).toEqual({ tempC: 22, condition: 'clear', band: 'mild', rain: false });
      expect(day.garmentIds?.length).toBeGreaterThanOrEqual(3);
    }
    const packed = ok.packing.flatMap((group) => group.items.map((item) => item.garmentId));
    expect(new Set(packed).size).toBe(packed.length);
    expect(new Set(packed)).toEqual(new Set(ok.days.flatMap((day) => day.garmentIds ?? [])));
    const geocode = calls.find((call) => call.route === 'geocode');
    expect(geocode?.url.searchParams.get('name')).toBe('Lisboa');
    expect(geocode?.url.searchParams.get('language')).toBe('es');
    expect(calls.find((call) => call.route === 'forecast')?.url.searchParams.get('forecast_days')).toBe('16');
    expect(outcomes()).toEqual([{ outcome: 'planned' }]);
  });

  test('calls no model: only the database and Open-Meteo', async () => {
    const { calls } = await plan(world());
    expect(calls.every((call) => call.route !== 'other')).toBe(true);
  });

  test('spends the trip quota on the local day before any Open-Meteo call', async () => {
    const { calls } = await plan(world());
    const quota = calls.find((call) => call.route === 'quota');
    expect(JSON.parse(quota?.body ?? '{}')).toEqual({ p_user_id: USER_ID, p_kind: 'trip', p_limit: TRIP_DAILY_LIMIT, p_day: TODAY });
    expect(TRIP_DAILY_LIMIT).toBe(5);
    const order = calls.map((call) => call.route);
    expect(order.indexOf('quota')).toBeLessThan(order.indexOf('geocode'));
  });

  test('a day past the forecast has no weather', async () => {
    const { body } = await plan(world({ forecast: () => json(200, daily(TODAY, 5)) }));

    const ok = body as OkBody;
    expect(ok.days.map((day) => day.weather === null)).toEqual([false, true, true]);
    expect(outcomes()).toEqual([{ outcome: 'planned' }]);
  });

  test('a failed forecast plans every day without weather, as degraded', async () => {
    const w = world({ forecast: () => json(500, {}) });
    const { response, body } = await plan(w);

    expect(response.status).toBe(200);
    expect((body as OkBody).days.every((day) => day.weather === null)).toBe(true);
    expect(outcomes()).toEqual([{ outcome: 'degraded' }]);
    expect([...w.cache.values()][0]?.result).toMatchObject({ degraded: true });
    expect(body).not.toHaveProperty('degraded');
  });

  test('a closet missing a required slot answers too_small without quota or Open-Meteo', async () => {
    const { response, body, calls } = await plan(world({ garments: [garment(1, 't_shirt'), garment(2, 'jeans')] }));

    expect(response.status).toBe(200);
    expect(body).toEqual({ kind: 'too_small', missing: ['shoes'] });
    expect(count(calls, 'quota') + count(calls, 'geocode') + count(calls, 'forecast')).toBe(0);
  });

  test('a city the geocoder doesn’t know → 404 city_not_found', async () => {
    const { response, body, calls } = await plan(world({ geocode: () => json(200, { results: [] }) }));
    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'city_not_found' });
    expect(count(calls, 'forecast')).toBe(0);
  });

  test('a geocoder failure → 503 geocoding_unavailable', async () => {
    const { response, body } = await plan(world({ geocode: () => json(502, {}) }));
    expect(response.status).toBe(503);
    expect(body).toEqual({ error: 'geocoding_unavailable' });
  });

  test('over the quota → 429 before any Open-Meteo call', async () => {
    const { response, body, calls } = await plan(world({ quota: false }));
    expect(response.status).toBe(429);
    expect(body).toEqual({ error: 'over_quota' });
    expect(count(calls, 'geocode')).toBe(0);
  });

  test('a database failure → 500 internal', async () => {
    const { response, body } = await plan(world({ fail: { closet: json(500, {}) } }));
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'internal' });
  });
});

describe('the cache', () => {
  test('the same trip within 6 hours is a hit: no quota, no Open-Meteo, the same answer', async () => {
    const w = world();
    const first = await plan(w);
    const second = await plan(w, tripRequest(), NOW + TRIP_TTL_MS - 60_000);

    expect(second.body).toEqual(first.body);
    expect(count(second.calls, 'quota') + count(second.calls, 'geocode') + count(second.calls, 'forecast')).toBe(0);
    expect(TRIP_TTL_MS).toBe(6 * 60 * 60 * 1000);
  });

  test('after 6 hours it plans again', async () => {
    const w = world();
    await plan(w);
    const later = await plan(w, tripRequest(), NOW + TRIP_TTL_MS + 60_000);
    expect(count(later.calls, 'quota')).toBe(1);
  });

  test('a degraded answer is a hit for an hour only', async () => {
    const w = world({ forecast: () => json(500, {}) });
    await plan(w);
    const soon = await plan(w, tripRequest(), NOW + 30 * 60_000);
    const later = await plan(w, tripRequest(), NOW + 90 * 60_000);
    expect(count(soon.calls, 'quota')).toBe(0);
    expect(count(later.calls, 'quota')).toBe(1);
  });

  test('another city spelling, language, dates or a closet change is a miss', async () => {
    const w = world();
    await plan(w);
    for (const body of [
      { ...TRIP, city: 'Porto' },
      { ...TRIP, language: 'en' },
      { ...TRIP, end: '2026-11-28' },
      { ...TRIP, occasion: 'going_out' },
    ]) {
      const { calls } = await plan(w, tripRequest(body));
      expect(count(calls, 'quota')).toBe(1);
    }
    const changed = await plan({ ...w, garments: [...CLOSET, garment(7, 'skirt')] });
    expect(count(changed.calls, 'quota')).toBe(1);
  });

  test('the city is matched case- and space-insensitively', async () => {
    const w = world();
    await plan(w);
    const { calls } = await plan(w, tripRequest({ ...TRIP, city: '  lisboa ' }));
    expect(count(calls, 'quota')).toBe(0);
  });
});
