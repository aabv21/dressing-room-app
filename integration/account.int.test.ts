// integration/account.int.test.ts
//
// The account functions end to end on the full local stack, called by signed-in users through the
// real gateway (JWT check) with supabase-js `functions.invoke`: `apple-token` exchanges a code with
// the Apple mock (`mockServices.ts` on the host) and stores the refresh token server-side;
// `export-data` returns the caller's rows and signed photo URLs; `delete-account` removes the
// caller's photos, revokes the Apple token with the mock and deletes the auth user, whose rows
// cascade away. A second user is untouched throughout.
//
// Needs the Edge Runtime: `pnpm db:start` (or `db:start:ci`, which keeps it) and `pnpm env:local`.
// Those start scripts generate the local Apple test key the functions sign with; this suite reads
// the same file to verify the signatures. The tests run in order and share A's account: the export
// and the deletion follow the token exchange, and the retry follows the deletion. A's Apple identity
// is linked straight in `auth.identities` (through the CLI and `SUPABASE_DB_URL`).

import { execFile } from 'node:child_process';
import { createPublicKey, randomUUID, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

import type { SupabaseClient } from '@supabase/supabase-js';

import { signInWithEmail } from '../src/auth/emailAuth';
import { garmentPhotoPath, uploadGarmentPhotoBytes } from '../src/closet/garmentRepository';
import type { Database } from '../src/lib/database.types';
import { LOCAL_APPLE_KEY_PATH } from '../scripts/db-start.ts';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, serviceClient, uniqueEmail } from './helpers';
import { mockAppleRefreshToken, mockAppleSubject, type MockServices, startMockServices } from './mockServices';

loadIntegrationEnv();

type Client = SupabaseClient<Database>;
type GarmentUpdate = Database['public']['Tables']['garments']['Update'];
type SignedInUser = { id: string; client: Client; garmentIds: string[] };

const PASSWORD = 'Password123!';
const FUNCTION_TIMEOUT_MS = 60_000;
// The Edge Runtime's `SUPABASE_URL`, which the signed export URLs start with locally (see the NOTE in
// `supabase/functions/export-data/handler.ts`).
const EDGE_SUPABASE_URL = 'http://kong:8000';
// Fixed paths next to this file, the repo's config and the start script's key file, never user input.
// eslint-disable-next-line security/detect-non-literal-fs-filename
const PHOTO = new Uint8Array(readFileSync(new URL('fixtures/garment.webp', import.meta.url)));
// eslint-disable-next-line security/detect-non-literal-fs-filename
const CONFIG_TOML = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');

/** The local Apple test key `scripts/db-start.ts` passed to the stack, as a PEM. */
function localAppleKey(): string {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return readFileSync(LOCAL_APPLE_KEY_PATH, 'utf8').trim().replace(/\\n/g, '\n');
  } catch (error) {
    throw new Error(
      `account.int.test.ts needs ${LOCAL_APPLE_KEY_PATH}: start the stack with \`pnpm db:start\` (not a bare \`supabase start\`). ` +
        String(error instanceof Error ? error.message : error),
    );
  }
}

/** A local `[edge_runtime.secrets]` value from `supabase/config.toml`. */
function localSecret(name: string): string {
  // `name` is one of this file's own literals below.
  // eslint-disable-next-line security/detect-non-literal-regexp
  const match = new RegExp(`^${name} = (?:"([^"]*)"|'([^']*)')`, 'm').exec(CONFIG_TOML);
  const value = match?.[1] ?? match?.[2];
  if (value === undefined) throw new Error(`supabase/config.toml has no ${name}`);
  return value;
}

const APPLE = {
  teamId: localSecret('APPLE_TEAM_ID'),
  keyId: localSecret('APPLE_KEY_ID'),
  clientId: localSecret('APPLE_CLIENT_ID'),
  // The local test key's public half, to verify the client secrets the function signs.
  publicKey: createPublicKey(localAppleKey()),
};

const execFileAsync = promisify(execFile);

