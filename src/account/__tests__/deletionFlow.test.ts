jest.mock('../accountClient', () => ({ deleteAccount: jest.fn(), verifyAccount: jest.fn() }));
jest.mock('../../auth/authService', () => ({ signOutLocally: jest.fn(() => Promise.resolve()) }));

import { signOutLocally } from '../../auth/authService';
import { kvGet, kvKeys, kvRemove, kvSet } from '../../lib/kv';
import { deleteAccount, verifyAccount } from '../accountClient';
import { confirmPendingDeletion, DELETION_SETTLE_MS, deletionMessage, runDeletion } from '../deletionFlow';
import { deletionState, markDeletion } from '../deletionMarker';

const mockedDeleteAccount = jest.mocked(deleteAccount);
const mockedSignOutLocally = jest.mocked(signOutLocally);
const mockedVerifyAccount = jest.mocked(verifyAccount);

const USER = '0b7f6d7e-1111-4c4c-9a9a-000000000001';
const MARKER = `account.deleting.${USER}`;

function fakeQueue() {
  return {
    pause: jest.fn(() => Promise.resolve()),
    clear: jest.fn(),
    resume: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of kvKeys()) kvRemove(key);
  kvSet(`closet.v1.${USER}`, 'x');
  kvSet(`outfit.worn.${USER}`, 'x');
});

test('a deletion marks it before pausing, then clears the queue, signs out and drops the data and the marker', async () => {
  const queue = fakeQueue();
  let markedAtPause: string | null = null;
  queue.pause.mockImplementation(() => {
    markedAtPause = kvGet(MARKER);
    return Promise.resolve();
  });
  mockedDeleteAccount.mockResolvedValue({ ok: true });

  expect(await runDeletion(USER, queue)).toBe('deleted');

  expect(markedAtPause).toMatch(/^deleting:\d+$/);
  expect(queue.clear).toHaveBeenCalledTimes(1);
  expect(mockedSignOutLocally).toHaveBeenCalledTimes(1);
  expect(kvKeys()).toEqual([]);
  expect(queue.resume).toHaveBeenCalledWith({ run: false });
});

test('a failing queue clear or kv cleanup still signs out (M2)', async () => {
  const queue = fakeQueue();
  queue.clear.mockImplementation(() => {
    throw new Error('sqlite');
  });
  mockedDeleteAccount.mockResolvedValue({ ok: true });
  const keysSpy = jest.spyOn(jest.requireActual<typeof import('../../lib/kv')>('../../lib/kv'), 'kvKeys');
  keysSpy.mockImplementationOnce(() => {
    throw new Error('kv');
  });

  expect(await runDeletion(USER, queue)).toBe('deleted');

  expect(mockedSignOutLocally).toHaveBeenCalledTimes(1);
  expect(queue.resume).toHaveBeenCalledWith({ run: false });
  keysSpy.mockRestore();
});

test('reauth keeps the queue and the data, marks the deletion for the next sign-in and signs out', async () => {
  const queue = fakeQueue();
  mockedDeleteAccount.mockResolvedValue({ ok: false, error: 'reauth' });

  expect(await runDeletion(USER, queue)).toBe('reauth');

  expect(deletionState(USER)).toBe('reauth');
  expect(queue.clear).not.toHaveBeenCalled();
  expect(kvGet(`closet.v1.${USER}`)).toBe('x');
  expect(mockedSignOutLocally).toHaveBeenCalledTimes(1);
  expect(queue.resume).toHaveBeenCalledWith({ run: false });
});

test('reauth after supabase-js already signed out and dropped the data leaves no marker behind', async () => {
  const queue = fakeQueue();
  mockedDeleteAccount.mockImplementation(() => {
    // AuthProvider's SIGNED_OUT handling ran during the call (a refused refresh).
    for (const key of kvKeys()) kvRemove(key);
    return Promise.resolve({ ok: false, error: 'reauth' });
  });

  expect(await runDeletion(USER, queue)).toBe('reauth');

  expect(deletionState(USER)).toBeNull();
});

test.each(['network', 'unknown'] as const)(
  'a %s failure keeps the marker (the server may have finished), so the queue stays blocked',
  async (error) => {
    const queue = fakeQueue();
    mockedDeleteAccount.mockResolvedValue({ ok: false, error });

    expect(await runDeletion(USER, queue)).toBe(error);

    expect(deletionState(USER)).toBe('deleting');
    expect(queue.clear).not.toHaveBeenCalled();
    expect(mockedSignOutLocally).not.toHaveBeenCalled();
    expect(queue.resume).toHaveBeenCalledWith({ run: false });
    expect(kvGet(`closet.v1.${USER}`)).toBe('x');
  },
);

