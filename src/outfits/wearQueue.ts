// "I'll wear it" while offline (spec §5.4: "writes queue until the connection returns"): a wear the
// network couldn't send waits in kv, keyed by user, and `WearQueueFlusher` sends it on the next
// launch, foreground or reconnect. `log_wear` is idempotent per client wear id, so a wear that did
// reach the server before its answer was lost is never logged twice.
import { OCCASIONS } from '../closet/catalog';
import { kvGet, kvSet } from '../lib/kv';
import type { RequestError, RequestResult } from '../lib/requestResult';
import type { WearWithItems } from '../stats/wearsRepository';
import type { LogWearInput } from './outfitRepository';

/** The queue's kv key; its `<name>.<id>` shape lets the account cleanup clear and refuse it. */
export function wearQueueKey(userId: string): string {
  return `wear.queue.${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInput(value: unknown): value is LogWearInput {
  return (
    isRecord(value) &&
    typeof value.wearId === 'string' &&
    Array.isArray(value.garmentIds) &&
    value.garmentIds.every((id) => typeof id === 'string') &&
    typeof value.wornOn === 'string' &&
    (value.occasion === null || OCCASIONS.some((occasion) => occasion === value.occasion)) &&
    (value.score === null || typeof value.score === 'number')
  );
}

/** The queued wears, oldest first; an unreadable record reads as empty. */
export function queuedWears(userId: string): LogWearInput[] {
  const raw = kvGet(wearQueueKey(userId));
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isInput) : [];
  } catch {
    return [];
  }
}

function writeQueue(userId: string, wears: readonly LogWearInput[]): void {
  kvSet(wearQueueKey(userId), JSON.stringify(wears));
}

/** Adds a wear to the end of the queue; a wear id already queued is ignored. */
export function enqueueWear(userId: string, input: LogWearInput): void {
  const queue = queuedWears(userId);
  if (queue.some((queued) => queued.wearId === input.wearId)) return;
  writeQueue(userId, [...queue, input]);
}

/** Removes a queued wear (Diary's Delete before it was sent); true when it was queued. */
export function dequeueWear(userId: string, wearId: string): boolean {
  const queue = queuedWears(userId);
  const rest = queue.filter((queued) => queued.wearId !== wearId);
  if (rest.length === queue.length) return false;
  writeQueue(userId, rest);
  return true;
}

/** The queued wears as Stats and Diary rows, keyed by their wear id (the row's id once sent). */
export function queuedAsWears(userId: string): WearWithItems[] {
  return queuedWears(userId).map((queued) => ({
    id: queued.wearId,
    wornOn: queued.wornOn,
    occasion: queued.occasion,
    score: queued.score,
    garmentIds: [...queued.garmentIds],
  }));
}

/**
 * `wears` (newest first, as `listWears` returns them) plus the queued wears with `wornOn` in
 * `[from, to]` that the server doesn't have yet, each placed first within its day (the latest logged).
 */
export function withQueuedWears(
  userId: string,
  wears: readonly WearWithItems[],
  from: string,
  to: string,
): WearWithItems[] {
  const known = new Set(wears.map((wear) => wear.id));
  const queued = queuedAsWears(userId).filter((wear) => !known.has(wear.id) && wear.wornOn >= from && wear.wornOn <= to);
  if (queued.length === 0) return [...wears];
  return [...queued.reverse(), ...wears].sort((a, b) => (a.wornOn < b.wornOn ? 1 : a.wornOn > b.wornOn ? -1 : 0));
}

export type WearOutcome = { status: 'logged' } | { status: 'queued' } | { status: 'failed'; error: RequestError };

/** Logs a wear now, or queues it when the network failed; any other failure is reported. */
export async function logWearOrQueue(
  userId: string,
  input: LogWearInput,
  /** `logWear`, passed in so this module stays free of the Supabase client. */
  send: (input: LogWearInput) => Promise<RequestResult>,
): Promise<WearOutcome> {
  const outcome = await send(input);
  if (outcome.ok) return { status: 'logged' };
  if (outcome.error === 'network') {
    enqueueWear(userId, input);
    return { status: 'queued' };
  }
  return { status: 'failed', error: outcome.error };
}

export type FlushResult = { sent: number; dropped: number; remaining: number };

type FlushDeps = {
  /** `logWear`, passed in by `WearQueueFlusher` like the session check below. */
  send: (input: LogWearInput) => Promise<RequestResult>;
  /**
   * The stored session's user (`storedSessionUserId`); nothing is sent under another account's
   * session.
   */
  sessionUserId: () => string | null;
};

const flushing = new Map<string, Promise<FlushResult>>();

async function runFlush(
  userId: string,
  send: (input: LogWearInput) => Promise<RequestResult>,
  sessionUserId: () => string | null,
): Promise<FlushResult> {
  let sent = 0;
  let dropped = 0;
  for (;;) {
    const next = queuedWears(userId)[0];
    if (next === undefined || sessionUserId() !== userId) break;
    const outcome = await send(next);
    if (outcome.ok) {
      sent += 1;
    } else if (outcome.error === 'invalid') {
      // The server refused it as sent (e.g. a garment was deleted meanwhile): retrying can't help.
      dropped += 1;
      if (__DEV__) console.warn('wearQueue: dropped a queued wear the server refused', next.wearId);
    } else {
      break;
    }
    dequeueWear(userId, next.wearId);
  }
  return { sent, dropped, remaining: queuedWears(userId).length };
}

/** Sends the queued wears in order; at most one flush runs per user, and a second call joins it. */
export function flushWearQueue(userId: string, deps: FlushDeps): Promise<FlushResult> {
  const running = flushing.get(userId);
  if (running !== undefined) return running;
  const flush = runFlush(userId, deps.send, deps.sessionUserId).finally(() => {
    flushing.delete(userId);
  });
  flushing.set(userId, flush);
  return flush;
}
