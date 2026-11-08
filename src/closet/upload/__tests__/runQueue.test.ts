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

import { PermanentUploadError, backoffMs, runQueue } from '../runQueue';

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

// `QueueStoreApi`/`QueueSteps` are declared with method-shorthand syntax (matching the brief's
// exact interfaces), which trips `@typescript-eslint/unbound-method` the moment a test asserts on
// one of these functions with `toHaveBeenCalledWith`/`toHaveBeenCalledTimes` (the rule treats a
// shorthand method as a potentially-`this`-bound class method). Fakes below are therefore typed as
// plain `jest.Mock`-property bags, not as `QueueStoreApi`/`QueueSteps` themselves, and are passed
// to `runQueue` where only its parameter's structural type is checked — same pattern as
// `src/auth/__tests__/authService.test.ts`'s `fakeClient`.

type FakeStore = {
  listQueue: jest.Mock;
  saveItem: jest.Mock;
  removeItem: jest.Mock;
  all: () => QueueItem[];
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

  expect(first).toEqual({ committed: 0, failed: 1, waiting: 0 });
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

test('a non-8th failure keeps the item retryable', async () => {
  const store = createFakeStore([makeItem({ attempts: 2 })]);
  const steps = createSteps();
  steps.commit.mockRejectedValueOnce(new TypeError('Network request failed'));

  const result = await runQueue('user-1', steps, store, () => 0);

  expect(result).toEqual({ committed: 0, failed: 1, waiting: 0 });
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
