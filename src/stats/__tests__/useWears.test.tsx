import { act, renderHook } from '@testing-library/react-native';

import { kvRemove } from '../../lib/kv';
import { enqueueWear, wearQueueKey } from '../../outfits/wearQueue';
import { readStoredWears, storedWearsKey, storeWears } from '../storedWears';
import { useWears, type WearsOptions } from '../useWears';
import { listWears, type WearWithItems } from '../wearsRepository';

jest.mock('../wearsRepository', () => ({ listWears: jest.fn() }));
jest.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ userId: 'user-1' }) }));
jest.mock('../../lib/localDate', () => ({ localDate: () => '2026-11-08' }));

const USER = 'user-1';
const list = jest.mocked(listWears);
const wear = (id: string, wornOn: string): WearWithItems => ({ id, wornOn, occasion: 'office', score: 80, garmentIds: ['g1'] });

type Props = { from: string; to: string } & WearsOptions;

async function setup(initial: Props) {
  return renderHook(({ from, to, ...options }: Props) => useWears(from, to, options), { initialProps: initial });
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

beforeEach(() => {
  list.mockReset();
  kvRemove(storedWearsKey(USER));
  kvRemove(wearQueueKey(USER));
});

test('fetches the range when enabled, with the queued wears in it, and replaces the stored record', async () => {
  list.mockResolvedValue([wear('w1', '2026-11-01')]);
  enqueueWear(USER, { wearId: 'q1', garmentIds: ['g2'], wornOn: '2026-11-07', occasion: null, score: null });
  enqueueWear(USER, { wearId: 'q0', garmentIds: ['g2'], wornOn: '2025-01-01', occasion: null, score: null });

  const { result } = await setup({ from: '2025-11-08', to: '2026-11-08', enabled: true, record: 'replace' });
  await flush();

  expect(list).toHaveBeenCalledWith('2025-11-08', '2026-11-08');
  expect(result.current.wears?.map((w) => w.id)).toEqual(['q1', 'w1']);
  expect(result.current).toMatchObject({ offlineSince: null, failed: false, today: '2026-11-08' });
  expect(readStoredWears(USER)).toEqual({ from: '2025-11-08', to: '2026-11-08', wears: [wear('w1', '2026-11-01')] });
});

test('fetches nothing while disabled', async () => {
  const { result } = await setup({ from: '2026-11-01', to: '2026-11-30', enabled: false, record: 'merge' });
  await flush();

  expect(list).not.toHaveBeenCalled();
  expect(result.current).toMatchObject({ wears: null, failed: false });
});

test('merge folds the range into the stored record, only up to today', async () => {
  storeWears(USER, '2025-11-08', '2026-10-31', [wear('old', '2026-10-30')]);
  list.mockResolvedValue([wear('w1', '2026-11-02')]);

  await setup({ from: '2026-11-01', to: '2026-11-30', enabled: true, record: 'merge' });
  await flush();

  expect(readStoredWears(USER)).toEqual({
    from: '2025-11-08',
    to: '2026-11-08',
    wears: [wear('w1', '2026-11-02'), wear('old', '2026-10-30')],
  });
});

test('merge: a failed fetch shows the stored days of the range, offline since the stored day', async () => {
  storeWears(USER, '2025-11-08', '2026-11-05', [wear('w2', '2026-11-02'), wear('w1', '2026-10-01')]);
  list.mockRejectedValue(new Error('offline'));

  const { result } = await setup({ from: '2026-11-01', to: '2026-11-30', enabled: true, record: 'merge' });
  await flush();

  expect(result.current.wears?.map((w) => w.id)).toEqual(['w2']);
  expect(result.current).toMatchObject({ offlineSince: '2026-11-05', failed: false });
});

test('merge: a range starting before the stored record fails', async () => {
  storeWears(USER, '2025-11-08', '2026-11-05', [wear('w1', '2026-10-01')]);
  list.mockRejectedValue(new Error('offline'));

  const { result } = await setup({ from: '2025-10-01', to: '2025-10-31', enabled: true, record: 'merge' });
  await flush();

  expect(result.current).toMatchObject({ wears: null, failed: true });
});

test('replace: a failed fetch shows the whole stored record', async () => {
  storeWears(USER, '2026-10-01', '2026-11-05', [wear('w1', '2026-10-01')]);
  list.mockRejectedValue(new Error('offline'));

  const { result } = await setup({ from: '2025-11-08', to: '2026-11-08', enabled: true, record: 'replace' });
  await flush();

  expect(result.current.wears?.map((w) => w.id)).toEqual(['w1']);
  expect(result.current.offlineSince).toBe('2026-11-05');
});

test('a failed fetch with nothing stored fails', async () => {
  list.mockRejectedValue(new Error('offline'));

  const { result } = await setup({ from: '2025-11-08', to: '2026-11-08', enabled: true, record: 'replace' });
  await flush();

  expect(result.current).toMatchObject({ wears: null, failed: true });
});

test('a new range never shows the previous range’s wears, and a late answer for it is dropped', async () => {
  let answerOctober: (wears: WearWithItems[]) => void = () => undefined;
  list.mockResolvedValueOnce([wear('nov', '2026-11-02')]);
  list.mockReturnValueOnce(
    new Promise((resolve) => {
      answerOctober = resolve;
    }),
  );
  list.mockResolvedValueOnce([wear('sep', '2026-09-02')]);

  const { result, rerender } = await setup({ from: '2026-11-01', to: '2026-11-30', enabled: true, record: 'merge' });
  await flush();
  expect(result.current.wears?.map((w) => w.id)).toEqual(['nov']);

  await rerender({ from: '2026-10-01', to: '2026-10-31', enabled: true, record: 'merge' });
  expect(result.current.wears).toBeNull();

  await rerender({ from: '2026-09-01', to: '2026-09-30', enabled: true, record: 'merge' });
  await flush();
  await act(async () => {
    answerOctober([wear('oct', '2026-10-02')]);
    await Promise.resolve();
  });

  expect(result.current.wears?.map((w) => w.id)).toEqual(['sep']);
});

test('reload fetches the range again', async () => {
  list.mockResolvedValueOnce([]).mockResolvedValueOnce([wear('w1', '2026-11-02')]);

  const { result } = await setup({ from: '2026-11-01', to: '2026-11-30', enabled: true, record: 'merge' });
  await flush();
  await act(async () => {
    result.current.reload();
    await Promise.resolve();
  });
  await flush();

  expect(list).toHaveBeenCalledTimes(2);
  expect(result.current.wears?.map((w) => w.id)).toEqual(['w1']);
});

test('removeLocal hides a wear at once, until the next answer', async () => {
  list.mockResolvedValue([wear('w2', '2026-11-03'), wear('w1', '2026-11-02')]);

  const { result } = await setup({ from: '2026-11-01', to: '2026-11-30', enabled: true, record: 'merge' });
  await flush();
  await act(async () => {
    result.current.removeLocal('w2');
    await Promise.resolve();
  });

  expect(result.current.wears?.map((w) => w.id)).toEqual(['w1']);
});
