const mockAuth = { current: { status: 'signedIn', userId: 'user-1' as string | null } };
jest.mock('../../auth/AuthProvider', () => ({
  useAuth: () => mockAuth.current,
}));
jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));
// The real kv store (jest.setup.ts's in-memory fake), with `kvSet` wrapped so a test can count writes.
jest.mock('../../lib/kv', () => {
  const actual = jest.requireActual<typeof import('../../lib/kv')>('../../lib/kv');
  return { ...actual, kvSet: jest.fn(actual.kvSet) };
});
jest.mock('../../account/accountClient', () => ({ deleteAccount: jest.fn(), verifyAccount: jest.fn() }));
jest.mock('../../account/deviceFiles', () => ({ forgetDeviceFiles: jest.fn(() => Promise.resolve()) }));
jest.mock('../../auth/authService', () => ({
  signOutLocally: jest.fn(() => Promise.resolve()),
  storedSessionUserId: jest.fn(() => null),
}));
jest.mock('../garmentRepository', () => ({
  garmentPhotoPath: (userId: string, garmentId: string, variant: string) => `${userId}/${garmentId}/${variant}.webp`,
  listGarments: jest.fn(),
  signedPhotoUrls: jest.fn(),
}));

import { act, render, screen, waitFor } from '@testing-library/react-native';
import * as Network from 'expo-network';
import { useEffect } from 'react';
import { AppState, Text, type AppStateStatus } from 'react-native';

import { deleteAccount } from '../../account/accountClient';
import { runDeletion } from '../../account/deletionFlow';
import { kvGet, kvRemove, kvSet } from '../../lib/kv';
import { garment } from '../../test/garmentFixture';
import { ClosetProvider, useCloset, usePendingPolling } from '../ClosetProvider';
import { listGarments, signedPhotoUrls, type Garment } from '../garmentRepository';

const mockedList = jest.mocked(listGarments);
const mockedSign = jest.mocked(signedPhotoUrls);
const mockedKvSet = jest.mocked(kvSet);

const CACHE_KEY = 'closet.v1.user-1';

function Probe({ poll = false }: { poll?: boolean }): React.JSX.Element {
  const closet = useCloset();
  usePendingPolling(poll);
  return (
    <>
      <Text testID="status">{closet.status}</Text>
      <Text testID="ids">{closet.garments.map((g) => g.id).join(',')}</Text>
      <Text testID="thumbs">{[...closet.thumbUrls.entries()].map(([id, url]) => `${id}=${url}`).join(',')}</Text>
    </>
  );
}

async function renderProvider(poll = false): Promise<void> {
  await render(
    <ClosetProvider>
      <Probe poll={poll} />
    </ClosetProvider>,
  );
}

let appStateHandler: ((state: AppStateStatus) => void) | undefined;
let networkHandler: ((event: Network.NetworkStateEvent) => void) | undefined;
const appStateRemove = jest.fn();
const networkRemove = jest.fn();

