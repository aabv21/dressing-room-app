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

/** Users whose queue is paused: no pass, item or network stage starts for them. */
const paused = new Set<string>();

/**
 * Pauses `userId`'s queue and resolves once a pass already running has stopped. A stage in flight
 * finishes, but nothing after it starts (no upload, no commit, no next item), so once this
 * resolves nothing more of this user's reaches the server until `resumeQueue`. Account deletion
 * uses it so no photo lands after the server has listed the user's storage.
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
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, due.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  return { committed, failed, waiting };
}

/**
 * Advances one item through every remaining stage. Returns whether it committed, failed, or was
 * stopped by `pauseQueue` between two stages (its row keeps the last stage reached and its
 * attempts, due at once).
 *
 * Each call is one attempt, and it is claimed (persisted as `attempts + 1` with its backoff)
 * before any stage runs: a native crash or OOM in `prepare`, or a kill mid-upload, never reaches
 * the `catch`, so without the claim the next launch would re-run the same item forever. Every stage
 * save carries the claimed values forward, so one claim covers all three stages; a run that
 * succeeds removes the item, so its claim never costs a later run anything, and a run that fails
 * normally counts exactly once (the `catch` reuses the claim instead of adding another).
 */
async function advanceToCommit(
  item: QueueItem,
  steps: QueueSteps,
  store: QueueStoreApi,
  now: () => number,
  stopped: () => boolean,
): Promise<'committed' | 'failed' | 'stopped'> {
  // Only a crashed run can leave an item at the limit without `failed` set: give up instead of
  // running it a ninth time.
  if (item.attempts >= MAX_ATTEMPTS) {
    store.saveItem({ ...item, failed: true });
    return 'failed';
  }
  const attempts = item.attempts + 1;
  let current: QueueItem = { ...item, attempts, nextAttemptAt: now() + backoffMs(attempts) };
  store.saveItem(current);
  // A pause isn't a failure: the item keeps its stage, gives back the claimed attempt and is due
  // again as soon as the queue runs.
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
    const permanent = error instanceof PermanentUploadError;
    const failedItem: QueueItem = {
      ...current,
      nextAttemptAt: now() + backoffMs(attempts),
      failed: permanent || attempts >= MAX_ATTEMPTS,
    };
    store.saveItem(failedItem);
    return 'failed';
  }
}
