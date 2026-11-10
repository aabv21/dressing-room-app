const mockAuth = { current: { status: 'signedIn', userId: 'user-1' as string | null } };
jest.mock('../../auth/AuthProvider', () => ({
  useAuth: () => mockAuth.current,
}));
const mockRefresh = jest.fn(() => Promise.resolve());
jest.mock('../ClosetProvider', () => ({
  useCloset: () => ({ refresh: mockRefresh }),
}));
jest.mock('../upload/queueStore', () => ({
  enqueuePhotos: jest.fn(() => []),
  enqueueReplacement: jest.fn(),
  listQueue: jest.fn(() => []),
  resetFailed: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('../upload/runQueue', () => ({
  runQueue: jest.fn(() => Promise.resolve({ committed: 0, failed: 0, waiting: 0 })),
}));
const mockSteps = { prepare: jest.fn(), upload: jest.fn(), commit: jest.fn() };
jest.mock('../upload/queueSteps', () => ({
  createQueueSteps: () => mockSteps,
}));
jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

import { act, render, screen } from '@testing-library/react-native';
import * as Network from 'expo-network';
import { useEffect } from 'react';
import { AppState, Text, type AppStateStatus } from 'react-native';

import { UploadQueueProvider, useUploadQueue } from '../UploadQueueProvider';
import { enqueuePhotos, enqueueReplacement, listQueue, removeItem, resetFailed, type QueueItem } from '../upload/queueStore';
import { runQueue } from '../upload/runQueue';

const mockedRunQueue = jest.mocked(runQueue);
const mockedListQueue = jest.mocked(listQueue);

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    garmentId: 'g-1',
    userId: 'user-1',
    replace: false,
    sourceUri: 'file:///uploads/g-1-source.jpg',
    stage: 'captured',
    fullUri: null,
    thumbUri: null,
    attempts: 0,
    nextAttemptAt: 0,
    failed: false,
    createdAt: 0,
    ...overrides,
  };
}

let queue: ReturnType<typeof useUploadQueue> | undefined;

function Probe(): React.JSX.Element {
  const value = useUploadQueue();
  useEffect(() => {
    queue = value;
  });
  return <Text testID="counts">{`pending ${String(value.pending)} failed ${String(value.failed)}`}</Text>;
}

let appStateHandler: ((state: AppStateStatus) => void) | undefined;
let networkHandler: ((event: Network.NetworkStateEvent) => void) | undefined;

async function renderProvider(): Promise<void> {
  await render(
    <UploadQueueProvider>
      <Probe />
    </UploadQueueProvider>,
  );
  // Let the mount pass settle.
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.current = { status: 'signedIn', userId: 'user-1' };
  queue = undefined;
  mockedListQueue.mockReturnValue([]);
  jest.mocked(removeItem).mockImplementation(() => undefined);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, handler) => {
    if (type === 'change') {
      appStateHandler = handler;
    }
    return { remove: jest.fn() };
  });
  jest.mocked(Network.addNetworkStateListener).mockImplementation((handler) => {
    networkHandler = handler;
    return { remove: jest.fn() };
  });
});

afterEach(() => {
  jest.useRealTimers();
});

test('runs the queue once on mount with the real steps', async () => {
  await renderProvider();

  expect(mockedRunQueue).toHaveBeenCalledTimes(1);
  expect(mockedRunQueue).toHaveBeenCalledWith('user-1', mockSteps);
});

test('reports pending and failed counts from the stored queue', async () => {
  mockedListQueue.mockReturnValue([item({ garmentId: 'a' }), item({ garmentId: 'b' }), item({ garmentId: 'c', failed: true })]);

  await renderProvider();

  expect(screen.getByTestId('counts')).toHaveTextContent('pending 2 failed 1');
});

test('enqueue stores the photos, then runs the queue', async () => {
  await renderProvider();
  mockedRunQueue.mockClear();

  await act(async () => {
    queue?.enqueue(['file:///a.jpg', 'file:///b.jpg']);
    await Promise.resolve();
  });

  expect(enqueuePhotos).toHaveBeenCalledWith('user-1', ['file:///a.jpg', 'file:///b.jpg']);
  expect(mockedRunQueue).toHaveBeenCalledTimes(1);
  expect(jest.mocked(enqueuePhotos).mock.invocationCallOrder[0]).toBeLessThan(
    mockedRunQueue.mock.invocationCallOrder[0] ?? 0,
  );
});

test('enqueueReplacement stores the replacement, then runs the queue', async () => {
  await renderProvider();
  mockedRunQueue.mockClear();

  await act(async () => {
    queue?.enqueueReplacement('g-9', 'file:///new.jpg');
    await Promise.resolve();
  });

  expect(enqueueReplacement).toHaveBeenCalledWith('user-1', 'g-9', 'file:///new.jpg');
  expect(mockedRunQueue).toHaveBeenCalledTimes(1);
});

