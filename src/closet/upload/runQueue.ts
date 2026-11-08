import { PermanentUploadError } from './permanentUploadError';
import { listQueue, removeItem, saveItem, type QueueItem } from './queueStore';

export { PermanentUploadError };

/**
 * Drives queued garment photos through capture → prepare → upload → commit, resumably: each
 * stage is persisted before the next starts, so an app kill or lost connection only ever repeats
 * the stage that was interrupted, never an earlier one, and never leaves two copies of the same
 * garment. `queueStore.ts` only persists items; this module decides what runs next and how
 * failures back off.
 */

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
 * Set when a call to `runQueue` arrives while a pass for that user is already running. Without
 * this, an item enqueued mid-pass (e.g. from the camera screen while a previous batch is still
 * uploading) would sit until some later, unrelated trigger called `runQueue` again — the running
 * pass took its item list once, up front, and never looks again. Checked (and cleared) after each
 * sweep through `due`; set, it starts another sweep inside the same shared promise instead of
 * resolving, so the overlapping caller's own `await runQueue(...)` only settles once its item has
 * actually been attempted.
 */
const rerunRequested = new Set<string>();

export function runQueue(
  userId: string,
  steps: QueueSteps,
  store: QueueStoreApi = defaultStore,
  now: () => number = Date.now,
): Promise<RunQueueResult> {
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
    if (!rerunRequested.has(userId)) break;
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

  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const item = due.at(index);
      if (item === undefined) return;
      if (await advanceToCommit(item, steps, store, now)) {
        committed += 1;
      } else {
        failed += 1;
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, due.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  return { committed, failed, waiting };
}

/** Advances one item through every remaining stage. Returns whether it committed. */
async function advanceToCommit(
  item: QueueItem,
  steps: QueueSteps,
  store: QueueStoreApi,
  now: () => number,
): Promise<boolean> {
  let current = item;
  try {
    if (current.stage === 'captured') {
      const { fullUri, thumbUri } = await steps.prepare(current.sourceUri);
      current = { ...current, stage: 'prepared', fullUri, thumbUri };
      store.saveItem(current);
    }
    if (current.stage === 'prepared') {
      const { fullUri, thumbUri } = current;
      if (fullUri === null || thumbUri === null) {
        throw new PermanentUploadError('prepared item is missing its resized images');
      }
      await steps.upload({ ...current, fullUri, thumbUri });
      current = { ...current, stage: 'uploaded' };
      store.saveItem(current);
    }
    await steps.commit(current);
    store.removeItem(current);
    return true;
  } catch (error) {
    const attempts = current.attempts + 1;
    const permanent = error instanceof PermanentUploadError;
    const failedItem: QueueItem = {
      ...current,
      attempts,
      nextAttemptAt: now() + backoffMs(attempts),
      failed: permanent || attempts >= MAX_ATTEMPTS,
    };
    store.saveItem(failedItem);
    return false;
  }
}