/**
 * Links an Apple identity (`sub`) to `userId`, the row GoTrue writes when someone signs in with Apple.
 * `auth.identities` isn't reachable through the API, so this goes straight to the database
 * (`SUPABASE_DB_URL` from `.env.local`) through the Supabase CLI. Every value is a uuid or a
 * `mockAppleSubject`, never user input.
 */
async function linkAppleIdentity(userId: string, sub: string): Promise<void> {
  const sql =
    'insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at) ' +
    `values (gen_random_uuid(), '${sub}', '${userId}', jsonb_build_object('sub', '${sub}'), 'apple', now(), now())`;
  await execFileAsync('pnpm', ['exec', 'supabase', 'db', 'query', '--db-url', process.env.SUPABASE_DB_URL ?? '', sql]);
}

let mock: MockServices;
let userA: SignedInUser;
let userB: SignedInUser;

type Invoked = { status: number | undefined; body: unknown };

/** `functions.invoke` with the status and JSON body of any answer, 2xx or not. */
async function invoke(
  client: Client,
  name: 'apple-token' | 'export-data' | 'delete-account',
  body: Record<string, unknown>,
): Promise<Invoked> {
  const result = await client.functions.invoke<unknown>(name, { body });
  const { response } = result;
  if (result.error === null) return { status: response?.status, body: result.data };
  const failed = response?.clone();
  return { status: failed?.status, body: failed === undefined ? null : ((await failed.json()) as unknown) };
}

/** A reviewed garment with both photos, inserted the way the app does and given attributes with the service role. */
async function addGarment(user: { id: string; client: Client }, attributes: GarmentUpdate): Promise<string> {
  const id = randomUUID();
  await uploadGarmentPhotoBytes(user.id, id, 'full', PHOTO, user.client);
  await uploadGarmentPhotoBytes(user.id, id, 'thumb', PHOTO, user.client);
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
  return id;
}

async function userWithCloset(label: string): Promise<SignedInUser> {
  const email = uniqueEmail(label);
  const id = await createUser(email, PASSWORD);
  const client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });
  const user = { id, client };
  const garmentIds = [
    await addGarment(user, { category: 't_shirt', colors: ['white'], formality: 2, warmth: 1, fit: 'regular' }),
    await addGarment(user, { category: 'jeans', colors: ['navy'], formality: 2, warmth: 2, fit: 'regular' }),
  ];
  const wear = await client.rpc('log_wear', {
    p_wear_id: randomUUID(),
    p_garment_ids: garmentIds,
    p_worn_on: new Date().toISOString().slice(0, 10),
    p_occasion: 'office',
    p_score: 80,
  });
  expect(wear.error).toBeNull();
  return { ...user, garmentIds };
}

/** Every object path under `userId/` (one level of garment folders), read with the service role. */
async function objectsOf(userId: string): Promise<string[]> {
  const storage = serviceClient().storage.from('garments');
  const { data: folders, error } = await storage.list(userId, { limit: 1000 });
  expect(error).toBeNull();
  const paths: string[] = [];
  for (const folder of folders ?? []) {
    const { data: files, error: filesError } = await storage.list(`${userId}/${folder.name}`, { limit: 1000 });
    expect(filesError).toBeNull();
    paths.push(...(files ?? []).map((file) => `${userId}/${folder.name}/${file.name}`));
  }
  return paths.sort();
}

const photoPathsOf = (user: SignedInUser): string[] =>
  user.garmentIds.flatMap((id) => [garmentPhotoPath(user.id, id, 'full'), garmentPhotoPath(user.id, id, 'thumb')]).sort();

type UserTable = 'profiles' | 'garments' | 'outfits' | 'wears' | 'apple_tokens' | 'usage_counters';

/** How many rows `table` holds for `userId`, read with the service role. */
async function rowCount(table: UserTable, userId: string): Promise<number> {
  const { count, error } = await serviceClient().from(table).select('*', { count: 'exact', head: true }).eq('user_id', userId);
  expect(error).toBeNull();
  return count ?? -1;
}

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown;
}

beforeAll(async () => {
  mock = await startMockServices();
  userA = await userWithCloset('account-user-a');
  userB = await userWithCloset('account-user-b');
}, FUNCTION_TIMEOUT_MS);

