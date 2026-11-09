/** @jest-environment node */
// supabase/functions/for-you/__tests__/handler.test.ts
import type { Archetype } from '../../_shared/archetypes.ts';
import { type ClothingType, type GarmentCategory, slotOf } from '../../_shared/catalog.ts';
import {
  FIT_CANDIDATES,
  FIT_FLOOR,
  fitCandidates,
  finalRank,
  LINES_MODEL,
  MAX_IDEAS,
  rankByGain,
  type RankedIdea,
  searchQuery,
  templateLine,
} from '../../_shared/forYou.ts';
import { type RuleGarment, seasonOf } from '../../_shared/outfitRules.ts';
import { RATING_LEVELS } from '../../_shared/rating.ts';
import type { FnEnv } from '../../_shared/userContext.ts';
import { FOR_YOU_DAILY_LIMIT, type ForYouCard, handleForYou } from '../handler.ts';

const { jest } = import.meta;

const USER_ID = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const NOW = Date.parse('2026-11-08T09:00:00Z');
const DAY_MS = 86_400_000;

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
  pinned_on: null,
  ...extra,
});

/** Two tops, two bottoms and two pairs of shoes, all neutral and casual to smart casual. */
function closet(): Row[] {
  return [
    garment(1, 't_shirt'),
    garment(2, 'shirt', { colors: ['gray'], formality: 3, fit: 'fitted' }),
    garment(3, 'jeans', { colors: ['navy'] }),
    garment(4, 'pants', { colors: ['black'], formality: 3, fit: 'fitted' }),
    garment(5, 'sneakers'),
    garment(6, 'loafers', { colors: ['black'], formality: 3 }),
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

type RouteName = 'closet' | 'profile' | 'quota' | 'cacheGet' | 'cachePut' | 'jev' | 'claude';
type Call = { route: RouteName; url: URL; body: string | undefined };
type FitState = { user: Row; outfit: { category: string; colors: string[] }[] };

function routeOf(method: string, url: URL): RouteName {
  if (url.origin === ENV.typesafeBaseUrl && url.pathname === '/v1/systemone' && method === 'POST') return 'jev';
  if (url.origin === ENV.anthropicBaseUrl && url.pathname === '/v1/messages' && method === 'POST') return 'claude';
  if (url.pathname === '/rest/v1/garments' && method === 'GET') return 'closet';
  if (url.pathname === '/rest/v1/profiles' && method === 'GET') return 'profile';
  if (url.pathname === '/rest/v1/rpc/consume_quota' && method === 'POST') return 'quota';
  if (url.pathname === '/rest/v1/for_you_cache') return method === 'GET' ? 'cacheGet' : 'cachePut';
  throw new Error(`unexpected request ${method} ${url.href}`);
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const LEVELS = new Map<string, number>(Object.entries(RATING_LEVELS));

/** A Jev fit body with both Score answers at `fraction` of their scale, so `parseFit` gives `fraction`. */
function jevFit(fraction: number): unknown {
  const answer = (dimension: string) => ({
    type: 'score',
    score: fraction * ((LEVELS.get(dimension) ?? 0) - 1),
    confidence: 0.6,
  });
  return { model: 'jev-1.14.0', answers: { body_flattery: answer('body_flattery'), style_match: answer('style_match') } };
}

/** A fit per archetype that varies by category and color, so the ranking has something to sort. */
function fitFor(category: string, color: string): number {
  const text = `${category}:${color}`;
  let sum = 0;
  for (const char of text) sum += char.charCodeAt(0);
  return ((sum % 9) + 1) / 10;
}

const archetypeFit = (archetype: Archetype): number => fitFor(archetype.category, archetype.colors[0] ?? '');

const lineFor = (id: string): string => `A quiet staple for ${id}`;

/** The archetype ids a lines request asks for (its schema's id enum). */
function requestedIds(body: string | undefined): string[] {
  const request = JSON.parse(body ?? '{}') as {
    output_config: { format: { schema: { properties: { lines: { items: { properties: { id: { enum: string[] } } } } } } } };
  };
  return request.output_config.format.schema.properties.lines.items.properties.id.enum;
}

function claudeLines(lines: { id: string; text: string }[]): unknown {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: LINES_MODEL,
    content: [{ type: 'text', text: JSON.stringify({ lines }) }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 400, output_tokens: 120 },
  };
}

type World = {
  garments: Row[];
  profile: Row | null;
  quota: boolean;
  jev: (state: FitState, n: number) => Response | Promise<Response>;
  claude: (ids: string[]) => Response | Promise<Response>;
  /** for_you_cache rows by cache_key, as stored (the result keeps its internal `degraded` marker). */
  cache: Map<string, { result: unknown; created_at: string }>;
  /** How long the closet read takes, in ms (only with fake timers). */
  closetDelayMs?: number;
  /** Routes that never answer: their calls end only when the caller aborts them. */
  hang?: readonly RouteName[];
  fail?: Partial<Record<RouteName, Response>>;
};

function world(overrides: Partial<World> = {}): World {
  return {
    garments: closet(),
    profile: PROFILE,
    quota: true,
    jev: (state) => json(200, jevFit(fitFor(state.outfit[0]?.category ?? '', state.outfit[0]?.colors[0] ?? ''))),
    claude: (ids) => json(200, claudeLines(ids.map((id) => ({ id, text: lineFor(id) })))),
    cache: new Map(),
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
    if (w.hang?.includes(route) === true) {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }
    switch (route) {
      case 'closet':
        if (w.closetDelayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, w.closetDelayMs));
        return json(200, w.garments);
      case 'profile':
        return json(200, w.profile === null ? [] : [w.profile]);
      case 'quota':
        return json(200, w.quota);
      case 'cacheGet': {
        const key = (url.searchParams.get('cache_key') ?? '').replace(/^eq\./, '');
        const row = w.cache.get(key);
        return json(200, row === undefined ? [] : [row]);
      }
      case 'cachePut': {
        const row = JSON.parse(body ?? '{}') as { cache_key: string; result: unknown; created_at: string };
        w.cache.set(row.cache_key, { result: row.result, created_at: row.created_at });
        return new Response(null, { status: 201 });
      }
      case 'jev': {
        const n = jevCount;
        jevCount += 1;
        jevInFlight += 1;
        jevPeak = Math.max(jevPeak, jevInFlight);
        try {
          await Promise.resolve();
          return await w.jev((JSON.parse(body ?? '{}') as { state: FitState }).state, n);
        } finally {
          jevInFlight -= 1;
        }
      }
      case 'claude':
        return w.claude(requestedIds(body));
    }
  };
  return { fetch, calls, jevPeak: () => jevPeak };
}

function forYouRequest(
  body: unknown = { language: 'en' },
  { auth = AUTH, method = 'POST' }: { auth?: string | null; method?: string } = {},
): Request {
  const headers = { 'content-type': 'application/json', ...(auth === null ? {} : { authorization: auth }) };
  return new Request('http://functions.test/for-you', {
    method,
    headers,
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
}

type OkBody = { kind: 'ok'; ideas: ForYouCard[] };

async function forYou(w: World, request: Request = forYouRequest(), now = NOW) {
  const fake = fakeFetch(w);
  const response = await handleForYou(request, { env: ENV, fetch: fake.fetch, now: () => now });
  return { response, body: (await response.json()) as unknown, ...fake };
}

const count = (calls: Call[], route: RouteName): number => calls.filter((call) => call.route === route).length;
const cachedResults = (w: World): unknown[] => [...w.cache.values()].map((row) => row.result);
const ids = (body: unknown): string[] => (body as OkBody).ideas.map((idea) => idea.id);

/** The ideas the pure ranking expects for `rows`, given each archetype's fit (null: Jev failed). */
function expectedRanking(
  rows: readonly Row[],
  fitOf: (archetype: Archetype) => number | null = archetypeFit,
  clothingType: ClothingType = 'feminine',
): RankedIdea[] {
  const season = seasonOf(new Date(NOW).toISOString().slice(0, 10), 40.4168);
  const candidates = fitCandidates(rankByGain(rows as unknown as RuleGarment[], clothingType, season));
  return finalRank(candidates.map((idea) => ({ ...idea, fit: fitOf(idea.archetype) })));
}

const nonIncreasing = (values: readonly number[]): boolean =>
  values.every((value, i) => i === 0 || value <= (values[i - 1] ?? value));

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
    const { response, calls } = await forYou(world(), forYouRequest(undefined, { auth }));
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
    expect(outcomes()).toEqual([{ outcome: 'invalid' }]);
  });

  test('a method other than POST → 405', async () => {
    const { response, calls } = await forYou(world(), forYouRequest(undefined, { method: 'GET' }));
    expect(response.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  test.each([
    ['not JSON', 'nope'],
    ['no language', {}],
    ['an unknown language', { language: 'fr' }],
    ['a locale instead of a language', { language: 'es-ES' }],
  ])('%s → 400 invalid_input', async (_label, body) => {
    const { response, body: answer, calls } = await forYou(world(), forYouRequest(body));
    expect(response.status).toBe(400);
    expect(answer).toEqual({ error: 'invalid_input' });
    expect(calls).toHaveLength(0);
  });

  test('a database error loading the garments → 500 with no quota or model call', async () => {
    const { response, body, calls } = await forYou(world({ fail: { closet: json(500, {}) } }));
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'internal' });
    expect(count(calls, 'quota') + count(calls, 'jev') + count(calls, 'claude')).toBe(0);
    expect(outcomes()).toEqual([{ outcome: 'error' }]);
  });

  test('the quota RPC failing → 500, nothing cached', async () => {
    const w = world({ fail: { quota: json(500, {}) } });
    const { response, calls } = await forYou(w);
    expect(response.status).toBe(500);
    expect(count(calls, 'jev') + count(calls, 'claude') + count(calls, 'cachePut')).toBe(0);
  });
});

