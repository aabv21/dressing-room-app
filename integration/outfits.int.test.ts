// integration/outfits.int.test.ts
//
// The outfit functions end to end on the full local stack: signed-in users call `lucky-list`,
// `rate-outfit` and `for-you` through the real gateway (JWT check) with supabase-js
// `functions.invoke`; the functions read the closet and the profile with the caller's token (RLS),
// spend the daily quota, fill `lucky_cache`/`rating_cache`/`weather_cache`/`for_you_cache`, and
// call Jev and Open-Meteo, here `mockServices.ts` on the host, and Claude, here `mockAnthropic.ts`.
// Also: `log_wear` from supabase-js bumps the garments' wear count.
//
// Needs the Edge Runtime: `pnpm db:start` (or `db:start:ci`, which keeps it) and `pnpm env:local`.

import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { signInWithEmail } from '../src/auth/emailAuth';
import type { Database } from '../src/lib/database.types';
import { ARCHETYPES } from '../supabase/functions/_shared/archetypes.ts';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, serviceClient, uniqueEmail } from './helpers';
import { type MockAnthropic, startMockAnthropic } from './mockAnthropic';
import { jevAnswers, MILD_FORECAST, type MockServices, startMockServices } from './mockServices';

loadIntegrationEnv();

type GarmentInsert = Database['public']['Tables']['garments']['Update'];
type Client = SupabaseClient<Database>;
type SignedInUser = { id: string; client: Client };

const PASSWORD = 'Password123!';
// Madrid; `locationKey` rounds the coordinates to two decimals.
const CITY = { city_name: 'Madrid', city_lat: 40.4168, city_lon: -3.7038 };
const LOCATION_KEY = '40.42,-3.70';
const FUNCTION_TIMEOUT_MS = 60_000;

let mock: MockServices;
let anthropic: MockAnthropic;
let userA: SignedInUser;
let userB: SignedInUser;
const createdUserIds: string[] = [];

/** User A's six reviewed garments, by name. */
const closet = {
  whiteTee: randomUUID(),
  grayShirt: randomUUID(),
  navyJeans: randomUUID(),
  blackPants: randomUUID(),
  whiteSneakers: randomUUID(),
  blackLoafers: randomUUID(),
};

const ATTRIBUTES: Record<keyof typeof closet, GarmentInsert> = {
  whiteTee: { category: 't_shirt', colors: ['white'], formality: 2, warmth: 1, fit: 'regular' },
  grayShirt: { category: 'shirt', colors: ['gray'], formality: 3, warmth: 1, fit: 'fitted' },
  navyJeans: { category: 'jeans', colors: ['navy'], formality: 2, warmth: 2, fit: 'regular' },
  blackPants: { category: 'pants', colors: ['black'], formality: 3, warmth: 2, fit: 'fitted' },
  whiteSneakers: { category: 'sneakers', colors: ['white'], formality: 2, warmth: 1, fit: 'regular' },
  blackLoafers: { category: 'loafers', colors: ['black'], formality: 3, warmth: 1, fit: 'regular' },
};

const TOPS = new Set<string>([closet.whiteTee, closet.grayShirt]);
const BOTTOMS = new Set<string>([closet.navyJeans, closet.blackPants]);
const SHOES = new Set<string>([closet.whiteSneakers, closet.blackLoafers]);

/** The client's local day as the functions take it (the UTC day here, like `consume_quota`'s). */
const today = (): string => new Date().toISOString().slice(0, 10);

/** The top of the UTC hour `at` falls in, as `weather_cache.hour` stores it. */
function utcHour(at: Date): string {
  const hour = new Date(at.getTime());
  hour.setUTCMinutes(0, 0, 0);
  return hour.toISOString();
}

async function signedInUser(label: string): Promise<SignedInUser> {
  const email = uniqueEmail(label);
  const id = await createUser(email, PASSWORD);
  createdUserIds.push(id);
  const client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });
  return { id, client };
}