/** A promise the test settles by hand, to hold a refresh in flight. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.current = { status: 'signedIn', userId: 'user-1' };
  appStateHandler = undefined;
  networkHandler = undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, handler) => {
    if (type === 'change') {
      appStateHandler = handler;
    }
    return { remove: appStateRemove };
  });
  jest.mocked(Network.addNetworkStateListener).mockImplementation((handler) => {
    networkHandler = handler;
    return { remove: networkRemove };
  });
  kvRemove(CACHE_KEY);
  kvRemove('closet.v1.user-2');
  mockedSign.mockImplementation((paths) => Promise.resolve(new Map(paths.map((path) => [path, `https://signed/${path}`]))));
});

afterEach(() => {
  jest.useRealTimers();
});

test('a successful refresh shows the garments with signed thumbnails and caches them in kv', async () => {
  mockedList.mockResolvedValue([garment({ id: 'a', extraction_status: 'done' }), garment({ id: 'b', extraction_status: 'done' })]);

  await renderProvider();

  expect(await screen.findByText('ready')).toBeOnTheScreen();
  expect(screen.getByTestId('ids')).toHaveTextContent('a,b');
  expect(screen.getByTestId('thumbs')).toHaveTextContent(
    'a=https://signed/user-1/a/thumb.webp,b=https://signed/user-1/b/thumb.webp',
  );
  expect(mockedSign).toHaveBeenCalledWith(['user-1/a/thumb.webp', 'user-1/b/thumb.webp']);

  const cached = kvGet(CACHE_KEY);
  expect(cached).not.toBeNull();
  const parsed = JSON.parse(cached ?? '{}') as { garments: { id: string }[] };
  expect(parsed.garments.map((g) => g.id)).toEqual(['a', 'b']);
});

test('a failed refresh with a cache keeps the cached garments and reports offline', async () => {
  kvSet(
    CACHE_KEY,
    JSON.stringify({
      garments: [garment({ id: 'cached', extraction_status: 'done' })],
      thumbs: { cached: { url: 'https://signed/old', signedAt: 0 } },
    }),
  );
  mockedList.mockRejectedValue(new TypeError('Network request failed'));

  await renderProvider();

  expect(await screen.findByText('offline')).toBeOnTheScreen();
  expect(screen.getByTestId('ids')).toHaveTextContent('cached');
  expect(screen.getByTestId('thumbs')).toHaveTextContent('cached=https://signed/old');
});

test('a failed refresh with no cache reports offline with no garments', async () => {
  mockedList.mockRejectedValue(new TypeError('Network request failed'));

  await renderProvider();

  expect(await screen.findByText('offline')).toBeOnTheScreen();
  expect(screen.getByTestId('ids')).toHaveTextContent('');
});

test('thumbnails signed less than 50 minutes ago are not signed again', async () => {
  mockedList.mockResolvedValue([garment({ id: 'a', extraction_status: 'done' })]);
  let refresh: (() => Promise<void>) | undefined;
  function Grab(): null {
    const value = useCloset().refresh;
    useEffect(() => {
      refresh = value;
    });
    return null;
  }
  await render(
    <ClosetProvider>
      <Grab />
    </ClosetProvider>,
  );
  await act(async () => {
    await refresh?.();
  });

  expect(mockedList).toHaveBeenCalledTimes(2);
  expect(mockedSign).toHaveBeenCalledTimes(1);
});

test('polling refreshes every 5 s while a garment is pending, and stops once none is', async () => {
  jest.useFakeTimers({ now: Date.parse('2026-11-08T12:00:30.000Z') });
  const pending = garment({ id: 'p', extraction_status: 'pending', created_at: '2026-11-08T12:00:00.000Z' });
  mockedList.mockResolvedValueOnce([pending]).mockResolvedValue([{ ...pending, extraction_status: 'done' }]);

  await renderProvider(true);
  expect(mockedList).toHaveBeenCalledTimes(1);

  await act(async () => {
    await jest.advanceTimersByTimeAsync(5_000);
  });
  expect(mockedList).toHaveBeenCalledTimes(2);

  await act(async () => {
    await jest.advanceTimersByTimeAsync(20_000);
  });
  expect(mockedList).toHaveBeenCalledTimes(2);
});

test('polling never starts when the only pending garment is stale', async () => {
  jest.useFakeTimers({ now: Date.parse('2026-11-08T12:30:00.000Z') });
  mockedList.mockResolvedValue([
    garment({ id: 'stale', extraction_status: 'pending', created_at: '2026-11-08T12:00:00.000Z' }),
  ]);

  await renderProvider(true);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(20_000);
  });

  expect(mockedList).toHaveBeenCalledTimes(1);
});

test('polling never starts while inactive', async () => {
  jest.useFakeTimers({ now: Date.parse('2026-11-08T12:00:30.000Z') });
  mockedList.mockResolvedValue([garment({ id: 'p', extraction_status: 'pending', created_at: '2026-11-08T12:00:00.000Z' })]);

  await renderProvider(false);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(20_000);
  });

  expect(mockedList).toHaveBeenCalledTimes(1);
});

test('replaceLocal and removeLocal update the list and the cache', async () => {
  mockedList.mockResolvedValue([garment({ id: 'a', extraction_status: 'done' }), garment({ id: 'b', extraction_status: 'done' })]);
  let closet: ReturnType<typeof useCloset> | undefined;
  function Grab(): React.JSX.Element {
    const value = useCloset();
    useEffect(() => {
      closet = value;
    });
    return <Text testID="ids">{value.garments.map((g) => `${g.id}:${g.status}`).join(',')}</Text>;
  }
  await render(
    <ClosetProvider>
      <Grab />
    </ClosetProvider>,
  );
  expect(await screen.findByText('a:available,b:available')).toBeOnTheScreen();

  await act(async () => {
    closet?.replaceLocal(garment({ id: 'a', extraction_status: 'done', status: 'laundry' }));
    await Promise.resolve();
  });
  expect(screen.getByTestId('ids')).toHaveTextContent('a:laundry,b:available');

  await act(async () => {
    closet?.removeLocal('b');
    await Promise.resolve();
  });
  expect(screen.getByTestId('ids')).toHaveTextContent('a:laundry');
  const parsed = JSON.parse(kvGet(CACHE_KEY) ?? '{}') as { garments: { id: string; status: string }[] };
  expect(parsed.garments).toEqual([expect.objectContaining({ id: 'a', status: 'laundry' })]);
});

/** Renders the provider and hands back its live context value, for calling `refresh` directly. */
async function renderWithHandle(): Promise<{ current: () => ReturnType<typeof useCloset> }> {
  let closet: ReturnType<typeof useCloset> | undefined;
  function Grab(): React.JSX.Element {
    const value = useCloset();
    useEffect(() => {
      closet = value;
    });
    return <Text testID="thumbs">{[...value.thumbUrls.entries()].map(([id, url]) => `${id}=${url}`).join(',')}</Text>;
  }
  await render(
    <ClosetProvider>
      <Grab />
    </ClosetProvider>,
  );
  return {
    current: () => {
      if (closet === undefined) throw new Error('the provider never rendered');
      return closet;
    },
  };
}