test('a second call while one runs is busy and never calls the function twice', async () => {
  const queue = fakeQueue();
  let finish: (value: { ok: true }) => void = () => undefined;
  mockedDeleteAccount.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );

  const first = runDeletion(USER, queue);
  expect(await runDeletion(USER, queue)).toBe('busy');
  finish({ ok: true });

  expect(await first).toBe('deleted');
  expect(mockedDeleteAccount).toHaveBeenCalledTimes(1);
});

describe('confirmPendingDeletion (a launch, sign-in, foreground or reconnect with the marker present)', () => {
  const MARKED_AT = 1_700_000_000_000;
  const settled = (): number => MARKED_AT + DELETION_SETTLE_MS;

  beforeEach(() => {
    markDeletion(USER, 'deleting', MARKED_AT);
  });

  test('an account that is gone gets the local cleanup and sign-out of a confirmed deletion', async () => {
    const queue = fakeQueue();
    mockedVerifyAccount.mockResolvedValue('gone');

    // Gone counts at once, even right after the marker.
    expect(await confirmPendingDeletion(USER, queue, () => MARKED_AT + 1)).toBe('deleted');

    expect(mockedVerifyAccount).toHaveBeenCalledWith(USER);
    expect(queue.clear).toHaveBeenCalledTimes(1);
    expect(mockedSignOutLocally).toHaveBeenCalledTimes(1);
    expect(kvKeys()).toEqual([]);
    expect(queue.resume).toHaveBeenCalledWith({ run: false });
    expect(mockedDeleteAccount).not.toHaveBeenCalled();
  });

  test('an account that still exists 2 minutes after the marker drops it and runs the queue again, deleting nothing', async () => {
    const queue = fakeQueue();
    mockedVerifyAccount.mockResolvedValue('exists');

    expect(await confirmPendingDeletion(USER, queue, settled)).toBe('kept');

    expect(deletionState(USER)).toBeNull();
    expect(queue.resume).toHaveBeenCalledWith();
    expect(queue.clear).not.toHaveBeenCalled();
    expect(mockedSignOutLocally).not.toHaveBeenCalled();
    expect(kvGet(`closet.v1.${USER}`)).toBe('x');
    expect(mockedDeleteAccount).not.toHaveBeenCalled();
  });

  test('an account that still exists within 2 minutes of the marker stays pending (the server may still be deleting)', async () => {
    const queue = fakeQueue();
    mockedVerifyAccount.mockResolvedValue('exists');

    expect(await confirmPendingDeletion(USER, queue, () => settled() - 1)).toBe('pending');

    expect(deletionState(USER)).toBe('deleting');
    expect(queue.resume).not.toHaveBeenCalled();
    expect(mockedDeleteAccount).not.toHaveBeenCalled();
  });

  test('an old-format marker counts as long ago, so an existing account is kept at once', async () => {
    const queue = fakeQueue();
    kvSet(MARKER, 'reauth');
    mockedVerifyAccount.mockResolvedValue('exists');

    expect(await confirmPendingDeletion(USER, queue, () => MARKED_AT)).toBe('kept');
    expect(deletionState(USER)).toBeNull();
  });

  test('anything else keeps the marker and the blocked queue for the next session', async () => {
    const queue = fakeQueue();
    mockedVerifyAccount.mockResolvedValue('unknown');

    expect(await confirmPendingDeletion(USER, queue, settled)).toBe('pending');

    expect(deletionState(USER)).toBe('deleting');
    expect(queue.resume).not.toHaveBeenCalled();
    expect(queue.clear).not.toHaveBeenCalled();
    expect(mockedSignOutLocally).not.toHaveBeenCalled();
    expect(mockedDeleteAccount).not.toHaveBeenCalled();
  });
});

test('maps each result to its message', () => {
  expect(deletionMessage('reauth')).toBe('profile.privacy.deleteError.reauth');
  expect(deletionMessage('network')).toBe('profile.privacy.deleteError.network');
  expect(deletionMessage('unknown')).toBe('profile.privacy.deleteError.unknown');
  expect(deletionMessage('deleted')).toBeUndefined();
  expect(deletionMessage('busy')).toBeUndefined();
});
