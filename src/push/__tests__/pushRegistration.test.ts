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
import { forgetPushToken, setPushPreferences, type PushClient } from '../pushRegistration';
import { readPush, writePush } from '../pushStore';

const mocked = jest.mocked(Notifications);
const USER_ID = 'user-1';
const TOKEN = 'ExponentPushToken[device-1]';

type Answer = { error: { message: string } | null };

/** A supabase-js stand-in recording the push_tokens upserts and deletes. */
function fakeClient({ upsert = { error: null }, remove = { error: null } }: { upsert?: Answer; remove?: Answer | Promise<never> } = {}) {
  const upserts: { row: unknown; options: unknown }[] = [];
  const deletes: { column: string; value: string }[] = [];
  const tables: string[] = [];
  const client = {
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
  return { client, upserts, deletes, tables };
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
  test('deletes this phone’s row and turns both off on the device', async () => {
    writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: true });
    const { client, deletes } = fakeClient();

    await forgetPushToken(USER_ID, client);

    expect(deletes).toEqual([{ column: 'token', value: TOKEN }]);
    expect(readPush(USER_ID)).toEqual({ token: null, reviewReady: false, weekly: false });
  });

  test('does nothing without a stored token', async () => {
    const { client, tables } = fakeClient();
    await forgetPushToken(USER_ID, client);
    expect(tables).toEqual([]);
  });

  test('never throws when the delete fails, so sign-out still goes ahead', async () => {
    writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: true });
    const { client } = fakeClient({ remove: Promise.reject(new TypeError('Network request failed')) });

    await expect(forgetPushToken(USER_ID, client)).resolves.toBeUndefined();
    expect(readPush(USER_ID).token).toBeNull();
  });
});
