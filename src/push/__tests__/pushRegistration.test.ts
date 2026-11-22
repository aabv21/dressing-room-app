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
jest.mock('expo-crypto', () => ({ getRandomBytes: jest.fn((size: number) => new Uint8Array(size).fill(0x1a)) }));

import { getRandomBytes } from 'expo-crypto';
import * as Notifications from 'expo-notifications';

import { allowUserKeys, kvKeys, kvRemove } from '../../lib/kv';
import {
  confirmPushClaim,
  flushPendingUnregister,
  forgetPushToken,
  forgetPushTokenLater,
  resumePushClaim,
  setPushPreferences,
  type PushClient,
} from '../pushRegistration';
import { deviceSecret, readPendingClaim, readPendingUnregister, readPush, writePendingClaim, writePendingUnregister, writePush } from '../pushStore';

const mocked = jest.mocked(Notifications);
const USER_ID = 'user-1';
const TOKEN = 'ExponentPushToken[device-1]';
const SECRET = '1a'.repeat(32);
// The mocked getRandomBytes fills every byte with 0x1a, so a 16-byte nonce reads like this.
const NONCE = '1a'.repeat(16);

type Answer = { error: { message: string; code?: string } | null };
type InvokeAnswer = { data: unknown; error: Error | null };
type Unregister = { token: string; device_secret: string };
type Claim = Record<string, unknown>;

/** A supabase-js stand-in recording register_push_token calls, own-row deletes and push-unregister calls. */
function fakeClient({
  register = { error: null },
  remove = { error: null },
  unregister = () => Promise.resolve({ data: null, error: null }),
  claim = () => Promise.resolve({ data: null, error: null }),
}: {
  register?: Answer;
  remove?: Answer | Promise<never>;
  unregister?: (body: Unregister) => Promise<InvokeAnswer>;
  claim?: (body: Claim) => Promise<InvokeAnswer>;
} = {}) {
  const registered: unknown[] = [];
  const deletes: { table: string; column: string; value: string }[] = [];
  const unregistered: Unregister[] = [];
  const claims: Claim[] = [];
  const client = {
    rpc: (name: string, args: unknown) => {
      if (name !== 'register_push_token') throw new Error(`unexpected rpc ${name}`);
      registered.push(args);
      return Promise.resolve(register);
    },
    functions: {
      invoke: (name: string, options: { body: Unregister & Claim }) => {
        if (name === 'push-claim') {
          claims.push(options.body);
          return claim(options.body);
        }
        if (name !== 'push-unregister') throw new Error(`unexpected function ${name}`);
        unregistered.push(options.body);
        return unregister(options.body);
      },
    },
    from: (table: string) => ({
      delete: () => ({
        eq: (column: string, value: string) => {
          deletes.push({ table, column, value });
          return remove instanceof Promise ? remove : Promise.resolve(remove);
        },
      }),
    }),
  } as unknown as PushClient;
  return { client, registered, deletes, unregistered, claims };
}

const offlineDelete = (): Promise<never> => Promise.reject(new TypeError('Network request failed'));

function deniedStatus(): Notifications.NotificationPermissionsStatus {
  return { granted: false, canAskAgain: false, status: 'denied', expires: 'never' } as unknown as Notifications.NotificationPermissionsStatus;
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of kvKeys()) kvRemove(key);
  allowUserKeys(USER_ID);
  mockConstants.expoConfig = { extra: { eas: { projectId: 'project-1' } } };
});

describe('deviceSecret', () => {
  test('is 256 random bits as hex, made once and kept device-wide (outside any account’s keys)', () => {
    expect(deviceSecret()).toBe(SECRET);
    expect(deviceSecret()).toBe(SECRET);
    expect(getRandomBytes).toHaveBeenCalledTimes(1);
    expect(getRandomBytes).toHaveBeenCalledWith(32);
    expect(kvKeys()).toEqual(['push.deviceSecret']);
  });
});