/**
 * A reviewed garment: inserted the way the app does (only `id`, with the user's session), then
 * given its attributes with the service role, since `extraction_status` and `reviewed_at` aren't
 * client-writable. The insert trigger's extraction call finds the row no longer `pending` (or
 * fails without a mock Claude) and leaves it as set here.
 */
async function addReviewedGarment(user: SignedInUser, id: string, attributes: GarmentInsert): Promise<void> {
  const insert = await user.client.from('garments').insert({ id });
  expect(insert.error).toBeNull();
  const update = await serviceClient()
    .from('garments')
    .update({
      ...attributes,
      pattern: 'solid',
      seasons: [],
      status: 'available',
      extraction_status: 'done',
      uncertain_fields: [],
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id);
  expect(update.error).toBeNull();
}

/** For you's line for an archetype, as the mock Claude writes it. */
const lineFor = (id: string): string => `Pairs easily with what you already own (${id})`;

/**
 * The mock Claude's answer to For you's lines request: a line for every archetype id, since the mock
 * can't read which ideas were asked for (`parseLines` keeps only the ones requested).
 */
const CLAUDE_LINES = {
  id: 'msg_mock',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-5-5',
  content: [{ type: 'text', text: JSON.stringify({ lines: ARCHETYPES.map(({ id }) => ({ id, text: lineFor(id) })) }) }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 400, output_tokens: 300 },
};

type Invoked = { status: number | undefined; body: unknown };

/** `functions.invoke` with the status and JSON body of any answer, 2xx or not. */
async function invoke(
  client: Client,
  name: 'lucky-list' | 'rate-outfit' | 'for-you',
  body: Record<string, unknown>,
): Promise<Invoked> {
  // `error` is typed `any` by functions-js; only its presence matters here.
  const result = await client.functions.invoke<unknown>(name, { body });
  const { response } = result;
  if (result.error === null) return { status: response?.status, body: result.data };
  const failed = response?.clone();
  return { status: failed?.status, body: failed === undefined ? null : ((await failed.json()) as unknown) };
}

const rate = (user: SignedInUser | { client: Client }, garmentIds: readonly string[]) =>
  invoke(user.client, 'rate-outfit', { garment_ids: garmentIds, occasion: null, date: today() });

beforeAll(async () => {
  mock = await startMockServices();
  mock.jev((request) => ({ status: 200, body: jevAnswers(request, 0.9) }));
  anthropic = await startMockAnthropic();
  anthropic.respondWith({ status: 200, body: CLAUDE_LINES });
  mock.forecast({ status: 200, body: MILD_FORECAST });

  userA = await signedInUser('outfits-user-a');
  userB = await signedInUser('outfits-user-b');

  const service = serviceClient();
  const profile = await service.from('profiles').update(CITY).eq('user_id', userA.id);
  expect(profile.error).toBeNull();
  // Weather is cached per location and hour across users: start this run with a miss.
  const cleared = await service.from('weather_cache').delete().eq('location_key', LOCATION_KEY);
  expect(cleared.error).toBeNull();

  for (const [name, id] of Object.entries(closet) as [keyof typeof closet, string][]) {
    // eslint-disable-next-line security/detect-object-injection -- `name` is a key of `closet`, which `ATTRIBUTES` mirrors.
    await addReviewedGarment(userA, id, ATTRIBUTES[name]);
  }
}, FUNCTION_TIMEOUT_MS);

afterAll(async () => {
  await mock.close();
  await anthropic.close();
  await serviceClient().from('weather_cache').delete().eq('location_key', LOCATION_KEY);
  await Promise.all(createdUserIds.map((id) => deleteUser(id)));
});

describe('lucky-list', () => {
  let firstOutfits: unknown;
  let hourBefore: string;

  test('answers kind ok with complete outfits from the closet, rated by Jev', async () => {
    hourBefore = utcHour(new Date());

    const { status, body } = await invoke(userA.client, 'lucky-list', { date: today(), occasion: null });

    expect(status).toBe(200);
    expect(body).toMatchObject({ kind: 'ok', weather: { band: 'mild', condition: 'clear', rain: false } });
    const { outfits } = body as { outfits: { garmentIds: string[]; score: number | null; freshThisWeek: boolean }[] };
    expect(outfits.length).toBeGreaterThan(0);
    for (const outfit of outfits) {
      expect(outfit.garmentIds.filter((id) => TOPS.has(id))).toHaveLength(1);
      expect(outfit.garmentIds.filter((id) => BOTTOMS.has(id))).toHaveLength(1);
      expect(outfit.garmentIds.filter((id) => SHOES.has(id))).toHaveLength(1);
      expect(outfit.score).toBe(90);
      expect(outfit.freshThisWeek).toBe(true);
    }
    expect(mock.calls('/v1/systemone')).toBe(outfits.length);
    firstOutfits = outfits;
  }, FUNCTION_TIMEOUT_MS);

  test('a second call is served from lucky_cache without calling Jev', async () => {
    const jevCalls = mock.calls('/v1/systemone');

    const { status, body } = await invoke(userA.client, 'lucky-list', { date: today(), occasion: null });

    expect(status).toBe(200);
    expect(body).toMatchObject({ kind: 'ok', outfits: firstOutfits });
    expect(mock.calls('/v1/systemone')).toBe(jevCalls);
  }, FUNCTION_TIMEOUT_MS);

  test("the forecast lands in weather_cache for the hour, and later calls don't fetch it again", async () => {
    const hourAfter = utcHour(new Date());

    const { data, error } = await serviceClient()
      .from('weather_cache')
      .select('hour, payload')
      .eq('location_key', LOCATION_KEY)
      .in('hour', [hourBefore, hourAfter]);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.payload).toMatchObject({ weather: { band: 'mild' }, lat: CITY.city_lat });
    // Stored coordinates: no geocoding; one forecast for both calls (unless the hour turned over).
    expect(mock.calls('/v1/search')).toBe(0);
    expect(mock.calls('/v1/forecast')).toBe(hourBefore === hourAfter ? 1 : 2);
  });
});

