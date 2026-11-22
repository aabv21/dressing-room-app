// integration/trip.int.test.ts
//
// `trip-plan` end to end on the local stack: a signed-in user's closet (read with the caller's token,
// RLS), the `trip` quota on the local day, `trip_cache`, and Open-Meteo's geocoding and daily
// forecast, here `mockServices.ts` on the host. No model is called.
//
// Needs the Edge Runtime: `pnpm db:start` (or `db:start:ci`, which keeps it) and `pnpm env:local`.

import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { signInWithEmail } from '../src/auth/emailAuth';
import type { Database } from '../src/lib/database.types';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, serviceClient, uniqueEmail } from './helpers';
import { dailyForecast, MADRID_GEOCODE, type MockServices, startMockServices } from './mockServices';

loadIntegrationEnv();

type Client = SupabaseClient<Database>;
type GarmentUpdate = Database['public']['Tables']['garments']['Update'];

const PASSWORD = 'Password123!';
const FUNCTION_TIMEOUT_MS = 60_000;

let mock: MockServices;
let userId: string;
let client: Client;

const today = (): string => new Date().toISOString().slice(0, 10);
const daysFrom = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const closet = { tee: randomUUID(), shirt: randomUUID(), jeans: randomUUID(), sneakers: randomUUID() };
const ATTRIBUTES: Record<keyof typeof closet, GarmentUpdate> = {
  tee: { category: 't_shirt', colors: ['white'], formality: 2, warmth: 1, fit: 'regular' },
  shirt: { category: 'shirt', colors: ['gray'], formality: 2, warmth: 1, fit: 'regular' },
  jeans: { category: 'jeans', colors: ['navy'], formality: 2, warmth: 2, fit: 'regular' },
  sneakers: { category: 'sneakers', colors: ['white'], formality: 2, warmth: 1, fit: 'regular' },
};

type Invoked = { status: number | undefined; body: unknown };

async function invoke(body: Record<string, unknown>): Promise<Invoked> {
  const result = await client.functions.invoke<unknown>('trip-plan', { body });
  const { response } = result;
  if (result.error === null) return { status: response?.status, body: result.data };
  const failed = response?.clone();
  return { status: failed?.status, body: failed === undefined ? null : ((await failed.json()) as unknown) };
}

const trip = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  city: 'Madrid',
  start: daysFrom(today(), 2),
  end: daysFrom(today(), 4),
  occasion: null,
  language: 'en',
  date: today(),
  ...overrides,
});

async function tripQuota(): Promise<number> {
  const { data, error } = await serviceClient().from('usage_counters').select('count').eq('user_id', userId).eq('kind', 'trip');
  expect(error).toBeNull();
  return (data ?? []).reduce((sum, row) => sum + row.count, 0);
}

beforeAll(async () => {
  mock = await startMockServices();
  mock.geocode({ status: 200, body: MADRID_GEOCODE });
  mock.forecast({ status: 200, body: dailyForecast(today(), 16) });

  const email = uniqueEmail('trip-user');
  userId = await createUser(email, PASSWORD);
  client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });
  for (const [name, id] of Object.entries(closet) as [keyof typeof closet, string][]) {
    expect((await client.from('garments').insert({ id })).error).toBeNull();
    const update = await serviceClient()
      .from('garments')
      // eslint-disable-next-line security/detect-object-injection -- `name` is a key of `closet`, which `ATTRIBUTES` mirrors.
      .update({ ...ATTRIBUTES[name], pattern: 'solid', seasons: [], status: 'available', extraction_status: 'done', uncertain_fields: [], reviewed_at: new Date().toISOString() })
      .eq('id', id);
    expect(update.error).toBeNull();
  }
}, FUNCTION_TIMEOUT_MS);

afterAll(async () => {
  try {
    await mock.close();
  } finally {
    await deleteUser(userId);
  }
});

test('plans each day from the closet with the forecast and a packing list, spending one trip quota', async () => {
  const geocodesBefore = mock.calls('/v1/search');

  const { status, body } = await invoke(trip());

  expect(status).toBe(200);
  const ok = body as {
    kind: string;
    city: string;
    days: { date: string; weather: { band: string } | null; garmentIds: string[] | null }[];
    packing: { slot: string; items: { garmentId: string; days: number }[] }[];
  };
  expect(ok.kind).toBe('ok');
  expect(ok.city).toBe('Madrid');
  expect(ok.days.map((day) => day.date)).toEqual([daysFrom(today(), 2), daysFrom(today(), 3), daysFrom(today(), 4)]);
  for (const day of ok.days) {
    expect(day.weather?.band).toBe('mild');
    expect(day.garmentIds).toContain(closet.jeans);
    expect(day.garmentIds).toContain(closet.sneakers);
  }
  expect(ok.packing.map((group) => group.slot)).toEqual(['top', 'bottom', 'shoes']);
  expect(ok.packing.find((group) => group.slot === 'bottom')?.items).toEqual([{ garmentId: closet.jeans, days: 3 }]);
  expect(mock.calls('/v1/search')).toBe(geocodesBefore + 1);
  expect(await tripQuota()).toBe(1);

  const { data: cached } = await serviceClient().from('trip_cache').select('cache_key').eq('user_id', userId);
  expect(cached).toHaveLength(1);
}, FUNCTION_TIMEOUT_MS);

test('the same trip again is a cache hit: no quota and no Open-Meteo call', async () => {
  const forecastsBefore = mock.calls('/v1/forecast');

  const { status } = await invoke(trip({ city: ' madrid ' }));

  expect(status).toBe(200);
  expect(mock.calls('/v1/forecast')).toBe(forecastsBefore);
  expect(await tripQuota()).toBe(1);
}, FUNCTION_TIMEOUT_MS);

test('days past the forecast come back without weather', async () => {
  mock.forecast({ status: 200, body: dailyForecast(today(), 3) });

  const { status, body } = await invoke(trip({ start: daysFrom(today(), 1), end: daysFrom(today(), 4) }));

  expect(status).toBe(200);
  const days = (body as { days: { weather: unknown }[] }).days;
  expect(days.map((day) => day.weather === null)).toEqual([false, false, true, true]);
}, FUNCTION_TIMEOUT_MS);

test('a city the geocoder doesn’t know answers 404 city_not_found', async () => {
  mock.geocode({ status: 200, body: { results: [] } });
  try {
    const { status, body } = await invoke(trip({ city: 'Nowhereville' }));
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'city_not_found' });
  } finally {
    mock.geocode({ status: 200, body: MADRID_GEOCODE });
  }
}, FUNCTION_TIMEOUT_MS);

test('the sixth trip of the day answers 429 over_quota', async () => {
  const used = await tripQuota();
  for (let n = used; n < 5; n += 1) {
    const { status } = await invoke(trip({ end: daysFrom(today(), 5 + n) }));
    expect(status).toBe(200);
  }
  const { status, body } = await invoke(trip({ end: daysFrom(today(), 11) }));
  expect(status).toBe(429);
  expect(body).toEqual({ error: 'over_quota' });
}, FUNCTION_TIMEOUT_MS);
