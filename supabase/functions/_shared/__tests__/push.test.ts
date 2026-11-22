/** @jest-environment node */
// supabase/functions/_shared/__tests__/push.test.ts
import type { PushEnv, ServiceEnv } from '../env.ts';
import { deleteTokens, EXPO_PUSH_BATCH, EXPO_PUSH_TIMEOUT_MS, PUSH_CHANNEL_ID, sendPushes, type PushMessage } from '../push.ts';
import { reviewReadyCopy, weeklySummaryCopy } from '../pushCopy.ts';

const { jest } = import.meta;

const ENV: PushEnv & ServiceEnv = {
  supabaseUrl: 'http://supabase.test',
  serviceRoleKey: 'service-role-test',
  expoPushUrl: 'http://expo.test/--/api/v2/push/send',
  expoAccessToken: '',
};

type Call = { url: string; method: string; headers: Headers; body: string; signal: AbortSignal | null };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const message = (n: number): PushMessage => ({
  to: `ExponentPushToken[${String(n)}]`,
  title: 'Title',
  body: 'Body',
  data: { url: '/review' },
});

/** A fake Expo that answers each batch with `answer(batch, index)`. */
function fakeExpo(answer: (batch: PushMessage[], index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init.body === 'string' ? init.body : '';
    calls.push({ url, method: init.method ?? 'GET', headers: new Headers(init.headers), body, signal: init.signal ?? null });
    return Promise.resolve(answer(JSON.parse(body || '[]') as PushMessage[], calls.length - 1));
  }) as typeof fetch;
  return { fetchFn, calls };
}

const okTickets = (batch: PushMessage[]): Response =>
  json(200, { data: batch.map((_, i) => ({ status: 'ok', id: `receipt-${String(i)}` })) });

afterEach(() => {
  jest.useRealTimers();
});

