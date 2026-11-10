import { AppState } from 'react-native';

const mockCreateClient = jest.fn(() => ({
  auth: {
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
  },
}));

jest.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }));
// The real module's only job is a side effect (installing `globalThis.localStorage`); reproduce
// that here since there is no native SQLite to back the real implementation under Jest.
const mockStoredItems = new Map<string, string>();
jest.mock('expo-sqlite/localStorage/install', () => {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string): string | null => mockStoredItems.get(key) ?? null,
  };
  return {};
});

const ORIGINAL_ENV = process.env;
// Imported for identity only: jest.resetModules() below gives `../supabase` a fresh registry, so the
// comparison goes through the same module instance the client was created with.
let fetchWithTimeout: unknown;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

test('creates a client with the expected auth options when both env vars are set', async () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54421';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

  await import('../supabase');
  ({ fetchWithTimeout } = await import('../fetchWithTimeout'));

  expect(mockCreateClient).toHaveBeenCalledTimes(1);
  const [url, anonKey, options] = mockCreateClient.mock.calls[0] as unknown as [
    string,
    string,
    Record<string, unknown>,
  ];
  expect(url).toBe('http://127.0.0.1:54421');
  expect(anonKey).toBe('anon-key');
  expect(options['auth']).toMatchObject({
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // supabase-js's own default key for this URL, spelled out so readStoredSession reads the same entry.
    storageKey: 'sb-127-auth-token',
  });
  expect(options['global']).toEqual({ fetch: fetchWithTimeout });
});

test('readStoredSession reads the persisted session without a network call', async () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54421';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  const { readStoredSession } = await import('../supabase');

  expect(readStoredSession()).toBeNull();

  mockStoredItems.set(
    'sb-127-auth-token',
    JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 1, user: { id: 'user-1', email: 'ana@example.com' } }),
  );
  expect(readStoredSession()).toEqual({ userId: 'user-1', email: 'ana@example.com' });
  mockStoredItems.clear();
});

test('throws naming the missing variable when the anon key is unset', async () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54421';
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  await expect(import('../supabase')).rejects.toThrow(/EXPO_PUBLIC_SUPABASE_ANON_KEY/);
});

test('throws naming the missing variable when the url is unset', async () => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

  await expect(import('../supabase')).rejects.toThrow(/EXPO_PUBLIC_SUPABASE_URL/);
});

describe('startAuthAutoRefresh', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54421';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  });

  test('starts on active and stops on background, and unsubscribes on cleanup', async () => {
    const remove = jest.fn();
    const addEventListener = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove });

    const { supabase, startAuthAutoRefresh } = await import('../supabase');
    // These are jest.fn() mocks from the mocked module factory above, not real class methods, so
    // there is no `this` to lose by destructuring them.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { startAutoRefresh, stopAutoRefresh } = supabase.auth;
    const stop = startAuthAutoRefresh();

    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    const handler = addEventListener.mock.calls[0]?.[1];

    handler?.('active');
    expect(startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(stopAutoRefresh).not.toHaveBeenCalled();

    handler?.('background');
    expect(stopAutoRefresh).toHaveBeenCalledTimes(1);

    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