describe('setPushPreferences', () => {
  test('turning a notice on asks permission, fetches the token for the EAS project and registers it with the device secret', async () => {
    const { client, registered } = fakeClient();

    expect(await setPushPreferences(USER_ID, { reviewReady: true, weekly: false }, 'en', client)).toBe('saved');

    expect(mocked.getPermissionsAsync).toHaveBeenCalled();
    expect(mocked.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'project-1' });
    expect(registered).toEqual([
      { p_token: TOKEN, p_platform: 'ios', p_review_ready: true, p_weekly: false, p_device_secret: SECRET },
    ]);
    expect(readPush(USER_ID)).toEqual({ token: TOKEN, reviewReady: true, weekly: false });
  });

  test('registering a token that was waiting to be unregistered takes it off the pending list', async () => {
    writePendingUnregister([TOKEN, 'ExponentPushToken[other]']);
    const { client } = fakeClient();

    expect(await setPushPreferences(USER_ID, { reviewReady: false, weekly: true }, 'en', client)).toBe('saved');

    expect(readPendingUnregister()).toEqual(['ExponentPushToken[other]']);
  });

  test('a denied permission stores nothing', async () => {
    mocked.getPermissionsAsync.mockResolvedValueOnce(deniedStatus());
    const { client, registered } = fakeClient();

    expect(await setPushPreferences(USER_ID, { reviewReady: false, weekly: true }, 'en', client)).toBe('denied');

    expect(mocked.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(registered).toEqual([]);
    expect(readPush(USER_ID)).toEqual({ token: null, reviewReady: false, weekly: false });
  });

  test('a token fetch that fails (no FCM or APNs set up yet) is "unavailable" and stores nothing', async () => {
    mocked.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('Default FirebaseApp is not initialized'));
    const { client, registered } = fakeClient();

    expect(await setPushPreferences(USER_ID, { reviewReady: true, weekly: false }, 'en', client)).toBe('unavailable');

    expect(registered).toEqual([]);
    expect(readPush(USER_ID).reviewReady).toBe(false);
  });

  test('without an EAS project id the token is never asked for', async () => {
    mockConstants.expoConfig = { extra: {} };
    const { client, registered } = fakeClient();

    expect(await setPushPreferences(USER_ID, { reviewReady: true, weekly: false }, 'en', client)).toBe('unavailable');

    expect(mocked.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(registered).toEqual([]);
  });

  test('a refused registration (another device holds the token, or offline) keeps the previous choices', async () => {
    writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: false });
    const { client } = fakeClient({ register: { error: { message: 'register_push_token: another device holds this token' } } });

    expect(await setPushPreferences(USER_ID, { reviewReady: true, weekly: true }, 'en', client)).toBe('failed');

    expect(readPush(USER_ID)).toEqual({ token: TOKEN, reviewReady: true, weekly: false });
  });

  test('turning both off deletes the own row and forgets the token', async () => {
    writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: false });
    const { client, deletes, registered } = fakeClient();

    expect(await setPushPreferences(USER_ID, { reviewReady: false, weekly: false }, 'en', client)).toBe('saved');

    expect(deletes).toEqual([{ table: 'push_tokens', column: 'token', value: TOKEN }]);
    expect(registered).toEqual([]);
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

    expect(deletes).toEqual([{ table: 'push_tokens', column: 'token', value: 'ExponentPushToken[old]' }]);
    expect(readPush(USER_ID)).toEqual({ token: TOKEN, reviewReady: true, weekly: true });
  });
});

describe('forgetPushToken', () => {
  test('deletes this phone’s own row with the session, then turns both off on the device', async () => {
    writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: true });
    const { client, deletes, unregistered } = fakeClient();

    await forgetPushToken(USER_ID, client);

    expect(deletes).toEqual([{ table: 'push_tokens', column: 'token', value: TOKEN }]);
    expect(unregistered).toEqual([]);
    expect(readPush(USER_ID)).toEqual({ token: null, reviewReady: false, weekly: false });
    expect(readPendingUnregister()).toEqual([]);
  });

  test('does nothing without a stored token', async () => {
    const { client, deletes } = fakeClient();
    await forgetPushToken(USER_ID, client);
    expect(deletes).toEqual([]);
  });

  test.each([
    ['an error answer', { error: { message: 'offline' } }],
    ['a network failure', offlineDelete()],
  ] as const)('offline (%s), the token waits in the device’s pending list and sign-out still goes ahead', async (_label, remove) => {
    if (remove instanceof Promise) remove.catch(() => undefined);
    writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: true });
    const { client } = fakeClient({ remove });

    await expect(forgetPushToken(USER_ID, client)).resolves.toBeUndefined();

    expect(readPendingUnregister()).toEqual([TOKEN]);
    expect(readPush(USER_ID).token).toBeNull();
  });

  test('a stalled network gives up after the timeout and keeps the token pending', async () => {
    jest.useFakeTimers();
    try {
      writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: true });
      const { client } = fakeClient({ remove: new Promise<never>(() => undefined) });

      const pending = forgetPushToken(USER_ID, client);
      await jest.advanceTimersByTimeAsync(5_000);
      await pending;

      expect(readPendingUnregister()).toEqual([TOKEN]);
    } finally {
      jest.useRealTimers();
    }
  });

  test('the pending list and the device secret survive the account’s own kv being forgotten', async () => {
    deviceSecret();
    writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: true });
    const { client } = fakeClient({ remove: { error: { message: 'offline' } } });
    await forgetPushToken(USER_ID, client);

    expect(kvKeys().filter((key) => key.split('.').includes(USER_ID))).toEqual(['push.user-1']);
    expect(kvKeys()).toEqual(expect.arrayContaining(['push.pendingUnregister', 'push.deviceSecret']));
  });
});