describe('sendPushes', () => {
  test('posts the messages to Expo as JSON, on the Android channel, without a bearer when no access token is set', async () => {
    const { fetchFn, calls } = fakeExpo(okTickets);

    const result = await sendPushes(ENV, fetchFn, [message(1), message(2)]);

    expect(result).toEqual({ sent: 2, failed: 0, dead: [] });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(ENV.expoPushUrl);
    expect(call?.method).toBe('POST');
    expect(call?.headers.get('content-type')).toBe('application/json');
    expect(call?.headers.get('accept')).toBe('application/json');
    expect(call?.headers.has('authorization')).toBe(false);
    expect(JSON.parse(call?.body ?? '')).toEqual([
      { ...message(1), channelId: PUSH_CHANNEL_ID, sound: 'default' },
      { ...message(2), channelId: PUSH_CHANNEL_ID, sound: 'default' },
    ]);
    expect(call?.signal).not.toBeNull();
  });

  test('a data-only message (a claim code) goes without title, sound or channel, at high priority', async () => {
    const { fetchFn, calls } = fakeExpo(okTickets);

    await sendPushes(ENV, fetchFn, [{ to: 'ExponentPushToken[1]', data: { type: 'push-claim', code: 'ABCD2345' } }]);

    expect(JSON.parse(calls[0]?.body ?? '')).toEqual([
      { to: 'ExponentPushToken[1]', data: { type: 'push-claim', code: 'ABCD2345' }, priority: 'high', _contentAvailable: true },
    ]);
  });

  test('sends the access token as a bearer when Expo’s enhanced security is on', async () => {
    const { fetchFn, calls } = fakeExpo(okTickets);
    await sendPushes({ ...ENV, expoAccessToken: 'expo-token' }, fetchFn, [message(1)]);
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer expo-token');
  });

  test('sends nothing for no messages', async () => {
    const { fetchFn, calls } = fakeExpo(okTickets);
    expect(await sendPushes(ENV, fetchFn, [])).toEqual({ sent: 0, failed: 0, dead: [] });
    expect(calls).toHaveLength(0);
  });

  test(`batches at most ${String(EXPO_PUSH_BATCH)} messages per request`, async () => {
    const { fetchFn, calls } = fakeExpo(okTickets);
    const messages = Array.from({ length: 201 }, (_, n) => message(n));

    const result = await sendPushes(ENV, fetchFn, messages);

    expect(calls.map((call) => (JSON.parse(call.body) as unknown[]).length)).toEqual([100, 100, 1]);
    expect(result).toEqual({ sent: 201, failed: 0, dead: [] });
  });

  test('a DeviceNotRegistered ticket names its token as dead; other errors only count as failed', async () => {
    const { fetchFn } = fakeExpo(() =>
      json(200, {
        data: [
          { status: 'ok', id: 'r1' },
          { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
          { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
        ],
      }),
    );

    expect(await sendPushes(ENV, fetchFn, [message(1), message(2), message(3)])).toEqual({
      sent: 1,
      failed: 2,
      dead: ['ExponentPushToken[2]'],
    });
  });

  test.each([
    ['a 500', () => json(500, { errors: [{ code: 'INTERNAL' }] })],
    ['a body without tickets', () => json(200, { errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS' }] })],
    ['fewer tickets than messages', () => json(200, { data: [{ status: 'ok' }] })],
    ['a non-JSON body', () => new Response('<html>', { status: 200 })],
    ['a network error', () => Promise.reject(new TypeError('network'))],
  ])('%s fails that batch only, and the next batch still goes', async (_label, failure) => {
    const { fetchFn, calls } = fakeExpo((batch, index) => (index === 0 ? failure() : okTickets(batch)));
    const messages = Array.from({ length: 102 }, (_, n) => message(n));

    expect(await sendPushes(ENV, fetchFn, messages)).toEqual({ sent: 2, failed: 100, dead: [] });
    expect(calls).toHaveLength(2);
  });

  test(`gives up on a batch after ${String(EXPO_PUSH_TIMEOUT_MS)} ms`, async () => {
    jest.useFakeTimers();
    // A fetch that never answers but honors the abort, as Deno's does.
    const hanging = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      })) as typeof fetch;

    const pending = sendPushes(ENV, hanging, [message(1)]);
    await jest.advanceTimersByTimeAsync(EXPO_PUSH_TIMEOUT_MS);

    expect(await pending).toEqual({ sent: 0, failed: 1, dead: [] });
  });
});

describe('deleteTokens', () => {
  test('deletes exactly those tokens with the service role', async () => {
    const calls: Call[] = [];
    const fetchFn = ((input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, method: init.method ?? 'GET', headers: new Headers(init.headers), body: '', signal: null });
      return Promise.resolve(json(200, [{ token: 'ExponentPushToken[a]' }]));
    }) as typeof fetch;

    await deleteTokens(ENV, fetchFn, ['ExponentPushToken[a]', 'ExponentPushToken[b"c]']);

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe(`${ENV.supabaseUrl}/rest/v1/push_tokens`);
    expect(calls[0]?.method).toBe('DELETE');
    expect(url.searchParams.get('token')).toBe('in.("ExponentPushToken[a]","ExponentPushToken[b\\"c]")');
    expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${ENV.serviceRoleKey}`);
  });

  test(`deletes in chunks of ${String(EXPO_PUSH_BATCH)}, so a big run of dead tokens stays within URL limits`, async () => {
    const urls: string[] = [];
    const fetchFn = ((input: RequestInfo | URL) => {
      urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(json(200, []));
    }) as typeof fetch;

    await deleteTokens(ENV, fetchFn, Array.from({ length: 250 }, (_, n) => `ExponentPushToken[${String(n)}]`));

    expect(urls).toHaveLength(3);
    const counts = urls.map((url) => (new URL(url).searchParams.get('token')?.match(/ExponentPushToken/g) ?? []).length);
    expect(counts).toEqual([100, 100, 50]);
  });

  test('does nothing for no tokens', async () => {
    const fetchFn = jest.fn() as unknown as typeof fetch;
    await deleteTokens(ENV, fetchFn, []);
    expect(jest.mocked(fetchFn)).not.toHaveBeenCalled();
  });
});

describe('push copy', () => {
  test.each([
    ['en', 1, '1 garment is ready to review', 'Tap to confirm their details.'],
    ['en', 4, '4 garments are ready to review', 'Tap to confirm their details.'],
    ['es', 1, '1 prenda lista para revisar', 'Toca para confirmar sus datos.'],
    ['es', 4, '4 prendas listas para revisar', 'Toca para confirmar sus datos.'],
  ] as const)('ready to review in %s for %d', (language, count, title, body) => {
    expect(reviewReadyCopy(language, count)).toEqual({ title, body });
  });

  test.each([
    ['en', 4, 3, 'Your week', 'This week: 4 outfits logged · 3 pieces waiting to be worn'],
    ['en', 1, 1, 'Your week', 'This week: 1 outfit logged · 1 piece waiting to be worn'],
    ['en', 0, 2, 'Your week', 'This week: 0 outfits logged · 2 pieces waiting to be worn'],
    ['es', 4, 3, 'Tu semana', 'Esta semana: 4 outfits registrados · 3 prendas esperando a que las uses'],
    ['es', 1, 1, 'Tu semana', 'Esta semana: 1 outfit registrado · 1 prenda esperando a que la uses'],
  ] as const)('weekly summary in %s for %d outfits and %d unused', (language, outfits, unused, title, body) => {
    expect(weeklySummaryCopy(language, outfits, unused)).toEqual({ title, body });
  });
});
