/** @jest-environment node */
// supabase/functions/lucky-list/__tests__/handler.test.ts
import { slotOf, type GarmentCategory, type Slot } from '../../_shared/catalog.ts';
import { isCompleteOutfit, mulberry32, preScore, type RuleGarment } from '../../_shared/outfitRules.ts';
import { RATING_DIMENSIONS, RATING_LEVELS } from '../../_shared/rating.ts';
import type { FnEnv } from '../../_shared/userContext.ts';
import { handleLucky, LUCKY_DAILY_LIMIT, type LuckyOutfit } from '../handler.ts';

const { jest } = import.meta;

const USER_ID = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
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

const LEVELS = new Map<string, number>(Object.entries(RATING_LEVELS));

/** A Jev body whose every dimension sits at `fraction` of its scale, so the composite is `round(100 · fraction)`. */
function jevAt(fraction: number, { unsafe = 0.05 }: { unsafe?: number } = {}): unknown {
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
      unsafe_for_weather: { type: 'noul', noul: unsafe },
      weakest_piece: { type: 'choice', choice: 'none', confidence: 0.5 },
    },
  };
}

type Row = Record<string, unknown>;

const idOf = (n: number): string => `10000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const garment = (n: number, category: GarmentCategory | null, extra: Row = {}): Row => ({
  id: idOf(n),
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

const daysAgo = (days: number): string => new Date(Date.parse(`${DATE}T09:00:00Z`) - days * 86_400_000).toISOString();

/** 40 garments: 12 tops, 10 bottoms, 6 shoes, 2 dresses, 4 outerwear, 3 bags and 3 accessories. */
function bigCloset(): Row[] {
  const neutrals = ['black', 'white', 'gray', 'navy', 'beige', 'cream'];
  const pick = (n: number): string[] => [neutrals[n % neutrals.length] ?? 'black'];
  const rows: Row[] = [];
  let n = 1;
  const add = (category: GarmentCategory, count: number, extra: (i: number) => Row = () => ({})): void => {
    for (let i = 0; i < count; i += 1, n += 1) rows.push(garment(n, category, { colors: pick(n), ...extra(i) }));
  };
  add('t_shirt', 6, (i) => ({ last_worn_at: i < 2 ? daysAgo(i + 1) : i < 4 ? daysAgo(10 + i) : null }));
  add('shirt', 3, () => ({ colors: ['light_blue'] }));
  add('sweater', 3, (i) => ({ last_worn_at: daysAgo(20 + i) }));
  add('jeans', 5, (i) => ({ last_worn_at: i === 0 ? daysAgo(2) : null }));
  add('pants', 3);
  add('skirt', 2, () => ({ pattern: 'striped' }));
  add('sneakers', 3);
  add('loafers', 2, () => ({ formality: 3 }));
  add('boots', 1, () => ({ colors: ['brown'] }));
  add('dress', 2, () => ({ colors: ['green'] }));
  add('jacket', 2);
  add('coat', 2, () => ({ warmth: 3 }));
  add('bag', 3, () => ({ colors: ['camel'] }));
  add('belt', 1, () => ({ colors: ['brown'] }));
  add('scarf', 1, () => ({ colors: ['red'] }));
  add('watch', 1, () => ({ colors: ['silver'] }));
  return rows;
}

/** One fresh top, one top worn 3 days ago, one bottom and one pair of shoes. */
function smallCloset(): Row[] {
  return [
    garment(1, 't_shirt'),
    garment(2, 'shirt', { last_worn_at: daysAgo(3) }),
    garment(3, 'jeans', { colors: ['navy'] }),
    garment(4, 'sneakers'),
  ];
}

const PROFILE: Row = {
  clothing_type: 'feminine',
  body_type: 'pear',
  height_cm: 164,
  waist_cm: 71,
  age_group: '25_34',
  styles: ['casual'],
  city_name: 'Madrid',
  city_lat: 40.4168,
  city_lon: -3.7038,
  updated_at: '2026-11-01T00:00:00Z',
};

const NO_CITY: Row = { ...PROFILE, city_name: null, city_lat: null, city_lon: null };

const COOL = { tempC: 15, condition: 'cloudy', band: 'cool', rain: false };
const HOT = { tempC: 31, condition: 'clear', band: 'hot', rain: false };
const COLD = { tempC: 4, condition: 'cloudy', band: 'cold', rain: false };

type RouteName =
  | 'closet'
  | 'profile'
  | 'weatherGet'
  | 'weatherPut'
  | 'forecast'
  | 'geocode'
  | 'quota'
  | 'cacheGet'
  | 'cachePut'
  | 'jev';
type Call = { route: RouteName; url: URL; body: string | undefined };
type JevState = { outfit: { slot: string; category: string }[]; context: { weather: unknown } };

function routeOf(method: string, url: URL): RouteName {
  if (url.origin === ENV.typesafeBaseUrl && url.pathname === '/v1/systemone' && method === 'POST') return 'jev';
  if (url.origin === ENV.openMeteoUrl && url.pathname === '/v1/forecast') return 'forecast';
  if (url.origin === ENV.geocodingUrl && url.pathname === '/v1/search') return 'geocode';
  if (url.pathname === '/rest/v1/garments' && method === 'GET' && !url.searchParams.has('id')) return 'closet';
  if (url.pathname === '/rest/v1/profiles' && method === 'GET') return 'profile';
  if (url.pathname === '/rest/v1/weather_cache') return method === 'GET' ? 'weatherGet' : 'weatherPut';
  if (url.pathname === '/rest/v1/rpc/consume_quota' && method === 'POST') return 'quota';
  if (url.pathname === '/rest/v1/lucky_cache') return method === 'GET' ? 'cacheGet' : 'cachePut';
  throw new Error(`unexpected request ${method} ${url.href}`);
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type World = {
  garments: Row[];
  profile: Row | null;
  quota: boolean;
  /** The hour's weather_cache payload weather; null: a miss, so the forecast is fetched. */
  weather: Row | null;
  forecast: () => Response | Promise<Response>;
  /** Jev's answer for the `n`th request (0-based, in launch order). */
  jev: (state: JevState, n: number) => Response | Promise<Response>;
  /** lucky_cache rows by cache_key, as stored (the result keeps its internal `degraded` marker). */
  luckyCache: Map<string, { result: unknown; created_at: string }>;
  fail?: Partial<Record<RouteName, Response>>;
};

/** Scores that vary per request, so the ranking has something to sort. */
const varied = (_state: JevState, n: number): Response => json(200, jevAt(((n * 7) % 11) / 10));

function world(overrides: Partial<World> = {}): World {
  return {
    garments: bigCloset(),
    profile: PROFILE,
    quota: true,
    weather: COOL,
    forecast: () => json(500, {}),
    jev: varied,
    luckyCache: new Map(),
    ...overrides,
  };
}

/** A fake `fetch` over `w` that routes by URL and method and records every call. */
function fakeFetch(w: World) {
  const calls: Call[] = [];
  let jevCount = 0;
  let jevInFlight = 0;
  let jevPeak = 0;
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init.method ?? 'GET';
    const url = new URL(href);
    const route = routeOf(method, url);
    const body = typeof init.body === 'string' ? init.body : undefined;
    calls.push({ route, url, body });
    const failure = new Map(Object.entries(w.fail ?? {})).get(route);
    if (failure !== undefined) return failure.clone();
    switch (route) {
      case 'closet':
        return json(200, w.garments);
      case 'profile':
        return json(200, w.profile === null ? [] : [w.profile]);
      case 'weatherGet':
        return json(200, w.weather === null ? [] : [{ payload: { weather: w.weather, lat: 40.42, lon: -3.7 } }]);
      case 'forecast':
        return w.forecast();
      case 'geocode':
        return json(200, { results: [] });
      case 'weatherPut':
        return new Response(null, { status: 201 });
      case 'quota':
        return json(200, w.quota);
      case 'cacheGet': {
        const key = (url.searchParams.get('cache_key') ?? '').replace(/^eq\./, '');
        const row = w.luckyCache.get(key);
        return json(200, row === undefined ? [] : [row]);
      }
      case 'cachePut': {
        const row = JSON.parse(body ?? '{}') as { cache_key: string; result: unknown; created_at: string };
        w.luckyCache.set(row.cache_key, { result: row.result, created_at: row.created_at });
        return new Response(null, { status: 201 });
      }
      case 'jev': {
        const n = jevCount;
        jevCount += 1;
        jevInFlight += 1;
        jevPeak = Math.max(jevPeak, jevInFlight);
        try {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return await w.jev((JSON.parse(body ?? '{}') as { state: JevState }).state, n);
        } finally {
          jevInFlight -= 1;
        }
      }
    }
  };
  return { fetch, calls, jevPeak: () => jevPeak };
}

function luckyRequest(
  body: unknown = { date: DATE, occasion: 'university' },
  { auth = AUTH, method = 'POST' }: { auth?: string | null; method?: string } = {},
): Request {
  const headers = { 'content-type': 'application/json', ...(auth === null ? {} : { authorization: auth }) };
  return new Request('http://functions.test/lucky-list', {
    method,
    headers,
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
}

type OkBody = { kind: 'ok'; weather: unknown; outfits: LuckyOutfit[] };

async function lucky(w: World, request: Request = luckyRequest()) {
  const fake = fakeFetch(w);
  const response = await handleLucky(request, { env: ENV, fetch: fake.fetch, rand: mulberry32(7) });
  return { response, body: (await response.json()) as unknown, ...fake };
}

const count = (calls: Call[], route: RouteName): number => calls.filter((call) => call.route === route).length;
const cachedResults = (w: World): unknown[] => [...w.luckyCache.values()].map((row) => row.result);

const byId = (w: World): Map<string, RuleGarment> =>
  new Map(w.garments.map((row) => [String(row.id), row as unknown as RuleGarment]));
const piecesOf = (w: World, outfit: LuckyOutfit): RuleGarment[] => {
  const garments = byId(w);
  return outfit.garmentIds.map((id) => {
    const found = garments.get(id);
    if (found === undefined) throw new Error(`unknown garment ${id}`);
    return found;
  });
};
const slotsOf = (w: World, outfit: LuckyOutfit): Slot[] =>
  piecesOf(w, outfit).map((piece) => slotOf(piece.category ?? 'accessory'));

const nonIncreasing = (values: readonly number[]): boolean => values.every((value, i) => i === 0 || value <= (values[i - 1] ?? value));

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
    const { response, calls } = await lucky(world(), luckyRequest(undefined, { auth }));
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test('a method other than POST → 405', async () => {
    const { response, calls } = await lucky(world(), luckyRequest(undefined, { method: 'GET' }));
    expect(response.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  test.each([
    ['not JSON', 'nope'],
    ['no date', { occasion: null }],
    ['an impossible date', { date: '2026-02-30', occasion: null }],
    ['an unknown occasion', { date: DATE, occasion: 'beach' }],
    ['no occasion key', { date: DATE }],
  ])('%s → 400 invalid_input', async (_label, body) => {
    const { response, body: answer, calls } = await lucky(world(), luckyRequest(body));
    expect(response.status).toBe(400);
    expect(answer).toEqual({ error: 'invalid_input' });
    expect(calls).toHaveLength(0);
  });

  test('a database error loading the garments → 500 with no quota or Jev call', async () => {
    const { response, body, calls } = await lucky(world({ fail: { closet: json(500, {}) } }));
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'internal' });
    expect(count(calls, 'quota')).toBe(0);
    expect(count(calls, 'jev')).toBe(0);
    expect(outcomes()).toEqual([{ outcome: 'error' }]);
  });
});

describe('too small', () => {
  test('a closet without shoes → too_small with missing [shoes] and the weather; no Jev, quota or cache', async () => {
    const w = world({ garments: bigCloset().filter((row) => !['sneakers', 'loafers', 'boots'].includes(String(row.category))) });
    const { response, body, calls } = await lucky(w);
    expect(response.status).toBe(200);
    expect(body).toEqual({ kind: 'too_small', missing: ['shoes'], weather: COOL });
    expect(count(calls, 'jev')).toBe(0);
    expect(count(calls, 'quota')).toBe(0);
    expect(count(calls, 'cacheGet') + count(calls, 'cachePut')).toBe(0);
    expect(outcomes()).toEqual([{ outcome: 'too_small' }]);
  });

  test('everything in the laundry → every required slot missing', async () => {
    const w = world({ garments: bigCloset().map((row) => ({ ...row, status: 'laundry' })) });
    const { body, calls } = await lucky(w);
    expect(body).toEqual({ kind: 'too_small', missing: ['top', 'bottom', 'shoes'], weather: COOL });
    expect(count(calls, 'jev')).toBe(0);
  });

  test('an empty closet with no city → too_small with weather null', async () => {
    const { body } = await lucky(world({ garments: [], profile: NO_CITY }));
    expect(body).toEqual({ kind: 'too_small', missing: ['top', 'bottom', 'shoes'], weather: null });
  });
});

describe('the lucky list', () => {
  test('40 garments → 30 complete outfits ranked by score, at most 5 Jev calls at once, cached', async () => {
    const w = world();
    const { response, body, calls, jevPeak } = await lucky(w);
    expect(response.status).toBe(200);
    const { kind, weather, outfits } = body as OkBody;
    expect(kind).toBe('ok');
    expect(weather).toEqual(COOL);
    expect(outfits).toHaveLength(30);
    for (const outfit of outfits) {
      expect(isCompleteOutfit(slotsOf(w, outfit))).toBe(true);
      expect(new Set(outfit.garmentIds).size).toBe(outfit.garmentIds.length);
      expect(typeof outfit.score).toBe('number');
    }
    expect(nonIncreasing(outfits.map((outfit) => outfit.score ?? -1))).toBe(true);
    expect(new Set(outfits.map((outfit) => outfit.garmentIds.join())).size).toBe(30);

    expect(count(calls, 'jev')).toBe(30);
    expect(jevPeak()).toBeLessThanOrEqual(5);
    expect(jevPeak()).toBeGreaterThan(1);
    const quota = calls.find((call) => call.route === 'quota');
    expect(JSON.parse(quota?.body ?? '{}')).toEqual({ p_user_id: USER_ID, p_kind: 'lucky', p_limit: LUCKY_DAILY_LIMIT });
    expect(LUCKY_DAILY_LIMIT).toBe(10);

    expect(body).not.toHaveProperty('degraded');
    expect(cachedResults(w)).toEqual([{ ...(body as OkBody), degraded: false }]);
    expect(outcomes()).toEqual([{ outcome: 'ranked' }]);
  });

  test('the 30 ranked are the best pre-scored candidates, so items worn this week are left out', async () => {
    const w = world();
    const { body } = await lucky(w);
    const { outfits } = body as OkBody;
    const recentlyWorn = new Set([idOf(1), idOf(2), idOf(13)]);
    for (const outfit of outfits) {
      expect(outfit.garmentIds.some((id) => recentlyWorn.has(id))).toBe(false);
      expect(outfit.freshThisWeek).toBe(true);
    }
  });

  test('the 30 spread over the closet: 3+ shoes, 5+ tops or one-pieces, a dress, some without an extra, ≤ 2 per base (P4-R13)', async () => {
    const w = world();
    const { body } = await lucky(w);
    const { outfits } = body as OkBody;
    expect(outfits).toHaveLength(30);
    const pieces = outfits.map((outfit) => piecesOf(w, outfit));
    const idsIn = (slots: readonly Slot[]): Set<string> =>
      new Set(pieces.flatMap((outfit) => outfit.filter((piece) => slots.includes(slotOf(piece.category ?? 'accessory'))).map((piece) => piece.id)));
    expect(idsIn(['shoes']).size).toBeGreaterThanOrEqual(3);
    expect(idsIn(['top', 'one_piece']).size).toBeGreaterThanOrEqual(5);
    expect(pieces.some((outfit) => outfit.some((piece) => piece.category === 'dress'))).toBe(true);
    const extras: readonly Slot[] = ['bag', 'headwear', 'accessory'];
    const isExtra = (piece: RuleGarment): boolean => extras.includes(slotOf(piece.category ?? 'accessory'));
    expect(pieces.some((outfit) => !outfit.some(isExtra))).toBe(true);
    const perBase = new Map<string, number>();
    for (const outfit of pieces) {
      const key = outfit
        .filter((piece) => !isExtra(piece))
        .map((piece) => piece.id)
        .sort()
        .join(',');
      perBase.set(key, (perBase.get(key) ?? 0) + 1);
    }
    expect(Math.max(...perBase.values())).toBeLessThanOrEqual(2);
  });

  /** ≥ 5 distinct tops or one-pieces, no top in more than 8 of the 30, and a dress. */
  function expectSpread(w: World, outfits: readonly LuckyOutfit[]): void {
    expect(outfits).toHaveLength(30);
    const pieces = outfits.map((outfit) => piecesOf(w, outfit));
    const bodies = pieces.flatMap((outfit) =>
      outfit.filter((piece) => ['top', 'one_piece'].includes(slotOf(piece.category ?? 'accessory'))),
    );
    expect(new Set(bodies.map((piece) => piece.id)).size).toBeGreaterThanOrEqual(5);
    const perTop = new Map<string, number>();
    for (const piece of bodies) perTop.set(piece.id, (perTop.get(piece.id) ?? 0) + 1);
    expect(Math.max(...perTop.values())).toBeLessThanOrEqual(8);
    expect(pieces.some((outfit) => outfit.some((piece) => piece.category === 'dress'))).toBe(true);
  }

  test('a closet with one pair of shoes still fills the 30, spread over the tops (per-slot cap)', async () => {
    const w = world({ garments: bigCloset().filter((row) => !['sneakers', 'loafers'].includes(String(row.category))) });
    const { body } = await lucky(w);
    expectSpread(w, (body as OkBody).outfits);
    for (const outfit of (body as OkBody).outfits) expect(slotsOf(w, outfit)).toContain('shoes');
  });

  /** Ten seeds (the seed is user id + date), November 1–10. */
  const TEN_DATES = Array.from({ length: 10 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);

  const timesIn = (outfits: readonly LuckyOutfit[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const id of outfits.flatMap((outfit) => outfit.garmentIds)) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  };

  test('exactly one dress: tops and one-pieces share one cap, so the dress is not treated as unavoidable', async () => {
    const dresses = bigCloset().filter((row) => row.category === 'dress');
    for (const date of TEN_DATES) {
      // The lone dress is neutral and never worn, so it pre-scores with the best bases.
      const w = world({
        garments: bigCloset()
          .filter((row) => row.id !== dresses[1]?.id)
          .map((row) => (row.id === dresses[0]?.id ? { ...row, colors: ['black'] } : row)),
      });
      const { outfits } = (await lucky(w, luckyRequest({ date, occasion: 'university' }))).body as OkBody;
      expect(outfits).toHaveLength(30);
      expect(Math.max(...timesIn(outfits).values())).toBeLessThanOrEqual(8);
      const bodies = new Set(
        outfits.flatMap((outfit) =>
          piecesOf(w, outfit)
            .filter((piece) => ['top', 'one_piece'].includes(slotOf(piece.category ?? 'accessory')))
            .map((piece) => piece.id),
        ),
      );
      expect(bodies.size).toBeGreaterThanOrEqual(5);
    }
  });

  test('one top and 7 dresses: the lone top is not unavoidable either', async () => {
    const onlyTop = idOf(5);
    const extraDresses = [41, 42, 43, 44, 45].map((n) => garment(n, 'dress', { colors: ['black'] }));
    for (const date of TEN_DATES) {
      const w = world({
        garments: [
          ...bigCloset().filter((row) => slotOf((row.category ?? 'accessory') as GarmentCategory) !== 'top' || row.id === onlyTop),
          ...extraDresses,
        ],
      });
      const { outfits } = (await lucky(w, luckyRequest({ date, occasion: 'university' }))).body as OkBody;
      expect(outfits).toHaveLength(30);
      expect(timesIn(outfits).get(onlyTop) ?? 0).toBeLessThanOrEqual(8);
      expect(outfits.some((outfit) => piecesOf(w, outfit).some((piece) => piece.category === 'dress'))).toBe(true);
    }
  });

  test('a cold day with one coat: the coat is in every outfit and the 30 still spread over the tops', async () => {
    const coats = bigCloset().filter((row) => row.category === 'coat');
    const oneCoat = coats[0]?.id;
    const w = world({
      weather: COLD,
      garments: bigCloset().filter((row) => row.category !== 'jacket' && (row.category !== 'coat' || row.id === oneCoat)),
    });
    const { body } = await lucky(w);
    const { outfits } = body as OkBody;
    expectSpread(w, outfits);
    for (const outfit of outfits) expect(outfit.garmentIds).toContain(oneCoat);
  });

  test('the same user and date give the same candidate order on a recompute; another date another order (M3)', async () => {
    const failing = (): World => world({ jev: () => json(500, {}) });
    const order = async (date: string): Promise<string[][]> =>
      ((await lucky(failing(), luckyRequest({ date, occasion: 'university' }))).body as OkBody).outfits.map(
        (outfit) => outfit.garmentIds,
      );
    const first = await order(DATE);
    expect(await order(DATE)).toEqual(first);
    expect(await order('2026-11-10')).not.toEqual(first);
  });

  test('Jev sees the outfit state without ids or measurements', async () => {
    const seen: unknown[] = [];
    const { calls } = await lucky(
      world({
        jev: (state, n) => {
          seen.push(state);
          return varied(state, n);
        },
      }),
    );
    expect(seen).toHaveLength(30);
    const sent = calls.filter((call) => call.route === 'jev').map((call) => call.body ?? '');
    for (const text of sent) {
      const request = JSON.parse(text) as { model: string; state: unknown };
      expect(request.model).toBe('jev-latest');
      const state = JSON.stringify(request.state);
      expect(state).not.toContain('10000000-');
      expect(state).not.toContain('waist');
      expect(state).not.toContain('Madrid');
      expect(state).not.toContain('164');
    }
  });

  test('a hit answers with this hour\'s weather, keeping the list as ranked (I2)', async () => {
    const w = world();
    const first = (await lucky(w)).body as OkBody;
    w.weather = { ...COOL, tempC: 9, condition: 'rain', rain: true };
    const { body, calls } = await lucky(w);
    expect(count(calls, 'jev')).toBe(0);
    expect((body as OkBody).weather).toEqual({ tempC: 9, condition: 'rain', band: 'cool', rain: true });
    expect((body as OkBody).outfits).toEqual(first.outfits);
  });

  test('a hit without this hour\'s weather falls back to the validated stored weather', async () => {
    const w = world();
    await lucky(w);
    w.weather = null; // a weather_cache miss, and the forecast fails
    const stored = await lucky(w);
    expect((stored.body as OkBody).weather).toEqual(COOL);
    for (const row of w.luckyCache.values()) {
      row.result = { ...(row.result as Record<string, unknown>), weather: { tempC: 'warm', condition: 'clear', band: 'mild', rain: false } };
    }
    const invalid = await lucky(w);
    expect(count(invalid.calls, 'jev')).toBe(0);
    expect((invalid.body as OkBody).weather).toBeNull();
  });

  test('a second call hits the cache: no Jev, no quota, the same body', async () => {
    const w = world();
    const first = await lucky(w);
    infoSpy.mockClear();
    const second = await lucky(w);
    expect(second.response.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(count(second.calls, 'jev')).toBe(0);
    expect(count(second.calls, 'quota')).toBe(0);
    expect(outcomes()).toEqual([{ outcome: 'cached' }]);
  });

  test('another occasion or another date is another cache entry', async () => {
    const w = world();
    await lucky(w);
    const office = await lucky(w, luckyRequest({ date: DATE, occasion: null }));
    expect(count(office.calls, 'jev')).toBeGreaterThan(0);
    const tomorrow = await lucky(w, luckyRequest({ date: '2026-11-09', occasion: 'university' }));
    expect(count(tomorrow.calls, 'jev')).toBeGreaterThan(0);
    expect(w.luckyCache.size).toBe(3);
  });

  test('a garment edit changes the fingerprint, so the list is recomputed', async () => {
    const w = world();
    await lucky(w);
    w.garments = w.garments.map((row) => (row.id === idOf(5) ? { ...row, colors: ['red'], updated_at: '2026-11-08T08:00:00Z' } : row));
    const { calls } = await lucky(w);
    expect(count(calls, 'quota')).toBe(1);
    expect(count(calls, 'jev')).toBe(30);
    expect(w.luckyCache.size).toBe(2);
  });

  test('putting a garment in the laundry changes the fingerprint', async () => {
    const w = world();
    await lucky(w);
    w.garments = w.garments.map((row) => (row.id === idOf(5) ? { ...row, status: 'laundry' } : row));
    const { calls } = await lucky(w);
    expect(count(calls, 'jev')).toBe(30);
  });

  test('a garment still being read (no category yet) or in the laundry does not change the key (P4-R15)', async () => {
    const w = world();
    await lucky(w);
    w.garments = [
      ...w.garments,
      garment(900, null, { colors: [], pattern: null, formality: null, fit: null, warmth: null }),
      garment(901, 'blouse', { status: 'laundry' }),
    ];
    const { calls } = await lucky(w);
    expect(count(calls, 'jev')).toBe(0);
    expect(count(calls, 'quota')).toBe(0);
    expect(w.luckyCache.size).toBe(1);
  });

  test('logging a wear keeps the cached list (P4-R6) but its outfits are no longer fresh this week', async () => {
    const w = world();
    const first = (await lucky(w)).body as OkBody;
    const worn = first.outfits[0]?.garmentIds ?? [];
    w.garments = w.garments.map((row) =>
      worn.includes(String(row.id)) ? { ...row, last_worn_at: `${DATE}T08:00:00Z`, updated_at: `${DATE}T08:00:00Z` } : row,
    );
    const { body, calls } = await lucky(w);
    expect(count(calls, 'jev')).toBe(0);
    expect(count(calls, 'quota')).toBe(0);
    const { outfits } = body as OkBody;
    expect(outfits.map((outfit) => outfit.garmentIds)).toEqual(first.outfits.map((outfit) => outfit.garmentIds));
    expect(outfits[0]?.freshThisWeek).toBe(false);
    for (const outfit of outfits) {
      expect(outfit.freshThisWeek).toBe(!outfit.garmentIds.some((id) => worn.includes(id)));
    }
  });

  test('a profile edit is a new cache entry', async () => {
    const w = world();
    await lucky(w);
    w.profile = { ...PROFILE, styles: ['elegant'], updated_at: '2026-11-08T07:00:00Z' };
    const { calls } = await lucky(w);
    expect(count(calls, 'jev')).toBe(30);
  });

  test('quota false → 429 over_quota with no Jev call and nothing cached', async () => {
    const w = world({ quota: false });
    const { response, body, calls } = await lucky(w);
    expect(response.status).toBe(429);
    expect(body).toEqual({ error: 'over_quota' });
    expect(count(calls, 'jev')).toBe(0);
    expect(w.luckyCache.size).toBe(0);
    expect(outcomes()).toEqual([{ outcome: 'over_quota' }]);
  });

  test('Jev failing for every call → the outfits in pre-score order with score null, still 200, cached degraded', async () => {
    const w = world({ jev: () => json(503, { error: 'unavailable' }) });
    const { response, body } = await lucky(w);
    expect(response.status).toBe(200);
    const { outfits } = body as OkBody;
    expect(outfits).toHaveLength(30);
    expect(outfits.every((outfit) => outfit.score === null)).toBe(true);
    expect(nonIncreasing(outfits.map((outfit) => preScore(piecesOf(w, outfit), DATE)))).toBe(true);
    expect(body).not.toHaveProperty('degraded');
    expect(cachedResults(w)).toEqual([{ ...(body as OkBody), degraded: true }]);
    expect(outcomes()).toEqual([{ outcome: 'degraded' }]);
  });

  test('an unparseable Jev answer counts as a failed call', async () => {
    const w = world({ jev: () => json(200, { answers: {} }) });
    const { body } = await lucky(w);
    expect((body as OkBody).outfits.every((outfit) => outfit.score === null)).toBe(true);
  });

  test('some Jev calls failing → the rated outfits by score, then the failed ones in pre-score order', async () => {
    const w = world({ jev: (state, n) => (n % 3 === 0 ? json(500, {}) : varied(state, n)) });
    const { body } = await lucky(w);
    const { outfits } = body as OkBody;
    expect(outfits).toHaveLength(30);
    const firstNull = outfits.findIndex((outfit) => outfit.score === null);
    expect(firstNull).toBe(20);
    const rated = outfits.slice(0, firstNull);
    const failed = outfits.slice(firstNull);
    expect(rated.every((outfit) => outfit.score !== null)).toBe(true);
    expect(nonIncreasing(rated.map((outfit) => outfit.score ?? -1))).toBe(true);
    expect(failed.every((outfit) => outfit.score === null)).toBe(true);
    expect(nonIncreasing(failed.map((outfit) => preScore(piecesOf(w, outfit), DATE)))).toBe(true);
    expect(cachedResults(w)).toEqual([expect.objectContaining({ degraded: true })]);
  });

  test('a degraded entry is served for an hour, then recomputed (P4-R12)', async () => {
    const w = world({ jev: () => json(500, {}) });
    await lucky(w);
    const within = await lucky(w);
    expect(count(within.calls, 'jev')).toBe(0);
    for (const row of w.luckyCache.values()) row.created_at = new Date(Date.now() - 61 * 60_000).toISOString();
    w.jev = varied;
    const later = await lucky(w);
    expect(count(later.calls, 'quota')).toBe(1);
    expect(count(later.calls, 'jev')).toBe(30);
    expect(cachedResults(w)).toEqual([expect.objectContaining({ degraded: false })]);
  });

  test('a malformed cache entry is a miss', async () => {
    const w = world();
    await lucky(w);
    for (const row of w.luckyCache.values()) row.result = { kind: 'ok', outfits: [{ garmentIds: 'nope' }] };
    const { calls } = await lucky(w);
    expect(count(calls, 'jev')).toBe(30);
  });

  test('no candidate passing the rules (but no slot missing) → ok with no outfits, cached, no Jev', async () => {
    const w = world();
    const { response, body, calls } = await lucky(w, luckyRequest({ date: DATE, occasion: 'event' }));
    expect(response.status).toBe(200);
    expect(body).toEqual({ kind: 'ok', weather: COOL, outfits: [] });
    expect(count(calls, 'jev')).toBe(0);
    expect(count(calls, 'quota')).toBe(1);
    expect(cachedResults(w)).toEqual([{ kind: 'ok', weather: COOL, outfits: [], degraded: false }]);
    expect(outcomes()).toEqual([{ outcome: 'empty' }]);
  });

  test('freshThisWeek is false for an outfit with an item worn 3 days ago', async () => {
    const w = world({ garments: smallCloset() });
    const { body } = await lucky(w);
    const { outfits } = body as OkBody;
    expect(outfits).toHaveLength(2);
    const withWorn = outfits.find((outfit) => outfit.garmentIds.includes(idOf(2)));
    const withoutWorn = outfits.find((outfit) => !outfit.garmentIds.includes(idOf(2)));
    expect(withWorn?.freshThisWeek).toBe(false);
    expect(withoutWorn?.freshThisWeek).toBe(true);
  });
});

describe('weather', () => {
  test('no city → weather null, no weather calls, the outfits still returned with a neutral weather fit', async () => {
    const states: JevState[] = [];
    const w = world({
      profile: NO_CITY,
      // Jev claims the outfit is unsafe for the weather; with no weather that is ignored (P4-R9/R10).
      jev: (state) => {
        states.push(state);
        return json(200, jevAt(0.9, { unsafe: 0.95 }));
      },
    });
    const { response, body, calls } = await lucky(w);
    expect(response.status).toBe(200);
    const { weather, outfits } = body as OkBody;
    expect(weather).toBeNull();
    expect(outfits).toHaveLength(30);
    expect(count(calls, 'weatherGet') + count(calls, 'forecast') + count(calls, 'geocode')).toBe(0);
    expect(states.every((state) => state.context.weather === null)).toBe(true);
    // 0.9 everywhere except weather_fit at the neutral 0.5 (weight 0.15): 90 − 0.15 · 40 = 84, not capped at 40.
    expect(outfits.every((outfit) => outfit.score === 84)).toBe(true);
    expect(cachedResults(w)).toEqual([expect.objectContaining({ degraded: false })]);
  });

  test('a forecast failure for a known city → weather null and the list cached as degraded', async () => {
    const w = world({ weather: null, forecast: () => json(502, {}) });
    const { body } = await lucky(w);
    expect((body as OkBody).weather).toBeNull();
    expect((body as OkBody).outfits.length).toBeGreaterThan(0);
    expect(cachedResults(w)).toEqual([expect.objectContaining({ degraded: true })]);
    // Every rating succeeded; the degradation is the weather's alone (M2).
    expect(outcomes()).toEqual([{ outcome: 'degraded' }]);
  });

  test('hot weather → no outerwear in any outfit', async () => {
    const w = world({ weather: HOT });
    const { body } = await lucky(w);
    const { outfits } = body as OkBody;
    expect(outfits.length).toBeGreaterThan(0);
    for (const outfit of outfits) expect(slotsOf(w, outfit)).not.toContain('outerwear');
  });

  test('cold weather → outerwear in every outfit', async () => {
    const w = world({ weather: COLD });
    const { body } = await lucky(w);
    const { outfits } = body as OkBody;
    expect(outfits.length).toBeGreaterThan(0);
    for (const outfit of outfits) expect(slotsOf(w, outfit)).toContain('outerwear');
  });
});

describe('pinned garments', () => {
  const pin = (w: Row[], id: string, date: string): Row[] =>
    w.map((row) => (String(row.id) === id ? { ...row, pinned_on: date } : row));

  test('a pin for today: every outfit in the list contains the pinned garment', async () => {
    const w = world({ garments: pin(bigCloset(), idOf(5), DATE) });
    const { body } = await lucky(w);
    const { outfits } = body as OkBody;
    expect(outfits.length).toBeGreaterThan(0);
    for (const outfit of outfits) expect(outfit.garmentIds).toContain(idOf(5));
  });

  test('a pin for another date has no effect: the list is the same as with no pin', async () => {
    const plain = (await lucky(world())).body as OkBody;
    const w = world({ garments: pin(bigCloset(), idOf(5), '2026-11-09') });
    const { body } = await lucky(w);
    expect((body as OkBody).outfits.map((o) => o.garmentIds)).toEqual(plain.outfits.map((o) => o.garmentIds));
  });

  test('a pin on a garment in the laundry has no effect: the list equals the same laundried closet with no pin', async () => {
    const laundried = bigCloset().map((row) => (String(row.id) === idOf(5) ? { ...row, status: 'laundry' } : row));
    const withoutPin = (await lucky(world({ garments: laundried }))).body as OkBody;
    const w = world({ garments: pin(laundried, idOf(5), DATE) });
    const { body } = await lucky(w);
    expect((body as OkBody).outfits.map((o) => o.garmentIds)).toEqual(withoutPin.outfits.map((o) => o.garmentIds));
    expect((body as OkBody).outfits.every((outfit) => !outfit.garmentIds.includes(idOf(5)))).toBe(true);
  });

  test('a pin with no complete rule-passing candidate gives the normal list', async () => {
    // idOf(5) is a formality-2 t-shirt; pinning it for an "event" (formality 4-5) means no
    // candidate the pin could qualify ever passes the rules, so the normal (unfiltered) list runs.
    const unpinned = (await lucky(world(), luckyRequest({ date: DATE, occasion: 'event' }))).body as OkBody;
    const w = world({ garments: pin(bigCloset(), idOf(5), DATE) });
    const { body } = await lucky(w, luckyRequest({ date: DATE, occasion: 'event' }));
    expect((body as OkBody).kind).toBe('ok');
    expect((body as OkBody).outfits.map((o) => o.garmentIds)).toEqual(unpinned.outfits.map((o) => o.garmentIds));
  });

  test('pinning a garment changes the cache key: a pin after a cached miss recomputes', async () => {
    const w = world();
    await lucky(w);
    w.garments = pin(w.garments, idOf(5), DATE);
    const { calls } = await lucky(w);
    expect(count(calls, 'jev')).toBeGreaterThan(0);
    expect(w.luckyCache.size).toBe(2);
  });

  test('several pinned garments: any one of them qualifies a candidate', async () => {
    const w = world({ garments: pin(pin(bigCloset(), idOf(5), DATE), idOf(10), DATE) });
    const { body } = await lucky(w);
    const { outfits } = body as OkBody;
    expect(outfits.length).toBeGreaterThan(0);
    for (const outfit of outfits) {
      expect(outfit.garmentIds.includes(idOf(5)) || outfit.garmentIds.includes(idOf(10))).toBe(true);
    }
  });

  // --- I1: a pinned outerwear piece is included on days the weather doesn't require it ----------

  test('a pinned jacket on a mild day (the default COOL weather, outerwear not required): every outfit contains it', async () => {
    // bigCloset's two jackets are ids 31 and 32.
    const w = world({ garments: pin(bigCloset(), idOf(31), DATE) });
    const { body } = await lucky(w);
    const { outfits } = body as OkBody;
    expect(outfits.length).toBeGreaterThan(0);
    for (const outfit of outfits) expect(outfit.garmentIds).toContain(idOf(31));
  });

  test('a pinned jacket with no weather known: every outfit contains it', async () => {
    const w = world({ garments: pin(bigCloset(), idOf(31), DATE), profile: NO_CITY });
    const { body } = await lucky(w);
    const { outfits } = body as OkBody;
    expect(outfits.length).toBeGreaterThan(0);
    for (const outfit of outfits) expect(outfit.garmentIds).toContain(idOf(31));
  });

  // --- I2: "Wear it" (a pin for tomorrow) must not invalidate today's cached list -----------------

  test('a pin for tomorrow keeps today\'s cache entry a hit', async () => {
    const w = world();
    const first = (await lucky(w)).body as OkBody;
    w.garments = pin(w.garments, idOf(5), '2026-11-09');
    const { body, calls } = await lucky(w);
    expect(count(calls, 'jev')).toBe(0);
    expect(count(calls, 'quota')).toBe(0);
    expect((body as OkBody).outfits).toEqual(first.outfits);
    expect(w.luckyCache.size).toBe(1);
  });

  test('a pin for today (not tomorrow) does change the cache key', async () => {
    const w = world();
    await lucky(w);
    w.garments = pin(w.garments, idOf(5), DATE);
    const { calls } = await lucky(w);
    expect(count(calls, 'jev')).toBeGreaterThan(0);
    expect(w.luckyCache.size).toBe(2);
  });
});

describe('donated garments', () => {
  test('a donated garment is never in the candidates or the list', async () => {
    const w = world({
      garments: bigCloset().map((row) => (String(row.id) === idOf(5) ? { ...row, status: 'donated' } : row)),
    });
    const { body } = await lucky(w);
    const { outfits } = body as OkBody;
    expect(outfits.length).toBeGreaterThan(0);
    expect(outfits.every((outfit) => !outfit.garmentIds.includes(idOf(5)))).toBe(true);
  });

  test('a closet whose every shoe is donated is too_small', async () => {
    const w = world({
      garments: bigCloset().map((row) =>
        ['sneakers', 'loafers', 'boots'].includes(String(row.category)) ? { ...row, status: 'donated' } : row,
      ),
    });
    const { body } = await lucky(w);
    expect((body as { kind: string }).kind).toBe('too_small');
  });
});

describe('latency budget (P4-R11)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const hrefOf = (input: string | URL | Request): string =>
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  /** Advances fake time in small steps, letting real macrotasks (`crypto.subtle.digest`) run between them. */
  async function drive(ms: number, step = 50): Promise<void> {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      for (let turn = 0; turn < 3; turn += 1) await new Promise((resolve) => setImmediate(resolve));
      await jest.advanceTimersByTimeAsync(Math.min(step, ms - elapsed));
    }
  }

  test('no Jev ranking call starts after 15 s: the rest keep pre-score order, score null, cached degraded', async () => {
    const w = world();
    const fake = fakeFetch(w);
    let jevCalls = 0;
    const pending = handleLucky(luckyRequest(), {
      env: ENV,
      fetch: async (input, init = {}) => {
        if (!hrefOf(input).startsWith(ENV.typesafeBaseUrl)) return fake.fetch(input, init);
        jevCalls += 1;
        const n = jevCalls;
        // Each rating takes 6 s: waves start at ~0, ~6 and ~12 s; at ~18 s the budget is spent.
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(json(200, jevAt(((n * 7) % 11) / 10)));
          }, 6_000);
        });
      },
      rand: mulberry32(7),
    });
    await drive(20_000);
    const response = await pending;
    expect(response.status).toBe(200);
    const { outfits } = (await response.json()) as OkBody;
    expect(jevCalls).toBe(15);
    expect(outfits).toHaveLength(30);
    expect(outfits.slice(0, 15).every((outfit) => outfit.score !== null)).toBe(true);
    expect(outfits.slice(15).every((outfit) => outfit.score === null)).toBe(true);
    expect(nonIncreasing(outfits.slice(15).map((outfit) => preScore(piecesOf(w, outfit), DATE)))).toBe(true);
    expect(cachedResults(w)).toEqual([expect.objectContaining({ degraded: true })]);
    expect(outcomes()).toEqual([{ outcome: 'degraded' }]);
  });
});

describe('logging', () => {
  test('logs only an outcome word, never garments, the profile or model output', async () => {
    const spies = (['log', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      const w = world();
      await lucky(w);
      await lucky(w);
      await lucky(world({ quota: false }));
      await lucky(world({ jev: () => json(500, {}) }));
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      for (const [line] of infoSpy.mock.calls) {
        const parsed = JSON.parse(String(line)) as Record<string, unknown>;
        expect(Object.keys(parsed)).toEqual(['outcome']);
      }
      expect(outcomes()).toEqual([
        { outcome: 'ranked' },
        { outcome: 'cached' },
        { outcome: 'over_quota' },
        { outcome: 'degraded' },
      ]);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
