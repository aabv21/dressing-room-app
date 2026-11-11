jest.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ userId: 'user-1' }) }));
jest.mock('../../auth/authService', () => ({ storedSessionUserId: jest.fn(() => 'user-1') }));
const mockRefresh = jest.fn(() => Promise.resolve());
jest.mock('../../closet/ClosetProvider', () => ({ useCloset: () => ({ refresh: mockRefresh }) }));
jest.mock('../wearQueue', () => ({ flushWearQueue: jest.fn() }));
jest.mock('../outfitRepository', () => ({ logWear: jest.fn() }));
jest.mock('expo-network', () => ({ addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })) }));

import { act, render } from '@testing-library/react-native';
import * as Network from 'expo-network';
import { AppState, type AppStateStatus } from 'react-native';

import { storedSessionUserId } from '../../auth/authService';
import { logWear } from '../outfitRepository';
import { flushWearQueue } from '../wearQueue';
import { WearQueueFlusher } from '../WearQueueFlusher';

const mockedFlush = jest.mocked(flushWearQueue);
let appStateHandler: ((state: AppStateStatus) => void) | undefined;
let networkHandler: ((event: { isConnected?: boolean; isInternetReachable?: boolean }) => void) | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  mockedFlush.mockResolvedValue({ sent: 0, dropped: 0, remaining: 0 });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateHandler = handler;
    return { remove: jest.fn() };
  });
  jest.mocked(Network.addNetworkStateListener).mockImplementation((handler) => {
    networkHandler = handler;
    return { remove: jest.fn() };
  });
});

test('flushes on mount with the stored session as the guard', async () => {
  await render(<WearQueueFlusher />);

  expect(mockedFlush).toHaveBeenCalledTimes(1);
  expect(mockedFlush).toHaveBeenCalledWith('user-1', { send: logWear, sessionUserId: storedSessionUserId });
  expect(mockRefresh).not.toHaveBeenCalled();
});

test('flushes on returning to the foreground and on reconnect, and refreshes the closet after a send', async () => {
  await render(<WearQueueFlusher />);
  mockedFlush.mockResolvedValue({ sent: 1, dropped: 0, remaining: 0 });

  await act(async () => {
    appStateHandler?.('active');
    await Promise.resolve();
  });
  expect(mockedFlush).toHaveBeenCalledTimes(2);
  expect(mockRefresh).toHaveBeenCalledTimes(1);

  await act(async () => {
    networkHandler?.({ isConnected: false });
    networkHandler?.({ isConnected: true, isInternetReachable: true });
    await Promise.resolve();
  });
  expect(mockedFlush).toHaveBeenCalledTimes(3);
});
