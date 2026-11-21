import { act, renderHook } from '@testing-library/react-native';

import { WAIT_LONG_MS, WAIT_LONGER_MS, useWaitStage } from '../useWaitStage';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

test('a wait reads as starting, then long at about 6 s and longer at about 20 s', async () => {
  const { result } = await renderHook(() => useWaitStage(true));
  expect(result.current).toBe('start');
  await advance(WAIT_LONG_MS - 1);
  expect(result.current).toBe('start');
  await advance(1);
  expect(result.current).toBe('long');
  await advance(WAIT_LONGER_MS - WAIT_LONG_MS);
  expect(result.current).toBe('longer');
  expect([WAIT_LONG_MS, WAIT_LONGER_MS]).toEqual([6000, 20000]);
});

test('each new wait starts over', async () => {
  const { result, rerender } = await renderHook(({ waiting }: { waiting: boolean }) => useWaitStage(waiting), {
    initialProps: { waiting: true },
  });
  await advance(WAIT_LONGER_MS);
  expect(result.current).toBe('longer');

  await rerender({ waiting: false });
  expect(result.current).toBe('start');
  await rerender({ waiting: true });
  expect(result.current).toBe('start');
  await advance(WAIT_LONG_MS);
  expect(result.current).toBe('long');
});

test('its two timers are cleared once the screen is gone', async () => {
  const clear = jest.spyOn(globalThis, 'clearTimeout');
  const { unmount } = await renderHook(() => useWaitStage(true));
  clear.mockClear();
  await unmount();
  expect(clear).toHaveBeenCalledTimes(2);
  clear.mockRestore();
});
