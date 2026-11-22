// integration/push.int.test.ts
//
// Server push on the full local stack: push_tokens through register_push_token() as the app writes it
// (own rows only, the device secret: another phone can't take a token, a new account on the same
// phone does), push-claim (a code pushed to the token takes it over), push-unregister with no session, the "ready to review" push from extract-attributes once a batch is done (once an
// hour, a dead token deleted), and the weekly-summary function behind its secret. Expo's push
// service is `mockServices.ts` on the host (`EXPO_PUSH_URL` in config.toml).
//
// Needs the Edge Runtime: `pnpm db:start` (or `db:start:ci`) and `pnpm env:local`.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { signInWithEmail } from '../src/auth/emailAuth';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, serviceClient, uniqueEmail } from './helpers';
import { type MockAnthropic, startMockAnthropic } from './mockAnthropic';
import { EXPO_PUSH_PATH, type MockServices, startMockServices } from './mockServices';

loadIntegrationEnv();

const PASSWORD = 'Password123!';
const POLL_INTERVAL_MS = 250;
// Must match WEEKLY_SUMMARY_SECRET in supabase/config.toml.
const WEEKLY_SECRET = 'local-only-not-a-secret';

// Fixed paths in this repo, never user input.
const PHOTO = readFileSync(new URL('fixtures/garment.webp', import.meta.url));
const OK = JSON.parse(
  readFileSync(new URL('../supabase/functions/_shared/__tests__/fixtures/claude-ok.json', import.meta.url), 'utf8'),
) as unknown;

let claude: MockAnthropic;
let services: MockServices;
const createdUserIds: string[] = [];
const uploadedPaths: string[] = [];

/** `secret` is the phone's device secret (the app's `push.deviceSecret`). */
type SignedInUser = { id: string; client: ReturnType<typeof anonClient>; token: string; secret: string };

const newSecret = (): string => randomUUID().replace(/-/g, '').repeat(2);

async function signedInUser(label: string): Promise<SignedInUser> {
  const email = uniqueEmail(label);
  const id = await createUser(email, PASSWORD);
  createdUserIds.push(id);
  const client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });
  return { id, client, token: `ExponentPushToken[int-${randomUUID()}]`, secret: newSecret() };
}

/** What the app does when a switch goes on; the error is null on success. */
async function register(user: SignedInUser, choices: { review_ready: boolean; weekly: boolean }) {
  const { error } = await user.client.rpc('register_push_token', {
    p_token: user.token,
    p_platform: 'android',
    p_review_ready: choices.review_ready,
    p_weekly: choices.weekly,
    p_device_secret: user.secret,
  });
  return error;
}

async function optIn(user: SignedInUser, choices: { review_ready: boolean; weekly: boolean }): Promise<void> {
  expect(await register(user, choices)).toBeNull();
}

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type Pushed = { to: string; title: string; body: string; data: Record<string, unknown> };

const pushesTo = (token: string): Pushed[] => (services.pushes() as Pushed[]).filter((message) => message.to === token);

async function waitFor<T>(read: () => T | Promise<T>, done: (value: T) => boolean, withinMs: number): Promise<T> {
  const deadline = Date.now() + withinMs;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    value = await read();
  }
  return value;
}

async function tokenRows(token: string): Promise<number> {
  const { data, error } = await serviceClient().from('push_tokens').select('token').eq('token', token);
  if (error !== null) throw error;
  return data.length;
}