describe('too small', () => {
  test.each([
    ['an empty closet', []],
    ['two garments', closet().slice(0, 2)],
    [
      'one available, one in the laundry, the rest donated or still being read',
      [
        garment(1, 't_shirt'),
        garment(3, 'jeans', { colors: ['navy'], status: 'laundry' }),
        garment(5, 'sneakers', { status: 'donated' }),
        garment(8, null),
      ],
    ],
  ])('%s → too_small with no cache, quota or model call', async (_label, garments) => {
    const { response, body, calls } = await forYou(world({ garments }));
    expect(response.status).toBe(200);
    expect(body).toEqual({ kind: 'too_small' });
    expect(calls.map((call) => call.route).sort()).toEqual(['closet', 'profile']);
    expect(outcomes()).toEqual([{ outcome: 'too_small' }]);
  });

  test('two available garments plus a donated one is still too_small', async () => {
    const garments = [...closet().slice(0, 2), garment(9, 'sneakers', { status: 'donated' })];
    const { body } = await forYou(world({ garments }));
    expect(body).toEqual({ kind: 'too_small' });
  });

  test('two available plus ten in the laundry is a wardrobe, not too_small (P5-R11)', async () => {
    const laundry = Array.from({ length: 10 }, (_, i) => {
      const category: GarmentCategory = (['jeans', 'sneakers', 'shirt', 'pants', 'loafers'] as const)[i % 5] ?? 'jeans';
      return garment(30 + i, category, { status: 'laundry', colors: [i % 2 === 0 ? 'navy' : 'black'] });
    });
    const { body } = await forYou(world({ garments: [...closet().slice(0, 2), ...laundry] }));
    expect(body).toMatchObject({ kind: 'ok' });
    expect((body as OkBody).ideas.length).toBeGreaterThan(0);
  });

  test('everything in the laundry or lent out still gets ideas', async () => {
    const away = closet().map((row, i) => ({ ...row, status: i % 2 === 0 ? 'laundry' : 'lent' }));
    const { body: awayBody } = await forYou(world({ garments: away }));
    const { body } = await forYou(world());
    expect(awayBody).toEqual(body);
  });
});

