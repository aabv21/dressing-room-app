/** @jest-environment node */
// supabase/functions/weekly-summary/__tests__/handler.test.ts
import { handleWeeklySummary, type WeeklySummaryEnv } from '../handler.ts';

const { jest } = import.meta;

const ENV: WeeklySummaryEnv = {
  supabaseUrl: 'http://supabase.test',
  serviceRoleKey: 'service-role-test',
  expoPushUrl: 'http://expo.test/--/api/v2/push/send',
  expoAccessToken: '',
  weeklySummarySecret: 'weekly-secret-test',
};

type Target = { user_id: string; token: string; language: string; outfits: number; unused: number };
type Call = { route: 'targets' | 'expo' | 'deleteToken'; url: URL; method: string; headers: Headers; body: string };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const userOf = (n: number): string => `10000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const target = (n: number, overrides: Partial<Target> = {}): Target => ({
  user_id: userOf(n),
  token: `ExponentPushToken[${String(n)}]`,
  language: 'en',
  outfits: 4,
  unused: 3,
  ...overrides,
});

type World = {
  targets: Target[];
  failTargets?: boolean;
  /** A server `max_rows` below the function's page size. */
  maxRows?: number;
  expo?: (messages: { to: string }[], index: number) => Response | Promise<Response>;
  failDelete?: boolean;
};

const okTickets = (messages: unknown[]): Response => json(200, { data: messages.map(() => ({ status: 'ok', id: 'r' })) });

function fakeFetch(world: World) {
  const calls: Call[] = [];
  let expoIndex = 0;
  const fetchFn = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? init.body : '';
    const headers = new Headers(init.headers);
    if (url.href === ENV.expoPushUrl && method === 'POST') {
      calls.push({ route: 'expo', url, method, headers, body });
      const messages = JSON.parse(body) as { to: string }[];
      return Promise.resolve((world.expo ?? okTickets)(messages, expoIndex++));
    }
    if (url.pathname === '/rest/v1/rpc/weekly_summary_targets' && method === 'POST') {
      calls.push({ route: 'targets', url, method, headers, body });
      if (world.failTargets === true) return Promise.resolve(json(500, { message: 'boom' }));
      const limit = Math.min(Number(url.searchParams.get('limit') ?? world.targets.length), world.maxRows ?? Infinity);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return Promise.resolve(json(200, world.targets.slice(offset, offset + limit)));
    }
    if (url.pathname === '/rest/v1/push_tokens' && method === 'DELETE') {
      calls.push({ route: 'deleteToken', url, method, headers, body });
      return Promise.resolve(world.failDelete === true ? json(500, {}) : json(200, []));
    }
    return Promise.reject(new Error(`unexpected request ${method} ${url.href}`));
  }) as typeof fetch;
  return { fetchFn, calls };
}

function cron({ secret = ENV.weeklySummarySecret, method = 'POST' }: { secret?: string | null; method?: string } = {}): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  const header = secret ?? undefined;
  if (header !== undefined) headers.set('x-webhook-secret', header);
  return new Request('http://functions.test/weekly-summary', { method, headers, ...(method === 'POST' ? { body: '{}' } : {}) });
}

let infoSpy: jest.SpiedFunction<typeof console.info>;

beforeEach(() => {
  infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  infoSpy.mockRestore();
});

describe('request checks', () => {
  test.each([
    ['a wrong secret', { secret: 'nope' }],
    ['a secret differing only in its last character', { secret: `${ENV.weeklySummarySecret.slice(0, -1)}X` }],
    ['no secret', { secret: null }],
  ])('%s is rejected with 401 before any fetch', async (_label, options) => {
    const { fetchFn, calls } = fakeFetch({ targets: [target(1)] });
    const response = await handleWeeklySummary(cron(options), { env: ENV, fetch: fetchFn });
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test('a method other than POST is rejected with 405', async () => {
    const { fetchFn, calls } = fakeFetch({ targets: [target(1)] });
    expect((await handleWeeklySummary(cron({ method: 'GET' }), { env: ENV, fetch: fetchFn })).status).toBe(405);
    expect(calls).toHaveLength(0);
  });
});

describe('the summary', () => {
  test('reads the targets with the service role and sends each its counts in its language, opening Stats', async () => {
    const { fetchFn, calls } = fakeFetch({
      targets: [target(1), target(2, { language: 'es', outfits: 1, unused: 1 })],
    });

    const response = await handleWeeklySummary(cron(), { env: ENV, fetch: fetchFn });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'sent', targets: 2, sent: 2, failed: 0, removed: 0 });
    const read = calls.find((call) => call.route === 'targets');
    expect(read?.headers.get('authorization')).toBe(`Bearer ${ENV.serviceRoleKey}`);
    const expo = calls.filter((call) => call.route === 'expo');
    expect(expo).toHaveLength(1);
    expect(JSON.parse(expo[0]?.body ?? '')).toEqual([
      {
        to: 'ExponentPushToken[1]',
        title: 'Your week',
        body: 'This week: 4 outfits logged · 3 pieces waiting to be worn',
        data: { kind: 'weeklySummary', url: '/closet?segment=stats' },
        channelId: 'app-notices',
        sound: 'default',
      },
      {
        to: 'ExponentPushToken[2]',
        title: 'Tu semana',
        body: 'Esta semana: 1 outfit registrado · 1 prenda esperando a que la uses',
        data: { kind: 'weeklySummary', url: '/closet?segment=stats' },
        channelId: 'app-notices',
        sound: 'default',
      },
    ]);
  });

  test('nobody opted in: nothing is sent', async () => {
    const { fetchFn, calls } = fakeFetch({ targets: [] });
    const response = await handleWeeklySummary(cron(), { env: ENV, fetch: fetchFn });
    expect(await response.json()).toEqual({ outcome: 'sent', targets: 0, sent: 0, failed: 0, removed: 0 });
    expect(calls.some((call) => call.route === 'expo')).toBe(false);
  });

  test('150 phones go in two Expo requests of at most 100', async () => {
    const { fetchFn, calls } = fakeFetch({ targets: Array.from({ length: 150 }, (_, n) => target(n)) });
    await handleWeeklySummary(cron(), { env: ENV, fetch: fetchFn });
    expect(calls.filter((call) => call.route === 'expo').map((call) => (JSON.parse(call.body) as unknown[]).length)).toEqual([100, 50]);
  });

  test('reads every target when the server caps a page', async () => {
    const { fetchFn, calls } = fakeFetch({ targets: Array.from({ length: 5 }, (_, n) => target(n)), maxRows: 2 });
    const response = await handleWeeklySummary(cron(), { env: ENV, fetch: fetchFn });
    expect(await response.json()).toMatchObject({ targets: 5, sent: 5 });
    const offsets = calls.filter((call) => call.route === 'targets').map((call) => call.url.searchParams.get('offset'));
    expect(offsets).toEqual(['0', '2', '4', '5']);
  });

  test('DeviceNotRegistered tokens are deleted, exactly those', async () => {
    const { fetchFn, calls } = fakeFetch({
      targets: [target(1), target(2), target(3)],
      expo: () =>
        json(200, {
          data: [
            { status: 'ok', id: 'r1' },
            { status: 'error', details: { error: 'DeviceNotRegistered' } },
            { status: 'error', details: { error: 'MessageRateExceeded' } },
          ],
        }),
    });

    const response = await handleWeeklySummary(cron(), { env: ENV, fetch: fetchFn });

    expect(await response.json()).toEqual({ outcome: 'sent', targets: 3, sent: 1, failed: 2, removed: 1 });
    const deletion = calls.find((call) => call.route === 'deleteToken');
    expect(deletion?.url.searchParams.get('token')).toBe('in.("ExponentPushToken[2]")');
  });

  test('a failed batch doesn’t stop the next', async () => {
    const { fetchFn } = fakeFetch({
      targets: Array.from({ length: 101 }, (_, n) => target(n)),
      expo: (messages, index) => (index === 0 ? json(500, {}) : okTickets(messages)),
    });
    const response = await handleWeeklySummary(cron(), { env: ENV, fetch: fetchFn });
    expect(await response.json()).toEqual({ outcome: 'sent', targets: 101, sent: 1, failed: 100, removed: 0 });
  });

  test('a failing token delete still answers what was sent', async () => {
    const { fetchFn } = fakeFetch({
      targets: [target(1)],
      expo: () => json(200, { data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }),
      failDelete: true,
    });
    const response = await handleWeeklySummary(cron(), { env: ENV, fetch: fetchFn });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'sent', targets: 1, sent: 0, failed: 1, removed: 0 });
  });

  test.each([
    ['the targets read fails', { targets: [], failTargets: true }],
    ['a target of another shape', { targets: [{ ...target(1), token: 42 } as unknown as Target] }],
  ])('%s: 500 and nothing sent', async (_label, world) => {
    const { fetchFn, calls } = fakeFetch(world);
    const response = await handleWeeklySummary(cron(), { env: ENV, fetch: fetchFn });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal' });
    expect(calls.some((call) => call.route === 'expo')).toBe(false);
  });

  test('logs only outcome words and counts, never a token or copy', async () => {
    const { fetchFn } = fakeFetch({ targets: [target(1)] });
    await handleWeeklySummary(cron(), { env: ENV, fetch: fetchFn });
    expect(infoSpy.mock.calls).toEqual([[JSON.stringify({ outcome: 'sent', targets: '1', sent: '1', failed: '0', removed: '0' })]]);
  });
});