describe('flushPendingUnregister', () => {
  test('after an offline sign-out, the next launch unregisters the token with the device secret and drops it', async () => {
    writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: true });
    await forgetPushToken(USER_ID, fakeClient({ remove: { error: { message: 'offline' } } }).client);
    const online = fakeClient();

    await flushPendingUnregister(online.client);

    expect(online.unregistered).toEqual([{ token: TOKEN, device_secret: SECRET }]);
    expect(readPendingUnregister()).toEqual([]);
  });

  test('a token that fails again stays for the next try; the others go', async () => {
    writePendingUnregister(['ExponentPushToken[one]', 'ExponentPushToken[two]']);
    const { client, unregistered } = fakeClient({
      unregister: ({ token }) => Promise.resolve({ data: null, error: token === 'ExponentPushToken[one]' ? new Error('500') : null }),
    });

    await flushPendingUnregister(client);

    expect(unregistered.map(({ token }) => token)).toEqual(['ExponentPushToken[one]', 'ExponentPushToken[two]']);
    expect(readPendingUnregister()).toEqual(['ExponentPushToken[one]']);
  });

  test('nothing pending: no call', async () => {
    const { client, unregistered } = fakeClient();
    await flushPendingUnregister(client);
    expect(unregistered).toEqual([]);
  });

  test('never throws', async () => {
    writePendingUnregister([TOKEN]);
    await expect(flushPendingUnregister(fakeClient({ unregister: () => Promise.reject(new TypeError('x')) }).client)).resolves.toBeUndefined();
    expect(readPendingUnregister()).toEqual([TOKEN]);
  });
});