describe('the ideas', () => {
  test('3–5 ideas in gain × fit order with Claude lines and store queries, cached, one Jev call per candidate', async () => {
    const w = world();
    const { response, body, calls, jevPeak } = await forYou(w);
    expect(response.status).toBe(200);
    const { kind, ideas } = body as OkBody;
    expect(kind).toBe('ok');

    const expected = expectedRanking(w.garments);
    expect(expected).toHaveLength(MAX_IDEAS);
    expect(ideas).toEqual(
      expected.map(({ archetype, gain }) => ({
        id: archetype.id,
        category: archetype.category,
        colors: archetype.colors,
        newOutfits: gain.newOutfits,
        combinesWith: gain.combinesWith,
        line: lineFor(archetype.id),
        lineKey: null,
        lineParams: {},
        searchQuery: searchQuery(archetype, 'feminine', 'en'),
      })),
    );
    expect(nonIncreasing(expected.map((idea) => idea.score))).toBe(true);
    // At most 2 per slot, so a closet that layering dominates still gets other kinds of piece.
    const slots = expected.map((idea) => slotOf(idea.archetype.category));
    for (const slot of new Set(slots)) expect(slots.filter((s) => s === slot).length).toBeLessThanOrEqual(2);

    expect(count(calls, 'jev')).toBe(FIT_CANDIDATES);
    expect(jevPeak()).toBeLessThanOrEqual(5);
    expect(count(calls, 'claude')).toBe(1);
    const quota = calls.find((call) => call.route === 'quota');
    expect(JSON.parse(quota?.body ?? '{}')).toEqual({ p_user_id: USER_ID, p_kind: 'for_you', p_limit: FOR_YOU_DAILY_LIMIT });
    expect(FOR_YOU_DAILY_LIMIT).toBe(1);

    expect(body).not.toHaveProperty('degraded');
    expect(cachedResults(w)).toEqual([{ ...(body as OkBody), degraded: false }]);
    expect([...w.cache.values()][0]?.created_at).toBe(new Date(NOW).toISOString());
    expect(outcomes()).toEqual([{ outcome: 'ranked' }]);
  });

  test('Spanish: the lines are asked for in Spanish and the store queries are Spanish', async () => {
    const w = world();
    const { body, calls } = await forYou(w, forYouRequest({ language: 'es' }));
    const request = JSON.parse(calls.find((call) => call.route === 'claude')?.body ?? '{}') as {
      messages: { content: { text: string }[] }[];
    };
    expect(request.messages[0]?.content[0]?.text).toContain('Spanish');
    expect((body as OkBody).ideas.map((idea) => idea.searchQuery)).toEqual(
      expectedRanking(w.garments).map(({ archetype }) => searchQuery(archetype, 'feminine', 'es')),
    );
  });

  test('Jev sees the archetype and the bucketed user, never garment ids or measurements; Claude sees no user data', async () => {
    const w = world();
    const { calls } = await forYou(w);
    for (const call of calls.filter((c) => c.route === 'jev')) {
      const { state } = JSON.parse(call.body ?? '{}') as { state: FitState };
      expect(Object.keys(state.user).sort()).toEqual(['age_group', 'body_type', 'clothing_type', 'height_bucket', 'styles']);
      expect(state.outfit).toHaveLength(1);
      expect(call.body).not.toContain(idOf(1).slice(0, 8));
      expect(call.body).not.toContain('164');
    }
    const claude = calls.find((call) => call.route === 'claude')?.body ?? '';
    expect(claude).not.toContain('10000000-');
    expect(claude).not.toContain('pear');
    expect(claude).not.toContain('Madrid');
  });

  test('no profile → the everything archetypes and no audience word in the queries', async () => {
    const w = world({ profile: null });
    const { body } = await forYou(w);
    const ranked = rankByGain(w.garments as unknown as RuleGarment[], 'everything', seasonOf('2026-11-08', null));
    const expected = finalRank(fitCandidates(ranked).map((idea) => ({ ...idea, fit: archetypeFit(idea.archetype) })));
    expect(ids(body)).toEqual(expected.map(({ archetype }) => archetype.id));
    expect((body as OkBody).ideas.map((idea) => idea.searchQuery)).toEqual(
      expected.map(({ archetype }) => searchQuery(archetype, 'everything', 'en')),
    );
  });

  test('Claude failing → every idea gets its template key, cached degraded', async () => {
    const w = world({ claude: () => json(500, { type: 'error' }) });
    const { response, body } = await forYou(w);
    expect(response.status).toBe(200);
    const expected = expectedRanking(w.garments);
    const { ideas } = body as OkBody;
    expect(ideas.map((idea) => idea.id)).toEqual(expected.map(({ archetype }) => archetype.id));
    expect(ideas.map(({ line, lineKey, lineParams }) => ({ line, lineKey, lineParams }))).toEqual(
      expected.map((idea) => ({ line: null, lineKey: templateLine(idea).key, lineParams: templateLine(idea).params })),
    );
    for (const idea of ideas) expect(idea.lineKey).toMatch(/^forYou\.line\./);
    expect(cachedResults(w)).toEqual([{ ...(body as OkBody), degraded: true }]);
    expect(outcomes()).toEqual([{ outcome: 'degraded' }]);
  });

  test('a Claude refusal or an answer with only some lines → templates for the missing ones, degraded', async () => {
    const refused = world({ claude: () => json(200, { ...(claudeLines([]) as Row), stop_reason: 'refusal' }) });
    const { body: refusedBody } = await forYou(refused);
    expect((refusedBody as OkBody).ideas.every((idea) => idea.line === null && idea.lineKey !== null)).toBe(true);

    const firstOnly = (asked: string[]) => claudeLines(asked.slice(0, 1).map((id) => ({ id, text: lineFor(id) })));
    const partial = world({ claude: (asked) => json(200, firstOnly(asked)) });
    const { body } = await forYou(partial);
    const [first, ...rest] = (body as OkBody).ideas;
    expect(first?.line).toBe(lineFor(first?.id ?? ''));
    expect(first?.lineKey).toBeNull();
    expect(rest.every((idea) => idea.line === null && idea.lineKey !== null)).toBe(true);
    expect(cachedResults(partial)).toEqual([expect.objectContaining({ degraded: true })]);
  });

  test('Jev failing for every idea → gain-only order (every fit at the floor), cached degraded', async () => {
    const w = world({ jev: () => json(503, {}) });
    const { body, calls } = await forYou(w);
    const expected = expectedRanking(w.garments, () => null);
    expect(expected.every((idea) => idea.fit === FIT_FLOOR)).toBe(true);
    expect(ids(body)).toEqual(expected.map(({ archetype }) => archetype.id));
    expect(nonIncreasing((body as OkBody).ideas.map((idea) => idea.newOutfits))).toBe(true);
    // The lines still come from Claude.
    expect((body as OkBody).ideas.every((idea) => idea.line !== null)).toBe(true);
    expect(count(calls, 'claude')).toBe(1);
    expect(cachedResults(w)).toEqual([{ ...(body as OkBody), degraded: true }]);
    expect(outcomes()).toEqual([{ outcome: 'degraded' }]);
  });

  test('an unparseable Jev answer counts as a failed fit', async () => {
    const w = world({ jev: () => json(200, { answers: { body_flattery: { type: 'score', score: 99 } } }) });
    const { body } = await forYou(w);
    expect(ids(body)).toEqual(expectedRanking(w.garments, () => null).map(({ archetype }) => archetype.id));
    expect(cachedResults(w)).toEqual([expect.objectContaining({ degraded: true })]);
  });

  test('nothing with gain > 0 → ok with no ideas, cached, no Jev or Claude call', async () => {
    const garments = [garment(1, 'bag'), garment(2, 'bag', { colors: ['black'] }), garment(3, 'scarf')];
    const w = world({ garments });
    const { body, calls } = await forYou(w);
    expect(body).toEqual({ kind: 'ok', ideas: [] });
    expect(count(calls, 'jev') + count(calls, 'claude')).toBe(0);
    expect(cachedResults(w)).toEqual([{ kind: 'ok', ideas: [], degraded: false }]);
    expect(outcomes()).toEqual([{ outcome: 'empty' }]);
  });
});

