jest.mock('../../lib/supabase', () => ({ supabase: {} }));
const mockConstants: { expoConfig: { extra?: { eas?: { projectId?: string } } } | null } = {
  expoConfig: { extra: { eas: { projectId: 'project-1' } } },
};
// A getter: the factory runs before `mockConstants` is initialized.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockConstants.expoConfig;
    },
  },
}));

import * as Notifications from 'expo-notifications';

import { allowUserKeys, kvKeys, kvRemove } from '../../lib/kv';
import { flushPendingUnregister, forgetPushToken, setPushPreferences, type PushClient } from '../pushRegistration';
import { readPendingUnregister, readPush, writePush } from '../pushStore';

const mocked = jest.mocked(Notifications);
const USER_ID = 'user-1';
const TOKEN = 'ExponentPushToken[device-1]';

type Answer = { error: { message: string } | null };

type InvokeAnswer = { data: unknown; error: Error | null };

/** A supabase-js stand-in recording the push_tokens upserts and deletes and the push-unregister calls. */
function fakeClient({
  upsert = { error: null },
  remove = { error: null },
  unregister = () => Promise.resolve({ data: null, error: null }),
}: {
  upsert?: Answer;
  remove?: Answer | Promise<never>;
  unregister?: (token: string) => Promise<InvokeAnswer>;
} = {}) {
  const upserts: { row: unknown; options: unknown }[] = [];
  const deletes: { column: string; value: string }[] = [];
  const tables: string[] = [];
  const unregistered: string[] = [];
  const client = {
    functions: {
      invoke: (name: string, options: { body: { token: string } }) => {
        if (name !== 'push-unregister') throw new Error(`unexpected function ${name}`);
        unregistered.push(options.body.token);
        return unregister(options.body.token);
      },
    },
    from: (table: string) => {
      tables.push(table);
      return {
        upsert: (row: unknown, options: unknown) => {
          upserts.push({ row, options });
          return Promise.resolve(upsert);
        },
        delete: () => ({
          eq: (column: string, value: string) => {
            deletes.push({ column, value });
            return remove instanceof Promise ? remove : Promise.resolve(remove);
          },
        }),
      };
    },
  } as unknown as PushClient;
  return { client, upserts, deletes, tables, unregistered };
}

function deniedStatus(): Notifications.NotificationPermissionsStatus {
  return { granted: false, canAskAgain: false, status: 'denied', expires: 'never' } as unknown as Notifications.NotificationPermissionsStatus;
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of kvKeys()) kvRemove(key);
  allowUserKeys(USER_ID);
  mockConstants.expoConfig = { extra: { eas: { projectId: 'project-1' } } };
});

describe('setPushPreferences', () => {
  test('turning a notice on asks permission, fetches the token for the EAS project and upserts it with both choices', async () => {
    const { client, upserts, tables } = fakeClient();

    expect(await setPushPreferences(USER_ID, { reviewReady: true, weekly: false }, 'en', client)).toBe('saved');

    expect(mocked.getPermissionsAsync).toHaveBeenCalled();
    expect(mocked.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'project-1' });
    expect(tables).toEqual(['push_tokens']);
    expect(upserts).toEqual([
      { row: { token: TOKEN, platform: 'ios', review_ready: true, weekly: false }, options: { onConflict: 'user_id,token' } },
    ]);
    expect(readPush(USER_ID)).toEqual({ token: TOKEN, reviewReady: true, weekly: false });
  });

  test('a denied permission stores nothing', async () => {
    mocked.getPermissionsAsync.mockResolvedValueOnce(deniedStatus());
    const { client, upserts } = fakeClient();

    expect(await setPushPreferences(USER_ID, { reviewReady: false, weekly: true }, 'en', client)).toBe('denied');

    expect(mocked.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(upserts).toEqual([]);
    expect(readPush(USER_ID)).toEqual({ token: null, reviewReady: false, weekly: false });
  });

  test('a token fetch that fails (no FCM or APNs set up yet) is "unavailable" and stores nothing', async () => {
    mocked.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('Default FirebaseApp is not initialized'));
    const { client, upserts } = fakeClient();

    expect(await setPushPreferences(USER_ID, { reviewReady: true, weekly: false }, 'en', client)).toBe('unavailable');

    expect(upserts).toEqual([]);
    expect(readPush(USER_ID).reviewReady).toBe(false);
  });

  test('without an EAS project id the token is never asked for', async () => {
    mockConstants.expoConfig = { extra: {} };
    const { client, upserts } = fakeClient();

    expect(await setPushPreferences(USER_ID, { reviewReady: true, weekly: false }, 'en', client)).toBe('unavailable');

    expect(mocked.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(upserts).toEqual([]);
  });

  test('a failed upsert keeps the previous choices', async () => {
    writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: false });
    const { client } = fakeClient({ upsert: { error: { message: 'offline' } } });

    expect(await setPushPreferences(USER_ID, { reviewReady: true, weekly: true }, 'en', client)).toBe('failed');

    expect(readPush(USER_ID)).toEqual({ token: TOKEN, reviewReady: true, weekly: false });
  });

  test('turning both off deletes the row and forgets the token', async () => {
    writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: false });
    const { client, deletes, upserts } = fakeClient();

    expect(await setPushPreferences(USER_ID, { reviewReady: false, weekly: false }, 'en', client)).toBe('saved');

    expect(deletes).toEqual([{ column: 'token', value: TOKEN }]);
    expect(upserts).toEqual([]);
    expect(mocked.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(readPush(USER_ID)).toEqual({ token: null, reviewReady: false, weekly: false });
  });

  test('a failed delete keeps both on the device as they were', async () => {
    writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: false });
    const { client } = fakeClient({ remove: { error: { message: 'offline' } } });

    expect(await setPushPreferences(USER_ID, { reviewReady: false, weekly: false }, 'en', client)).toBe('failed');

    expect(readPush(USER_ID)).toEqual({ token: TOKEN, reviewReady: true, weekly: false });
  });

  test('a phone whose token changed drops the old row after saving the new one', async () => {
    writePush(USER_ID, { token: 'ExponentPushToken[old]', reviewReady: true, weekly: false });
    const { client, deletes } = fakeClient();

    expect(await setPushPreferences(USER_ID, { reviewReady: true, weekly: true }, 'en', client)).toBe('saved');

    expect(deletes).toEqual([{ column: 'token', value: 'ExponentPushToken[old]' }]);
    expect(readPush(USER_ID)).toEqual({ token: TOKEN, reviewReady: true, weekly: true });
  });
});

