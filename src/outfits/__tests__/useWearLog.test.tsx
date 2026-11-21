import { act, renderHook } from '@testing-library/react-native';
import { randomUUID } from 'expo-crypto';
import { AccessibilityInfo } from 'react-native';

import { kvRemove } from '../../lib/kv';
import type { RequestResult } from '../../lib/requestResult';
import { logWear } from '../outfitRepository';
import { queuedWears, wearQueueKey } from '../wearQueue';
import { isWornToday, wornTodayKey } from '../wornToday';
import { useWearLog } from '../useWearLog';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('../outfitRepository', () => ({ logWear: jest.fn() }));
jest.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ userId: 'user-1' }) }));
const mockRefresh = jest.fn(() => Promise.resolve());
jest.mock('../../closet/ClosetProvider', () => ({ useCloset: () => ({ refresh: mockRefresh }) }));

const USER = 'user-1';
const DAY = '2026-11-08';
const OUTFIT = ['g1', 'g2'];
const send = jest.mocked(logWear);
const uuid = jest.mocked(randomUUID);

let announce: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  let n = 0;
  uuid.mockImplementation(() => `wear-${String(++n)}`);
  kvRemove(wearQueueKey(USER));
  kvRemove(wornTodayKey(USER));
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});

async function setup() {
  return renderHook(() => useWearLog(DAY));
}

test('logs the wear once, marks the outfit logged and refreshes the closet', async () => {
  send.mockResolvedValue({ ok: true });
  const { result } = await setup();

  let status: string | undefined;
  await act(async () => {
    status = await result.current.log(OUTFIT, 'office', 82);
  });

  expect(status).toBe('logged');
  expect(send).toHaveBeenCalledWith({ wearId: 'wear-1', garmentIds: OUTFIT, wornOn: DAY, occasion: 'office', score: 82 });
  expect(result.current.isLogged(OUTFIT)).toBe(true);
  expect(result.current.busy).toBe(false);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

test('a second tap while one wear is sending is ignored', async () => {
  let answer: (result: RequestResult) => void = () => undefined;
  send.mockReturnValue(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  const { result } = await setup();

  let second: string | undefined;
  await act(async () => {
    void result.current.log(OUTFIT, null);
    second = await result.current.log(OUTFIT, null);
  });
  expect(result.current.busy).toBe(true);
  await act(async () => {
    answer({ ok: true });
    await Promise.resolve();
  });

  expect(second).toBe('ignored');
  expect(send).toHaveBeenCalledTimes(1);
});

test('a failure is kept for that outfit and announced, and the retry reuses the wear id', async () => {
  send.mockResolvedValueOnce({ ok: false, error: 'unknown' }).mockResolvedValueOnce({ ok: true });
  const { result } = await setup();

  await act(async () => {
    expect(await result.current.log(OUTFIT, null)).toBe('failed');
  });
  expect(result.current.errorFor(OUTFIT)).toBe('unknown');
  expect(result.current.errorFor(['g3', 'g4'])).toBeNull();
  expect(announce).toHaveBeenCalledWith('Something went wrong. Try again.');

  await act(async () => {
    await result.current.log(['g3', 'g4'], null);
  });
  await act(async () => {
    await result.current.log(OUTFIT, null);
  });

  const ids = send.mock.calls.map(([input]) => input.wearId);
  expect(ids).toEqual(['wear-1', 'wear-2', 'wear-1']);
  expect(result.current.errorFor(OUTFIT)).toBeNull();
});

test('clearError hides the failure', async () => {
  send.mockResolvedValue({ ok: false, error: 'invalid' });
  const { result } = await setup();
  await act(async () => {
    await result.current.log(OUTFIT, null);
  });

  await act(async () => {
    result.current.clearError();
    await Promise.resolve();
  });

  expect(result.current.errorFor(OUTFIT)).toBeNull();
});

test('offline the wear is queued, shown logged with its note, announced, and the closet left alone', async () => {
  send.mockResolvedValue({ ok: false, error: 'network' });
  const { result } = await setup();

  await act(async () => {
    expect(await result.current.log(OUTFIT, null)).toBe('queued');
  });

  expect(queuedWears(USER).map((wear) => wear.wearId)).toEqual(['wear-1']);
  expect(result.current.isLogged(OUTFIT)).toBe(true);
  expect(result.current.isQueued(OUTFIT)).toBe(true);
  expect(result.current.isQueued(['g3'])).toBe(false);
  expect(announce).toHaveBeenCalledWith("Logged — it syncs when you're back online.");
  expect(mockRefresh).not.toHaveBeenCalled();
});

test('a wear that lands after unmount still marks the outfit logged, without setting state', async () => {
  const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  let answer: (result: RequestResult) => void = () => undefined;
  send.mockReturnValue(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  const { result, unmount } = await setup();
  await act(async () => {
    void result.current.log(OUTFIT, null);
    await Promise.resolve();
  });

  await unmount();
  await act(async () => {
    answer({ ok: true });
    await Promise.resolve();
  });

  expect(isWornToday(USER, DAY, OUTFIT)).toBe(true);
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});