/** What the app's pending-list flush sends after a sign-out: no session, the anon key only. */
function pushUnregister(body: unknown): Promise<Response> {
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  return fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/push-unregister`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: anonKey, authorization: `Bearer ${anonKey}` },
    body: JSON.stringify(body),
  });
}

function weeklySummary(secret: string): Promise<Response> {
  return fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/weekly-summary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': secret },
    body: '{}',
  });
}

beforeAll(async () => {
  claude = await startMockAnthropic();
  claude.respondWith({ status: 200, body: OK });
  services = await startMockServices();
});

afterAll(async () => {
  try {
    await claude.close();
    await services.close();
    await serviceClient().storage.from('garments').remove(uploadedPaths);
  } finally {
    await Promise.all(createdUserIds.map((id) => deleteUser(id)));
  }
});

describe('push_tokens through the API', () => {
  test('each user reads and deletes only their own row, never writes it directly, and never reads the secret’s hash', async () => {
    const userA = await signedInUser('push-rls-a');
    const userB = await signedInUser('push-rls-b');
    await optIn(userA, { review_ready: true, weekly: false });

    const own = await userA.client.from('push_tokens').select('token, review_ready, weekly');
    expect(own.data).toEqual([{ token: userA.token, review_ready: true, weekly: false }]);

    expect((await userB.client.from('push_tokens').select('token')).data).toEqual([]);
    // No client writes but through register_push_token(): a direct update is refused outright.
    const update = await userB.client.from('push_tokens').update({ weekly: true }).eq('token', userA.token);
    expect(update.error?.code).toBe('42501');
    const removal = await userB.client.from('push_tokens').delete().eq('token', userA.token).select('token');
    expect(removal.data).toEqual([]);

    const sneaky = await userA.client
      .from('push_tokens')
      .update({ last_review_push_at: '2020-01-01T00:00:00Z' })
      .eq('token', userA.token);
    expect(sneaky.error?.code).toBe('42501');
    expect((await userA.client.from('push_tokens').select('device_secret_hash')).error?.code).toBe('42501');

    // Turning both off, as the app does.
    expect((await userA.client.from('push_tokens').delete().eq('token', userA.token)).error).toBeNull();
    expect(await tokenRows(userA.token)).toBe(0);
  });
});

describe('taking over and unregistering a token', () => {
  test('another phone’s secret can’t take a token; a new account on the same phone takes it over', async () => {
    const previous = await signedInUser('push-takeover-a');
    const next = await signedInUser('push-takeover-b');
    await optIn(previous, { review_ready: true, weekly: true });

    const stranger = await register({ ...next, token: previous.token }, { review_ready: true, weekly: true });
    expect(stranger?.code).toBe('42501');

    await optIn({ ...next, token: previous.token, secret: previous.secret }, { review_ready: false, weekly: true });

    const { data, error } = await serviceClient().from('push_tokens').select('user_id').eq('token', previous.token);
    expect(error).toBeNull();
    expect(data).toEqual([{ user_id: next.id }]);
  });

  test('push-unregister, with only the anon key, deletes the token for its own secret and answers 204 either way', async () => {
    const user = await signedInUser('push-unregister');
    await optIn(user, { review_ready: true, weekly: false });

    expect((await pushUnregister({ token: user.token, device_secret: newSecret() })).status).toBe(204);
    expect(await tokenRows(user.token)).toBe(1);

    expect((await pushUnregister({ token: user.token, device_secret: user.secret })).status).toBe(204);
    expect(await tokenRows(user.token)).toBe(0);

    expect((await pushUnregister({ token: user.token, device_secret: user.secret })).status).toBe(204);
    expect((await pushUnregister({ token: 'not-a-token', device_secret: user.secret })).status).toBe(400);
  });
});

describe('reclaiming a token by proving receipt of a push', () => {
  test('push-claim sends a code to the token only, and the code takes the token over with the new secret', async () => {
    const holder = await signedInUser('push-claim-holder');
    const claimant = await signedInUser('push-claim-claimant');
    await optIn(holder, { review_ready: true, weekly: true });

    const start = await claimant.client.functions.invoke('push-claim', { body: { token: holder.token, step: 'start' } });
    expect(start.error).toBeNull();
    const pushed = await waitFor(() => pushesTo(holder.token), (pushes) => pushes.length > 0, 10_000);
    expect(pushed).toHaveLength(1);
    const code = String(pushed[0]?.data.code);
    expect(pushed[0]?.data.type).toBe('push-claim');
    expect(pushed[0]).not.toHaveProperty('title');

    // A second start within 10 minutes sends nothing.
    await claimant.client.functions.invoke('push-claim', { body: { token: holder.token, step: 'start' } });
    await sleep(1_000);
    expect(pushesTo(holder.token)).toHaveLength(1);

    const confirm = (withCode: string) =>
      claimant.client.functions.invoke('push-claim', {
        body: { token: holder.token, step: 'confirm', code: withCode, device_secret: claimant.secret, platform: 'android', review_ready: true, weekly: false },
      });
    expect((await confirm('WRNGXY23')).error).not.toBeNull();
    expect((await confirm(code)).error).toBeNull();

    const { data } = await serviceClient().from('push_tokens').select('user_id').eq('token', holder.token);
    expect(data).toEqual([{ user_id: claimant.id }]);
  }, 30_000);
});

describe('ready to review', () => {
  test('a finished upload pushes once to an opted-in phone, and not again within the hour', async () => {
    const user = await signedInUser('push-review');
    await optIn(user, { review_ready: true, weekly: false });

    await addGarment(user);
    const first = await waitFor(() => pushesTo(user.token), (pushes) => pushes.length > 0, 20_000);
    expect(first).toEqual([
      {
        to: user.token,
        title: '1 garment is ready to review',
        body: 'Tap to confirm their details.',
        data: { kind: 'reviewReady', url: '/review' },
        channelId: 'app-notices',
        sound: 'default',
      },
    ]);

    const second = await addGarment(user);
    await waitFor(
      async () => (await serviceClient().from('garments').select('extraction_status').eq('id', second).single()).data?.extraction_status,
      (status) => status !== 'pending',
      20_000,
    );
    // The write-back is in; give the function time to have pushed, had it been allowed to.
    await sleep(2_000);
    expect(pushesTo(user.token)).toHaveLength(1);
  }, 60_000);

  test('a phone Expo says is gone loses its row', async () => {
    services.expoPush((messages) => ({
      status: 200,
      body: { data: messages.map(() => ({ status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } })) },
    }));
    try {
      const user = await signedInUser('push-dead');
      await optIn(user, { review_ready: true, weekly: false });

      await addGarment(user);

      expect(await waitFor(() => tokenRows(user.token), (rows) => rows === 0, 20_000)).toBe(0);
      expect(pushesTo(user.token)).toHaveLength(1);
    } finally {
      services.expoPush(null);
    }
  }, 40_000);
});

describe('weekly summary', () => {
  test('the function pushes each weekly phone its week, behind its secret', async () => {
    const user = await signedInUser('push-weekly');
    await optIn(user, { review_ready: false, weekly: true });
    // A wear logged today, written as the server would (the RPC needs real garments).
    const service = serviceClient();
    const outfit = await service.from('outfits').insert({ user_id: user.id }).select('id').single();
    expect(outfit.error).toBeNull();
    const today = new Date().toISOString().slice(0, 10);
    expect((await service.from('wears').insert({ user_id: user.id, outfit_id: outfit.data?.id ?? '', worn_on: today })).error).toBeNull();

    expect((await weeklySummary('wrong-secret')).status).toBe(401);
    expect(pushesTo(user.token)).toEqual([]);

    const response = await weeklySummary(WEEKLY_SECRET);
    expect(response.status).toBe(200);
    expect(pushesTo(user.token)).toEqual([
      {
        to: user.token,
        title: 'Your week',
        body: 'This week: 1 outfit logged · 0 pieces waiting to be worn',
        data: { kind: 'weeklySummary', url: '/closet?segment=stats' },
        channelId: 'app-notices',
        sound: 'default',
      },
    ]);
    expect(services.calls(EXPO_PUSH_PATH)).toBeGreaterThan(0);
  }, 30_000);
});
