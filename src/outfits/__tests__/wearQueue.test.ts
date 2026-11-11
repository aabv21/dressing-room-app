import { kvRemove } from '../../lib/kv';
import type { RequestResult } from '../../lib/requestResult';
import type { LogWearInput } from '../outfitRepository';
import {
  dequeueWear,
  enqueueWear,
  flushWearQueue,
  logWearOrQueue,
  queuedAsWears,
  queuedWears,
  wearQueueKey,
  withQueuedWears,
} from '../wearQueue';

const USER = 'user-1';
const input = (wearId: string, garmentIds: string[] = ['g1', 'g2']): LogWearInput => ({
  wearId,
  garmentIds,
  wornOn: '2026-11-10',
  occasion: 'office',
  score: 82,
});
const ok: RequestResult = { ok: true };
const fail = (error: 'network' | 'invalid' | 'unknown'): RequestResult => ({ ok: false, error });
const session = () => USER;

beforeEach(() => {
  kvRemove(wearQueueKey(USER));
});

describe('logWearOrQueue', () => {
  test('a logged wear is not queued', async () => {
    const send = jest.fn(() => Promise.resolve(ok));
    await expect(logWearOrQueue(USER, input('w1'), send)).resolves.toEqual({ status: 'logged' });
    expect(queuedWears(USER)).toEqual([]);
  });

  test('a network failure queues the wear', async () => {
    const send = jest.fn(() => Promise.resolve(fail('network')));
    await expect(logWearOrQueue(USER, input('w1'), send)).resolves.toEqual({ status: 'queued' });
    expect(queuedWears(USER)).toEqual([input('w1')]);
  });

  test('any other failure is reported and nothing is queued', async () => {
    const send = jest.fn(() => Promise.resolve(fail('invalid')));
    await expect(logWearOrQueue(USER, input('w1'), send)).resolves.toEqual({ status: 'failed', error: 'invalid' });
    expect(queuedWears(USER)).toEqual([]);
  });
});

test('enqueuing the same wear id twice keeps one entry', () => {
  enqueueWear(USER, input('w1'));
  enqueueWear(USER, input('w1'));
  expect(queuedWears(USER)).toHaveLength(1);
});

test('dequeueWear removes a queued wear and reports whether it was there', () => {
  enqueueWear(USER, input('w1'));
  expect(dequeueWear(USER, 'w1')).toBe(true);
  expect(dequeueWear(USER, 'w1')).toBe(false);
  expect(queuedWears(USER)).toEqual([]);
});

test('queuedAsWears maps each queued wear to a diary row keyed by its wear id', () => {
  enqueueWear(USER, input('w1', ['g3']));
  expect(queuedAsWears(USER)).toEqual([
    { id: 'w1', wornOn: '2026-11-10', occasion: 'office', score: 82, garmentIds: ['g3'] },
  ]);
});

describe('flushWearQueue', () => {
  test('sends every queued wear in order and empties the queue', async () => {
    enqueueWear(USER, input('w1'));
    enqueueWear(USER, input('w2'));
    const send = jest.fn((sent: LogWearInput) => Promise.resolve(sent.wearId === '' ? fail('invalid') : ok));

    await expect(flushWearQueue(USER, { send, sessionUserId: session })).resolves.toEqual({
      sent: 2,
      dropped: 0,
      remaining: 0,
    });
    expect(send.mock.calls.map(([sent]) => sent.wearId)).toEqual(['w1', 'w2']);
    expect(queuedWears(USER)).toEqual([]);
  });

  test('an invalid queued wear is dropped and the rest still send', async () => {
    enqueueWear(USER, input('w1'));
    enqueueWear(USER, input('w2'));
    const send = jest.fn((sent: LogWearInput) => Promise.resolve(sent.wearId === 'w1' ? fail('invalid') : ok));

    await expect(flushWearQueue(USER, { send, sessionUserId: session })).resolves.toEqual({
      sent: 1,
      dropped: 1,
      remaining: 0,
    });
  });

  test('flush stops at a network error and keeps the order', async () => {
    enqueueWear(USER, input('w1'));
    enqueueWear(USER, input('w2'));
    enqueueWear(USER, input('w3'));
    const send = jest.fn((sent: LogWearInput) => Promise.resolve(sent.wearId === 'w2' ? fail('network') : ok));

    await expect(flushWearQueue(USER, { send, sessionUserId: session })).resolves.toEqual({
      sent: 1,
      dropped: 0,
      remaining: 2,
    });
    expect(queuedWears(USER).map((w) => w.wearId)).toEqual(['w2', 'w3']);
  });

  test('flush sends nothing when the session belongs to another user', async () => {
    enqueueWear(USER, input('w1'));
    const send = jest.fn(() => Promise.resolve(ok));

    await expect(flushWearQueue(USER, { send, sessionUserId: () => 'user-2' })).resolves.toEqual({
      sent: 0,
      dropped: 0,
      remaining: 1,
    });
    expect(send).not.toHaveBeenCalled();
  });

  test('two flushes at once send each wear once', async () => {
    enqueueWear(USER, input('w1'));
    enqueueWear(USER, input('w2'));
    const send = jest.fn(() => Promise.resolve(ok));

    await Promise.all([
      flushWearQueue(USER, { send, sessionUserId: session }),
      flushWearQueue(USER, { send, sessionUserId: session }),
    ]);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

test('withQueuedWears adds the queued wears in the range, newest first, without repeating a sent one', () => {
  enqueueWear(USER, { ...input('q-new'), wornOn: '2026-11-10' });
  enqueueWear(USER, { ...input('w-sent'), wornOn: '2026-11-09' });
  enqueueWear(USER, { ...input('q-old'), wornOn: '2026-10-01' });
  const fetched = [
    { id: 'w-sent', wornOn: '2026-11-09', occasion: null, score: null, garmentIds: ['g1'] },
    { id: 'w-a', wornOn: '2026-11-09', occasion: null, score: null, garmentIds: ['g1'] },
    { id: 'w-b', wornOn: '2026-11-02', occasion: null, score: null, garmentIds: ['g1'] },
  ];

  expect(withQueuedWears(USER, fetched, '2026-11-01', '2026-11-30').map((w) => w.id)).toEqual([
    'q-new',
    'w-sent',
    'w-a',
    'w-b',
  ]);
});

test("a wear being sent can't be dequeued: Diary then deletes it on the server instead", async () => {
  enqueueWear(USER, input('w1'));
  let finish: (result: RequestResult) => void = () => undefined;
  const send = jest.fn(
    () =>
      new Promise<RequestResult>((resolve) => {
        finish = resolve;
      }),
  );
  const flush = flushWearQueue(USER, { send, sessionUserId: session });

  expect(dequeueWear(USER, 'w1')).toBe(false);
  finish(ok);
  await flush;
  expect(queuedWears(USER)).toEqual([]);
});