describe('a replaced photo (final review I3)', () => {
  test('a refresh that returns a bumped photo_version re-signs that thumbnail at once', async () => {
    let signing = 0;
    mockedSign.mockImplementation((paths) => {
      signing += 1;
      return Promise.resolve(new Map(paths.map((path) => [path, `https://signed/${path}?token=${String(signing)}`])));
    });
    mockedList.mockResolvedValue([
      garment({ id: 'a', extraction_status: 'done', photo_version: 1 }),
      garment({ id: 'b', extraction_status: 'done', photo_version: 1 }),
    ]);
    const closet = await renderWithHandle();
    await waitFor(() => {
      expect(screen.getByTestId('thumbs')).toHaveTextContent(
        'a=https://signed/user-1/a/thumb.webp?token=1,b=https://signed/user-1/b/thumb.webp?token=1',
      );
    });

    mockedList.mockResolvedValue([
      garment({ id: 'a', extraction_status: 'done', photo_version: 2, updated_at: '2026-11-08T12:05:00.000Z' }),
      garment({ id: 'b', extraction_status: 'done', photo_version: 1 }),
    ]);
    await act(async () => {
      await closet.current().refresh();
    });

    expect(mockedSign).toHaveBeenCalledTimes(2);
    expect(mockedSign).toHaveBeenLastCalledWith(['user-1/a/thumb.webp']);
    expect(closet.current().thumbUrls.get('a')).toBe('https://signed/user-1/a/thumb.webp?token=2');
    expect(closet.current().thumbUrls.get('b')).toBe('https://signed/user-1/b/thumb.webp?token=1');
  });

  test('until the new version is signed, the old URL is not offered under the new version', async () => {
    mockedList.mockResolvedValue([garment({ id: 'a', extraction_status: 'done', photo_version: 1 })]);
    const closet = await renderWithHandle();
    await waitFor(() => {
      expect(screen.getByTestId('thumbs')).toHaveTextContent('a=https://signed/user-1/a/thumb.webp');
    });

    const signing = deferred<Map<string, string>>();
    mockedSign.mockReturnValueOnce(signing.promise);
    mockedList.mockResolvedValue([garment({ id: 'a', extraction_status: 'done', photo_version: 2 })]);
    let refreshed: Promise<void> | undefined;
    await act(async () => {
      refreshed = closet.current().refresh();
      await Promise.resolve();
    });

    // The grid's cache key is already `a:thumb:2`: the old URL there would cache the old photo under it.
    expect(screen.getByTestId('thumbs')).toHaveTextContent('');

    await act(async () => {
      signing.resolve(new Map([['user-1/a/thumb.webp', 'https://signed/new']]));
      await refreshed;
    });
    expect(screen.getByTestId('thumbs')).toHaveTextContent('a=https://signed/new');
  });
});

