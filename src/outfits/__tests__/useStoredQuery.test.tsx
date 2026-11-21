import { act, renderHook } from '@testing-library/react-native';

import type { AiOutcome } from '../aiClient';
import { useStoredQuery, type StoredQueryOptions } from '../useStoredQuery';

type Deferred = { key: string; resolve: (outcome: AiOutcome<string>) => void };

/** A fetch whose calls stay pending until the test settles them, in order. */
function pendingFetches() {
  const calls: Deferred[] = [];
  const fetchFor = (key: string) => () =>
    new Promise<AiOutcome<string>>((resolve) => {
      calls.push({ key, resolve });
    });
  return { calls, fetchFor };
}

// Not `key`: React keeps that prop to itself.
type Props = { query: string; enabled: boolean; stored?: string | null };

async function setup(initial: Props) {
  const { calls, fetchFor } = pendingFetches();
  const store = jest.fn<undefined, [string, string]>();
  const hook = await renderHook(
    ({ query: key, enabled, stored = null }: Props) => {
      const options: StoredQueryOptions<string> = {
        key,
        enabled,
        fetch: fetchFor(key),
        readStored: () => stored,
        store: (result) => {
          store(key, result);
        },
      };
      return useStoredQuery(options);
    },
    { initialProps: initial },
  );
  const settle = async (index: number, outcome: AiOutcome<string>) => {
    await act(async () => {
      calls.at(index)?.resolve(outcome);
      await Promise.resolve();
    });
  };
  return { ...hook, calls, store, settle };
}

test('is loading with nothing stored, then ready with the answer, which it stores', async () => {
  const { result, calls, store, settle } = await setup({ query: 'a', enabled: true });

  expect(result.current.status).toBe('loading');
  expect(result.current.data).toBeNull();
  expect(calls).toHaveLength(1);

  await settle(0, { ok: true, result: 'answer' });

  expect(result.current).toMatchObject({ status: 'ready', data: 'answer', error: null });
  expect(store).toHaveBeenCalledWith('a', 'answer');
});

test('fetches nothing while disabled, and once enabled', async () => {
  const { calls, rerender } = await setup({ query: 'a', enabled: false });
  expect(calls).toHaveLength(0);

  await rerender({ query: 'a', enabled: true });
  expect(calls).toHaveLength(1);
});

test('keeps one request in flight: triggers during it run once after it, with the latest inputs', async () => {
  const { result, calls, rerender, settle } = await setup({ query: 'a', enabled: true });

  await rerender({ query: 'b', enabled: true });
  await rerender({ query: 'c', enabled: true });
  await act(async () => {
    result.current.refetch();
    await Promise.resolve();
  });
  expect(calls).toHaveLength(1);

  await settle(0, { ok: true, result: 'for a' });
  expect(calls.map((call) => call.key)).toEqual(['a', 'c']);

  await settle(1, { ok: true, result: 'for c' });
  expect(calls).toHaveLength(2);
  expect(result.current.data).toBe('for c');
});

test('drops a queued trigger when the query was disabled meanwhile', async () => {
  const { calls, rerender, settle } = await setup({ query: 'a', enabled: true });

  await rerender({ query: 'b', enabled: true });
  await rerender({ query: 'b', enabled: false });
  await settle(0, { ok: true, result: 'for a' });

  expect(calls).toHaveLength(1);
});

test('shows the stored answer while the first fetch runs, and offline when it cannot connect', async () => {
  const { result, settle } = await setup({ query: 'a', enabled: true, stored: 'stored' });

  expect(result.current).toMatchObject({ status: 'ready', data: 'stored', error: null });

  await settle(0, { ok: false, error: 'network' });

  expect(result.current).toMatchObject({ status: 'offline', data: 'stored', error: 'network' });
});

test('a failed refetch keeps this session’s answer on screen, with its error', async () => {
  const { result, settle } = await setup({ query: 'a', enabled: true, stored: 'stored' });
  await settle(0, { ok: true, result: 'fresh' });

  await act(async () => {
    result.current.refetch();
    await Promise.resolve();
  });
  await settle(1, { ok: false, error: 'over_quota' });

  expect(result.current).toMatchObject({ status: 'ready', data: 'fresh', error: 'over_quota' });
});

test('an error with nothing to show is the error status', async () => {
  const { result, settle } = await setup({ query: 'a', enabled: true });

  await settle(0, { ok: false, error: 'unavailable' });

  expect(result.current).toMatchObject({ status: 'error', data: null, error: 'unavailable' });
});

test('reload drops the answer and fetches again', async () => {
  const { result, calls, settle } = await setup({ query: 'a', enabled: true });
  await settle(0, { ok: false, error: 'unknown' });

  await act(async () => {
    result.current.reload();
    await Promise.resolve();
  });

  expect(result.current.status).toBe('loading');
  expect(calls).toHaveLength(2);
});

test('another query’s answer is not shown, but stays as the last good answer', async () => {
  const { result, rerender, settle } = await setup({ query: 'a', enabled: true });
  await settle(0, { ok: true, result: 'for a' });

  await rerender({ query: 'b', enabled: true });

  expect(result.current).toMatchObject({ status: 'loading', data: null, lastData: 'for a' });
});

test('an answer that lands after unmount sets no state and stores nothing', async () => {
  const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const { calls, store, unmount } = await setup({ query: 'a', enabled: true });

  await unmount();
  await act(async () => {
    calls[0]?.resolve({ ok: true, result: 'late' });
    await Promise.resolve();
  });

  expect(store).not.toHaveBeenCalled();
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});