describe('the wardrobe (P5-R9)', () => {
  test('a garment in the laundry still combines in the gain and still owns its archetype', async () => {
    // Both pairs of shoes away: with only available pieces no outfit would be complete.
    const isShoe = (row: Row): boolean => ['sneakers', 'loafers'].includes(String(row.category));
    const w = world({ garments: closet().map((row) => (isShoe(row) ? { ...row, status: 'laundry' } : row)) });
    const { body } = await forYou(w);
    expect(ids(body)).toEqual(expectedRanking(closet()).map(({ archetype }) => archetype.id));
    expect((body as OkBody).ideas.every((idea) => idea.newOutfits > 0)).toBe(true);
    // The white sneakers in the laundry still own the white-sneakers archetype.
    expect(ids(body)).not.toContain('white-sneakers');
  });
});

describe('donated garments', () => {
  test('a donated garment adds no gain and owns no archetype: the ideas match the closet without it', async () => {
    const donated = [
      garment(20, 'skirt', { colors: ['black'], status: 'donated' }),
      garment(21, 'blazer', { colors: ['camel'], formality: 4, status: 'donated' }),
      garment(22, 'sneakers', { colors: ['black'], status: 'donated' }),
    ];
    const { body: withDonated } = await forYou(world({ garments: [...closet(), ...donated] }));
    const { body: without } = await forYou(world());
    expect(withDonated).toEqual(without);
  });

  test('donating a garment changes the key; editing a donated one does not', async () => {
    const w = world({ garments: [...closet(), garment(20, 'skirt', { colors: ['black'] })] });
    await forYou(w);
    w.garments = [...closet(), garment(20, 'skirt', { colors: ['black'], status: 'donated' })];
    expect(count((await forYou(w)).calls, 'quota')).toBe(1);
    w.garments = [...closet(), garment(20, 'skirt', { colors: ['black'], status: 'donated', formality: 4 })];
    expect(count((await forYou(w)).calls, 'quota')).toBe(0);
  });
});