describe('a poll that finds nothing new (final review T7 M1)', () => {
  test('writes no kv and keeps the same garments array and thumbnail map', async () => {
    const rows = (): Garment[] => [
      garment({ id: 'a', extraction_status: 'pending' }),
      garment({ id: 'b', extraction_status: 'done', colors: ['navy'], seasons: ['winter'] }),
    ];
    mockedList.mockImplementation(() => Promise.resolve(rows()));
    const closet = await renderWithHandle();
    await waitFor(() => {
      expect(closet.current().thumbUrls.size).toBe(2);
    });
    const before = closet.current();
    mockedKvSet.mockClear();

    await act(async () => {
      await closet.current().refresh();
    });

    expect(mockedList).toHaveBeenCalledTimes(2);
    expect(mockedKvSet).not.toHaveBeenCalled();
    expect(closet.current().garments).toBe(before.garments);
    expect(closet.current().thumbUrls).toBe(before.thumbUrls);
  });

  test('a changed row is committed while unchanged rows keep their identity', async () => {
    mockedList.mockResolvedValue([
      garment({ id: 'a', extraction_status: 'pending' }),
      garment({ id: 'b', extraction_status: 'done' }),
    ]);
    const closet = await renderWithHandle();
    await waitFor(() => {
      expect(closet.current().thumbUrls.size).toBe(2);
    });
    const [, unchangedBefore] = closet.current().garments;
    mockedKvSet.mockClear();

    mockedList.mockResolvedValue([
      garment({ id: 'a', extraction_status: 'done', category: 'jeans', updated_at: '2026-11-08T12:00:20.000Z' }),
      garment({ id: 'b', extraction_status: 'done' }),
    ]);
    await act(async () => {
      await closet.current().refresh();
    });

    expect(mockedKvSet).toHaveBeenCalledTimes(1);
    const [changed, unchanged] = closet.current().garments;
    expect(changed?.category).toBe('jeans');
    expect(unchanged).toBe(unchangedBefore);
  });
});

