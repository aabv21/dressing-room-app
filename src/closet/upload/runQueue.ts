import { PermanentUploadError } from './permanentUploadError';
import { listQueue, removeItem, saveItem, type QueueItem } from './queueStore';

export { PermanentUploadError };

// Drives queued photos through prepare → upload → commit. Each stage is persisted before the next, so
// a kill or lost connection repeats only the interrupted stage and never duplicates a garment.

export type QueueSteps = {
  prepare(sourceUri: string): Promise<{ fullUri: string; thumbUri: string }>;
  upload(item: QueueItem & { fullUri: string; thumbUri: string }): Promise<void>;
  commit(item: QueueItem): Promise<void>;
};

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const CONCURRENCY = 2;

/** `min(5s * 2^(attempts-1), 10min)`, attempts counted from 1. */
export function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

export type QueueStoreApi = {
  listQueue: typeof listQueue;
  saveItem: typeof saveItem;
  removeItem: typeof removeItem;
};

const defaultStore: QueueStoreApi = { listQueue, saveItem, removeItem };

export type RunQueueResult = { committed: number; failed: number; waiting: number };

/** Calls in flight, keyed by user, so overlapping callers share one pass instead of racing. */
const inFlight = new Map<string, Promise<RunQueueResult>>();

/**
 * Set when `runQueue` is called mid-pass: the running pass read its items once, up front, so it sweeps
 * again inside the same shared promise and the overlapping caller settles only once its item was tried.
 */
const rerunRequested = new Set<string>();

/** Users whose queue is paused: no pass, item or network stage starts for them. */
const paused = new Set<string>();

/**
 * Resolves once a running pass has stopped: a stage in flight finishes but nothing after it starts, so
 * no photo lands after account deletion's server listing until `resumeQueue`.
 */
export async function pauseQueue(userId: string): Promise<void> {
  paused.add(userId);
  await inFlight.get(userId)?.catch(() => undefined);
}

export function resumeQueue(userId: string): void {
  paused.delete(userId);
}

export function runQueue(
  userId: string,
  steps: QueueSteps,
  store: QueueStoreApi = defaultStore,
  now: () => number = Date.now,
): Promise<RunQueueResult> {
  if (paused.has(userId)) {
    return Promise.resolve({ committed: 0, failed: 0, waiting: 0 });
  }
  const existing = inFlight.get(userId);
  if (existing !== undefined) {
    rerunRequested.add(userId);
    return existing;
  }

  const pass = runQueuePasses(userId, steps, store, now).finally(() => {
    inFlight.delete(userId);
  });
  inFlight.set(userId, pass);
  return pass;
}

/** Repeats `runQueuePass` while a rerun was requested during the previous sweep, summing results. */
async function runQueuePasses(
  userId: string,
  steps: QueueSteps,
  store: QueueStoreApi,
  now: () => number,
): Promise<RunQueueResult> {
  let committed = 0;
  let failed = 0;
  let waiting = 0;
  for (;;) {
    rerunRequested.delete(userId);
    const sweep = await runQueuePass(userId, steps, store, now);
    committed += sweep.committed;
    failed += sweep.failed;
    waiting += sweep.waiting;
    if (!rerunRequested.has(userId) || paused.has(userId)) break;
  }
  return { committed, failed, waiting };
}

async function runQueuePass(
  userId: string,
  steps: QueueSteps,
  store: QueueStoreApi,
  now: () => number,
): Promise<RunQueueResult> {
  const items = store.listQueue(userId);
  const nowMs = now();

  let committed = 0;
  let failed = 0;
  let waiting = 0;
  const due: QueueItem[] = [];
  for (const item of items) {
    if (item.failed) {
      failed += 1;
    } else if (item.nextAttemptAt > nowMs) {
      waiting += 1;
    } else {
      due.push(item);
    }
  }

  const stopped = (): boolean => paused.has(userId);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const item = due.at(index);
      if (item === undefined || stopped()) return;
      const outcome = await advanceToCommit(item, steps, store, now, stopped);
      if (outcome === 'committed') {
        committed += 1;
      } else if (outcome === 'failed') {
        failed += 1;
      } else if (outcome === 'retry') {
        waiting += 1;
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, due.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  return { committed, failed, waiting };
}

/**
 * One attempt through the remaining stages, claimed (`attempts + 1` with its backoff) before any stage
 * runs: a native crash, OOM or kill never reaches the `catch`, so without the claim the item would rerun
 * forever. Every stage save carries the claim forward and the `catch` reuses it, so a failure counts once.
 */
async function advanceToCommit(
  item: QueueItem,
  steps: QueueSteps,
  store: QueueStoreApi,
  now: () => number,
  stopped: () => boolean,
): Promise<'committed' | 'failed' | 'retry' | 'stopped'> {
  // Only a crashed run leaves an item at the limit without `failed`: give up instead of a ninth run.
  if (item.attempts >= MAX_ATTEMPTS) {
    store.saveItem({ ...item, failed: true });
    return 'failed';
  }
  const attempts = item.attempts + 1;
  let current: QueueItem = { ...item, attempts, nextAttemptAt: now() + backoffMs(attempts) };
  store.saveItem(current);
  // A pause isn't a failure: the item keeps its stage, gives back the attempt and is due at once.
  const stop = (): 'stopped' => {
    store.saveItem({ ...current, attempts: item.attempts, nextAttemptAt: 0 });
    return 'stopped';
  };
  try {
    if (current.stage === 'captured') {
      const { fullUri, thumbUri } = await steps.prepare(current.sourceUri);
      current = { ...current, stage: 'prepared', fullUri, thumbUri };
      store.saveItem(current);
    }
    if (current.stage === 'prepared') {
      if (stopped()) return stop();
      const { fullUri, thumbUri } = current;
      if (fullUri === null || thumbUri === null) {
        throw new PermanentUploadError('prepared item is missing its resized images');
      }
      await steps.upload({ ...current, fullUri, thumbUri });
      current = { ...current, stage: 'uploaded' };
      store.saveItem(current);
    }
    if (stopped()) return stop();
    await steps.commit(current);
    store.removeItem(current);
    return 'committed';
  } catch (error) {
    if (__DEV__) console.warn('upload queue: attempt failed', error);
    const permanent = error instanceof PermanentUploadError;
    const failedItem: QueueItem = {
      ...current,
      nextAttemptAt: now() + backoffMs(attempts),
      failed: permanent || attempts >= MAX_ATTEMPTS,
    };
    store.saveItem(failedItem);
    // A retryable failure waits out its backoff; only a given-up item counts as failed.
    return failedItem.failed ? 'failed' : 'retry';
  }
}