describe('forgetPushToken', () => {
  test('unregisters this phone’s token on the server, then turns both off on the device', async () => {
    writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: true });
    const { client, unregistered } = fakeClient();

    await forgetPushToken(USER_ID, client);

    expect(unregistered).toEqual([TOKEN]);
    expect(readPush(USER_ID)).toEqual({ token: null, reviewReady: false, weekly: false });
    expect(readPendingUnregister()).toEqual([]);
  });

  test('does nothing without a stored token', async () => {
    const { client, unregistered } = fakeClient();
    await forgetPushToken(USER_ID, client);
    expect(unregistered).toEqual([]);
  });

  test.each([
    ['an error answer', () => Promise.resolve({ data: null, error: new Error('FunctionsFetchError') })],
    ['a network failure', () => Promise.reject(new TypeError('Network request failed'))],
  ])('offline (%s), the token waits in the device’s pending list and sign-out still goes ahead', async (_label, unregister) => {
    writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: true });
    const { client } = fakeClient({ unregister });

    await expect(forgetPushToken(USER_ID, client)).resolves.toBeUndefined();

    expect(readPendingUnregister()).toEqual([TOKEN]);
    expect(readPush(USER_ID).token).toBeNull();
  });

  test('a stalled network gives up after the timeout and keeps the token pending', async () => {
    jest.useFakeTimers();
    try {
      writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: true });
      const { client } = fakeClient({ unregister: () => new Promise<never>(() => undefined) });

      const pending = forgetPushToken(USER_ID, client);
      await jest.advanceTimersByTimeAsync(5_000);
      await pending;

      expect(readPendingUnregister()).toEqual([TOKEN]);
    } finally {
      jest.useRealTimers();
    }
  });

  test('the pending list survives the account’s own kv being forgotten', async () => {
    writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: true });
    const { client } = fakeClient({ unregister: () => Promise.resolve({ data: null, error: new Error('offline') }) });
    await forgetPushToken(USER_ID, client);

    expect(kvKeys().filter((key) => key.split('.').includes(USER_ID))).toEqual(['push.user-1']);
    expect(kvKeys()).toContain('push.pendingUnregister');
  });
});

describe('flushPendingUnregister', () => {
  test('the next launch unregisters each pending token and drops it on success', async () => {
    writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: true });
    const offline = fakeClient({ unregister: () => Promise.resolve({ data: null, error: new Error('offline') }) });
    await forgetPushToken(USER_ID, offline.client);
    const online = fakeClient();

    await flushPendingUnregister(online.client);

    expect(online.unregistered).toEqual([TOKEN]);
    expect(readPendingUnregister()).toEqual([]);
  });

  test('a token that fails again stays for the next try; the others go', async () => {
    const { client: offlineClient } = fakeClient({ unregister: () => Promise.resolve({ data: null, error: new Error('offline') }) });
    writePush(USER_ID, { token: 'ExponentPushToken[one]', reviewReady: true, weekly: false });
    await forgetPushToken(USER_ID, offlineClient);
    writePush(USER_ID, { token: 'ExponentPushToken[two]', reviewReady: true, weekly: false });
    await forgetPushToken(USER_ID, offlineClient);
    const { client, unregistered } = fakeClient({
      unregister: (token) => Promise.resolve({ data: null, error: token === 'ExponentPushToken[one]' ? new Error('500') : null }),
    });

    await flushPendingUnregister(client);

    expect(unregistered).toEqual(['ExponentPushToken[one]', 'ExponentPushToken[two]']);
    expect(readPendingUnregister()).toEqual(['ExponentPushToken[one]']);
  });

  test('nothing pending: no call', async () => {
    const { client, unregistered } = fakeClient();
    await flushPendingUnregister(client);
    expect(unregistered).toEqual([]);
  });

  test('never throws', async () => {
    writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: true });
    await forgetPushToken(USER_ID, fakeClient({ unregister: () => Promise.reject(new TypeError('x')) }).client);
    await expect(flushPendingUnregister(fakeClient({ unregister: () => Promise.reject(new TypeError('x')) }).client)).resolves.toBeUndefined();
    expect(readPendingUnregister()).toEqual([TOKEN]);
  });
});
