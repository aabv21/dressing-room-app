import type { QueueItem } from '../queueStore';

// `runQueue.ts` imports `queueStore.ts` for its default `QueueStoreApi` (every test here supplies
// its own fake store instead) and for the `QueueItem` type. `queueStore.ts` opens a real SQLite
// database and touches expo-file-system/expo-crypto at import time, so those three native modules
// are mocked before the import — the fakes are never exercised since no test uses the default
// store, but the module graph must still load under plain jest-expo.
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => ({
    execSync: jest.fn(),
    runSync: jest.fn(),
    getAllSync: jest.fn(() => []),
    getFirstSync: jest.fn(() => null),
  })),
}));
jest.mock('expo-file-system', () => ({
  File: function File() {
    // Never constructed: queueStore.ts only calls `new File(...)` inside functions this suite
    // never exercises (every test here supplies its own fake store, not the real one).
  },
  Directory: function Directory() {
    // Same as File above.
  },
  Paths: { document: { uri: 'file:///document' }, extname: () => '' },
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid') }));

import { PermanentUploadError, backoffMs, pauseQueue, resumeQueue, runQueue } from '../runQueue';

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    garmentId: 'garment-1',
    userId: 'user-1',
    replace: false,
    sourceUri: 'file:///uploads/garment-1-source.jpg',
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

// `QueueStoreApi`/`QueueSteps` are declared with method-shorthand syntax, which trips
// `@typescript-eslint/unbound-method` the moment a test asserts on one of these functions with
// `toHaveBeenCalledWith`/`toHaveBeenCalledTimes` (the rule treats a shorthand method as a
// potentially-`this`-bound class method). Fakes below are therefore typed as plain
// `jest.Mock`-property bags, not as `QueueStoreApi`/`QueueSteps` themselves, and are passed to
// `runQueue` where only its parameter's structural type is checked — same pattern as
// `src/auth/__tests__/authService.test.ts`'s `fakeClient`.

type FakeStore = {
  listQueue: jest.Mock;
  saveItem: jest.Mock;
  removeItem: jest.Mock;
  all: () => QueueItem[];
  /** Inserts an item directly into the backing store, as `queueStore.ts`'s `enqueue*` would. */
  enqueue: (item: QueueItem) => void;
};

/** An in-memory QueueStoreApi, scoped to one user, for exercising runQueue without real SQLite. */
function createFakeStore(initial: readonly QueueItem[]): FakeStore {
  const rows = new Map(initial.map((item) => [item.garmentId, item]));
  return {
    listQueue: jest.fn((userId: string) =>
      [...rows.values()].filter((item) => item.userId === userId).sort((a, b) => a.createdAt - b.createdAt),
    ),
    saveItem: jest.fn((item: QueueItem) => {
      rows.set(item.garmentId, item);
    }),
    removeItem: jest.fn((item: QueueItem) => {
      rows.delete(item.garmentId);
    }),
    all: () => [...rows.values()],
    enqueue: (item: QueueItem) => {
      rows.set(item.garmentId, item);
    },
  };
}

type FakeSteps = {
  prepare: jest.Mock;
  upload: jest.Mock;
  commit: jest.Mock;
};

function createSteps(): FakeSteps {
  const prepare = jest.fn<Promise<{ fullUri: string; thumbUri: string }>, [string]>(() =>
    Promise.resolve({ fullUri: 'file:///full.webp', thumbUri: 'file:///thumb.webp' }),
  );
  const upload = jest.fn<Promise<void>, [QueueItem & { fullUri: string; thumbUri: string }]>(() =>
    Promise.resolve(),
  );
  const commit = jest.fn<Promise<void>, [QueueItem]>(() => Promise.resolve());
  return { prepare, upload, commit };
}

test('happy path calls prepare, upload and commit once each and empties the queue', async () => {
  const store = createFakeStore([makeItem()]);
  const steps = createSteps();

  const result = await runQueue('user-1', steps, store, () => 0);

  expect(result).toEqual({ committed: 1, failed: 0, waiting: 0 });
  expect(steps.prepare).toHaveBeenCalledTimes(1);
  expect(steps.upload).toHaveBeenCalledTimes(1);
  expect(steps.commit).toHaveBeenCalledTimes(1);
  expect(store.all()).toHaveLength(0);
});

test('an interrupted commit resumes from uploaded without repeating prepare or upload', async () => {
  const store = createFakeStore([makeItem()]);
  const steps = createSteps();
  steps.commit.mockRejectedValueOnce(new TypeError('Network request failed'));

  const first = await runQueue('user-1', steps, store, () => 0);

  // A retryable failure waits out its backoff: it isn't counted as failed.
  expect(first).toEqual({ committed: 0, failed: 0, waiting: 1 });
  const [afterFirst] = store.all();
  expect(afterFirst?.stage).toBe('uploaded');
  expect(afterFirst?.attempts).toBe(1);
  expect(afterFirst?.failed).toBe(false);
  expect(steps.prepare).toHaveBeenCalledTimes(1);
  expect(steps.upload).toHaveBeenCalledTimes(1);

  const second = await runQueue('user-1', steps, store, () => backoffMs(1));

  expect(second).toEqual({ committed: 1, failed: 0, waiting: 0 });
  expect(steps.prepare).toHaveBeenCalledTimes(1);
  expect(steps.upload).toHaveBeenCalledTimes(1);
  expect(steps.commit).toHaveBeenCalledTimes(2);
  expect(store.all()).toHaveLength(0);
});

test('an item before its nextAttemptAt is skipped and counted as waiting', async () => {
  const store = createFakeStore([makeItem({ nextAttemptAt: 10_000, attempts: 1 })]);
  const steps = createSteps();

  const result = await runQueue('user-1', steps, store, () => 5_000);

  expect(result).toEqual({ committed: 0, failed: 0, waiting: 1 });
  expect(steps.prepare).not.toHaveBeenCalled();
});

test('a PermanentUploadError from upload marks the item failed immediately', async () => {
  const store = createFakeStore([makeItem()]);
  const steps = createSteps();
  steps.upload.mockRejectedValueOnce(new PermanentUploadError('rejected by server'));

  const result = await runQueue('user-1', steps, store, () => 0);

  expect(result).toEqual({ committed: 0, failed: 1, waiting: 0 });
  const [item] = store.all();
  expect(item?.failed).toBe(true);
  expect(item?.attempts).toBe(1);
  expect(steps.commit).not.toHaveBeenCalled();
});

test('the 8th failure marks the item failed', async () => {
  const store = createFakeStore([makeItem({ attempts: 7 })]);
  const steps = createSteps();
  steps.commit.mockRejectedValueOnce(new TypeError('Network request failed'));

  const result = await runQueue('user-1', steps, store, () => 0);

  expect(result).toEqual({ committed: 0, failed: 1, waiting: 0 });
  const [item] = store.all();
  expect(item?.attempts).toBe(8);
  expect(item?.failed).toBe(true);
});

test("a non-8th failure keeps the item retryable, counts it as waiting, and logs the reason in dev", async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const store = createFakeStore([makeItem({ attempts: 2 })]);
  const steps = createSteps();
  steps.commit.mockRejectedValueOnce(new TypeError('Network request failed'));

  const result = await runQueue('user-1', steps, store, () => 0);

  expect(result).toEqual({ committed: 0, failed: 0, waiting: 1 });
  expect(warn).toHaveBeenCalledWith('upload queue: attempt failed', expect.objectContaining({ message: 'Network request failed' }));
  warn.mockRestore();
  const [item] = store.all();
  expect(item?.attempts).toBe(3);
  expect(item?.failed).toBe(false);
  expect(item?.nextAttemptAt).toBe(backoffMs(3));
});

test('a failed item is skipped and counted as failed, not re-attempted', async () => {
  const store = createFakeStore([makeItem({ failed: true, attempts: 8 })]);
  const steps = createSteps();

  const result = await runQueue('user-1', steps, store, () => 0);

  expect(result).toEqual({ committed: 0, failed: 1, waiting: 0 });
  expect(steps.prepare).not.toHaveBeenCalled();
});

/** A promise plus the function that resolves it, for controlling exactly when a mock settles. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test('two concurrent runQueue calls for the same user share one pass', async () => {
  const store = createFakeStore([makeItem({ garmentId: 'a' }), makeItem({ garmentId: 'b' })]);
  const steps = createSteps();
  const gates = [deferred<{ fullUri: string; thumbUri: string }>(), deferred<{ fullUri: string; thumbUri: string }>()];
  let call = 0;
  steps.prepare.mockImplementation(() => {
    const gate = gates.at(call);
    call += 1;
    return gate?.promise ?? Promise.resolve({ fullUri: 'file:///full.webp', thumbUri: 'file:///thumb.webp' });
  });

  const first = runQueue('user-1', steps, store, () => 0);
  const second = runQueue('user-1', steps, store, () => 0);

  for (const gate of gates) gate.resolve({ fullUri: 'file:///full.webp', thumbUri: 'file:///thumb.webp' });
  const [firstResult, secondResult] = await Promise.all([first, second]);

  expect(firstResult).toBe(secondResult);
  expect(firstResult).toEqual({ committed: 2, failed: 0, waiting: 0 });
  // Both in-flight item preparations belong to the single shared pass, not two separate passes'.
  expect(steps.prepare).toHaveBeenCalledTimes(2);
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test('at most 2 prepare calls are in flight at once', async () => {
  const store = createFakeStore([
    makeItem({ garmentId: 'a' }),
    makeItem({ garmentId: 'b' }),
    makeItem({ garmentId: 'c' }),
  ]);
  const steps = createSteps();
  let inFlight = 0;
  let maxInFlight = 0;
  const pendingGates: Array<() => void> = [];
  steps.prepare.mockImplementation(() => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const gate = deferred<{ fullUri: string; thumbUri: string }>();
    pendingGates.push(() => {
      gate.resolve({ fullUri: 'file:///full.webp', thumbUri: 'file:///thumb.webp' });
    });
    return gate.promise.then((value) => {
      inFlight -= 1;
      return value;
    });
  });

  const resultPromise = runQueue('user-1', steps, store, () => 0);

  // The first wave (concurrency 2) starts two prepare calls; the third item has to wait for one
  // of them to resolve, so only after releasing a gate does a third call appear.
  await flushMicrotasks();
  expect(pendingGates).toHaveLength(2);
  expect(maxInFlight).toBe(2);

  pendingGates.shift()?.();
  await flushMicrotasks();
  expect(pendingGates).toHaveLength(2);
  expect(steps.prepare).toHaveBeenCalledTimes(3);

  while (pendingGates.length > 0) {
    pendingGates.shift()?.();
    await flushMicrotasks();
  }

  await resultPromise;
  expect(maxInFlight).toBeLessThanOrEqual(2);
  expect(steps.prepare).toHaveBeenCalledTimes(3);
});

test('an item enqueued while a pass is running is committed by the same awaited call', async () => {
  // runQueue reads listQueue once per sweep; without a rerun flag an item added mid-pass
  // would sit until some unrelated later trigger called runQueue again.
  const store = createFakeStore([makeItem({ garmentId: 'a' })]);
  const steps = createSteps();
  const gate = deferred<{ fullUri: string; thumbUri: string }>();
  steps.prepare.mockReturnValueOnce(gate.promise);

  const resultPromise = runQueue('user-1', steps, store, () => 0);
  await flushMicrotasks();

  // A second item is enqueued into the same store while the first sweep is still mid-`prepare`
  // for garment 'a' — this call overlaps the in-flight pass, so it should set the rerun flag
  // instead of starting an unrelated second pass.
  store.enqueue(makeItem({ garmentId: 'b' }));
  const overlapping = runQueue('user-1', steps, store, () => 0);

  gate.resolve({ fullUri: 'file:///full.webp', thumbUri: 'file:///thumb.webp' });
  const [result, overlappingResult] = await Promise.all([resultPromise, overlapping]);

  expect(result).toBe(overlappingResult);
  expect(result).toEqual({ committed: 2, failed: 0, waiting: 0 });
  expect(steps.prepare).toHaveBeenCalledTimes(2);
  expect(store.all()).toHaveLength(0);
});

describe('pauseQueue', () => {
  afterEach(() => {
    resumeQueue('user-1');
  });

  test('waits for the running stage, then starts no upload, commit or next item', async () => {
    const store = createFakeStore([makeItem({ garmentId: 'a' }), makeItem({ garmentId: 'b', createdAt: 1 })]);
    const steps = createSteps();
    const gateA = deferred<{ fullUri: string; thumbUri: string }>();
    const gateB = deferred<{ fullUri: string; thumbUri: string }>();
    steps.prepare.mockReturnValueOnce(gateA.promise).mockReturnValueOnce(gateB.promise);

    const pass = runQueue('user-1', steps, store, () => 0);
    await flushMicrotasks();
    let paused = false;
    const pausing = pauseQueue('user-1').then(() => {
      paused = true;
    });
    await flushMicrotasks();
    expect(paused).toBe(false);

    gateA.resolve({ fullUri: 'file:///full.webp', thumbUri: 'file:///thumb.webp' });
    gateB.resolve({ fullUri: 'file:///full.webp', thumbUri: 'file:///thumb.webp' });
    await pausing;
    await pass;

    expect(paused).toBe(true);
    expect(steps.upload).not.toHaveBeenCalled();
    expect(steps.commit).not.toHaveBeenCalled();
    // Stopped, not failed: each keeps its prepared stage and its attempts, and is due at once.
    expect(store.all()).toHaveLength(2);
    for (const stored of store.all()) {
      expect(stored).toMatchObject({ stage: 'prepared', attempts: 0, nextAttemptAt: 0, failed: false });
    }
  });

  test('a paused queue starts no pass until it is resumed', async () => {
    const store = createFakeStore([makeItem()]);
    const steps = createSteps();

    await pauseQueue('user-1');
    expect(await runQueue('user-1', steps, store, () => 0)).toEqual({ committed: 0, failed: 0, waiting: 0 });
    expect(steps.prepare).not.toHaveBeenCalled();
    expect(store.saveItem).not.toHaveBeenCalled();

    resumeQueue('user-1');
    expect(await runQueue('user-1', steps, store, () => 0)).toEqual({ committed: 1, failed: 0, waiting: 0 });
  });

  test('pausing one user leaves another user\'s queue running', async () => {
    const store = createFakeStore([makeItem({ userId: 'user-2' })]);
    const steps = createSteps();

    await pauseQueue('user-1');

    expect(await runQueue('user-2', steps, store, () => 0)).toEqual({ committed: 1, failed: 0, waiting: 0 });
  });
});

// A native crash (OOM in the cut-out or the image manipulator) kills the process mid-stage, so no
// `catch` ever runs. Simulated here by a stage that never settles: whatever the store holds at
// that point is exactly what the next launch would read back.
describe('a stage that crashes the app', () => {
  function never<T>(): Promise<T> {
    return new Promise<T>(() => undefined);
  }

  test('persists a claimed attempt before prepare runs', async () => {
    const store = createFakeStore([makeItem({ userId: 'crash-claim' })]);
    const steps = createSteps();
    steps.prepare.mockReturnValueOnce(never());

    void runQueue('crash-claim', steps, store, () => 1_000);
    await flushMicrotasks();

    expect(steps.prepare).toHaveBeenCalledTimes(1);
    const [claimed] = store.all();
    expect(claimed?.stage).toBe('captured');
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.nextAttemptAt).toBe(1_000 + backoffMs(1));
    expect(claimed?.failed).toBe(false);
  });

  test('a crash during upload after a successful prepare keeps the claimed attempt', async () => {
    const store = createFakeStore([makeItem({ userId: 'crash-upload' })]);
    const steps = createSteps();
    steps.upload.mockReturnValueOnce(never());

    void runQueue('crash-upload', steps, store, () => 0);
    await flushMicrotasks();

    const [claimed] = store.all();
    expect(claimed?.stage).toBe('prepared');
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.nextAttemptAt).toBe(backoffMs(1));
  });

  test('8 crashed launches mark the item failed on the next launch without running it again', async () => {
    let persisted = makeItem();
    let clock = 0;
    for (let launch = 1; launch <= 8; launch += 1) {
      // Each launch is a fresh process: a new user key keeps this test's never-settling passes
      // (the "crashed" ones) from being shared with the next launch through runQueue's in-flight map.
      const userId = `crash-loop-${String(launch)}`;
      const store = createFakeStore([{ ...persisted, userId }]);
      const steps = createSteps();
      steps.prepare.mockReturnValueOnce(never());
      clock = persisted.nextAttemptAt;

      void runQueue(userId, steps, store, () => clock);
      await flushMicrotasks();

      expect(steps.prepare).toHaveBeenCalledTimes(1);
      const [claimed] = store.all();
      if (claimed === undefined) throw new Error('the crashed item vanished');
      expect(claimed.attempts).toBe(launch);
      expect(claimed.failed).toBe(false);
      persisted = claimed;
    }

    const store = createFakeStore([{ ...persisted, userId: 'crash-loop-9' }]);
    const steps = createSteps();
    const result = await runQueue('crash-loop-9', steps, store, () => persisted.nextAttemptAt);

    expect(result).toEqual({ committed: 0, failed: 1, waiting: 0 });
    expect(steps.prepare).not.toHaveBeenCalled();
    const [item] = store.all();
    expect(item?.attempts).toBe(8);
    expect(item?.failed).toBe(true);
  });
});

describe('backoffMs', () => {
  test('attempt 1 is 5000ms', () => {
    expect(backoffMs(1)).toBe(5_000);
  });

  test('attempt 2 is 10000ms', () => {
    expect(backoffMs(2)).toBe(10_000);
  });

  test('attempt 9 caps at 600000ms', () => {
    expect(backoffMs(9)).toBe(600_000);
  });
});
