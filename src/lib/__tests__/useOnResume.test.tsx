import { renderHook } from '@testing-library/react-native';
import * as Network from 'expo-network';
import { AppState, type AppStateStatus } from 'react-native';

import { useOnResume } from '../useOnResume';

jest.mock('expo-network', () => ({ addNetworkStateListener: jest.fn() }));

type NetworkEvent = { isConnected?: boolean; isInternetReachable?: boolean | null };

let appStateListener: (state: AppStateStatus) => void = () => undefined;
let networkListener: (event: NetworkEvent) => void = () => undefined;
const removeAppState = jest.fn();
const removeNetwork = jest.fn();

let addAppStateListener: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  addAppStateListener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener;
    return { remove: removeAppState };
  });
  jest.mocked(Network.addNetworkStateListener).mockImplementation((listener) => {
    networkListener = listener as (event: NetworkEvent) => void;
    return { remove: removeNetwork };
  });
});

test('runs on returning to the foreground, not on leaving it', async () => {
  const callback = jest.fn();
  await renderHook(() => {
    useOnResume(callback);
  });

  appStateListener('background');
  expect(callback).not.toHaveBeenCalled();
  appStateListener('active');
  expect(callback).toHaveBeenCalledTimes(1);
});

test('runs when the network comes back, not on the first report or while it stays up', async () => {
  const callback = jest.fn();
  await renderHook(() => {
    useOnResume(callback);
  });

  networkListener({ isConnected: true, isInternetReachable: true });
  networkListener({ isConnected: true, isInternetReachable: null });
  expect(callback).not.toHaveBeenCalled();

  networkListener({ isConnected: true, isInternetReachable: false });
  networkListener({ isConnected: true, isInternetReachable: true });
  expect(callback).toHaveBeenCalledTimes(1);
});

test('calls the latest callback without subscribing again', async () => {
  const first = jest.fn();
  const second = jest.fn();
  const { rerender } = await renderHook(
    ({ callback }: { callback: () => void }) => {
      useOnResume(callback);
    },
    { initialProps: { callback: first } },
  );

  await rerender({ callback: second });
  appStateListener('active');

  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
  expect(addAppStateListener).toHaveBeenCalledTimes(1);
});

test('unsubscribes on unmount', async () => {
  const { unmount } = await renderHook(() => {
    useOnResume(jest.fn());
  });

  await unmount();

  expect(removeAppState).toHaveBeenCalledTimes(1);
  expect(removeNetwork).toHaveBeenCalledTimes(1);
});
