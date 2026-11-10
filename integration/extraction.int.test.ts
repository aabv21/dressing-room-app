// integration/extraction.int.test.ts
//
// Attribute extraction end to end on the full local stack: a garment insert fires the
// `garments_request_extraction` trigger, pg_net calls the `extract-attributes` Edge Function, the
// function calls Claude (here `mockAnthropic.ts` on the host) and writes the result back. Every
// failure (a 500, a refusal, no answer at all) ends `failed`, never stuck `pending`; a repeated
// insert of the same id calls Claude once; and an exhausted daily quota never reaches Claude.
//
// Needs the Edge Runtime: `pnpm db:start` (or `db:start:ci`, which keeps it) and `pnpm env:local`.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { signInWithEmail } from '../src/auth/emailAuth';
import type { Database } from '../src/lib/database.types';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, serviceClient, uniqueEmail } from './helpers';
import { type MockAnthropic, startMockAnthropic } from './mockAnthropic';

loadIntegrationEnv();

type ExtractionStatus = Database['public']['Enums']['extraction_status'];

const PASSWORD = 'Password123!';
const QUOTA_LIMIT = 100;
const POLL_INTERVAL_MS = 250;

// Fixed paths in this repo, never user input.
// eslint-disable-next-line security/detect-non-literal-fs-filename
const PHOTO = readFileSync(new URL('fixtures/garment.webp', import.meta.url));
function claudeFixture(name: string): unknown {
  const url = new URL(`../supabase/functions/_shared/__tests__/fixtures/${name}.json`, import.meta.url);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return JSON.parse(readFileSync(url, 'utf8')) as unknown;
}
const OK = claudeFixture('claude-ok');
const REFUSAL = claudeFixture('claude-refusal');

let mock: MockAnthropic;
const createdUserIds: string[] = [];
const uploadedPaths: string[] = [];

type SignedInUser = { id: string; client: ReturnType<typeof anonClient> };
let userA: SignedInUser;

async function signedInUser(label: string): Promise<SignedInUser> {
  const email = uniqueEmail(label);
  const id = await createUser(email, PASSWORD);
  createdUserIds.push(id);
  const client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });
  return { id, client };
}

/** What the app does: upload the full photo first, then insert the row (only `id`). */
async function addGarment(user: SignedInUser): Promise<string> {
  const id = randomUUID();
  const path = `${user.id}/${id}/full.webp`;
  const upload = await user.client.storage.from('garments').upload(path, PHOTO, { contentType: 'image/webp' });
  expect(upload.error).toBeNull();
  uploadedPaths.push(path);
  const insert = await user.client.from('garments').upsert({ id }, { onConflict: 'id', ignoreDuplicates: true });
  expect(insert.error).toBeNull();
  return id;
}

type GarmentState = { extraction_status: ExtractionStatus; category: string | null };

async function readGarment(id: string): Promise<GarmentState> {
  const { data, error } = await serviceClient()
    .from('garments')
    .select('extraction_status, category')
    .eq('id', id)
    .single();
  if (error !== null) throw error;
  return data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Polls until the garment leaves `pending`, or returns its last state once `withinMs` has passed. */
async function settledGarment(id: string, withinMs: number): Promise<GarmentState> {
  const deadline = Date.now() + withinMs;
  let state = await readGarment(id);
  while (state.extraction_status === 'pending' && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    state = await readGarment(id);
  }
  return state;
}

beforeAll(async () => {
  mock = await startMockAnthropic();
  userA = await signedInUser('extraction-user-a');
});

afterAll(async () => {
  await mock.close();
  await serviceClient().storage.from('garments').remove(uploadedPaths);
  await Promise.all(createdUserIds.map((id) => deleteUser(id)));
});

test("Claude's answer lands on the garment within 20 s", async () => {
  mock.respondWith({ status: 200, body: OK });

  const id = await addGarment(userA);

  expect(await settledGarment(id, 20_000)).toEqual({ extraction_status: 'done', category: 'jeans' });
}, 30_000);

test('a Claude 500 marks the garment failed', async () => {
  mock.respondWith({ status: 500, body: { type: 'error', error: { type: 'api_error', message: 'boom' } } });

  const id = await addGarment(userA);

  expect(await settledGarment(id, 20_000)).toEqual({ extraction_status: 'failed', category: null });
}, 30_000);

test('a Claude refusal marks the garment failed', async () => {
  mock.respondWith({ status: 200, body: REFUSAL });

  const id = await addGarment(userA);

  expect(await settledGarment(id, 20_000)).toEqual({ extraction_status: 'failed', category: null });
}, 30_000);

test('a Claude that never answers marks the garment failed within 40 s', async () => {
  mock.respondWith({ hang: true });

  const id = await addGarment(userA);

  expect(await settledGarment(id, 40_000)).toEqual({ extraction_status: 'failed', category: null });
}, 50_000);

test('inserting the same id again does not call Claude again', async () => {
  mock.respondWith({ status: 200, body: OK });
  const id = await addGarment(userA);
  expect((await settledGarment(id, 20_000)).extraction_status).toBe('done');
  const callsAfterFirst = mock.calls();

  const again = await userA.client.from('garments').upsert({ id }, { onConflict: 'id', ignoreDuplicates: true });
  expect(again.error).toBeNull();
  // Long enough for a queued pg_net request to reach the function and Claude, had one been queued.
  await sleep(5_000);

  expect(mock.calls()).toBe(callsAfterFirst);
}, 40_000);

test('an exhausted daily quota marks the garment over_quota without calling Claude', async () => {
  mock.respondWith({ status: 200, body: OK });
  const userC = await signedInUser('extraction-user-quota');
  const service = serviceClient();
  for (let used = 0; used < QUOTA_LIMIT; used += 1) {
    const { data, error } = await service.rpc('consume_quota', {
      p_user_id: userC.id,
      p_kind: 'extraction',
      p_limit: QUOTA_LIMIT,
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
  }
  const callsBefore = mock.calls();

  const id = await addGarment(userC);

  expect(await settledGarment(id, 20_000)).toEqual({ extraction_status: 'over_quota', category: null });
  expect(mock.calls()).toBe(callsBefore);
}, 60_000);