describe('cache and quota', () => {
  test('a second call hits the cache: no quota, Jev or Claude, the same body', async () => {
    const w = world();
    const first = await forYou(w);
    const second = await forYou(w);
    expect(second.body).toEqual(first.body);
    expect(count(second.calls, 'quota') + count(second.calls, 'jev') + count(second.calls, 'claude')).toBe(0);
    expect(outcomes()).toEqual([{ outcome: 'ranked' }, { outcome: 'cached' }]);
  });

  test('an entry is a hit for 7 days, then a miss that spends the quota again', async () => {
    const w = world();
    await forYou(w);
    const hit = await forYou(w, forYouRequest(), NOW + 7 * DAY_MS - 60_000);
    expect(count(hit.calls, 'quota')).toBe(0);
    const miss = await forYou(w, forYouRequest(), NOW + 7 * DAY_MS + 60_000);
    expect(count(miss.calls, 'quota')).toBe(1);
    expect(count(miss.calls, 'jev')).toBe(FIT_CANDIDATES);
    expect([...w.cache.values()][0]?.created_at).toBe(new Date(NOW + 7 * DAY_MS + 60_000).toISOString());
  });

  test('a degraded entry is served for an hour, then recomputed (P4-R12)', async () => {
    const w = world({ claude: () => json(500, {}) });
    await forYou(w);
    const within = await forYou(w, forYouRequest(), NOW + 59 * 60_000);
    expect(count(within.calls, 'quota')).toBe(0);
    w.claude = (asked) => json(200, claudeLines(asked.map((id) => ({ id, text: lineFor(id) }))));
    const after = await forYou(w, forYouRequest(), NOW + 61 * 60_000);
    expect(count(after.calls, 'quota')).toBe(1);
    expect((after.body as OkBody).ideas.every((idea) => idea.line !== null)).toBe(true);
    expect(cachedResults(w)).toEqual([expect.objectContaining({ degraded: false })]);
  });

  test('another language is another entry', async () => {
    const w = world();
    await forYou(w);
    const { calls } = await forYou(w, forYouRequest({ language: 'es' }));
    expect(count(calls, 'quota')).toBe(1);
    expect(w.cache.size).toBe(2);
  });

  test('logging a wear, the laundry or lending keeps the key; a garment edit or a profile edit changes it', async () => {
    const w = world();
    await forYou(w);
    const worn = { last_worn_at: '2026-11-07T10:00:00Z', updated_at: '2026-11-07T10:00:00Z' };
    w.garments = closet().map((row, i) => (i === 0 ? { ...row, ...worn } : row));
    expect(count((await forYou(w)).calls, 'quota')).toBe(0);
    const away = new Map([
      [1, 'laundry'],
      [2, 'lent'],
    ]);
    w.garments = closet().map((row, i) => ({ ...row, status: away.get(i) ?? row.status }));
    const laundry = await forYou(w);
    expect(count(laundry.calls, 'quota')).toBe(0);
    expect(w.cache.size).toBe(1);

    const changes: [string, () => void][] = [
      ['an edit', () => (w.garments = closet().map((row, i) => (i === 0 ? { ...row, colors: ['cream'] } : row)))],
      ['a profile edit', () => (w.profile = { ...PROFILE, updated_at: '2026-11-07T00:00:00Z' })],
    ];
    for (const [, change] of changes) {
      const before = w.cache.size;
      change();
      expect(count((await forYou(w)).calls, 'quota')).toBe(1);
      expect(w.cache.size).toBe(before + 1);
    }
  });

  test('a malformed cache entry is a miss', async () => {
    const w = world();
    await forYou(w);
    for (const row of w.cache.values()) row.result = { kind: 'ok', ideas: [{ id: 'x' }], degraded: false };
    const { calls } = await forYou(w);
    expect(count(calls, 'quota')).toBe(1);
  });

  test('quota false → 429 over_quota with no Jev or Claude call and nothing cached', async () => {
    const w = world({ quota: false });
    const { response, body, calls } = await forYou(w);
    expect(response.status).toBe(429);
    expect(body).toEqual({ error: 'over_quota' });
    expect(count(calls, 'jev') + count(calls, 'claude') + count(calls, 'cachePut')).toBe(0);
    expect(outcomes()).toEqual([{ outcome: 'over_quota' }]);
  });

  test('over the quota with an expired entry for the same closet → that entry, not a 429', async () => {
    const w = world({ claude: () => json(500, {}) });
    const first = await forYou(w);
    w.quota = false;
    const { response, body, calls } = await forYou(w, forYouRequest(), NOW + 2 * 60 * 60_000);
    expect(response.status).toBe(200);
    expect(body).toEqual(first.body);
    expect(count(calls, 'jev') + count(calls, 'claude') + count(calls, 'cachePut')).toBe(0);
    expect(outcomes()).toEqual([{ outcome: 'degraded' }, { outcome: 'stale' }]);
  });

  test('over the quota with an entry over 7 days old for the same closet → that entry (stale)', async () => {
    const w = world();
    const first = await forYou(w);
    w.quota = false;
    const { response, body } = await forYou(w, forYouRequest(), NOW + 8 * DAY_MS);
    expect(response.status).toBe(200);
    expect(body).toEqual(first.body);
    expect(outcomes()).toEqual([{ outcome: 'ranked' }, { outcome: 'stale' }]);
  });

  test('the quota RPC failing with an expired entry for the same closet → 500, not the entry', async () => {
    const w = world();
    await forYou(w);
    w.fail = { quota: json(500, {}) };
    const { response, body } = await forYou(w, forYouRequest(), NOW + 8 * DAY_MS);
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'internal' });
  });

  test('over the quota with an expired entry for another key only → 429', async () => {
    const w = world();
    await forYou(w);
    w.quota = false;
    w.garments = closet().map((row, i) => (i === 0 ? { ...row, colors: ['cream'] } : row));
    const { response } = await forYou(w, forYouRequest(), NOW + 8 * DAY_MS);
    expect(response.status).toBe(429);
    expect(outcomes()).toEqual([{ outcome: 'ranked' }, { outcome: 'over_quota' }]);
  });

  test('a season change is a miss, even inside the 7 days (P5-R10)', async () => {
    const w = world();
    const autumn = Date.parse('2026-11-28T09:00:00Z');
    await forYou(w, forYouRequest(), autumn);
    const sameSeason = await forYou(w, forYouRequest(), autumn + DAY_MS);
    expect(count(sameSeason.calls, 'quota')).toBe(0);
    const winter = await forYou(w, forYouRequest(), Date.parse('2026-12-01T09:00:00Z'));
    expect(count(winter.calls, 'quota')).toBe(1);
    expect(w.cache.size).toBe(2);
  });
});

