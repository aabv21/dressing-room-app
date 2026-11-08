jest.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'signedIn', userId: 'user-1' }),
}));
jest.mock('../garmentRepository', () => ({
  garmentPhotoPath: (userId: string, garmentId: string, variant: string) => `${userId}/${garmentId}/${variant}.webp`,
  listGarments: jest.fn(),
  signedPhotoUrls: jest.fn(),
}));

import { act, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';

import { kvGet, kvRemove, kvSet } from '../../lib/kv';
import { garment } from '../../test/garmentFixture';
import { ClosetProvider, useCloset, usePendingPolling } from '../ClosetProvider';
import { listGarments, signedPhotoUrls } from '../garmentRepository';

const mockedList = jest.mocked(listGarments);
const mockedSign = jest.mocked(signedPhotoUrls);

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

beforeEach(() => {
  jest.clearAllMocks();
  kvRemove(CACHE_KEY);
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
