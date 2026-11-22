// integration/buyCheck.int.test.ts
//
// `buy-check` end to end on the local stack: a signed-in user's closet and profile (read with the
// caller's token, RLS), the `buy_check` quota on the local day, and Claude (here `mockAnthropic.ts` on
// the host). Nothing about the photo is stored: no object, no garment row.
//
// Needs the Edge Runtime: `pnpm db:start` (or `db:start:ci`, which keeps it) and `pnpm env:local`.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { SupabaseClient } from '@supabase/supabase-js';

import { signInWithEmail } from '../src/auth/emailAuth';
import type { Database } from '../src/lib/database.types';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, serviceClient, uniqueEmail } from './helpers';
import { type MockAnthropic, startMockAnthropic } from './mockAnthropic';

loadIntegrationEnv();

type Client = SupabaseClient<Database>;
type GarmentUpdate = Database['public']['Tables']['garments']['Update'];

const PASSWORD = 'Password123!';
const FUNCTION_TIMEOUT_MS = 60_000;

// Fixed paths in this repo, never user input.
const PHOTO = readFileSync(new URL('fixtures/garment.webp', import.meta.url)).toString('base64');
function claudeFixture(name: string): unknown {
  const url = new URL(`../supabase/functions/_shared/__tests__/fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as unknown;
}

let mock: MockAnthropic;
let userId: string;
let client: Client;

const today = (): string => new Date().toISOString().slice(0, 10);

// Two tops and two shoes; `claude-ok` reads navy jeans, which `owned` duplicates.
const closet = { tee: randomUUID(), shirt: randomUUID(), sneakers: randomUUID(), boots: randomUUID(), owned: randomUUID() };
const ATTRIBUTES: Record<keyof typeof closet, GarmentUpdate> = {
  tee: { category: 't_shirt', colors: ['white'], formality: 2, warmth: 1 },
  shirt: { category: 'shirt', colors: ['gray'], formality: 2, warmth: 1 },
  sneakers: { category: 'sneakers', colors: ['white'], formality: 2, warmth: 1 },
  boots: { category: 'boots', colors: ['black'], formality: 2, warmth: 2 },
  owned: { category: 'jeans', colors: ['navy'], formality: 2, warmth: 2 },
};

type Invoked = { status: number | undefined; body: unknown };

async function invoke(body: Record<string, unknown>): Promise<Invoked> {
  const result = await client.functions.invoke<unknown>('buy-check', { body });
  const { response } = result;
  if (result.error === null) return { status: response?.status, body: result.data };
  const failed = response?.clone();
  return { status: failed?.status, body: failed === undefined ? null : ((await failed.json()) as unknown) };
}

const photo = (): Record<string, unknown> => ({ image: PHOTO, mediaType: 'image/webp', date: today(), language: 'en' });

async function buyCheckQuota(): Promise<number> {
  const { data, error } = await serviceClient().from('usage_counters').select('count').eq('user_id', userId).eq('kind', 'buy_check');
  expect(error).toBeNull();
  return (data ?? []).reduce((sum, row) => sum + row.count, 0);
}

beforeAll(async () => {
  mock = await startMockAnthropic();
  mock.respondWith({ status: 200, body: claudeFixture('claude-ok') });

  const email = uniqueEmail('buy-check-user');
  userId = await createUser(email, PASSWORD);
  client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });
  for (const [name, id] of Object.entries(closet) as [keyof typeof closet, string][]) {
    expect((await client.from('garments').insert({ id })).error).toBeNull();
    const update = await serviceClient()
      .from('garments')
      // eslint-disable-next-line security/detect-object-injection -- `name` is a key of `closet`, which `ATTRIBUTES` mirrors.
      .update({ ...ATTRIBUTES[name], pattern: 'solid', fit: 'regular', seasons: [], status: 'available', extraction_status: 'done', uncertain_fields: [], reviewed_at: new Date().toISOString() })
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

test('compares the photographed item with the closet and spends one buy_check quota', async () => {
  const callsBefore = mock.calls();

  const { status, body } = await invoke(photo());

  expect(status).toBe(200);
  expect(body).toEqual({
    kind: 'ok',
    item: expect.objectContaining({ category: 'jeans', colors: ['navy', 'light_blue'] }) as unknown,
    duplicates: [{ id: closet.owned }],
    newOutfits: 4,
    verdict: 'skip',
  });
  expect(mock.calls()).toBe(callsBefore + 1);
  expect(await buyCheckQuota()).toBe(1);
}, FUNCTION_TIMEOUT_MS);

test('stores nothing about the photo: no object in the bucket and no new garment', async () => {
  const { data: objects, error } = await serviceClient().storage.from('garments').list(userId);
  expect(error).toBeNull();
  expect(objects ?? []).toEqual([]);
  const { count } = await serviceClient().from('garments').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  expect(count).toBe(Object.keys(closet).length);
}, FUNCTION_TIMEOUT_MS);

test('a photo that is not a garment answers not_garment and still spends the quota', async () => {
  mock.respondWith({ status: 200, body: claudeFixture('claude-not-garment') });
  try {
    const { status, body } = await invoke(photo());
    expect(status).toBe(200);
    expect(body).toEqual({ kind: 'not_garment' });
    expect(await buyCheckQuota()).toBe(2);
  } finally {
    mock.respondWith({ status: 200, body: claudeFixture('claude-ok') });
  }
}, FUNCTION_TIMEOUT_MS);

test('an image whose bytes are not the declared type answers 400 without spending the quota', async () => {
  const { status, body } = await invoke({ ...photo(), mediaType: 'image/jpeg' });
  expect(status).toBe(400);
  expect(body).toEqual({ error: 'invalid_input' });
  expect(await buyCheckQuota()).toBe(2);
}, FUNCTION_TIMEOUT_MS);

test('the sixth check of the day answers 429 over_quota without calling Claude', async () => {
  for (let n = await buyCheckQuota(); n < 5; n += 1) {
    expect((await invoke(photo())).status).toBe(200);
  }
  const callsBefore = mock.calls();
  const { status, body } = await invoke(photo());
  expect(status).toBe(429);
  expect(body).toEqual({ error: 'over_quota' });
  expect(mock.calls()).toBe(callsBefore);
}, FUNCTION_TIMEOUT_MS);