describe('latency budget (P4-R11, the lines deadline)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  /** Advances fake time in small steps, letting real macrotasks (`crypto.subtle.digest`) run between them. */
  async function drive(ms: number, step = 50): Promise<void> {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      for (let turn = 0; turn < 3; turn += 1) await new Promise((resolve) => setImmediate(resolve));
      await jest.advanceTimersByTimeAsync(Math.min(step, ms - elapsed));
    }
  }

  test('no Jev fit starts after 15 s: the skipped ideas rank at the floor, cached degraded', async () => {
    // The closet read takes 14 s, each fit 6 s: the first wave starts at ~14 s, the second would at ~20 s.
    const w = world({
      closetDelayMs: 14_000,
      jev: (state) =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(json(200, jevFit(fitFor(state.outfit[0]?.category ?? '', state.outfit[0]?.colors[0] ?? ''))));
          }, 6_000);
        }),
    });
    const fake = fakeFetch(w);
    const pending = handleForYou(forYouRequest(), { env: ENV, fetch: fake.fetch });
    await drive(25_000);
    const response = await pending;
    expect(response.status).toBe(200);
    const body = (await response.json()) as OkBody;
    expect(count(fake.calls, 'jev')).toBe(5);

    const ranked = rankByGain(w.garments as unknown as RuleGarment[], 'feminine', seasonOf('2026-11-08', 40.4168));
    const fitted = new Set(fitCandidates(ranked).slice(0, 5).map(({ archetype }) => archetype.id));
    const expected = expectedRanking(w.garments, (a) => (fitted.has(a.id) ? archetypeFit(a) : null));
    expect(ids(body)).toEqual(expected.map(({ archetype }) => archetype.id));
    expect(count(fake.calls, 'claude')).toBe(1);
    expect(cachedResults(w)).toEqual([expect.objectContaining({ degraded: true })]);
    expect(outcomes()).toEqual([{ outcome: 'degraded' }]);
  });

  /** Runs the handler under fake time and reports when it answered, in ms since the request. */
  async function timed(w: World, ms: number) {
    const fake = fakeFetch(w);
    const answered = { after: Number.POSITIVE_INFINITY };
    const pending = handleForYou(forYouRequest(), { env: ENV, fetch: fake.fetch }).then((response) => {
      answered.after = Date.now() - NOW;
      return response;
    });
    await drive(ms);
    const response = await pending;
    return { response, body: (await response.json()) as OkBody, calls: fake.calls, answeredAfter: answered.after };
  }

  test('every Jev call and Claude hanging: the answer still lands before 40 s, with templates (I1)', async () => {
    // The closet read takes 14.9 s, so a first wave of fits starts just inside the budget and runs
    // to its 10 s timeout; Claude then gets only what's left before the 38 s lines deadline.
    const w = world({ closetDelayMs: 14_900, hang: ['jev', 'claude'] });
    const { response, body, calls, answeredAfter } = await timed(w, 45_000);
    expect(response.status).toBe(200);
    expect(answeredAfter).toBeLessThan(40_000);
    expect(answeredAfter).toBeGreaterThanOrEqual(37_000);
    expect(count(calls, 'jev')).toBe(5);
    expect(count(calls, 'claude')).toBe(1);
    expect(body.ideas.length).toBe(MAX_IDEAS);
    expect(body.ideas.every((idea) => idea.line === null && idea.lineKey !== null)).toBe(true);
    expect(cachedResults(w)).toEqual([expect.objectContaining({ degraded: true })]);
  });

  test('Jev and Claude hanging from the start: two fit waves, then Claude cut at the 38 s deadline', async () => {
    const w = world({ hang: ['jev', 'claude'] });
    const { calls, answeredAfter } = await timed(w, 45_000);
    expect(count(calls, 'jev')).toBe(FIT_CANDIDATES);
    expect(answeredAfter).toBeLessThan(40_000);
  });

  test('2 s or less left before the lines deadline → no Claude call, every idea on its template', async () => {
    const w = world({ closetDelayMs: 36_500 });
    const { body, calls, answeredAfter } = await timed(w, 40_000);
    expect(count(calls, 'jev')).toBe(0);
    expect(count(calls, 'claude')).toBe(0);
    expect(answeredAfter).toBeLessThan(37_000);
    expect(body.ideas.every((idea) => idea.line === null && idea.lineKey !== null)).toBe(true);
    expect(cachedResults(w)).toEqual([expect.objectContaining({ degraded: true })]);
  });
});

describe('logging', () => {
  test('logs only an outcome word, never ideas, lines, garments or the profile', async () => {
    const spies = (['log', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      const w = world();
      const { body } = await forYou(w);
      await forYou(w);
      await forYou(world({ quota: false }));
      await forYou(world({ claude: () => json(500, {}) }));
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      const logged = JSON.stringify(infoSpy.mock.calls);
      for (const idea of (body as OkBody).ideas) {
        expect(logged).not.toContain(idea.id);
        expect(logged).not.toContain(idea.line ?? '');
        expect(logged).not.toContain(idea.searchQuery);
      }
      for (const [line] of infoSpy.mock.calls) {
        expect(Object.keys(JSON.parse(String(line)) as Record<string, unknown>)).toEqual(['outcome']);
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