describe('rate-outfit', () => {
  test("answers a Jev score for the caller's own outfit", async () => {
    const jevCalls = mock.calls('/v1/systemone');

    const { status, body } = await rate(userA, [closet.whiteTee, closet.navyJeans, closet.whiteSneakers]);

    expect(status).toBe(200);
    expect(body).toMatchObject({ score: 90, label: 'great', estimated: false, swap: null });
    expect(mock.calls('/v1/systemone')).toBe(jevCalls + 1);
  }, FUNCTION_TIMEOUT_MS);

  test('without a session the gateway or the function answers 401', async () => {
    const { status } = await rate({ client: anonClient() }, [closet.whiteTee, closet.navyJeans, closet.whiteSneakers]);

    expect(status).toBe(401);
  }, FUNCTION_TIMEOUT_MS);

  test("another user rating A's garment ids gets 404: RLS hides them", async () => {
    const jevCalls = mock.calls('/v1/systemone');

    const { status, body } = await rate(userB, [closet.grayShirt, closet.blackPants, closet.blackLoafers]);

    expect(status).toBe(404);
    expect(body).toEqual({ error: 'garment_not_found' });
    expect(mock.calls('/v1/systemone')).toBe(jevCalls);
  }, FUNCTION_TIMEOUT_MS);

  test('a used-up daily rating quota answers 429 over_quota without calling Jev', async () => {
    const filled = await serviceClient()
      .from('usage_counters')
      .upsert({ user_id: userA.id, day: today(), kind: 'rating', count: 50 });
    expect(filled.error).toBeNull();
    const jevCalls = mock.calls('/v1/systemone');

    // An outfit not rated yet: only cache misses spend quota.
    const { status, body } = await rate(userA, [closet.grayShirt, closet.blackPants, closet.blackLoafers]);

    expect(status).toBe(429);
    expect(body).toEqual({ error: 'over_quota' });
    expect(mock.calls('/v1/systemone')).toBe(jevCalls);
  }, FUNCTION_TIMEOUT_MS);
});