describe('work in flight for a user who is gone (I1)', () => {
  test('a refresh that resolves after unmount writes neither state nor kv', async () => {
    kvSet(CACHE_KEY, JSON.stringify({ garments: [garment({ id: 'cached', extraction_status: 'done' })], thumbs: {} }));
    const list = deferred<ReturnType<typeof garment>[]>();
    mockedList.mockReturnValueOnce(list.promise);
    const view = await render(
      <ClosetProvider>
        <Probe />
      </ClosetProvider>,
    );

    await view.unmount();
    await act(async () => {
      list.resolve([]);
      await Promise.resolve();
    });

    expect(JSON.parse(kvGet(CACHE_KEY) ?? '{}')).toEqual({
      garments: [expect.objectContaining({ id: 'cached' })],
      thumbs: {},
    });
    expect(mockedSign).not.toHaveBeenCalled();
  });

  test('a follow-up refresh queued behind one in flight never starts after unmount', async () => {
    const list = deferred<ReturnType<typeof garment>[]>();
    mockedList.mockReturnValueOnce(list.promise).mockResolvedValue([]);
    let refresh: (() => Promise<void>) | undefined;
    function Grab(): null {
      const value = useCloset().refresh;
      useEffect(() => {
        refresh = value;
      });
      return null;
    }
    const view = await render(
      <ClosetProvider>
        <Grab />
      </ClosetProvider>,
    );
    const followUp = refresh?.();

    await view.unmount();
    await act(async () => {
      list.resolve([]);
      await followUp;
    });

    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  test("a refresh that resolves after the session switched to another user doesn't touch the first user's closet", async () => {
    kvSet(CACHE_KEY, JSON.stringify({ garments: [garment({ id: 'mine', extraction_status: 'done' })], thumbs: {} }));
    const list = deferred<ReturnType<typeof garment>[]>();
    mockedList.mockReturnValueOnce(list.promise);
    const view = await render(
      <ClosetProvider>
        <Probe />
      </ClosetProvider>,
    );

    // AuthProvider already reports user-2 while the guard still shows user-1's tree (loading).
    mockAuth.current = { status: 'loading', userId: 'user-2' };
    await view.rerender(
      <ClosetProvider>
        <Probe />
      </ClosetProvider>,
    );
    await act(async () => {
      list.resolve([garment({ id: 'theirs', user_id: 'user-2', extraction_status: 'done' })]);
      await Promise.resolve();
    });

    expect(screen.getByTestId('ids')).toHaveTextContent('mine');
    expect(JSON.parse(kvGet(CACHE_KEY) ?? '{}')).toMatchObject({ garments: [expect.objectContaining({ id: 'mine' })] });
    expect(kvGet('closet.v1.user-2')).toBeNull();
  });
});

describe('refresh on foreground and reconnect (I2)', () => {
  test('returning to the foreground refreshes; going to the background does not', async () => {
    mockedList.mockResolvedValue([]);
    await renderProvider();
    expect(await screen.findByText('ready')).toBeOnTheScreen();
    mockedList.mockClear();

    await act(async () => {
      appStateHandler?.('background');
      await Promise.resolve();
    });
    expect(mockedList).not.toHaveBeenCalled();

    await act(async () => {
      appStateHandler?.('active');
      await Promise.resolve();
    });
    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  test('coming back online refreshes and clears the offline note', async () => {
    mockedList.mockRejectedValueOnce(new TypeError('Network request failed')).mockResolvedValue([]);
    await renderProvider();
    expect(await screen.findByText('offline')).toBeOnTheScreen();

    await act(async () => {
      networkHandler?.({ isConnected: false, isInternetReachable: false });
      await Promise.resolve();
    });
    expect(mockedList).toHaveBeenCalledTimes(1);

    await act(async () => {
      networkHandler?.({ isConnected: true, isInternetReachable: true });
      await Promise.resolve();
    });

    expect(await screen.findByText('ready')).toBeOnTheScreen();
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  test('both listeners are removed on unmount', async () => {
    mockedList.mockResolvedValue([]);
    const view = await render(
      <ClosetProvider>
        <Probe />
      </ClosetProvider>,
    );

    await view.unmount();

    expect(appStateRemove).toHaveBeenCalledTimes(1);
    expect(networkRemove).toHaveBeenCalledTimes(1);
  });
});

describe('an account deleted while its closet work is in flight', () => {
  test('a re-sign that resolves after the deletion finished leaves no closet copy behind', async () => {
    const GONE = 'user-gone';
    mockAuth.current = { status: 'signedIn', userId: GONE };
    mockedList.mockResolvedValueOnce([garment({ id: 'g1', user_id: GONE, extraction_status: 'done' })]);
    const signing = deferred<Map<string, string>>();
    mockedSign.mockReturnValueOnce(signing.promise);
    jest.mocked(deleteAccount).mockResolvedValue({ ok: true });
    await renderProvider();
    await waitFor(() => {
      expect(mockedSign).toHaveBeenCalledTimes(1);
    });

    // The deletion's device cleanup runs while the provider still believes its user is signed in.
    const queue = { pause: jest.fn(() => Promise.resolve()), clear: jest.fn(), resume: jest.fn() };
    await act(async () => {
      expect(await runDeletion(GONE, queue)).toBe('deleted');
    });
    expect(kvGet(`closet.v1.${GONE}`)).toBeNull();

    await act(async () => {
      signing.resolve(new Map([[`${GONE}/g1/thumb.webp`, 'https://signed/late']]));
      await Promise.resolve();
    });

    expect(mockedKvSet).toHaveBeenCalledWith(`closet.v1.${GONE}`, expect.any(String));
    expect(kvGet(`closet.v1.${GONE}`)).toBeNull();
  });
});