afterAll(async () => {
  try {
    await mock.close();
    const leftover = await objectsOf(userB.id);
    if (leftover.length > 0) await serviceClient().storage.from('garments').remove(leftover);
  } finally {
    // A is normally gone already; `deleteUser` ignores a 404.
    await Promise.all([deleteUser(userA.id), deleteUser(userB.id)]);
  }
});

test('apple-token exchanges the code with Apple and stores the refresh token server-side only', async () => {
  const code = `code-${randomUUID()}`;
  // A signed in with Apple as the user the mock's id_token for this code names.
  await linkAppleIdentity(userA.id, mockAppleSubject(code));

  const { status, body } = await invoke(userA.client, 'apple-token', { code });

  expect(status).toBe(200);
  expect(body).toEqual({ outcome: 'stored' });

  const [form] = mock.appleForms('/auth/token');
  expect(mock.appleForms('/auth/token')).toHaveLength(1);
  expect(form?.get('code')).toBe(code);
  expect(form?.get('grant_type')).toBe('authorization_code');
  expect(form?.get('client_id')).toBe(APPLE.clientId);

  // The client secret the Edge Runtime signed with WebCrypto: ES256, the key id, Apple's claims.
  const [header = '', claims = '', signature = ''] = (form?.get('client_secret') ?? '').split('.');
  expect(decodeSegment(header)).toEqual({ alg: 'ES256', kid: APPLE.keyId });
  const decoded = decodeSegment(claims) as { iss: string; sub: string; aud: string; iat: number; exp: number };
  expect(decoded).toMatchObject({ iss: APPLE.teamId, sub: APPLE.clientId, aud: 'https://appleid.apple.com' });
  expect(decoded.exp).toBeGreaterThan(decoded.iat);
  expect(Math.abs(decoded.iat - Date.now() / 1000)).toBeLessThan(120);
  const valid = verify(
    'sha256',
    Buffer.from(`${header}.${claims}`),
    { key: APPLE.publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(signature, 'base64url'),
  );
  expect(valid).toBe(true);

  const stored = await serviceClient().from('apple_tokens').select('refresh_token').eq('user_id', userA.id);
  expect(stored.error).toBeNull();
  expect(stored.data).toEqual([{ refresh_token: mockAppleRefreshToken(code) }]);

  // Server-only: the user's own client can't read it back.
  const own = await userA.client.from('apple_tokens').select('refresh_token');
  expect(own.data ?? []).toEqual([]);
  expect(mock.appleForms('/auth/revoke')).toHaveLength(0);
}, FUNCTION_TIMEOUT_MS);

test('apple-token stores nothing for a code whose Apple user isn’t the caller’s, and revokes it', async () => {
  // B has no Apple identity at all, so a code for someone's Apple sign-in can't be parked under B.
  const code = `code-${randomUUID()}`;

  const { status, body } = await invoke(userB.client, 'apple-token', { code });

  expect(status).toBe(200);
  expect(body).toEqual({ outcome: 'identity_mismatch' });
  expect(await rowCount('apple_tokens', userB.id)).toBe(0);
  const revokes = mock.appleForms('/auth/revoke');
  expect(revokes.map((form) => form.get('token'))).toEqual([mockAppleRefreshToken(code)]);
}, FUNCTION_TIMEOUT_MS);

test('export-data holds the caller’s profile, garments, outfits with items, wears and photo URLs, and nothing of B', async () => {
  const { status, body } = await invoke(userA.client, 'export-data', {});

  expect(status).toBe(200);
  const data = body as {
    exportedAt: string;
    profile: { user_id: string } | null;
    garments: { id: string; user_id: string }[];
    outfits: { id: string; user_id: string; items: { garment_id: string }[] }[];
    wears: { outfit_id: string; user_id: string; occasion: string | null; score: number | null }[];
    photos: { garmentId: string; full: string | null; thumb: string | null }[];
  };
  expect(Number.isNaN(Date.parse(data.exportedAt))).toBe(false);
  expect(data.profile?.user_id).toBe(userA.id);
  expect(data.garments.map((garment) => garment.id).sort()).toEqual([...userA.garmentIds].sort());
  expect(data.outfits).toHaveLength(1);
  expect(data.outfits[0]?.items.map((item) => item.garment_id).sort()).toEqual([...userA.garmentIds].sort());
  expect(data.wears).toHaveLength(1);
  expect(data.wears[0]).toMatchObject({ outfit_id: data.outfits[0]?.id, user_id: userA.id, occasion: 'office', score: 80 });

  expect(data.photos.map((photo) => photo.garmentId).sort()).toEqual([...userA.garmentIds].sort());
  for (const photo of data.photos) {
    for (const url of [photo.full, photo.thumb]) {
      expect(url).toContain(`/storage/v1/object/sign/garments/${userA.id}/${photo.garmentId}/`);
      const local = (url ?? '').replace(EDGE_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
      const response = await fetch(local);
      expect(response.status).toBe(200);
      expect((await response.arrayBuffer()).byteLength).toBe(PHOTO.byteLength);
    }
  }

  const text = JSON.stringify(body);
  expect(text).not.toContain(userB.id);
  for (const id of userB.garmentIds) expect(text).not.toContain(id);
}, FUNCTION_TIMEOUT_MS);

// Uses A's Apple token row from the first test.
test('delete-account removes A’s photos, revokes the Apple token, deletes the user and every row cascades', async () => {
  expect(await objectsOf(userA.id)).toEqual(photoPathsOf(userA));
  const refreshToken = (await serviceClient().from('apple_tokens').select('refresh_token').eq('user_id', userA.id).single()).data
    ?.refresh_token;
  expect(refreshToken).toBeDefined();

  const { status, body } = await invoke(userA.client, 'delete-account', {});

  expect(status).toBe(200);
  expect(body).toEqual({ outcome: 'deleted' });

  // B's revoke from the mismatch test came first.
  const revokes = mock.appleForms('/auth/revoke').filter((form) => form.get('token') === refreshToken);
  expect(revokes).toHaveLength(1);
  expect(revokes[0]?.get('token_type_hint')).toBe('refresh_token');
  expect(revokes[0]?.get('client_id')).toBe(APPLE.clientId);

  expect(await objectsOf(userA.id)).toEqual([]);
  for (const table of ['profiles', 'garments', 'outfits', 'wears', 'apple_tokens', 'usage_counters'] as const) {
    expect(await rowCount(table, userA.id)).toBe(0);
  }
  const { data: outfitItems } = await serviceClient().from('outfit_items').select('garment_id').in('garment_id', userA.garmentIds);
  expect(outfitItems).toEqual([]);
  const gone = await serviceClient().auth.admin.getUserById(userA.id);
  expect(gone.data.user).toBeNull();
}, FUNCTION_TIMEOUT_MS);

// Runs after the deletion above, with A's still-valid access token.
test('a retry once the account is gone answers deleted without calling Apple again', async () => {
  const { status, body } = await invoke(userA.client, 'delete-account', {});

  expect(status).toBe(200);
  expect(body).toEqual({ outcome: 'deleted' });
  // Still only B's mismatch revoke and A's deletion revoke.
  expect(mock.appleForms('/auth/revoke')).toHaveLength(2);
}, FUNCTION_TIMEOUT_MS);

test('B is unaffected: the account, rows and photos are all still there', async () => {
  const user = await serviceClient().auth.admin.getUserById(userB.id);
  expect(user.data.user?.id).toBe(userB.id);
  expect(await rowCount('profiles', userB.id)).toBe(1);
  expect(await rowCount('garments', userB.id)).toBe(2);
  expect(await rowCount('outfits', userB.id)).toBe(1);
  expect(await rowCount('wears', userB.id)).toBe(1);
  expect(await objectsOf(userB.id)).toEqual(photoPathsOf(userB));

  const own = await userB.client.from('garments').select('id');
  expect(own.error).toBeNull();
  expect((own.data ?? []).map((row) => row.id).sort()).toEqual([...userB.garmentIds].sort());
});