describe('for-you', () => {
  type Idea = { id: string; newOutfits: number; line: string | null; lineKey: string | null; searchQuery: string };

  test('ranks 3–5 ideas with the mock Jev fit and the mock Claude lines, then serves them from for_you_cache', async () => {
    const jevBefore = mock.calls('/v1/systemone');
    const claudeBefore = anthropic.calls();
    // An entry from an older closet state, which the new entry replaces.
    const seeded = await serviceClient().from('for_you_cache').insert({
      user_id: userA.id,
      cache_key: 'an-older-closet',
      result: { kind: 'ok', ideas: [], degraded: false },
      created_at: '2026-01-01T00:00:00Z',
    });
    expect(seeded.error).toBeNull();

    const first = await invoke(userA.client, 'for-you', { language: 'en' });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ kind: 'ok' });
    const { ideas } = first.body as { ideas: Idea[] };
    expect(ideas.length).toBeGreaterThanOrEqual(3);
    expect(ideas.length).toBeLessThanOrEqual(5);
    for (const idea of ideas) {
      expect(idea.line).toBe(lineFor(idea.id));
      expect(idea.lineKey).toBeNull();
      expect(idea.newOutfits).toBeGreaterThan(0);
      expect(idea.searchQuery.length).toBeGreaterThan(0);
    }
    const jevCalls = mock.calls('/v1/systemone') - jevBefore;
    expect(jevCalls).toBeGreaterThanOrEqual(ideas.length);
    expect(jevCalls).toBeLessThanOrEqual(10);
    expect(anthropic.calls()).toBe(claudeBefore + 1);

    const service = serviceClient();
    const usage = await service.from('usage_counters').select('count').eq('user_id', userA.id).eq('kind', 'for_you');
    expect(usage.error).toBeNull();
    expect(usage.data).toEqual([{ count: 1 }]);
    const cached = await service.from('for_you_cache').select('cache_key').eq('user_id', userA.id);
    expect(cached.data).toHaveLength(1);
    expect(cached.data?.[0]?.cache_key).not.toBe('an-older-closet');

    // A cache hit: no quota (the day's one miss is spent), no Jev, no Claude.
    const second = await invoke(userA.client, 'for-you', { language: 'en' });
    expect(second).toEqual(first);
    expect(mock.calls('/v1/systemone')).toBe(jevBefore + jevCalls);
    expect(anthropic.calls()).toBe(claudeBefore + 1);

    // Another key (Spanish) with the day's miss spent: the newest entry, as stale, not a 429.
    const spent = await invoke(userA.client, 'for-you', { language: 'es' });
    expect(spent).toEqual(first);
    expect(mock.calls('/v1/systemone')).toBe(jevBefore + jevCalls);
  }, FUNCTION_TIMEOUT_MS);
});

test('log_wear from supabase-js bumps wear_count, and the garments select shows it', async () => {
  const worn = [closet.whiteTee, closet.navyJeans, closet.whiteSneakers];

  const { error } = await userA.client.rpc('log_wear', {
    p_wear_id: randomUUID(),
    p_garment_ids: worn,
    p_worn_on: today(),
  });
  expect(error).toBeNull();

  const { data, error: selectError } = await userA.client.from('garments').select('id, wear_count, last_worn_at');
  expect(selectError).toBeNull();
  const counts = new Map((data ?? []).map((row) => [row.id, row.wear_count]));
  expect(Object.values(closet).map((id) => counts.get(id))).toEqual(
    Object.values(closet).map((id) => (worn.includes(id) ? 1 : 0)),
  );
});