describe('reclaiming a token another device holds', () => {
  const CLAIMED = { userId: USER_ID, token: TOKEN, platform: 'ios' as const, reviewReady: true, weekly: false, nonce: NONCE };

  test('a 42501 refusal starts a claim with a fresh nonce and answers "verifying", not "failed"', async () => {
    const { client, claims } = fakeClient({ register: { error: { message: 'another device holds this token', code: '42501' } } });

    expect(await setPushPreferences(USER_ID, { reviewReady: true, weekly: false }, 'en', client)).toBe('verifying');

    expect(claims).toEqual([{ token: TOKEN, step: 'start', nonce: NONCE }]);
    expect(readPendingClaim()).toEqual(CLAIMED);
    expect(readPush(USER_ID).token).toBeNull();
  });

  test('any other failure starts no claim', async () => {
    const { client, claims } = fakeClient({ register: { error: { message: 'offline' } } });
    expect(await setPushPreferences(USER_ID, { reviewReady: true, weekly: false }, 'en', client)).toBe('failed');
    expect(claims).toEqual([]);
    expect(readPendingClaim()).toBeNull();
  });

  test('the code with this claim’s nonce confirms it with the device secret, and the choices are saved', async () => {
    writePendingClaim(CLAIMED);
    writePendingUnregister([TOKEN]);
    const { client, claims } = fakeClient();

    expect(await confirmPushClaim('K7M2P9QX', NONCE, USER_ID, client)).toBe(true);

    expect(claims).toEqual([
      { token: TOKEN, step: 'confirm', code: 'K7M2P9QX', nonce: NONCE, device_secret: SECRET, platform: 'ios', review_ready: true, weekly: false },
    ]);
    expect(readPendingClaim()).toBeNull();
    expect(readPush(USER_ID)).toEqual({ token: TOKEN, reviewReady: true, weekly: false });
    expect(readPendingUnregister()).toEqual([]);
  });

  test('a code carrying another claim’s nonce (an attacker’s) is ignored and spends no attempt', async () => {
    writePendingClaim(CLAIMED);
    const { client, claims } = fakeClient();

    expect(await confirmPushClaim('ATTACK23', 'ff'.repeat(16), USER_ID, client)).toBe(false);

    expect(claims).toEqual([]);
    expect(readPendingClaim()).toEqual(CLAIMED);
  });

  test('a successful reclaim deletes the phone’s previous token row, as a registration does', async () => {
    writePush(USER_ID, { token: 'ExponentPushToken[old]', reviewReady: true, weekly: false });
    writePendingClaim(CLAIMED);
    const { client, deletes } = fakeClient();

    expect(await confirmPushClaim('K7M2P9QX', NONCE, USER_ID, client)).toBe(true);

    expect(deletes).toEqual([{ table: 'push_tokens', column: 'token', value: 'ExponentPushToken[old]' }]);
  });

  test('without a pending claim, or with another account’s, a code confirms nothing', async () => {
    const none = fakeClient();
    expect(await confirmPushClaim('K7M2P9QX', NONCE, USER_ID, none.client)).toBe(false);
    expect(none.claims).toEqual([]);

    writePendingClaim({ ...CLAIMED, userId: 'user-2' });
    const other = fakeClient();
    expect(await confirmPushClaim('K7M2P9QX', NONCE, USER_ID, other.client)).toBe(false);
    expect(other.claims).toEqual([]);
  });

  test('a refused code keeps the claim for a retry at the next launch', async () => {
    writePendingClaim(CLAIMED);
    const { client } = fakeClient({ claim: () => Promise.resolve({ data: null, error: new Error('403') }) });

    expect(await confirmPushClaim('WRNGXY23', NONCE, USER_ID, client)).toBe(false);

    expect(readPendingClaim()).toEqual(CLAIMED);
    expect(readPush(USER_ID).token).toBeNull();
  });

  test('the next launch asks for a new code for this account’s claim, and drops another account’s', async () => {
    writePendingClaim(CLAIMED);
    const mine = fakeClient();
    await resumePushClaim(USER_ID, mine.client);
    expect(mine.claims).toEqual([{ token: TOKEN, step: 'start', nonce: NONCE }]);
    expect(readPendingClaim()).toEqual(CLAIMED);

    const theirs = fakeClient();
    await resumePushClaim('user-2', theirs.client);
    expect(theirs.claims).toEqual([]);
    expect(readPendingClaim()).toBeNull();
  });

  test('turning both off drops a claim in flight, so it can’t turn the notices back on later', async () => {
    writePendingClaim(CLAIMED);
    const { client } = fakeClient();

    expect(await setPushPreferences(USER_ID, { reviewReady: false, weekly: false }, 'en', client)).toBe('saved');

    expect(readPendingClaim()).toBeNull();
  });

  test('signing out drops a claim in flight too, even with no token stored yet', async () => {
    writePendingClaim(CLAIMED);
    const { client } = fakeClient();

    await forgetPushToken(USER_ID, client);

    expect(readPendingClaim()).toBeNull();
  });
});

describe('forgetPushTokenLater', () => {
  test('a session that ended without Sign out queues the token for push-unregister and turns everything off', () => {
    writePush(USER_ID, { token: TOKEN, reviewReady: true, weekly: true });
    writePendingClaim({ userId: USER_ID, token: TOKEN, platform: 'ios', reviewReady: true, weekly: true, nonce: NONCE });

    forgetPushTokenLater(USER_ID);

    expect(readPendingUnregister()).toEqual([TOKEN]);
    expect(readPush(USER_ID)).toEqual({ token: null, reviewReady: false, weekly: false });
    expect(readPendingClaim()).toBeNull();
  });

  test('nothing stored: nothing queued', () => {
    forgetPushTokenLater(USER_ID);
    expect(readPendingUnregister()).toEqual([]);
  });
});