test('an AppState "active" event runs the queue; "background" does not', async () => {
  await renderProvider();
  mockedRunQueue.mockClear();

  await act(async () => {
    appStateHandler?.('background');
    await Promise.resolve();
  });
  expect(mockedRunQueue).not.toHaveBeenCalled();

  await act(async () => {
    appStateHandler?.('active');
    await Promise.resolve();
  });
  expect(mockedRunQueue).toHaveBeenCalledTimes(1);
});

test('reconnecting runs the queue', async () => {
  await renderProvider();
  mockedRunQueue.mockClear();

  await act(async () => {
    networkHandler?.({ isConnected: false, isInternetReachable: false });
    await Promise.resolve();
  });
  expect(mockedRunQueue).not.toHaveBeenCalled();

  await act(async () => {
    networkHandler?.({ isConnected: true, isInternetReachable: true });
    await Promise.resolve();
  });
  expect(mockedRunQueue).toHaveBeenCalledTimes(1);
});

test('a pass that committed something refreshes the closet; one that did not, does not', async () => {
  mockedRunQueue.mockResolvedValueOnce({ committed: 0, failed: 0, waiting: 0 });
  await renderProvider();
  expect(mockRefresh).not.toHaveBeenCalled();

  mockedRunQueue.mockResolvedValueOnce({ committed: 2, failed: 0, waiting: 0 });
  await act(async () => {
    appStateHandler?.('active');
    await Promise.resolve();
  });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

test('schedules one run at the earliest future retry of a non-failed item (P3-R9)', async () => {
  jest.useFakeTimers({ now: 1_000_000 });
  mockedListQueue.mockReturnValue([
    item({ garmentId: 'later', nextAttemptAt: 1_000_000 + 20_000 }),
    item({ garmentId: 'soon', nextAttemptAt: 1_000_000 + 5_000 }),
    item({ garmentId: 'gave-up', nextAttemptAt: 1_000_000 + 1_000, failed: true }),
  ]);

  await renderProvider();
  expect(mockedRunQueue).toHaveBeenCalledTimes(1);

  await act(async () => {
    await jest.advanceTimersByTimeAsync(4_999);
  });
  expect(mockedRunQueue).toHaveBeenCalledTimes(1);

  mockedListQueue.mockReturnValue([]);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1);
  });
  expect(mockedRunQueue).toHaveBeenCalledTimes(2);

  // Nothing left waiting: no further timer.
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60_000);
  });
  expect(mockedRunQueue).toHaveBeenCalledTimes(2);
});

test('retryFailed resets the failed items and runs the queue', async () => {
  await renderProvider();
  mockedRunQueue.mockClear();

  await act(async () => {
    queue?.retryFailed();
    await Promise.resolve();
  });

  expect(resetFailed).toHaveBeenCalledWith('user-1');
  expect(mockedRunQueue).toHaveBeenCalledTimes(1);
});

test('discardFailed removes only the failed items', async () => {
  const failedItem = item({ garmentId: 'f', failed: true });
  let stored = [item({ garmentId: 'ok' }), failedItem];
  mockedListQueue.mockImplementation(() => stored);
  jest.mocked(removeItem).mockImplementation((removed) => {
    stored = stored.filter((entry) => entry !== removed);
  });
  await renderProvider();
  expect(screen.getByTestId('counts')).toHaveTextContent('pending 1 failed 1');

  await act(async () => {
    queue?.discardFailed();
    await Promise.resolve();
  });

  expect(removeItem).toHaveBeenCalledTimes(1);
  expect(removeItem).toHaveBeenCalledWith(failedItem);
  expect(screen.getByTestId('counts')).toHaveTextContent('pending 1 failed 0');
});

test('a pass still in flight when the provider unmounts neither refreshes nor schedules a retry', async () => {
  jest.useFakeTimers({ now: 1_000_000 });
  let finish: ((result: { committed: number; failed: number; waiting: number }) => void) | undefined;
  mockedRunQueue.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  mockedListQueue.mockReturnValue([item({ garmentId: 'waiting', nextAttemptAt: 1_000_000 + 5_000 })]);
  const view = await render(
    <UploadQueueProvider>
      <Probe />
    </UploadQueueProvider>,
  );

  await view.unmount();
  await act(async () => {
    finish?.({ committed: 1, failed: 0, waiting: 1 });
    await jest.advanceTimersByTimeAsync(60_000);
  });

  expect(mockRefresh).not.toHaveBeenCalled();
  expect(mockedRunQueue).toHaveBeenCalledTimes(1);
});

test("once another account's session is active, triggers no longer start passes for this user", async () => {
  const view = await render(
    <UploadQueueProvider>
      <Probe />
    </UploadQueueProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  mockedRunQueue.mockClear();

  mockAuth.current = { status: 'loading', userId: 'user-2' };
  await view.rerender(
    <UploadQueueProvider>
      <Probe />
    </UploadQueueProvider>,
  );
  await act(async () => {
    appStateHandler?.('active');
    await Promise.resolve();
  });

  expect(mockedRunQueue).not.toHaveBeenCalled();
});
